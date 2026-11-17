create function public.current_user_can_discover_staff_club(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_club_memberships membership
    join public.users actor on actor.id = membership.auth_user_id and actor.status = 'active'
    join public.clubs club on club.id = membership.club_id
    where membership.auth_user_id = (select auth.uid())
      and membership.club_id = target_club_id
      and membership.role in ('admin', 'head_manager', 'manager', 'coach', 'assistant_coach')
      and membership.role_rank >= 20
      and club.archived_at is null
      and coalesce(club.status, 'active') = 'active'
  );
$function$;

create function public.current_user_can_discover_staff_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.teams team
    join public.user_club_memberships membership
      on membership.club_id = team.club_id and membership.auth_user_id = (select auth.uid())
    where team.id = target_team_id
      and team.archived_at is null
      and coalesce(team.status, 'active') = 'active'
      and public.current_user_can_discover_staff_club(team.club_id)
      and (
        membership.role = 'admin'
        or exists (
          select 1
          from public.team_staff assignment
          where assignment.team_id = team.id
            and assignment.user_id = (select auth.uid())
        )
      )
  );
$function$;

revoke all on function public.current_user_can_discover_staff_club(uuid),
  public.current_user_can_discover_staff_team(uuid) from public, anon;
grant execute on function public.current_user_can_discover_staff_club(uuid),
  public.current_user_can_discover_staff_team(uuid) to authenticated;

-- Workspace pickers need the same linked club and team rows before a user activates them.
-- Operational access and mutations still use the existing active-workspace authority checks.
create policy clubs_select_staff_workspace_discovery on public.clubs
  for select to authenticated using (public.current_user_can_discover_staff_club(id));

create policy teams_select_staff_workspace_discovery on public.teams
  for select to authenticated using (public.current_user_can_discover_staff_team(id));

create policy team_staff_select_own_workspace_discovery on public.team_staff
  for select to authenticated using (
    user_id = (select auth.uid()) and public.current_user_can_discover_staff_team(team_id)
  );
