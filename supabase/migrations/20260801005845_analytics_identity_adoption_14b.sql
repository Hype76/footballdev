create or replace function public.get_platform_analytics_identity_adoption(
  start_date_value date,
  end_date_value date,
  club_id_value uuid default null,
  plan_key_value text default null,
  include_excluded_value boolean default false,
  role_value text default null,
  platform_value text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with
capture as (
  select min(timezone('Europe/London', occurred_at)::date) as capture_start_date
  from public.analytics_events
  where schema_version >= 2
    and coalesce(production_state, environment) = 'production'
),
eligible_clubs as (
  select club.id, club.created_at
  from public.clubs club
  where club.status = 'active'
    and (club_id_value is null or club.id = club_id_value)
    and (plan_key_value is null or plan_key_value = '' or club.plan_key = plan_key_value)
    and (
      include_excluded_value
      or (
        lower(coalesce(club.name, '')) not like '%fp test%'
        and lower(coalesce(club.name, '')) not like '%fp-test%'
        and lower(coalesce(club.name, '')) not like 'demo %'
      )
    )
),
eligible_teams as (
  select team.id, team.club_id
  from public.teams team
  join eligible_clubs club on club.id = team.club_id
  where team.status = 'active'
),
valid_players as (
  select player.id, player.club_id, player.team_id, player.created_at
  from public.players player
  join eligible_clubs club on club.id = player.club_id
  join eligible_teams team
    on team.id = player.team_id
   and team.club_id = player.club_id
  where player.status = 'active'
),
current_contact_links as (
  select
    link.id,
    link.club_id,
    link.team_id,
    link.player_id,
    link.auth_user_id,
    link.status,
    link.accepted_at,
    link.invite_sent_at,
    coalesce(link.guardian_id::text, link.parent_link_id::text, link.id::text) as contact_key
  from public.parent_player_links link
  join valid_players player
    on player.id = link.player_id
   and player.club_id = link.club_id
   and player.team_id = link.team_id
  where link.status <> 'revoked'
),
valid_parent_links as (
  select link.*
  from current_contact_links link
  join public.users profile
    on profile.id = link.auth_user_id
   and profile.status = 'active'
  where link.status = 'active'
    and link.auth_user_id is not null
    and link.accepted_at is not null
    and (
      include_excluded_value
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
      include_excluded_value
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
selected_events as (
  select event.*
  from public.analytics_events event
  join eligible_clubs club on club.id = event.club_id
  where timezone('Europe/London', event.occurred_at)::date between start_date_value and end_date_value
    and coalesce(event.production_state, event.environment) = 'production'
    and (role_value is null or role_value = '' or event.actor_role_at_event = role_value or event.role = role_value)
    and (platform_value is null or platform_value = '' or event.platform = platform_value)
    and (
      include_excluded_value
      or (
        not event.is_excluded
        and not event.internal_state
        and not event.fp_test_state
      )
    )
),
historical_events as (
  select event.*
  from public.analytics_events event
  join eligible_clubs club on club.id = event.club_id
  where timezone('Europe/London', event.occurred_at)::date <= end_date_value
    and coalesce(event.production_state, event.environment) = 'production'
    and (
      include_excluded_value
      or (
        not event.is_excluded
        and not event.internal_state
        and not event.fp_test_state
      )
    )
),
active_parent_ids as (
  select distinct coalesce(event.actor_auth_user_id, event.user_id) as user_id
  from selected_events event
  join canonical_parents parent
    on parent.auth_user_id = coalesce(event.actor_auth_user_id, event.user_id)
   and parent.club_id = event.club_id
  where event.actor_role_family = 'parent'
    and event.is_meaningful
),
active_staff_ids as (
  select distinct coalesce(event.actor_auth_user_id, event.user_id) as user_id
  from selected_events event
  join canonical_staff staff
    on staff.user_id = coalesce(event.actor_auth_user_id, event.user_id)
   and staff.club_id = event.club_id
  where event.actor_role_family in ('staff', 'club_admin')
    and event.is_meaningful
),
active_club_ids as (
  select distinct event.club_id
  from selected_events event
  where event.is_meaningful
    and (
      (
        event.actor_role_family = 'parent'
        and exists (
          select 1 from canonical_parents parent
          where parent.auth_user_id = coalesce(event.actor_auth_user_id, event.user_id)
            and parent.club_id = event.club_id
        )
      )
      or (
        event.actor_role_family in ('staff', 'club_admin')
        and exists (
          select 1 from canonical_staff staff
          where staff.user_id = coalesce(event.actor_auth_user_id, event.user_id)
            and staff.club_id = event.club_id
        )
      )
    )
),
parent_login_ids as (
  select distinct coalesce(event.actor_auth_user_id, event.user_id) as user_id
  from historical_events event
  join canonical_parents parent
    on parent.auth_user_id = coalesce(event.actor_auth_user_id, event.user_id)
   and parent.club_id = event.club_id
  where event.event_name in ('auth.login_success', 'auth.login_succeeded')
    and event.actor_role_family = 'parent'
),
parent_activated_ids as (
  select distinct coalesce(event.actor_auth_user_id, event.user_id) as user_id
  from historical_events event
  join canonical_parents parent
    on parent.auth_user_id = coalesce(event.actor_auth_user_id, event.user_id)
   and parent.club_id = event.club_id
  where event.actor_role_family = 'parent'
    and event.is_meaningful
),
club_history as (
  select
    club.id as club_id,
    club.created_at,
    max(event.occurred_at) filter (
      where event.is_meaningful
        and event.actor_role_family in ('parent', 'staff', 'club_admin')
        and (
          exists (
            select 1 from canonical_parents parent
            where parent.auth_user_id = coalesce(event.actor_auth_user_id, event.user_id)
              and parent.club_id = event.club_id
          )
          or exists (
            select 1 from canonical_staff staff
            where staff.user_id = coalesce(event.actor_auth_user_id, event.user_id)
              and staff.club_id = event.club_id
          )
        )
    ) as last_qualifying_activity_at,
    min(event.occurred_at) filter (
      where event.event_name in ('auth.login_success', 'auth.login_succeeded')
        and event.actor_role_family in ('staff', 'club_admin')
        and exists (
          select 1 from canonical_staff staff
          where staff.user_id = coalesce(event.actor_auth_user_id, event.user_id)
            and staff.club_id = event.club_id
        )
    ) as first_staff_login_at,
    min(event.occurred_at) filter (
      where event.is_meaningful
        and event.actor_role_family in ('staff', 'club_admin')
    ) as first_staff_action_at,
    min(event.occurred_at) filter (
      where event.event_name in ('auth.login_success', 'auth.login_succeeded')
        and event.actor_role_family = 'parent'
    ) as first_parent_login_at,
    min(event.occurred_at) filter (
      where event.is_meaningful
        and event.actor_role_family = 'parent'
    ) as first_parent_action_at
  from eligible_clubs club
  left join historical_events event on event.club_id = club.id
  group by club.id, club.created_at
),
club_lifecycle as (
  select
    history.*,
    (select min(invite.invite_sent_at) from public.club_user_invites invite where invite.club_id = history.club_id and invite.invite_sent_at is not null) as first_staff_invitation_at,
    (select min(assignment.created_at) from valid_staff_assignments assignment where assignment.club_id = history.club_id) as first_staff_account_at,
    (select min(player.created_at) from valid_players player where player.club_id = history.club_id) as first_player_at,
    (select min(link.invite_sent_at) from current_contact_links link where link.club_id = history.club_id and link.invite_sent_at is not null) as first_parent_invitation_at
  from club_history history
),
dormancy_states as (
  select
    lifecycle.club_id,
    lifecycle.last_qualifying_activity_at,
    case
      when lifecycle.last_qualifying_activity_at is not null then 'measured'
      when capture.capture_start_date is null or timezone('Europe/London', lifecycle.created_at)::date < capture.capture_start_date then 'insufficient_history'
      else 'no_qualifying_activity'
    end as state,
    case
      when lifecycle.last_qualifying_activity_at is null then null
      else greatest(0, end_date_value - timezone('Europe/London', lifecycle.last_qualifying_activity_at)::date)
    end as days_since_activity
  from club_lifecycle lifecycle
  cross join capture
),
role_accounts as (
  select role_key, count(distinct user_id)::integer as account_count
  from valid_staff_assignments
  group by role_key
),
role_assignments as (
  select role_key, count(*)::integer as assignment_count
  from valid_staff_assignments
  group by role_key
),
parent_link_reconciliation as (
  select
    count(*) filter (where link.status = 'revoked')::integer as revoked_relationships,
    count(*) filter (
      where link.status = 'active'
        and link.auth_user_id is not null
        and (
          player.id is null
          or profile.id is null
          or team.id is null
          or link.club_id is distinct from player.club_id
          or link.team_id is distinct from player.team_id
        )
    )::integer as unresolved_identities,
    count(*) filter (
      where link.club_id is distinct from player.club_id
         or link.team_id is distinct from player.team_id
    )::integer as cross_scope_relationships
  from public.parent_player_links link
  left join public.players player on player.id = link.player_id and player.status = 'active'
  left join public.users profile on profile.id = link.auth_user_id and profile.status = 'active'
  left join public.teams team on team.id = link.team_id and team.status = 'active'
  where club_id_value is null or link.club_id = club_id_value
)
select jsonb_build_object(
  'definitionVersion', 2,
  'captureStartDate', (select capture_start_date from capture),
  'parentAdoption', jsonb_build_object(
    'contacts', (select count(distinct contact_key) from current_contact_links),
    'invitationsSent', (select count(distinct contact_key) from current_contact_links where invite_sent_at is not null),
    'invitationsAccepted', (select count(distinct auth_user_id) from valid_parent_links where accepted_at is not null),
    'authenticatedParentAccounts', (select count(distinct auth_user_id) from canonical_parents),
    'successfulParentLogins', (select count(*) from parent_login_ids),
    'parentsWithFirstMeaningfulAction', (select count(*) from parent_activated_ids),
    'activeParents', (select count(*) from active_parent_ids),
    'parentOnlyAccounts', (
      select count(*) from (
        select distinct parent.auth_user_id
        from canonical_parents parent
        where not exists (select 1 from canonical_staff staff where staff.user_id = parent.auth_user_id)
      ) parent_only
    ),
    'dualRoleParentAccounts', (
      select count(*) from (
        select distinct parent.auth_user_id
        from canonical_parents parent
        where exists (select 1 from canonical_staff staff where staff.user_id = parent.auth_user_id)
      ) dual_role
    ),
    'activeChildLinks', (select count(distinct (auth_user_id, player_id)) from valid_parent_links),
    'dormantActivatedParents', greatest(0, (select count(*) from parent_activated_ids) - (select count(*) from active_parent_ids)),
    'stages', jsonb_build_array(
      jsonb_build_object('key', 'contacts', 'label', 'Parent contacts', 'count', (select count(distinct contact_key) from current_contact_links), 'available', true),
      jsonb_build_object('key', 'invited', 'label', 'Invitations sent', 'count', (select count(distinct contact_key) from current_contact_links where invite_sent_at is not null), 'available', true),
      jsonb_build_object('key', 'accepted', 'label', 'Invitations accepted', 'count', (select count(distinct auth_user_id) from valid_parent_links where accepted_at is not null), 'available', true),
      jsonb_build_object('key', 'accounts', 'label', 'Authenticated parent accounts', 'count', (select count(distinct auth_user_id) from canonical_parents), 'available', true),
      jsonb_build_object('key', 'first_login', 'label', 'Successful Parent Portal login observed', 'count', (select count(*) from parent_login_ids), 'available', true),
      jsonb_build_object('key', 'activated', 'label', 'First meaningful Parent Portal action observed', 'count', (select count(*) from parent_activated_ids), 'available', true),
      jsonb_build_object('key', 'active', 'label', 'Active parents in selected period', 'count', (select count(*) from active_parent_ids), 'available', true)
    )
  ),
  'staff', jsonb_build_object(
    'authenticatedStaffAccounts', (select count(distinct user_id) from canonical_staff),
    'activeStaffAccounts', (select count(*) from active_staff_ids),
    'assignmentCount', (select count(*) from valid_staff_assignments),
    'multiTeamAccounts', (
      select count(*) from (
        select user_id from valid_staff_assignments group by user_id having count(distinct team_id) > 1
      ) multi_team
    ),
    'roleAccountCounts', coalesce((select jsonb_agg(jsonb_build_object('role', role_key, 'accounts', account_count) order by role_key) from role_accounts), '[]'::jsonb),
    'roleAssignmentCounts', coalesce((select jsonb_agg(jsonb_build_object('role', role_key, 'assignments', assignment_count) order by role_key) from role_assignments), '[]'::jsonb)
  ),
  'activity', jsonb_build_object(
    'activeParents', (select count(*) from active_parent_ids),
    'activeStaff', (select count(*) from active_staff_ids),
    'activeClubs', (select count(*) from active_club_ids),
    'activeParentAccountIds', coalesce((select jsonb_agg(user_id order by user_id) from active_parent_ids), '[]'::jsonb),
    'activeStaffAccountIds', coalesce((select jsonb_agg(user_id order by user_id) from active_staff_ids), '[]'::jsonb),
    'activeClubIds', coalesce((select jsonb_agg(club_id order by club_id) from active_club_ids), '[]'::jsonb)
  ),
  'clubActivation', jsonb_build_object(
    'stages', jsonb_build_array(
      jsonb_build_object('key', 'created', 'label', 'Created', 'count', (select count(*) from club_lifecycle)),
      jsonb_build_object('key', 'staff_invited', 'label', 'First staff invitation sent', 'count', (select count(*) from club_lifecycle where first_staff_invitation_at is not null)),
      jsonb_build_object('key', 'staff_account', 'label', 'First staff account accepted', 'count', (select count(*) from club_lifecycle where first_staff_account_at is not null)),
      jsonb_build_object('key', 'staff_login', 'label', 'First successful club-scoped staff login observed', 'count', (select count(*) from club_lifecycle where first_staff_login_at is not null)),
      jsonb_build_object('key', 'staff_action', 'label', 'First meaningful club action observed', 'count', (select count(*) from club_lifecycle where first_staff_action_at is not null)),
      jsonb_build_object('key', 'player_added', 'label', 'First active player added', 'count', (select count(*) from club_lifecycle where first_player_at is not null)),
      jsonb_build_object('key', 'parent_invited', 'label', 'First parent invitation sent', 'count', (select count(*) from club_lifecycle where first_parent_invitation_at is not null)),
      jsonb_build_object('key', 'parent_login', 'label', 'First Parent Portal login observed', 'count', (select count(*) from club_lifecycle where first_parent_login_at is not null)),
      jsonb_build_object('key', 'parent_action', 'label', 'First Parent Portal meaningful action observed', 'count', (select count(*) from club_lifecycle where first_parent_action_at is not null))
    ),
    'noStaffLoginObserved', (
      select count(*) from club_lifecycle lifecycle cross join capture
      where lifecycle.first_staff_login_at is null
        and capture.capture_start_date is not null
        and timezone('Europe/London', lifecycle.created_at)::date >= capture.capture_start_date
    ),
    'insufficientStaffLoginHistory', (
      select count(*) from club_lifecycle lifecycle cross join capture
      where lifecycle.first_staff_login_at is null
        and (capture.capture_start_date is null or timezone('Europe/London', lifecycle.created_at)::date < capture.capture_start_date)
    ),
    'noStaffLoginObservedClubIds', coalesce((
      select jsonb_agg(lifecycle.club_id order by lifecycle.club_id)
      from club_lifecycle lifecycle cross join capture
      where lifecycle.first_staff_login_at is null
        and capture.capture_start_date is not null
        and timezone('Europe/London', lifecycle.created_at)::date >= capture.capture_start_date
    ), '[]'::jsonb)
  ),
  'dormancy', jsonb_build_object(
    'measuredClubs', (select count(*) from dormancy_states where state = 'measured'),
    'dormant14Days', (select count(*) from dormancy_states where state = 'measured' and days_since_activity >= 14),
    'dormant30Days', (select count(*) from dormancy_states where state = 'measured' and days_since_activity >= 30),
    'dormant60Days', (select count(*) from dormancy_states where state = 'measured' and days_since_activity >= 60),
    'dormant90Days', (select count(*) from dormancy_states where state = 'measured' and days_since_activity >= 90),
    'noQualifyingActivity', (select count(*) from dormancy_states where state = 'no_qualifying_activity'),
    'insufficientHistory', (select count(*) from dormancy_states where state = 'insufficient_history'),
    'clubStates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clubId', club_id,
        'lastQualifyingActivityAt', last_qualifying_activity_at,
        'state', state,
        'daysSinceActivity', days_since_activity
      ) order by club_id)
      from dormancy_states
    ), '[]'::jsonb)
  ),
  'reconciliation', jsonb_build_object(
    'distinctAuthUsers', (select count(*) from (select auth_user_id from canonical_parents union select user_id from canonical_staff) identities),
    'distinctProfiles', (select count(*) from (select auth_user_id from canonical_parents union select user_id from canonical_staff) profiles),
    'distinctParentContacts', (select count(distinct contact_key) from current_contact_links),
    'distinctActiveLinks', (select count(distinct (auth_user_id, player_id)) from valid_parent_links),
    'distinctAssignments', (select count(*) from valid_staff_assignments),
    'dualRoleCount', (
      select count(*) from (
        select distinct parent.auth_user_id
        from canonical_parents parent
        where exists (select 1 from canonical_staff staff where staff.user_id = parent.auth_user_id)
      ) dual_role
    ),
    'revokedRelationshipCount', (select revoked_relationships from parent_link_reconciliation),
    'unresolvedIdentityCount', (select unresolved_identities from parent_link_reconciliation),
    'crossScopeRelationshipCount', (select cross_scope_relationships from parent_link_reconciliation),
    'authenticatedParentAccountIds', coalesce((select jsonb_agg(distinct auth_user_id order by auth_user_id) from canonical_parents), '[]'::jsonb),
    'authenticatedStaffAccountIds', coalesce((select jsonb_agg(distinct user_id order by user_id) from canonical_staff), '[]'::jsonb)
  )
);
$$;

revoke all on function public.get_platform_analytics_identity_adoption(date, date, uuid, text, boolean, text, text)
from public, anon, authenticated;

grant execute on function public.get_platform_analytics_identity_adoption(date, date, uuid, text, boolean, text, text)
to service_role;

comment on function public.get_platform_analytics_identity_adoption(date, date, uuid, text, boolean, text, text) is
'Version 2 private identity, adoption, activation, dormancy, and reconciliation metrics. Returns safe identifiers and counts only, without contact details.';
