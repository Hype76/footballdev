create or replace function public.get_platform_analytics_dashboard_14c(
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
eligible_clubs as (
  select club.id, club.created_at
  from public.clubs club
  where club.status = 'active'
    and (club_id_value is null or club.id = club_id_value)
    and (plan_key_value is null or plan_key_value = '' or club.plan_key = plan_key_value)
    and (
      include_fp_test_value
      or (
        lower(coalesce(club.name, '')) not like '%fp test%'
        and lower(coalesce(club.name, '')) not like '%fp-test%'
        and lower(coalesce(club.name, '')) not like 'demo %'
      )
    )
),
eligible_teams as (
  select team.id, team.club_id, team.created_at
  from public.teams team
  join eligible_clubs club on club.id = team.club_id
  where team.status = 'active'
),
eligible_players as (
  select player.id, player.club_id, player.team_id, player.created_at
  from public.players player
  join eligible_clubs club on club.id = player.club_id
  join eligible_teams team
    on team.id = player.team_id
   and team.club_id = player.club_id
  where player.status = 'active'
),
current_contacts as (
  select
    link.id,
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
  from current_contacts contact
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
canonical_parents as (
  select distinct auth_user_id, club_id
  from valid_parent_links
),
valid_staff_assignments as (
  select
    assignment.id,
    assignment.user_id,
    assignment.team_id,
    assignment.created_at,
    team.club_id,
    coalesce(nullif(assignment.role_key, ''), nullif(profile.role, ''), 'unknown') as role_key
  from public.team_staff assignment
  join eligible_teams team on team.id = assignment.team_id
  join public.users profile
    on profile.id = assignment.user_id
   and profile.status = 'active'
  where coalesce(profile.role, '') <> 'super_admin'
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
canonical_staff as (
  select distinct user_id, club_id
  from valid_staff_assignments
),
eligible_evaluations as (
  select evaluation.id, evaluation.club_id, evaluation.created_at
  from public.evaluations evaluation
  join eligible_clubs club on club.id = evaluation.club_id
),
classified_events as (
  select
    event.*,
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
  left join eligible_clubs club on club.id = event.club_id
  where timezone('Europe/London', event.occurred_at)::date between least(start_date_value, timezone('Europe/London', now())::date - 29) and greatest(end_date_value, timezone('Europe/London', now())::date)
    and (event.club_id is null or club.id is not null)
    and (environment_value is null or environment_value = '' or environment_value = 'all' or coalesce(event.production_state, event.environment) = environment_value)
    and (role_value is null or role_value = '' or role_value = 'all' or coalesce(event.actor_role_at_event, event.role) = role_value)
    and (platform_value is null or platform_value = '' or platform_value = 'all' or event.platform = platform_value)
    and (
      activity_type_value is null
      or activity_type_value = ''
      or activity_type_value = 'all'
      or event.event_category = activity_type_value
    )
    and (include_internal_value or not event.internal_state)
    and (include_fp_test_value or not event.fp_test_state)
    and (
      not event.is_excluded
      or (include_internal_value and event.internal_state)
      or (include_fp_test_value and event.fp_test_state)
    )
),
window_events as (
  select event.*
  from classified_events event
  where page_family_value is null
    or page_family_value = ''
    or page_family_value = 'all'
    or event.page_family = page_family_value
),
selected_events as (
  select event.*
  from window_events event
  where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
),
historical_events as (
  select event.*
  from public.analytics_events event
  left join eligible_clubs club on club.id = event.club_id
  where timezone('Europe/London', event.occurred_at)::date <= end_date_value
    and (event.club_id is null or club.id is not null)
    and (environment_value is null or environment_value = '' or environment_value = 'all' or coalesce(event.production_state, event.environment) = environment_value)
    and (include_internal_value or not event.internal_state)
    and (include_fp_test_value or not event.fp_test_state)
    and (
      not event.is_excluded
      or (include_internal_value and event.internal_state)
      or (include_fp_test_value and event.fp_test_state)
    )
),
selected_user_activity as (
  select
    event.actor_profile_id as user_id,
    min(event.occurred_at) as first_qualifying_at,
    max(event.occurred_at) as last_qualifying_at,
    count(*)::integer as event_count,
    count(*) filter (where event.is_meaningful)::integer as meaningful_action_count,
    bool_or(event.internal_state) as internal_state,
    bool_or(event.fp_test_state) as fp_test_state,
    min(event.actor_role_family) as role_family,
    min(event.club_id::text)::uuid as club_id
  from selected_events event
  where event.is_meaningful
  group by event.actor_profile_id
),
historical_first_activity as (
  select event.actor_profile_id as user_id, min(event.occurred_at) as first_qualifying_at
  from historical_events event
  where event.is_meaningful
  group by event.actor_profile_id
),
login_activity as (
  select
    event.actor_profile_id as user_id,
    min(event.actor_role_family) as role_family,
    min(event.club_id::text)::uuid as club_id,
    min(event.occurred_at) as first_qualifying_at,
    max(event.occurred_at) as last_qualifying_at,
    count(*)::integer as event_count,
    bool_or(event.internal_state) as internal_state,
    bool_or(event.fp_test_state) as fp_test_state
  from selected_events event
  where event.event_name in ('auth.login_success', 'auth.login_succeeded')
  group by event.actor_profile_id
),
top_pages as (
  select
    event.page_family,
    min(event.canonical_route) as canonical_route,
    count(*)::integer as page_views,
    count(distinct event.actor_profile_id)::integer as distinct_users,
    count(distinct nullif(event.session_id, ''))::integer as sessions
  from selected_events event
  where event.page_view
    and event.canonical_route <> ''
  group by event.page_family
),
role_activity as (
  select
    coalesce(event.actor_role_at_event, event.role, 'unknown') as role,
    event.actor_role_family as role_family,
    count(*) filter (where event.is_meaningful)::integer as meaningful_actions,
    count(distinct event.actor_profile_id) filter (where event.is_meaningful)::integer as active_users,
    count(*)::integer as total_events
  from selected_events event
  group by coalesce(event.actor_role_at_event, event.role, 'unknown'), event.actor_role_family
),
heatmap_cells as (
  select
    extract(isodow from timezone('Europe/London', event.occurred_at))::smallint - 1 as day_index,
    extract(hour from timezone('Europe/London', event.occurred_at))::smallint as hour,
    count(*) filter (where event.page_view)::integer as page_views,
    count(*) filter (where event.is_meaningful)::integer as meaningful_actions,
    count(*) filter (where event.event_name in ('auth.login_success', 'auth.login_succeeded'))::integer as successful_logins,
    count(distinct event.actor_profile_id)::integer as distinct_users,
    count(distinct event.club_id)::integer as distinct_clubs,
    count(*) filter (where event.internal_state)::integer as internal_events,
    count(*) filter (where event.fp_test_state)::integer as fp_test_events
  from selected_events event
  group by
    extract(isodow from timezone('Europe/London', event.occurred_at)),
    extract(hour from timezone('Europe/London', event.occurred_at))
),
first_logins as (
  select
    min(event.occurred_at) filter (where event.actor_role_family = 'parent') as first_parent_login_at,
    min(event.occurred_at) filter (where event.actor_role_family in ('staff', 'club_admin')) as first_staff_login_at
  from historical_events event
  where event.event_name in ('auth.login_success', 'auth.login_succeeded')
),
processor as (
  select
    state.watermark_received_at,
    state.last_successful_run_id,
    state.last_failed_run_id,
    state.updated_at
  from public.analytics_processor_state state
  where state.singleton
),
last_processor_run as (
  select run.id, run.status, run.started_at, run.finished_at, run.rows_rejected, run.rows_unattributed
  from public.analytics_processor_runs run
  order by run.started_at desc
  limit 1
),
last_successful_run as (
  select run.id, run.finished_at
  from public.analytics_processor_runs run
  where run.status = 'succeeded'
  order by run.finished_at desc nulls last
  limit 1
),
aggregate_state as (
  select max(refreshed_at) as last_aggregate_refresh_at
  from public.analytics_daily_user_activity
),
account_detail as (
  select jsonb_build_object(
    'clubs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'createdAt', created_at) order by id) from (select * from eligible_clubs order by id limit 500) rows), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'clubId', club_id, 'createdAt', created_at) order by id) from (select * from eligible_teams order by id limit 500) rows), '[]'::jsonb),
    'activePlayers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'clubId', club_id, 'createdAt', created_at) order by id) from (select * from eligible_players order by id limit 500) rows), '[]'::jsonb),
    'staffAccounts', coalesce((select jsonb_agg(jsonb_build_object('id', user_id, 'clubId', club_id) order by user_id) from (select * from canonical_staff order by user_id limit 500) rows), '[]'::jsonb),
    'parentAccounts', coalesce((select jsonb_agg(jsonb_build_object('id', auth_user_id, 'clubId', club_id) order by auth_user_id) from (select * from canonical_parents order by auth_user_id limit 500) rows), '[]'::jsonb),
    'parentContacts', coalesce((select jsonb_agg(jsonb_build_object('id', contact_key, 'clubId', club_id) order by contact_key) from (select distinct contact_key, club_id from current_contacts order by contact_key limit 500) rows), '[]'::jsonb),
    'activeParentChildLinks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'clubId', club_id) order by id) from (select distinct on (auth_user_id, player_id) id, club_id from valid_parent_links order by auth_user_id, player_id, id limit 500) rows), '[]'::jsonb),
    'parentOnlyAccounts', coalesce((select jsonb_agg(jsonb_build_object('id', auth_user_id, 'clubId', club_id) order by auth_user_id) from (select parent.* from canonical_parents parent where not exists (select 1 from canonical_staff staff where staff.user_id = parent.auth_user_id) order by auth_user_id limit 500) rows), '[]'::jsonb),
    'staffWithParentAccess', coalesce((select jsonb_agg(jsonb_build_object('id', auth_user_id, 'clubId', club_id) order by auth_user_id) from (select parent.* from canonical_parents parent where exists (select 1 from canonical_staff staff where staff.user_id = parent.auth_user_id) order by auth_user_id limit 500) rows), '[]'::jsonb),
    'developmentRecords', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'clubId', club_id, 'createdAt', created_at) order by id) from (select * from eligible_evaluations order by id limit 500) rows), '[]'::jsonb)
  ) as detail
)
select jsonb_build_object(
  'definitionVersion', 3,
  'generatedAt', timezone('utc', now()),
  'filters', jsonb_build_object(
    'startDate', start_date_value,
    'endDate', end_date_value,
    'clubId', club_id_value,
    'plan', plan_key_value,
    'role', role_value,
    'platform', platform_value,
    'activityType', activity_type_value,
    'environment', environment_value,
    'pageFamily', page_family_value,
    'includeInternal', include_internal_value,
    'includeFpTest', include_fp_test_value
  ),
  'accountEstate', jsonb_build_object(
    'clubs', (select count(*) from eligible_clubs),
    'teams', (select count(*) from eligible_teams),
    'activePlayers', (select count(*) from eligible_players),
    'authenticatedStaffAccounts', (select count(distinct user_id) from canonical_staff),
    'authenticatedParentAccounts', (select count(distinct auth_user_id) from canonical_parents),
    'parentContacts', (select count(distinct contact_key) from current_contacts),
    'activeParentChildLinks', (select count(distinct (auth_user_id, player_id)) from valid_parent_links),
    'parentOnlyAccounts', (
      select count(*) from canonical_parents parent
      where not exists (select 1 from canonical_staff staff where staff.user_id = parent.auth_user_id)
    ),
    'staffWithParentAccess', (
      select count(distinct parent.auth_user_id) from canonical_parents parent
      where exists (select 1 from canonical_staff staff where staff.user_id = parent.auth_user_id)
    ),
    'developmentRecords', (select count(*) from eligible_evaluations),
    'drilldown', (select detail from account_detail),
    'drilldownLimit', 500
  ),
  'authentication', jsonb_build_object(
    'successfulLoginsToday', (
      select count(*) from window_events event
      where event.event_name in ('auth.login_success', 'auth.login_succeeded')
        and timezone('Europe/London', event.occurred_at)::date = timezone('Europe/London', now())::date
    ),
    'successfulLoginsSelected', count(*) filter (where event_name in ('auth.login_success', 'auth.login_succeeded')),
    'distinctUsersLoggingIn', count(distinct actor_profile_id) filter (where event_name in ('auth.login_success', 'auth.login_succeeded')),
    'failedLogins', count(*) filter (where event_name = 'auth.login_failure'),
    'failedLoginsAvailable', true,
    'firstParentLoginAt', (select first_parent_login_at from first_logins),
    'firstStaffLoginAt', (select first_staff_login_at from first_logins),
    'drilldown', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', user_id,
        'roleFamily', role_family,
        'clubId', club_id,
        'firstQualifyingAt', first_qualifying_at,
        'lastQualifyingAt', last_qualifying_at,
        'eventCount', event_count,
        'internal', internal_state,
        'fpTest', fp_test_state
      ) order by user_id)
      from (select * from login_activity order by user_id limit 500) rows
    ), '[]'::jsonb),
    'drilldownLimit', 500,
    'definition', 'Successful authentication activity. It does not prove product activity.'
  ),
  'productActivity', jsonb_build_object(
    'activeUsersToday', (
      select count(distinct actor_profile_id) from window_events event
      where event.is_meaningful
        and timezone('Europe/London', event.occurred_at)::date = timezone('Europe/London', now())::date
    ),
    'activeUsers7Days', (
      select count(distinct actor_profile_id) from window_events event
      where event.is_meaningful
        and timezone('Europe/London', event.occurred_at)::date between timezone('Europe/London', now())::date - 6 and timezone('Europe/London', now())::date
    ),
    'activeUsers30Days', (
      select count(distinct actor_profile_id) from window_events event
      where event.is_meaningful
        and timezone('Europe/London', event.occurred_at)::date between timezone('Europe/London', now())::date - 29 and timezone('Europe/London', now())::date
    ),
    'selectedActiveUsers', count(distinct actor_profile_id) filter (where is_meaningful),
    'activeParents', count(distinct actor_profile_id) filter (
      where is_meaningful
        and actor_role_family = 'parent'
        and exists (
          select 1 from canonical_parents parent
          where parent.auth_user_id = selected_events.actor_profile_id
            and parent.club_id = selected_events.club_id
        )
    ),
    'activeStaff', count(distinct actor_profile_id) filter (
      where is_meaningful
        and actor_role_family in ('staff', 'club_admin')
        and exists (
          select 1 from canonical_staff staff
          where staff.user_id = selected_events.actor_profile_id
            and staff.club_id = selected_events.club_id
        )
    ),
    'activeClubs', count(distinct club_id) filter (
      where is_meaningful
        and actor_role_family in ('parent', 'staff', 'club_admin')
    ),
    'pageViews', count(*) filter (where page_view),
    'meaningfulActions', count(*) filter (where is_meaningful),
    'newActiveUsers', (
      select count(*) from selected_user_activity selected
      join historical_first_activity first_seen on first_seen.user_id = selected.user_id
      where timezone('Europe/London', first_seen.first_qualifying_at)::date between start_date_value and end_date_value
    ),
    'returningActiveUsers', (
      select count(*) from selected_user_activity selected
      join historical_first_activity first_seen on first_seen.user_id = selected.user_id
      where timezone('Europe/London', first_seen.first_qualifying_at)::date < start_date_value
    ),
    'drilldown', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', user_id,
        'roleFamily', role_family,
        'clubId', club_id,
        'firstQualifyingAt', first_qualifying_at,
        'lastQualifyingAt', last_qualifying_at,
        'eventCount', event_count,
        'meaningfulActionCount', meaningful_action_count,
        'internal', internal_state,
        'fpTest', fp_test_state
      ) order by user_id)
      from (select * from selected_user_activity order by user_id limit 500) rows
    ), '[]'::jsonb),
    'drilldownLimit', 500
  ),
  'topPages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'pageFamily', page_family,
      'canonicalRoute', canonical_route,
      'pageViews', page_views,
      'distinctUsers', distinct_users,
      'sessions', sessions
    ) order by page_views desc, page_family)
    from top_pages
  ), '[]'::jsonb),
  'roleActivity', coalesce((
    select jsonb_agg(jsonb_build_object(
      'role', role,
      'roleFamily', role_family,
      'activeUsers', active_users,
      'meaningfulActions', meaningful_actions,
      'totalEvents', total_events
    ) order by active_users desc, role)
    from role_activity
  ), '[]'::jsonb),
  'heatmap', jsonb_build_object(
    'days', jsonb_build_array('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
    'hours', to_jsonb(array(select generate_series(0, 23))),
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dayIndex', day_index,
        'hour', hour,
        'pageViews', page_views,
        'meaningfulActions', meaningful_actions,
        'successfulLogins', successful_logins,
        'distinctUsers', distinct_users,
        'distinctClubs', distinct_clubs,
        'internalEvents', internal_events,
        'fpTestEvents', fp_test_events
      ) order by day_index, hour)
      from heatmap_cells
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'pageViews', count(*) filter (where page_view),
      'meaningfulActions', count(*) filter (where is_meaningful),
      'successfulLogins', count(*) filter (where event_name in ('auth.login_success', 'auth.login_succeeded'))
    ),
    'timezone', 'Europe/London',
    'dayOrder', 'Monday to Sunday'
  ),
  'quality', jsonb_build_object(
    'unattributedUsers', count(*) filter (where actor_profile_id is null),
    'unattributedRoles', count(*) filter (where actor_role_family = 'unknown'),
    'unattributedClubs', count(*) filter (where club_id is null and actor_role_family <> 'platform_admin'),
    'unknownEventNames', count(*) filter (where event_category not in ('authentication', 'navigation', 'meaningful_action')),
    'quarantinedEvents', (select count(*) from public.analytics_event_quarantine where resolved_at is null),
    'unprocessedEvents', (select count(*) from public.analytics_events where processed_at is null),
    'duplicateEventsSuppressed', null,
    'duplicateEventsState', 'Not separately metered',
    'internalEvents', count(*) filter (where internal_state),
    'fpTestEvents', count(*) filter (where fp_test_state),
    'historicalCoverageStart', (select min(timezone('Europe/London', occurred_at)::date) from public.analytics_events where schema_version >= 2)
  ),
  'processor', jsonb_build_object(
    'lastEventReceivedAt', (select max(received_at) from public.analytics_events),
    'lastProcessorSuccessAt', (select finished_at from last_successful_run),
    'lastAggregateRefreshAt', (select last_aggregate_refresh_at from aggregate_state),
    'processorWatermarkAt', (select watermark_received_at from processor),
    'processingLagSeconds', greatest(0, extract(epoch from (timezone('utc', now()) - coalesce((select watermark_received_at from processor), timezone('utc', now())))))::bigint,
    'unprocessedEvents', (select count(*) from public.analytics_events where processed_at is null),
    'quarantinedEvents', (select count(*) from public.analytics_event_quarantine where resolved_at is null),
    'lastRunId', (select id from last_processor_run),
    'lastRunStatus', (select status from last_processor_run),
    'lastRunStartedAt', (select started_at from last_processor_run),
    'lastRunFinishedAt', (select finished_at from last_processor_run)
  ),
  'reconciliation', jsonb_build_object(
    'topPagesTotal', coalesce((select sum(page_views) from top_pages), 0),
    'roleMeaningfulTotal', coalesce((select sum(meaningful_actions) from role_activity), 0),
    'heatmapPageViewsTotal', coalesce((select sum(page_views) from heatmap_cells), 0),
    'heatmapMeaningfulTotal', coalesce((select sum(meaningful_actions) from heatmap_cells), 0),
    'heatmapLoginTotal', coalesce((select sum(successful_logins) from heatmap_cells), 0),
    'sourcePageViewsTotal', count(*) filter (where page_view),
    'sourceMeaningfulTotal', count(*) filter (where is_meaningful),
    'sourceLoginTotal', count(*) filter (where event_name in ('auth.login_success', 'auth.login_succeeded'))
  )
)
from selected_events;
$$;

revoke all on function public.get_platform_analytics_dashboard_14c(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.get_platform_analytics_dashboard_14c(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) to service_role;

comment on function public.get_platform_analytics_dashboard_14c(
  date, date, uuid, text, text, text, text, text, text, boolean, boolean
) is
'Bounded, service-role-only Platform Analytics dashboard evidence with privacy-safe drill-downs and reconciled heatmap totals.';
