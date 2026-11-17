create function public.list_own_staff_workspace_options()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with linked_clubs as (
    select club.id, club.name, club.logo_url, club.status, club.plan_key, club.plan_status,
      club.is_plan_comped, club.tester_access_expires_at, club.theme_accent, club.theme_button_style,
      membership.role as membership_role
    from public.user_club_memberships membership
    join public.users actor on actor.id = membership.auth_user_id and actor.status = 'active'
    join public.clubs club on club.id = membership.club_id
    where membership.auth_user_id = (select auth.uid())
      and membership.role in ('admin', 'head_manager', 'manager', 'coach', 'assistant_coach')
      and membership.role_rank >= 20
      and club.archived_at is null
      and coalesce(club.status, 'active') = 'active'
      and club.id is distinct from public.current_user_club_id()
  ),
  team_options as (
    select team.id, team.club_id, team.name, team.archived_at, team.theme_accent, team.theme_button_style
    from public.teams team
    join linked_clubs club on club.id = team.club_id
    where team.archived_at is null
      and coalesce(team.status, 'active') = 'active'
      and (
        club.membership_role = 'admin'
        or exists (
          select 1 from public.team_staff assignment
          where assignment.team_id = team.id and assignment.user_id = (select auth.uid())
        )
      )
  )
  select jsonb_build_object(
    'clubs', coalesce((select jsonb_agg(to_jsonb(club) - 'membership_role' order by club.name, club.id) from linked_clubs club), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id, 'team_id', assignment.team_id, 'role_key', assignment.role_key,
        'role_label', assignment.role_label, 'role_rank', assignment.role_rank,
        'teams', to_jsonb(team) || jsonb_build_object('clubs', to_jsonb(club) - 'membership_role')
      ) order by team.name, assignment.id)
      from public.team_staff assignment
      join team_options team on team.id = assignment.team_id
      join linked_clubs club on club.id = team.club_id
      where assignment.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'adminTeams', coalesce((
      select jsonb_agg(to_jsonb(team) order by team.name, team.id)
      from team_options team
      join linked_clubs club on club.id = team.club_id and club.membership_role = 'admin'
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.list_own_staff_workspace_options() from public, anon;
grant execute on function public.list_own_staff_workspace_options() to authenticated;
