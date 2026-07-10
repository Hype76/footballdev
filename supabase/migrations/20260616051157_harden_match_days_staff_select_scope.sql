-- Harden direct staff reads of Matchday rows.
--
-- The old match_days_staff_select_scoped policy allowed any same-club
-- authenticated non-parent user to read every Matchday row in the club.
-- That let Team A staff directly select private Team B fixtures through
-- the Supabase Data API. Keep privileged super admin read access explicit,
-- and require normal staff reads to be backed by a real team_staff assignment.

create or replace function public.can_read_match_day(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'super_admin'
    or (
      public.current_user_role() not in ('admin', 'parent_portal', 'super_admin')
      and public.current_user_club_id() is not null
      and public.current_user_role_rank() >= 20
      and target_team_id is not null
      and exists (
        select 1
        from public.team_staff ts
        where ts.team_id = target_team_id
          and ts.user_id = auth.uid()
      )
    );
$$;

revoke all on function public.can_read_match_day(uuid) from public;
revoke execute on function public.can_read_match_day(uuid) from anon;
grant execute on function public.can_read_match_day(uuid) to authenticated;
grant execute on function public.can_read_match_day(uuid) to service_role;

comment on function public.can_read_match_day(uuid) is
  'Returns true only for super admin or staff explicitly assigned to the target Matchday team. Used to prevent same-club cross-team direct reads.';

drop policy if exists match_days_staff_select_scoped on public.match_days;
create policy match_days_staff_select_scoped
on public.match_days
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.can_read_match_day(team_id)
  )
);
