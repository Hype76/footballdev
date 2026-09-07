-- Remove cancelled invitations from the owner list without losing invitation history or statistics.
alter table public.fan_connections add column owner_deleted_at timestamptz;
alter table public.fan_connections add constraint fan_owner_delete_cancelled_only
  check (owner_deleted_at is null or status = 'cancelled');

create or replace function public.delete_cancelled_fan_invitation(connection_id_value uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare target public.fan_connections%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='Sign in to delete a cancelled invitation.';
  end if;
  select * into target from public.fan_connections where id=connection_id_value for update;
  if target.id is null or target.invited_by<>auth.uid()
    or not app_private.fan_scope_active(target.parent_link_id,target.player_id,target.club_id,target.invited_by) then
    raise exception using errcode='42501',message='Only the inviting Parent can delete this invitation.';
  end if;
  if target.status<>'cancelled' or target.relationship_type<>'fan' then
    raise exception using errcode='42501',message='Only cancelled Fan invitations can be deleted.';
  end if;
  if target.owner_deleted_at is null then
    update public.fan_connections set owner_deleted_at=now(),updated_at=now() where id=target.id;
  end if;
end;
$$;
revoke all on function public.delete_cancelled_fan_invitation(uuid) from public, anon;
grant execute on function public.delete_cancelled_fan_invitation(uuid) to authenticated;

create or replace function public.list_fan_connections()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'parent_link_id',f.parent_link_id,'player_id',f.player_id,'club_id',f.club_id,
    'player_name',p.player_name,'club_name',c.name,'club_logo_url',c.logo_url,'theme_accent',c.theme_accent,'theme_button_style',c.theme_button_style,'team_id',p.team_id,'team_name',t.name,
    'name',f.name,'email',f.email,'relationship_type',f.relationship_type,'permissions',f.permissions,
    'status',case when f.status='pending' and f.expires_at<=now() then 'expired' else f.status end,
    'created_at',f.created_at,'expires_at',f.expires_at,'accepted_at',f.accepted_at,'updated_at',f.updated_at,
    'notifications_enabled',f.notifications_enabled,'is_owner',f.invited_by=auth.uid(),
    'invite_token',case when f.invited_by=auth.uid() and f.status='pending' and f.expires_at>now() then f.invite_token end
  ) order by f.created_at desc),'[]'::jsonb)
  from public.fan_connections f join public.players p on p.id=f.player_id join public.clubs c on c.id=f.club_id
  left join public.teams t on t.id=p.team_id
  where auth.uid() is not null and app_private.fan_scope_active(f.parent_link_id,f.player_id,f.club_id,f.invited_by)
    and ((f.invited_by=auth.uid() and f.owner_deleted_at is null) or (f.auth_user_id=auth.uid() and f.status='active'))
    and not exists(select 1 from public.users u where u.id=auth.uid() and u.status='suspended' and (u.role='parent_portal' or u.club_id=f.club_id));
$$;

revoke all on function public.list_fan_connections() from public, anon;
grant execute on function public.list_fan_connections() to authenticated;
