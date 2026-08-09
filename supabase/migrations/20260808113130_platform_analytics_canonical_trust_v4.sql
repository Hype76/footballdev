create or replace function public.get_platform_analytics_canonical_v4(
  start_date_value date,
  end_date_value date,
  club_id_value uuid default null,
  plan_key_value text default null,
  role_value text default null,
  platform_value text default null,
  activity_type_value text default null,
  environment_value text default 'production',
  page_family_value text default null,
  include_internal_value boolean default false,
  include_fp_test_value boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with
base_report as (
  select public.get_platform_analytics_dashboard_14c(
    start_date_value,
    end_date_value,
    club_id_value,
    plan_key_value,
    role_value,
    platform_value,
    activity_type_value,
    environment_value,
    page_family_value,
    include_internal_value,
    include_fp_test_value
  ) as report
),
identity_report as (
  select public.get_platform_analytics_identity_adoption(
    start_date_value,
    end_date_value,
    club_id_value,
    plan_key_value,
    include_fp_test_value,
    role_value,
    platform_value
  ) as report
),
eligible_workspaces as (
  select
    workspace.id,
    workspace.name,
    workspace.plan_key,
    workspace.created_at,
    public.workspace_scope_for_plan_key(workspace.plan_key) as workspace_scope
  from public.clubs workspace
  where workspace.status = 'active'
    and workspace.archived_at is null
    and (club_id_value is null or workspace.id = club_id_value)
    and (plan_key_value is null or plan_key_value = '' or workspace.plan_key = plan_key_value)
    and (
      include_fp_test_value
      or (
        lower(coalesce(workspace.name, '')) not like '%fp test%'
        and lower(coalesce(workspace.name, '')) not like '%fp-test%'
        and lower(coalesce(workspace.name, '')) not like 'demo %'
      )
    )
),
eligible_teams as (
  select team.id, team.club_id, team.name, team.created_at
  from public.teams team
  join eligible_workspaces workspace on workspace.id = team.club_id
  where team.status = 'active'
    and team.archived_at is null
),
eligible_players as (
  select player.id, player.club_id, player.team_id, player.created_at
  from public.players player
  join eligible_teams team
    on team.id = player.team_id
   and team.club_id = player.club_id
  where player.status = 'active'
    and player.archived_at is null
),
valid_staff_assignments as (
  select
    assignment.id,
    assignment.user_id,
    assignment.team_id,
    team.club_id,
    case coalesce(nullif(assignment.role_key, ''), nullif(profile.role, ''), 'unknown')
      when 'admin' then 'club_admin'
      else coalesce(nullif(assignment.role_key, ''), nullif(profile.role, ''), 'unknown')
    end as role_key
  from public.team_staff assignment
  join eligible_teams team on team.id = assignment.team_id
  join public.users profile
    on profile.id = assignment.user_id
   and profile.status = 'active'
  where coalesce(profile.role, '') in ('admin', 'club_admin', 'head_manager', 'manager', 'coach', 'assistant_coach')
    and (
      include_fp_test_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
),
canonical_staff_accounts as (
  select distinct
    profile.id as user_id,
    case coalesce(nullif(profile.role, ''), 'unknown')
      when 'admin' then 'club_admin'
      else coalesce(nullif(profile.role, ''), 'unknown')
    end as role_key
  from public.users profile
  where profile.status = 'active'
    and coalesce(profile.role, '') in ('admin', 'club_admin', 'head_manager', 'manager', 'coach', 'assistant_coach')
    and (
      exists (
        select 1
        from eligible_workspaces workspace
        where workspace.id = profile.club_id
      )
      or exists (
        select 1
        from valid_staff_assignments assignment
        where assignment.user_id = profile.id
      )
    )
    and (
      include_fp_test_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
),
current_parent_contacts as (
  select
    link.club_id,
    link.team_id,
    link.player_id,
    link.auth_user_id,
    link.status,
    link.accepted_at,
    coalesce(link.guardian_id::text, link.parent_link_id::text, link.id::text) as contact_key
  from public.parent_player_links link
  join eligible_players player
    on player.id = link.player_id
   and player.club_id = link.club_id
   and player.team_id = link.team_id
  where link.status <> 'revoked'
),
valid_parent_links as (
  select contact.*
  from current_parent_contacts contact
  join public.users profile
    on profile.id = contact.auth_user_id
   and profile.status = 'active'
  where contact.status = 'active'
    and contact.auth_user_id is not null
    and contact.accepted_at is not null
    and (
      include_fp_test_value
      or not (
        lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp test%'
        or lower(concat_ws(' ', profile.email, profile.name, profile.username, profile.display_name)) like '%fp-test%'
        or lower(coalesce(profile.email, '')) like '%+test@%'
        or lower(coalesce(profile.email, '')) like '%+demo@%'
        or lower(coalesce(profile.email, '')) like '%@example.test%'
        or lower(coalesce(profile.name, '')) like 'demo %'
        or lower(coalesce(profile.username, '')) like 'demo %'
        or lower(coalesce(profile.display_name, '')) like 'demo %'
      )
    )
),
parent_access_accounts as (
  select distinct link.auth_user_id
  from valid_parent_links link
),
eligible_development_records as (
  select evaluation.id, evaluation.club_id, evaluation.team_id, evaluation.status
  from public.evaluations evaluation
  join eligible_workspaces workspace on workspace.id = evaluation.club_id
),
filtered_events as (
  select
    event.*,
    timezone('Europe/London', event.occurred_at)::date as activity_date,
    case
      when event.canonical_route = '/parent-portal' then 'parent_overview'
      when event.canonical_route = '/parent-chat' then 'parent_chat'
      when event.canonical_route = '/parent-polls' then 'parent_polls'
      when event.canonical_route = '/friends-family' then 'friends_family'
      when event.canonical_route like '/calendar%' then 'staff_calendar'
      when event.canonical_route like '/player/%' then 'player_profile'
      when event.canonical_route in ('/assess-player', '/create-evaluation', '/feedback-forms', '/form-builder', '/sessions', '/sessions/start', '/sessions/previous') then 'development'
      when event.canonical_route = '/match-day' then 'game_day'
      when event.canonical_route in ('/user-access', '/platform-admin/staff') then 'staff_access'
      when event.canonical_route = '/platform-admin/analytics' then 'platform_analytics'
      when event.canonical_route = '' then 'no_page'
      else trim(both '_' from replace(event.canonical_route, '/', '_'))
    end as page_family
  from public.analytics_events event
  left join eligible_workspaces workspace on workspace.id = event.club_id
  where timezone('Europe/London', event.occurred_at)::date <= end_date_value
    and (event.club_id is null or workspace.id is not null)
    and (environment_value is null or environment_value = '' or environment_value = 'all' or coalesce(event.production_state, event.environment) = environment_value)
    and (role_value is null or role_value = '' or role_value = 'all' or coalesce(event.actor_role_at_event, event.role) = role_value)
    and (platform_value is null or platform_value = '' or platform_value = 'all' or event.platform = platform_value)
    and (activity_type_value is null or activity_type_value = '' or activity_type_value = 'all' or event.event_category = activity_type_value)
    and (include_internal_value or not event.internal_state)
    and (include_fp_test_value or not event.fp_test_state)
    and (
      not event.is_excluded
      or (include_internal_value and event.internal_state)
      or (include_fp_test_value and event.fp_test_state)
    )
),
selected_events as (
  select event.*
  from filtered_events event
  where event.activity_date between start_date_value and end_date_value
    and (page_family_value is null or page_family_value = '' or page_family_value = 'all' or event.page_family = page_family_value)
),
first_meaningful_activity as (
  select event.actor_profile_id as user_id, min(event.activity_date) as first_activity_date
  from filtered_events event
  where event.is_meaningful
    and event.actor_profile_id is not null
  group by event.actor_profile_id
),
selected_user_days as (
  select distinct event.activity_date, event.actor_profile_id as user_id
  from selected_events event
  where event.is_meaningful
    and event.actor_profile_id is not null
),
calendar_days as (
  select generate_series(start_date_value, end_date_value, interval '1 day')::date as activity_date
),
daily_trends as (
  select
    day.activity_date,
    count(event.id) filter (where event.event_name in ('auth.login_success', 'auth.login_succeeded'))::integer as successful_logins,
    count(event.id) filter (where event.event_name = 'auth.login_failure')::integer as failed_logins,
    count(distinct event.actor_profile_id) filter (where event.event_name in ('auth.login_success', 'auth.login_succeeded'))::integer as unique_login_users,
    count(event.id) filter (where event.page_view)::integer as page_views,
    count(event.id) filter (where event.is_meaningful)::integer as meaningful_actions,
    count(distinct event.actor_profile_id) filter (where event.is_meaningful)::integer as active_users,
    coalesce((
      select count(*)::integer
      from selected_user_days user_day
      join first_meaningful_activity first_seen on first_seen.user_id = user_day.user_id
      where user_day.activity_date = day.activity_date
        and first_seen.first_activity_date = day.activity_date
    ), 0) as new_active_users,
    coalesce((
      select count(*)::integer
      from selected_user_days user_day
      join first_meaningful_activity first_seen on first_seen.user_id = user_day.user_id
      where user_day.activity_date = day.activity_date
        and first_seen.first_activity_date < day.activity_date
    ), 0) as returning_active_users
  from calendar_days day
  left join selected_events event on event.activity_date = day.activity_date
  group by day.activity_date
),
active_staff_accounts as (
  select distinct event.actor_profile_id as user_id
  from selected_events event
  join canonical_staff_accounts staff on staff.user_id = event.actor_profile_id
  where event.is_meaningful
    and event.actor_role_family in ('staff', 'club_admin')
),
staff_role_adoption as (
  select
    staff.role_key,
    count(*)::integer as total_accounts,
    count(active.user_id)::integer as active_accounts
  from canonical_staff_accounts staff
  left join active_staff_accounts active on active.user_id = staff.user_id
  group by staff.role_key
),
workspace_last_activity as (
  select
    workspace.id as workspace_id,
    max(event.occurred_at) filter (
      where event.is_meaningful
        and event.actor_role_family in ('parent', 'staff', 'club_admin')
    ) as last_activity_at,
    max(event.occurred_at) filter (
      where event.is_meaningful
        and event.actor_role_family in ('parent', 'staff', 'club_admin')
        and event.activity_date between start_date_value and end_date_value
    ) as selected_activity_at
  from eligible_workspaces workspace
  left join filtered_events event on event.club_id = workspace.id
  group by workspace.id
),
capture_state as (
  select min(timezone('Europe/London', event.occurred_at)::date) as capture_start_date
  from public.analytics_events event
  where event.schema_version >= 2
),
workspace_states as (
  select
    workspace.id,
    workspace.name,
    workspace.workspace_scope,
    workspace.plan_key,
    activity.last_activity_at,
    case
      when activity.selected_activity_at is not null then 'active'
      when activity.last_activity_at is not null and timezone('Europe/London', activity.last_activity_at)::date >= end_date_value - 29 then 'quiet'
      when activity.last_activity_at is not null then 'dormant'
      when timezone('Europe/London', workspace.created_at)::date < capture.capture_start_date then 'insufficient_history'
      else 'never_observed'
    end as activity_state
  from eligible_workspaces workspace
  join workspace_last_activity activity on activity.workspace_id = workspace.id
  cross join capture_state capture
),
workspace_rollup as (
  select
    workspace.id,
    workspace.name,
    workspace.plan_key,
    workspace.workspace_scope,
    count(distinct team.id)::integer as team_count,
    count(distinct player.id)::integer as active_player_count,
    count(distinct assignment.id)::integer as staff_assignment_count,
    count(distinct development.id)::integer as development_record_count,
    count(distinct contact.contact_key)::integer as parent_contact_count,
    count(distinct (parent_link.auth_user_id, parent_link.player_id)) filter (
      where parent_link.auth_user_id is not null
        and parent_link.player_id is not null
    )::integer as active_parent_link_count
  from eligible_workspaces workspace
  left join eligible_teams team on team.club_id = workspace.id
  left join eligible_players player on player.team_id = team.id
  left join valid_staff_assignments assignment on assignment.team_id = team.id
  left join eligible_development_records development on development.club_id = workspace.id
  left join current_parent_contacts contact on contact.club_id = workspace.id
  left join valid_parent_links parent_link on parent_link.club_id = workspace.id
  group by workspace.id, workspace.name, workspace.plan_key, workspace.workspace_scope
),
team_rollup as (
  select
    team.id,
    team.name,
    workspace.name as workspace_name,
    workspace.workspace_scope,
    workspace.plan_key,
    count(distinct player.id)::integer as active_player_count,
    count(distinct assignment.id)::integer as staff_assignment_count
  from eligible_teams team
  join eligible_workspaces workspace on workspace.id = team.club_id
  left join eligible_players player on player.team_id = team.id
  left join valid_staff_assignments assignment on assignment.team_id = team.id
  group by team.id, team.name, workspace.name, workspace.workspace_scope, workspace.plan_key
),
estate_drilldown as (
  select jsonb_build_object(
    'customerClubs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', row.name,
        'scope', 'Club',
        'plan', row.plan_key,
        'status', 'Active',
        'teams', row.team_count,
        'activePlayers', row.active_player_count,
        'count', 1
      ) order by row.name)
      from workspace_rollup row
      where row.workspace_scope = 'club'
    ), '[]'::jsonb),
    'customerWorkspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', row.name,
        'scope', initcap(row.workspace_scope),
        'plan', row.plan_key,
        'status', 'Active',
        'teams', row.team_count,
        'activePlayers', row.active_player_count,
        'count', 1
      ) order by row.name)
      from workspace_rollup row
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', row.name,
        'workspace', row.workspace_name,
        'scope', initcap(row.workspace_scope),
        'plan', row.plan_key,
        'activePlayers', row.active_player_count,
        'staffAssignments', row.staff_assignment_count,
        'count', 1
      ) order by row.workspace_name, row.name)
      from team_rollup row
    ), '[]'::jsonb),
    'activePlayers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'team', row.name,
        'workspace', row.workspace_name,
        'scope', initcap(row.workspace_scope),
        'count', row.active_player_count
      ) order by row.workspace_name, row.name)
      from team_rollup row
      where row.active_player_count > 0
    ), '[]'::jsonb),
    'staffAccounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', case row.role_key
          when 'admin' then 'Club Admin'
          when 'club_admin' then 'Club Admin'
          when 'head_manager' then 'Team Admin'
          when 'manager' then 'Manager'
          when 'coach' then 'Coach'
          else initcap(replace(row.role_key, '_', ' '))
        end,
        'activeInPeriod', row.active_accounts,
        'count', row.total_accounts
      ) order by row.total_accounts desc, row.role_key)
      from staff_role_adoption row
    ), '[]'::jsonb),
    'staffAssignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', case row.role_key
          when 'admin' then 'Club Admin'
          when 'club_admin' then 'Club Admin'
          when 'head_manager' then 'Team Admin'
          when 'manager' then 'Manager'
          when 'coach' then 'Coach'
          else initcap(replace(row.role_key, '_', ' '))
        end,
        'count', row.assignment_count
      ) order by row.assignment_count desc, row.role_key)
      from (
        select assignment.role_key, count(*)::integer as assignment_count
        from valid_staff_assignments assignment
        group by assignment.role_key
      ) row
    ), '[]'::jsonb),
    'parentAccess', jsonb_build_array(
      jsonb_build_object('accessType', 'Staff and Parent', 'count', (
        select count(*) from parent_access_accounts parent
        where exists (select 1 from canonical_staff_accounts staff where staff.user_id = parent.auth_user_id)
      )),
      jsonb_build_object('accessType', 'Platform Admin and Parent', 'count', (
        select count(*) from parent_access_accounts parent
        join public.users profile on profile.id = parent.auth_user_id
        where profile.role = 'super_admin'
      )),
      jsonb_build_object('accessType', 'Parent only', 'count', (
        select count(*) from parent_access_accounts parent
        join public.users profile on profile.id = parent.auth_user_id
        where profile.role <> 'super_admin'
          and not exists (select 1 from canonical_staff_accounts staff where staff.user_id = parent.auth_user_id)
      ))
    ),
    'parentContacts', coalesce((
      select jsonb_agg(jsonb_build_object('workspace', row.name, 'scope', initcap(row.workspace_scope), 'count', row.parent_contact_count) order by row.name)
      from workspace_rollup row
      where row.parent_contact_count > 0
    ), '[]'::jsonb),
    'activeParentChildLinks', coalesce((
      select jsonb_agg(jsonb_build_object('workspace', row.name, 'scope', initcap(row.workspace_scope), 'count', row.active_parent_link_count) order by row.name)
      from workspace_rollup row
      where row.active_parent_link_count > 0
    ), '[]'::jsonb),
    'developmentRecords', coalesce((
      select jsonb_agg(jsonb_build_object('workspace', row.name, 'scope', initcap(row.workspace_scope), 'count', row.development_record_count) order by row.name)
      from workspace_rollup row
      where row.development_record_count > 0
    ), '[]'::jsonb)
  ) as detail
),
canonical_estate as (
  select jsonb_build_object(
    'customerClubs', (select count(*) from eligible_workspaces where workspace_scope = 'club'),
    'customerWorkspaces', (select count(*) from eligible_workspaces),
    'workspaceScopeBreakdown', jsonb_build_object(
      'club', (select count(*) from eligible_workspaces where workspace_scope = 'club'),
      'team', (select count(*) from eligible_workspaces where workspace_scope = 'team'),
      'individual', (select count(*) from eligible_workspaces where workspace_scope = 'individual'),
      'unknown', (select count(*) from eligible_workspaces where workspace_scope = 'unknown')
    ),
    'clubs', (select count(*) from eligible_workspaces where workspace_scope = 'club'),
    'teams', (select count(*) from eligible_teams),
    'activePlayers', (select count(*) from eligible_players),
    'staffAccounts', (select count(*) from canonical_staff_accounts),
    'authenticatedStaffAccounts', (select count(*) from canonical_staff_accounts),
    'staffAssignments', (select count(*) from valid_staff_assignments),
    'staffWithAssignments', (select count(distinct user_id) from valid_staff_assignments),
    'staffWithoutAssignments', (
      select count(*) from canonical_staff_accounts staff
      where not exists (select 1 from valid_staff_assignments assignment where assignment.user_id = staff.user_id)
    ),
    'usersWithParentAccess', (select count(*) from parent_access_accounts),
    'authenticatedParentAccounts', (select count(*) from parent_access_accounts),
    'staffWithParentAccess', (
      select count(*) from parent_access_accounts parent
      where exists (select 1 from canonical_staff_accounts staff where staff.user_id = parent.auth_user_id)
    ),
    'platformAdminsWithParentAccess', (
      select count(*) from parent_access_accounts parent
      join public.users profile on profile.id = parent.auth_user_id
      where profile.role = 'super_admin'
    ),
    'parentOnlyAccounts', (
      select count(*) from parent_access_accounts parent
      join public.users profile on profile.id = parent.auth_user_id
      where profile.role <> 'super_admin'
        and not exists (select 1 from canonical_staff_accounts staff where staff.user_id = parent.auth_user_id)
    ),
    'parentContacts', (select count(distinct contact_key) from current_parent_contacts),
    'activeParentChildLinks', (select count(distinct (auth_user_id, player_id)) from valid_parent_links),
    'developmentRecords', (select count(*) from eligible_development_records),
    'drilldown', (select detail from estate_drilldown),
    'definitions', jsonb_build_object(
      'customerClubs', 'Active, non-test customer workspaces whose commercial scope is Club.',
      'customerWorkspaces', 'Active, non-test customer storage containers across Club, Team, and Individual commercial scopes.',
      'teams', 'Active, non-archived football teams inside counted customer workspaces.',
      'activePlayers', 'Players with active status attached to an active team in a counted customer workspace.',
      'staffAccounts', 'Distinct active non-Platform-Admin staff profiles in a counted customer workspace, whether or not they currently have a team assignment.',
      'staffAssignments', 'Current team-role assignment rows for counted staff and active teams. One staff account may have several assignments.',
      'usersWithParentAccess', 'Distinct active authenticated users with an accepted active Parent relationship to a counted active player.',
      'parentContacts', 'Distinct current, non-revoked Parent or guardian contact relationships. Authentication is not required.',
      'activeParentChildLinks', 'Distinct accepted authenticated Parent-to-player relationships for counted active players.',
      'developmentRecords', 'Saved Development history in counted customer workspaces, including records for players whose current lifecycle has since changed.'
    )
  ) as estate
),
canonical_identity as (
  select
    ((identity.report - 'reconciliation' - 'parentAdoption' - 'staff' - 'activity' - 'clubActivation' - 'dormancy') || jsonb_build_object(
      'definitionVersion', 4,
      'parentAdoption', ((identity.report->'parentAdoption') || jsonb_build_object(
        'authenticatedParentAccounts', (select count(*) from parent_access_accounts),
        'parentOnlyAccounts', (select (estate.estate->>'parentOnlyAccounts')::integer from canonical_estate estate),
        'staffWithParentAccess', (select (estate.estate->>'staffWithParentAccess')::integer from canonical_estate estate),
        'platformAdminsWithParentAccess', (select (estate.estate->>'platformAdminsWithParentAccess')::integer from canonical_estate estate)
      )),
      'staff', ((identity.report->'staff') || jsonb_build_object(
        'authenticatedStaffAccounts', (select count(*) from canonical_staff_accounts),
        'assignmentCount', (select count(*) from valid_staff_assignments),
        'accountsWithAssignments', (select count(distinct user_id) from valid_staff_assignments),
        'accountsWithoutAssignments', (
          select count(*) from canonical_staff_accounts staff
          where not exists (select 1 from valid_staff_assignments assignment where assignment.user_id = staff.user_id)
        )
      )),
      'activity', ((identity.report->'activity')
        - 'activeParentAccountIds'
        - 'activeStaffAccountIds'
        - 'activeClubIds'),
      'clubActivation', ((identity.report->'clubActivation') - 'noStaffLoginObservedClubIds'),
      'dormancy', ((identity.report->'dormancy') - 'clubStates'),
      'reconciliation', ((identity.report->'reconciliation')
        - 'authenticatedParentAccountIds'
        - 'authenticatedStaffAccountIds'
        - 'activeParentAccountIds'
        - 'activeStaffAccountIds')
    )) as report
  from identity_report identity
),
trend_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', trend.activity_date,
    'successfulLogins', trend.successful_logins,
    'failedLogins', trend.failed_logins,
    'uniqueLoginUsers', trend.unique_login_users,
    'pageViews', trend.page_views,
    'meaningfulActions', trend.meaningful_actions,
    'activeUsers', trend.active_users,
    'newActiveUsers', trend.new_active_users,
    'returningActiveUsers', trend.returning_active_users
  ) order by trend.activity_date), '[]'::jsonb) as series
  from daily_trends trend
),
role_adoption_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'role', case row.role_key
      when 'admin' then 'Club Admin'
      when 'club_admin' then 'Club Admin'
      when 'head_manager' then 'Team Admin'
      when 'manager' then 'Manager'
      when 'coach' then 'Coach'
      else initcap(replace(row.role_key, '_', ' '))
    end,
    'totalAccounts', row.total_accounts,
    'activeAccounts', row.active_accounts
  ) order by row.total_accounts desc, row.role_key), '[]'::jsonb) as rows
  from staff_role_adoption row
),
workspace_activity_json as (
  select jsonb_build_object(
    'states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'state', row.activity_state,
        'label', case row.activity_state
          when 'active' then 'Active in selected period'
          when 'quiet' then 'Quiet'
          when 'dormant' then 'Dormant'
          when 'never_observed' then 'Never observed'
          else 'Insufficient history'
        end,
        'count', row.state_count
      ) order by row.sort_order)
      from (
        select
          state.activity_state,
          count(*)::integer as state_count,
          case state.activity_state
            when 'active' then 1
            when 'quiet' then 2
            when 'dormant' then 3
            when 'never_observed' then 4
            else 5
          end as sort_order
        from workspace_states state
        group by state.activity_state
      ) row
    ), '[]'::jsonb),
    'drilldown', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', state.name,
        'scope', initcap(state.workspace_scope),
        'plan', state.plan_key,
        'state', case state.activity_state
          when 'active' then 'Active in selected period'
          when 'quiet' then 'Quiet'
          when 'dormant' then 'Dormant'
          when 'never_observed' then 'Never observed'
          else 'Insufficient history'
        end,
        'lastActivityAt', state.last_activity_at,
        'count', 1
      ) order by state.name)
      from workspace_states state
    ), '[]'::jsonb),
    'definition', 'Active means qualifying customer activity in the selected period. Quiet means none in the period but some in the last 30 days. Dormant means the last observed activity is older. Never observed and insufficient history remain separate.'
  ) as report
)
select
  ((base.report - 'accountEstate' - 'authentication' - 'productActivity') || jsonb_build_object(
    'definitionVersion', 4,
    'generatedAt', timezone('utc', now()),
    'accountEstate', estate.estate,
    'authentication', (((base.report->'authentication') - 'drilldown' - 'drilldownLimit') || jsonb_build_object('trend', trend.series)),
    'productActivity', (((base.report->'productActivity') - 'drilldown' - 'drilldownLimit') || jsonb_build_object('trend', trend.series)),
    'identityAdoption', identity.report,
    'staffRoleAdoption', role_adoption.rows,
    'workspaceActivity', workspace_activity.report,
    'trend', trend.series
  ))
from base_report base
cross join canonical_estate estate
cross join canonical_identity identity
cross join trend_json trend
cross join role_adoption_json role_adoption
cross join workspace_activity_json workspace_activity;
$$;

revoke all on function public.get_platform_analytics_canonical_v4(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.get_platform_analytics_canonical_v4(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) to service_role;

comment on function public.get_platform_analytics_canonical_v4(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) is
'Canonical service-role-only Platform Analytics report. Headline counts, human-readable breakdowns, trends, and internal reconciliations share the same authoritative definitions without returning account, Parent, player, or relationship identifiers.';
