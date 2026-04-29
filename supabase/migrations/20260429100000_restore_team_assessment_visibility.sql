update public.evaluations e
set team_id = t.id
from public.teams t
where e.team_id is null
  and e.club_id = t.club_id
  and lower(trim(e.team)) = lower(trim(t.name));

insert into public.team_staff (team_id, user_id)
select distinct e.team_id, e.coach_id
from public.evaluations e
join public.users u on u.id = e.coach_id
where e.team_id is not null
  and e.coach_id is not null
  and u.role not in ('admin', 'super_admin')
on conflict (team_id, user_id) do nothing;

insert into public.team_staff (team_id, user_id)
select distinct s.team_id, s.created_by
from public.assessment_sessions s
join public.users u on u.id = s.created_by
where s.team_id is not null
  and s.created_by is not null
  and u.role not in ('admin', 'super_admin')
on conflict (team_id, user_id) do nothing;

drop policy if exists evaluations_select_scoped on public.evaluations;
create policy evaluations_select_scoped
on public.evaluations
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    evaluations.club_id = public.current_user_club_id()
    and (
      public.current_user_role_rank() >= 50
      or evaluations.coach_id = auth.uid()
      or exists (
        select 1
        from public.team_staff ts
        where ts.team_id = evaluations.team_id
          and ts.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.team_staff ts
        join public.teams t on t.id = ts.team_id
        where ts.user_id = auth.uid()
          and t.club_id = evaluations.club_id
          and lower(trim(t.name)) = lower(trim(evaluations.team))
      )
    )
  )
);
