drop policy if exists user_club_memberships_insert_scoped on public.user_club_memberships;
create policy user_club_memberships_insert_scoped
on public.user_club_memberships
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    auth.uid() = auth_user_id
    and (
      club_id = public.current_user_club_id()
      or exists (
        select 1
        from public.club_user_invites i
        where i.club_id = user_club_memberships.club_id
          and lower(i.email) = lower(user_club_memberships.email)
      )
    )
  )
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and role_rank <= public.current_user_role_rank()
  )
);

drop policy if exists user_club_memberships_update_scoped on public.user_club_memberships;
create policy user_club_memberships_update_scoped
on public.user_club_memberships
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    auth.uid() = auth_user_id
    and (
      club_id = public.current_user_club_id()
      or exists (
        select 1
        from public.club_user_invites i
        where i.club_id = user_club_memberships.club_id
          and lower(i.email) = lower(user_club_memberships.email)
      )
    )
  )
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and role_rank <= public.current_user_role_rank()
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    auth.uid() = auth_user_id
    and (
      club_id = public.current_user_club_id()
      or exists (
        select 1
        from public.club_user_invites i
        where i.club_id = user_club_memberships.club_id
          and lower(i.email) = lower(user_club_memberships.email)
      )
    )
  )
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
    and role_rank <= public.current_user_role_rank()
  )
);
