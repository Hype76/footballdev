insert into public.team_staff (team_id, user_id)
select single_team.team_id, u.id
from public.users u
join (
  select club_id, (array_agg(id))[1] as team_id
  from public.teams
  group by club_id
  having count(*) = 1
) single_team on single_team.club_id = u.club_id
where u.role not in ('admin', 'super_admin')
on conflict (team_id, user_id) do nothing;

insert into public.team_staff (team_id, user_id)
select s.team_id, s.created_by
from public.assessment_sessions s
join public.users u on u.id = s.created_by
where s.team_id is not null
  and s.created_by is not null
  and u.role not in ('admin', 'super_admin')
on conflict (team_id, user_id) do nothing;
