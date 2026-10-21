-- Staff invitation authority is separate from ordinary coaching and role viewing.
create function app_private.staff_admin_can_invite(actor_value uuid, club_value uuid, team_value uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    join public.clubs c on c.id=u.club_id and c.status='active' and c.archived_at is null
    join auth.users au on au.id=u.id and au.email_confirmed_at is not null
      and (au.banned_until is null or au.banned_until<=now())
    join public.user_club_memberships m on m.auth_user_id=u.id and m.club_id=u.club_id
      and m.role=u.role and m.role_rank=u.role_rank
    where u.id=actor_value and u.club_id=club_value and u.status='active'
      and public.is_club_plan_access_active(c.id)
      and ((u.role='admin' and u.role_rank>=90)
        or (team_value is not null and exists (
          select 1 from public.teams t where t.id=team_value and t.club_id=club_value
            and app_private.team_admin_can_manage(actor_value,t.id)
        )))
  );
$$;
revoke all on function app_private.staff_admin_can_invite(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.current_user_can_invite_staff(club_value uuid, team_value uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (public.current_user_role()='super_admin'
    or app_private.staff_admin_can_invite(auth.uid(),club_value,team_value));
$$;
revoke all on function public.current_user_can_invite_staff(uuid,uuid) from public,anon;
grant execute on function public.current_user_can_invite_staff(uuid,uuid) to authenticated;

-- Mail transport derives the actor from the verified session and rechecks the stored invitation.
create function public.staff_invite_actor_can_send(actor_value uuid, invite_value uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.club_user_invites i
    where i.id=invite_value and i.status='pending' and i.accepted_at is null
      and i.cancelled_at is null and i.replaced_at is null and i.expires_at>now()
      and i.invite_token is not null
      and app_private.staff_admin_can_invite(actor_value,i.club_id,i.team_id)
      and i.role_rank <= (select case when u.role='admin' then u.role_rank else 70 end
        from public.users u where u.id=actor_value)
  );
$$;
revoke all on function public.staff_invite_actor_can_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_invite_actor_can_send(uuid,uuid) to service_role;

-- Scoped Team Admins must also read returned rows after an invitation write.
drop policy if exists club_user_invites_select_scoped on public.club_user_invites;
create policy club_user_invites_select_scoped on public.club_user_invites
for select to authenticated using (
  public.current_user_role()='super_admin'
  or (club_id=public.current_user_club_id() and public.current_user_role_rank()>=50)
  or public.current_user_can_invite_staff(club_id,team_id)
  or lower(email)=lower(coalesce(auth.jwt()->>'email',''))
);

drop policy if exists club_user_invites_insert_scoped on public.club_user_invites;
create policy club_user_invites_insert_scoped on public.club_user_invites
for insert to authenticated with check (
  public.current_user_role()='super_admin' or (
    club_id=public.current_user_club_id()
    and role_rank<=case when public.current_user_role()='admin' then public.current_user_role_rank() else 70 end
    and public.current_user_can_invite_staff(club_id,team_id)
    and public.can_insert_staff_invite_for_plan(club_id,email)
    and ((team_id is not null and public.can_use_plan_feature(club_id,'teamStaffRoles'))
      or (team_id is null and public.can_use_plan_feature(club_id,'clubStaffRoles')))
  )
);

drop policy if exists club_user_invites_update_scoped on public.club_user_invites;
create policy club_user_invites_update_scoped on public.club_user_invites
for update to authenticated using (
  public.current_user_role()='super_admin' or (
    club_id=public.current_user_club_id()
    and role_rank<=case when public.current_user_role()='admin' then public.current_user_role_rank() else 70 end
    and public.current_user_can_invite_staff(club_id,team_id)
  )
) with check (
  public.current_user_role()='super_admin' or (
    club_id=public.current_user_club_id()
    and role_rank<=case when public.current_user_role()='admin' then public.current_user_role_rank() else 70 end
    and public.current_user_can_invite_staff(club_id,team_id)
  )
);

-- Preserve the established role mutation while adding fresh administrator authority.
alter function public.set_club_user_role(uuid,text,uuid) set schema app_private;
revoke all on function app_private.set_club_user_role(uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.set_club_user_role(target_user_id uuid,target_role_key text,target_team_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_club uuid;
begin
  select u.club_id into target_club from public.users u where u.id=target_user_id;
  if not coalesce(public.current_user_can_invite_staff(target_club,target_team_id),false) then
    raise exception using errcode='42501',message='Only a Team Admin or Club Admin can add staff.';
  end if;
  return app_private.set_club_user_role(target_user_id,target_role_key,target_team_id);
end;
$$;
revoke all on function public.set_club_user_role(uuid,text,uuid) from public,anon;
grant execute on function public.set_club_user_role(uuid,text,uuid) to authenticated;
