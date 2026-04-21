alter table public.teams
add column if not exists require_approval boolean not null default true;

update public.teams
set require_approval = true
where require_approval is null;

drop policy if exists teams_update_scoped on public.teams;
create policy teams_update_scoped
on public.teams
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    teams.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    teams.club_id = public.current_user_club_id()
    and public.current_user_role_rank() >= 50
  )
);
