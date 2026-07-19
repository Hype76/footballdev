-- FP-V1-SECURITY-P0-AUTHORITY-CONTAINMENT-RECOVERY-IMPLEMENT-01
-- Installs the atomic demo recovery operation. It does not invoke the reset and
-- does not modify demo or real application data during migration.

create table if not exists public.demo_reset_operations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  demo_scope text not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_category text not null,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  lock_result text not null,
  initial_state_fingerprint text,
  final_state_fingerprint text,
  created_counts jsonb not null default '{}'::jsonb,
  updated_counts jsonb not null default '{}'::jsonb,
  removed_counts jsonb not null default '{}'::jsonb,
  outcome text not null,
  failure_stage text,
  safe_error_code text,
  constraint demo_reset_operations_scope_check check (demo_scope = 'public-demo-v1'),
  constraint demo_reset_operations_actor_check check (actor_category = 'approved_demo_identity'),
  constraint demo_reset_operations_lock_check check (lock_result in ('acquired', 'conflict', 'not_acquired', 'not_attempted', 'unknown')),
  constraint demo_reset_operations_outcome_check check (outcome in ('completed', 'conflict', 'failed')),
  constraint demo_reset_operations_fingerprint_check check (
    (outcome = 'completed' and initial_state_fingerprint is not null and final_state_fingerprint is not null)
    or outcome <> 'completed'
  )
);

create index if not exists demo_reset_operations_operation_idx
on public.demo_reset_operations (operation_id, started_at desc);

create index if not exists demo_reset_operations_scope_started_idx
on public.demo_reset_operations (demo_scope, started_at desc);

alter table public.demo_reset_operations enable row level security;

create or replace function public.prevent_demo_reset_operation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'DEMO_RESET_AUDIT_IMMUTABLE';
end;
$$;

drop trigger if exists demo_reset_operations_immutable on public.demo_reset_operations;
create trigger demo_reset_operations_immutable
before update or delete on public.demo_reset_operations
for each row execute function public.prevent_demo_reset_operation_mutation();

create or replace function public.demo_reset_uuid(p_key text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select md5('footballplayer-demo-reset-v1:' || p_key)::uuid
$$;

create or replace function public.demo_reset_communication_fingerprint(p_club_id uuid)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select md5(jsonb_build_object(
    'communication_logs', (select count(*) from public.communication_logs where club_id = p_club_id),
    'club_user_invites', (select count(*) from public.club_user_invites where club_id = p_club_id),
    'scheduled_email_queue', (select count(*) from public.scheduled_email_queue where club_id = p_club_id),
    'calendar_commands', (select count(*) from public.calendar_event_notification_commands where club_id = p_club_id),
    'calendar_events', (select count(*) from public.calendar_event_notification_events where club_id = p_club_id),
    'match_notifications', (select count(*) from public.match_day_notification_events where club_id = p_club_id),
    'parent_chat_rooms', (select count(*) from public.parent_chat_rooms where club_id = p_club_id),
    'parent_chat_memberships', (
      select count(*)
      from public.parent_chat_memberships membership
      join public.parent_chat_rooms room on room.id = membership.room_id
      where room.club_id = p_club_id
    ),
    'parent_chat_membership_audit', (
      select count(*)
      from public.parent_chat_membership_audit audit
      join public.parent_chat_rooms room on room.id = audit.room_id
      where room.club_id = p_club_id
    ),
    'parent_chat_messages', (
      select count(*)
      from public.parent_chat_messages message
      join public.parent_chat_rooms room on room.id = message.room_id
      where room.club_id = p_club_id
    ),
    'staff_chat_conversations', (select count(*) from public.staff_chat_conversations where club_id = p_club_id),
    'staff_chat_members', (
      select count(*)
      from public.staff_chat_members member
      join public.staff_chat_conversations conversation on conversation.id = member.conversation_id
      where conversation.club_id = p_club_id
    ),
    'staff_chat_messages', (select count(*) from public.staff_chat_messages where club_id = p_club_id)
  )::text)
$$;

create or replace function public.demo_reset_state_fingerprint(
  p_club_id uuid,
  p_actor_id uuid
)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select md5(jsonb_build_object(
    'club', (select count(*) from public.clubs where id = p_club_id),
    'application_user', (select count(*) from public.users where id = p_actor_id and club_id = p_club_id),
    'membership', (select count(*) from public.user_club_memberships where auth_user_id = p_actor_id and club_id = p_club_id),
    'teams', (select coalesce(jsonb_agg(jsonb_build_array(id, name) order by name), '[]'::jsonb) from public.teams where club_id = p_club_id),
    'team_staff', (
      select coalesce(jsonb_agg(jsonb_build_array(staff.team_id, staff.user_id) order by staff.team_id), '[]'::jsonb)
      from public.team_staff staff
      join public.teams team on team.id = staff.team_id
      where team.club_id = p_club_id
    ),
    'roles', (select coalesce(jsonb_agg(jsonb_build_array(role_key, role_label, role_rank) order by role_key), '[]'::jsonb) from public.club_roles where club_id = p_club_id),
    'form_fields', (select coalesce(jsonb_agg(jsonb_build_array(id, label, type, order_index) order by order_index), '[]'::jsonb) from public.form_fields where club_id = p_club_id),
    'players', (select coalesce(jsonb_agg(jsonb_build_array(id, player_name, team_id, section, status) order by player_name), '[]'::jsonb) from public.players where club_id = p_club_id),
    'evaluations', (select coalesce(jsonb_agg(jsonb_build_array(id, player_id, session, date, average_score) order by id), '[]'::jsonb) from public.evaluations where club_id = p_club_id),
    'assessment_sessions', (select coalesce(jsonb_agg(jsonb_build_array(id, team_id, title, session_date, status) order by id), '[]'::jsonb) from public.assessment_sessions where club_id = p_club_id),
    'assessment_session_players', (
      select coalesce(jsonb_agg(jsonb_build_array(link.id, link.session_id, link.player_id) order by link.id), '[]'::jsonb)
      from public.assessment_session_players link
      join public.assessment_sessions session on session.id = link.session_id
      where session.club_id = p_club_id
    ),
    'parent_links', (select coalesce(jsonb_agg(jsonb_build_array(id, team_id, player_id, status) order by id), '[]'::jsonb) from public.parent_player_links where club_id = p_club_id),
    'staff_notes', (select coalesce(jsonb_agg(jsonb_build_array(id, player_id) order by id), '[]'::jsonb) from public.player_staff_notes where club_id = p_club_id),
    'polls', (select coalesce(jsonb_agg(jsonb_build_array(id, team_id, title, status) order by id), '[]'::jsonb) from public.polls where club_id = p_club_id),
    'poll_votes', (select coalesce(jsonb_agg(jsonb_build_array(id, poll_id, option_id) order by id), '[]'::jsonb) from public.poll_votes where club_id = p_club_id),
    'match_locations', (select coalesce(jsonb_agg(jsonb_build_array(id, name, address) order by id), '[]'::jsonb) from public.match_locations where club_id = p_club_id),
    'match_days', (select coalesce(jsonb_agg(jsonb_build_array(id, team_id, opponent, match_date, status) order by id), '[]'::jsonb) from public.match_days where club_id = p_club_id),
    'match_events', (select coalesce(jsonb_agg(jsonb_build_array(id, match_day_id, event_type, minute) order by id), '[]'::jsonb) from public.match_day_events where club_id = p_club_id),
    'scorer_interest', (select coalesce(jsonb_agg(jsonb_build_array(id, match_day_id, parent_link_id, status) order by id), '[]'::jsonb) from public.match_day_scorer_interest where club_id = p_club_id),
    'availability', (select coalesce(jsonb_agg(jsonb_build_array(id, match_day_id, player_id, status) order by id), '[]'::jsonb) from public.match_day_availability_requests where club_id = p_club_id),
    'calendar_events', (select count(*) from public.calendar_events where club_id = p_club_id),
    'communications', public.demo_reset_communication_fingerprint(p_club_id)
  )::text)
$$;

create or replace function public.parent_chat_sync_team_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_team_id uuid := case when tg_op = 'DELETE' then old.team_id else new.team_id end;
  room_record record;
begin
  if current_setting('app.demo_reset_skip_communication_sync', true) = 'on' then
    return coalesce(new, old);
  end if;

  insert into public.parent_chat_rooms (
    club_id,
    team_id,
    room_type,
    title
  )
  select
    team.club_id,
    team.id,
    'team',
    team.name || ' Team Chat'
  from public.teams team
  where team.id = resolved_team_id
  on conflict (club_id, team_id) where room_type = 'team'
  do nothing;

  for room_record in
    select room.id
    from public.parent_chat_rooms room
    where room.team_id = resolved_team_id
  loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;

  return coalesce(new, old);
end;
$$;

create or replace function public.parent_chat_sync_parent_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_record public.parent_player_links%rowtype;
  resolved_team_id uuid;
  room_record record;
begin
  if current_setting('app.demo_reset_skip_communication_sync', true) = 'on' then
    return coalesce(new, old);
  end if;

  link_record := case when tg_op = 'DELETE' then old else new end;

  select coalesce(link_record.team_id, player.team_id)
  into resolved_team_id
  from public.players player
  where player.id = link_record.player_id;

  if tg_op <> 'DELETE'
    and new.status = 'active'
    and new.auth_user_id is not null
    and resolved_team_id is not null then
    insert into public.parent_chat_rooms (
      club_id,
      team_id,
      player_id,
      room_type,
      title
    ) values (
      new.club_id,
      resolved_team_id,
      new.player_id,
      'parent_staff',
      'Chat with Staff'
    )
    on conflict (club_id, team_id, player_id) where room_type = 'parent_staff'
    do nothing;

    insert into public.parent_chat_rooms (
      club_id,
      team_id,
      room_type,
      title
    )
    select
      team.club_id,
      team.id,
      'team',
      team.name || ' Team Chat'
    from public.teams team
    where team.id = resolved_team_id
      and team.club_id = new.club_id
    on conflict (club_id, team_id) where room_type = 'team'
    do nothing;
  end if;

  for room_record in
    select room.id
    from public.parent_chat_rooms room
    where room.club_id = link_record.club_id
      and room.team_id = resolved_team_id
      and (
        room.room_type <> 'parent_staff'
        or room.player_id = link_record.player_id
      )
  loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;

  return coalesce(new, old);
end;
$$;

create or replace function public.parent_chat_sync_match_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.demo_reset_skip_communication_sync', true) = 'on' then
    return new;
  end if;

  update public.parent_chat_rooms room
  set
    status = case
      when new.previous_hidden_at is not null then 'archived'
      when new.status in ('scheduled', 'scorer_request', 'live', 'half_time') then 'active'
      else 'closed'
    end,
    updated_at = timezone('utc', now())
  where room.room_type = 'match_squad'
    and room.match_day_id = new.id
    and room.club_id = new.club_id
    and room.team_id = new.team_id;

  return new;
end;
$$;

create or replace function public.create_match_day_motm_poll_on_full_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.demo_reset_skip_communication_sync', true) = 'on' then
    return new;
  end if;

  if new.status = 'full_time'
    and old.status is distinct from new.status
    and new.enable_motm_poll is true
    and new.motm_poll_id is null then
    perform public.create_match_day_motm_poll(new.id);
  end if;

  return new;
end;
$$;

create or replace function public.reset_demo_account_atomic(
  p_actor_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_email text;
  v_club_id uuid;
  v_team_u12 uuid;
  v_team_u14 uuid;
  v_team_u16 uuid;
  v_home_location uuid;
  v_away_location uuid;
  v_previous_match uuid;
  v_next_match uuid;
  v_today date := timezone('utc', statement_timestamp())::date;
  v_initial_fingerprint text;
  v_final_fingerprint text;
  v_communication_before text;
  v_communication_after text;
  v_created_counts jsonb := '{}'::jsonb;
  v_updated_counts jsonb := '{}'::jsonb;
  v_removed_counts jsonb := '{}'::jsonb;
  v_actual_counts jsonb;
  v_count integer := 0;
  v_changed integer := 0;
  v_cached public.demo_reset_operations%rowtype;
begin
  if p_actor_id is null or p_operation_id is null then
    raise exception using errcode = '22023', message = 'DEMO_SCOPE_INVALID_ARGUMENT';
  end if;

  select lower(auth_user.email)
  into v_auth_email
  from auth.users auth_user
  where auth_user.id = p_actor_id
  for key share;

  if v_auth_email is distinct from 'demo@playerfeedback.online' then
    raise exception using errcode = '42501', message = 'DEMO_SCOPE_ACTOR_DENIED';
  end if;

  select operation.*
  into v_cached
  from public.demo_reset_operations operation
  where operation.operation_id = p_operation_id
    and operation.actor_id = p_actor_id
    and operation.demo_scope = 'public-demo-v1'
    and operation.outcome = 'completed'
  order by operation.started_at desc
  limit 1;

  if v_cached.id is not null then
    return jsonb_build_object(
      'success', true,
      'cached', true,
      'lock_result', 'already_completed',
      'operation_id', p_operation_id,
      'initial_state_fingerprint', v_cached.initial_state_fingerprint,
      'final_state_fingerprint', v_cached.final_state_fingerprint,
      'created_counts', v_cached.created_counts,
      'updated_counts', v_cached.updated_counts,
      'removed_counts', v_cached.removed_counts
    );
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('footballplayer:demo-reset:v1', 0)) then
    raise exception using errcode = '55P03', message = 'DEMO_RESET_LOCKED';
  end if;

  perform set_config('app.demo_reset_skip_communication_sync', 'on', true);
  perform set_config('app.demo_reset_operation_id', p_operation_id::text, true);

  select club.id
  into v_club_id
  from public.clubs club
  where lower(club.name) = lower('Cambourne Town Academy FC')
  for update;

  if v_club_id is null then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_CLUB_MISSING';
  end if;

  perform 1
  from public.clubs club
  where club.id = v_club_id
    and club.status = 'active'
    and club.plan_key = 'large_club'
    and club.plan_status = 'active'
    and club.is_plan_comped is true;

  if not found then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_CLUB_STATE_MISMATCH';
  end if;

  perform 1
  from public.users app_user
  where app_user.id = p_actor_id
    and app_user.club_id = v_club_id
    and lower(app_user.email) = 'demo@playerfeedback.online'
    and app_user.role = 'head_manager'
    and app_user.role_rank = 70
    and app_user.status = 'active'
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_PROFILE_MISMATCH';
  end if;

  perform 1
  from public.user_club_memberships membership
  where membership.auth_user_id = p_actor_id
    and membership.club_id = v_club_id
    and lower(membership.email) = 'demo@playerfeedback.online'
    and membership.role = 'head_manager'
    and membership.role_rank = 70
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_MEMBERSHIP_MISMATCH';
  end if;

  if exists (
    select 1
    from public.users app_user
    where app_user.club_id = v_club_id
      and app_user.id <> p_actor_id
  ) or exists (
    select 1
    from public.user_club_memberships membership
    where membership.club_id = v_club_id
      and membership.auth_user_id <> p_actor_id
  ) or exists (
    select 1
    from public.user_club_memberships membership
    where membership.auth_user_id = p_actor_id
      and membership.club_id <> v_club_id
  ) then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_ISOLATION_DRIFT';
  end if;

  perform team.id
  from public.teams team
  where team.club_id = v_club_id
  order by team.id
  for update;

  if exists (
    select 1
    from public.teams team
    where team.club_id = v_club_id
      and team.name not in ('U12 Tigers', 'U14 Falcons', 'U16 Lions')
  ) then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_TEAM_DRIFT';
  end if;

  insert into public.teams (
    id, club_id, name, created_by, created_by_name, created_by_email
  )
  select
    public.demo_reset_uuid('team:u12'), v_club_id, 'U12 Tigers', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'
  where not exists (
    select 1 from public.teams where club_id = v_club_id and name = 'U12 Tigers'
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('teams', v_changed);

  insert into public.teams (
    id, club_id, name, created_by, created_by_name, created_by_email
  )
  select
    public.demo_reset_uuid('team:u14'), v_club_id, 'U14 Falcons', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'
  where not exists (
    select 1 from public.teams where club_id = v_club_id and name = 'U14 Falcons'
  );
  get diagnostics v_changed = row_count;
  v_created_counts := jsonb_set(v_created_counts, '{teams}', to_jsonb(coalesce((v_created_counts ->> 'teams')::integer, 0) + v_changed));

  insert into public.teams (
    id, club_id, name, created_by, created_by_name, created_by_email
  )
  select
    public.demo_reset_uuid('team:u16'), v_club_id, 'U16 Lions', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'
  where not exists (
    select 1 from public.teams where club_id = v_club_id and name = 'U16 Lions'
  );
  get diagnostics v_changed = row_count;
  v_created_counts := jsonb_set(v_created_counts, '{teams}', to_jsonb(coalesce((v_created_counts ->> 'teams')::integer, 0) + v_changed));

  select id into strict v_team_u12 from public.teams where club_id = v_club_id and name = 'U12 Tigers';
  select id into strict v_team_u14 from public.teams where club_id = v_club_id and name = 'U14 Falcons';
  select id into strict v_team_u16 from public.teams where club_id = v_club_id and name = 'U16 Lions';

  if exists (
    select 1
    from public.team_staff staff
    join public.teams team on team.id = staff.team_id
    where team.club_id = v_club_id
      and staff.user_id <> p_actor_id
  ) then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_STAFF_DRIFT';
  end if;

  v_initial_fingerprint := public.demo_reset_state_fingerprint(v_club_id, p_actor_id);
  v_communication_before := public.demo_reset_communication_fingerprint(v_club_id);

  if exists (select 1 from public.calendar_events where club_id = v_club_id) then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_CALENDAR_DRIFT';
  end if;

  insert into public.club_roles (
    club_id, role_key, role_label, role_rank, is_system,
    created_by, created_by_name, created_by_email
  ) values
    (v_club_id, 'admin', 'Club Admin', 90, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (v_club_id, 'head_manager', 'Team Admin', 70, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (v_club_id, 'manager', 'Manager', 50, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (v_club_id, 'coach', 'Coach', 30, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (v_club_id, 'assistant_coach', 'Assistant Coach', 20, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online')
  on conflict (club_id, role_key) do update
  set
    role_label = excluded.role_label,
    role_rank = excluded.role_rank,
    is_system = excluded.is_system
  where (club_roles.role_label, club_roles.role_rank, club_roles.is_system)
    is distinct from (excluded.role_label, excluded.role_rank, excluded.is_system);

  if exists (
    select 1
    from public.club_roles role
    where role.club_id = v_club_id
      and role.role_key not in ('admin', 'head_manager', 'manager', 'coach', 'assistant_coach')
  ) then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_ROLE_DRIFT';
  end if;

  insert into public.team_staff (team_id, user_id)
  values
    (v_team_u12, p_actor_id),
    (v_team_u14, p_actor_id),
    (v_team_u16, p_actor_id)
  on conflict (team_id, user_id) do nothing;
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('team_staff', v_changed);

  if exists (
    select 1 from public.form_fields where club_id = v_club_id and created_by is distinct from p_actor_id
  ) or exists (
    select 1 from public.players where club_id = v_club_id and created_by is distinct from p_actor_id
  ) or exists (
    select 1 from public.evaluations where club_id = v_club_id and coach_id is distinct from p_actor_id
  ) or exists (
    select 1 from public.assessment_sessions where club_id = v_club_id and created_by is distinct from p_actor_id
  ) or exists (
    select 1 from public.parent_player_links where club_id = v_club_id and invited_by is distinct from p_actor_id
  ) or exists (
    select 1 from public.player_staff_notes where club_id = v_club_id and user_id is distinct from p_actor_id
  ) or exists (
    select 1 from public.polls where club_id = v_club_id and created_by is distinct from p_actor_id
  ) or exists (
    select 1 from public.match_locations where club_id = v_club_id and created_by is distinct from p_actor_id
  ) or exists (
    select 1 from public.match_days where club_id = v_club_id and created_by is distinct from p_actor_id
  ) or exists (
    select 1 from public.match_day_availability_requests where club_id = v_club_id and created_by is distinct from p_actor_id
  ) then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_RECORD_OWNERSHIP_DRIFT';
  end if;

  delete from public.match_day_availability_requests
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('availability:grace'),
      public.demo_reset_uuid('availability:ben'),
      public.demo_reset_uuid('availability:ella')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('availability_requests', v_changed);

  delete from public.match_day_events
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('match-event:fen-18'),
      public.demo_reset_uuid('match-event:fen-52')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('match_day_events', v_changed);

  delete from public.match_day_scorer_interest
  where club_id = v_club_id
    and id <> public.demo_reset_uuid('scorer-interest:histon');
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('scorer_interest', v_changed);

  delete from public.poll_votes
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('poll-vote:availability:alex'),
      public.demo_reset_uuid('poll-vote:availability:maya'),
      public.demo_reset_uuid('poll-vote:availability:noah'),
      public.demo_reset_uuid('poll-vote:availability:leo'),
      public.demo_reset_uuid('poll-vote:awards:alex'),
      public.demo_reset_uuid('poll-vote:awards:maya'),
      public.demo_reset_uuid('poll-vote:awards:noah')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('poll_votes', v_changed);

  delete from public.polls
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('poll:availability'),
      public.demo_reset_uuid('poll:awards')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('legacy_polls', v_changed);

  delete from public.assessment_session_players link
  using public.assessment_sessions session
  where link.session_id = session.id
    and session.club_id = v_club_id
    and link.id <> public.demo_reset_uuid(
      'session-player:' || link.session_id::text || ':' || link.player_id::text
    );
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('assessment_session_players', v_changed);

  delete from public.assessment_sessions
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('session:u12-pressing'),
      public.demo_reset_uuid('session:u14-west-cambs'),
      public.demo_reset_uuid('session:u12-final-third'),
      public.demo_reset_uuid('session:u16-histon')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('legacy_assessment_sessions', v_changed);

  delete from public.evaluations
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('evaluation:alex-pressing'),
      public.demo_reset_uuid('evaluation:alex-fen'),
      public.demo_reset_uuid('evaluation:alex-final-third'),
      public.demo_reset_uuid('evaluation:maya-angles'),
      public.demo_reset_uuid('evaluation:leo-west-cambs'),
      public.demo_reset_uuid('evaluation:sofia-back-four')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('legacy_evaluations', v_changed);

  delete from public.player_staff_notes
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('staff-note:alex'),
      public.demo_reset_uuid('staff-note:maya'),
      public.demo_reset_uuid('staff-note:sofia')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('legacy_staff_notes', v_changed);

  delete from public.parent_player_links
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('parent-link:alex'),
      public.demo_reset_uuid('parent-link:maya'),
      public.demo_reset_uuid('parent-link:noah'),
      public.demo_reset_uuid('parent-link:leo'),
      public.demo_reset_uuid('parent-link:sofia'),
      public.demo_reset_uuid('parent-link:grace'),
      public.demo_reset_uuid('parent-link:ben')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('legacy_parent_links', v_changed);

  delete from public.players
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('player:alex-morgan'),
      public.demo_reset_uuid('player:maya-singh'),
      public.demo_reset_uuid('player:noah-turner'),
      public.demo_reset_uuid('player:ruby-carter'),
      public.demo_reset_uuid('player:leo-hughes'),
      public.demo_reset_uuid('player:sofia-brooks'),
      public.demo_reset_uuid('player:theo-clarke'),
      public.demo_reset_uuid('player:grace-wilson'),
      public.demo_reset_uuid('player:ben-walker'),
      public.demo_reset_uuid('player:ella-price')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('legacy_players', v_changed);

  delete from public.form_fields
  where club_id = v_club_id
    and not (id = any(array[
      public.demo_reset_uuid('form-field:technical'),
      public.demo_reset_uuid('form-field:tactical'),
      public.demo_reset_uuid('form-field:physical'),
      public.demo_reset_uuid('form-field:mentality'),
      public.demo_reset_uuid('form-field:coachability'),
      public.demo_reset_uuid('form-field:strengths'),
      public.demo_reset_uuid('form-field:improvements'),
      public.demo_reset_uuid('form-field:overall-comments')
    ]));
  get diagnostics v_changed = row_count;
  v_removed_counts := v_removed_counts || jsonb_build_object('legacy_form_fields', v_changed);

  select count(*)
  into v_count
  from unnest(array[
    public.demo_reset_uuid('form-field:technical'),
    public.demo_reset_uuid('form-field:tactical'),
    public.demo_reset_uuid('form-field:physical'),
    public.demo_reset_uuid('form-field:mentality'),
    public.demo_reset_uuid('form-field:coachability'),
    public.demo_reset_uuid('form-field:strengths'),
    public.demo_reset_uuid('form-field:improvements'),
    public.demo_reset_uuid('form-field:overall-comments')
  ]) expected(id)
  where not exists (select 1 from public.form_fields field where field.id = expected.id);

  insert into public.form_fields (
    id, club_id, label, type, options, required, order_index,
    is_default, is_enabled, created_by, created_by_name, created_by_email
  ) values
    (public.demo_reset_uuid('form-field:technical'), v_club_id, 'Technical', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 1, true, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('form-field:tactical'), v_club_id, 'Tactical', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 2, true, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('form-field:physical'), v_club_id, 'Physical', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 3, true, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('form-field:mentality'), v_club_id, 'Mentality', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 4, true, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('form-field:coachability'), v_club_id, 'Coachability', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 5, true, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('form-field:strengths'), v_club_id, 'Strengths', 'textarea', '[]'::jsonb, false, 6, true, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('form-field:improvements'), v_club_id, 'Improvements', 'textarea', '[]'::jsonb, false, 7, true, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('form-field:overall-comments'), v_club_id, 'Overall Comments', 'textarea', '[]'::jsonb, false, 8, true, true, p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online')
  on conflict (id) do update
  set
    club_id = excluded.club_id,
    label = excluded.label,
    type = excluded.type,
    options = excluded.options,
    required = excluded.required,
    order_index = excluded.order_index,
    is_default = excluded.is_default,
    is_enabled = excluded.is_enabled
  where (
    form_fields.club_id, form_fields.label, form_fields.type, form_fields.options,
    form_fields.required, form_fields.order_index, form_fields.is_default, form_fields.is_enabled
  ) is distinct from (
    excluded.club_id, excluded.label, excluded.type, excluded.options,
    excluded.required, excluded.order_index, excluded.is_default, excluded.is_enabled
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('form_fields', v_count);
  v_updated_counts := v_updated_counts || jsonb_build_object('form_fields', v_changed - v_count);

  select count(*)
  into v_count
  from unnest(array[
    public.demo_reset_uuid('player:alex-morgan'),
    public.demo_reset_uuid('player:maya-singh'),
    public.demo_reset_uuid('player:noah-turner'),
    public.demo_reset_uuid('player:ruby-carter'),
    public.demo_reset_uuid('player:leo-hughes'),
    public.demo_reset_uuid('player:sofia-brooks'),
    public.demo_reset_uuid('player:theo-clarke'),
    public.demo_reset_uuid('player:grace-wilson'),
    public.demo_reset_uuid('player:ben-walker'),
    public.demo_reset_uuid('player:ella-price')
  ]) expected(id)
  where not exists (select 1 from public.players player where player.id = expected.id);

  insert into public.players (
    id, club_id, player_name, shirt_number, section, team_id, team,
    parent_name, parent_email, parent_contacts, contact_type, positions,
    status, notes, created_by, created_by_name, created_by_email
  ) values
    (public.demo_reset_uuid('player:alex-morgan'), v_club_id, 'Alex Morgan', '12', 'Squad', v_team_u12, 'U12 Tigers', 'Sam Morgan', 'demo.parent.01@footballplayer.test', '[{"name":"Sam Morgan","email":"demo.parent.01@footballplayer.test"}]'::jsonb, 'parent', array['Striker','Winger'], 'promoted', 'Sharp movement in the final third.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('player:maya-singh'), v_club_id, 'Maya Singh', '8', 'Squad', v_team_u12, 'U12 Tigers', 'Priya Singh', 'demo.parent.02@footballplayer.test', '[{"name":"Priya Singh","email":"demo.parent.02@footballplayer.test"}]'::jsonb, 'parent', array['CM'], 'promoted', 'Calm in possession and leads warmups well.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('player:noah-turner'), v_club_id, 'Noah Turner', '5', 'Squad', v_team_u12, 'U12 Tigers', 'Chris Turner', 'demo.parent.03@footballplayer.test', '[{"name":"Chris Turner","email":"demo.parent.03@footballplayer.test"}]'::jsonb, 'parent', array['CB'], 'promoted', 'Strong one-to-one defending and recovery runs.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('player:ruby-carter'), v_club_id, 'Ruby Carter', '1', 'Trial', v_team_u12, 'U12 Tigers', 'Elliot Carter', 'demo.parent.04@footballplayer.test', '[{"name":"Elliot Carter","email":"demo.parent.04@footballplayer.test"}]'::jsonb, 'parent', array['GK'], 'active', 'Confident handling, still learning distribution speed.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('player:leo-hughes'), v_club_id, 'Leo Hughes', '11', 'Squad', v_team_u14, 'U14 Falcons', 'Amira Hughes', 'demo.parent.05@footballplayer.test', '[{"name":"Amira Hughes","email":"demo.parent.05@footballplayer.test"}]'::jsonb, 'parent', array['Winger'], 'promoted', 'Positive runner who commits defenders.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('player:sofia-brooks'), v_club_id, 'Sofia Brooks', '6', 'Squad', v_team_u14, 'U14 Falcons', 'Helen Brooks', 'demo.parent.06@footballplayer.test', '[{"name":"Helen Brooks","email":"demo.parent.06@footballplayer.test"}]'::jsonb, 'parent', array['CM','CDM'], 'promoted', 'Reads danger early and helps organise shape.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('player:theo-clarke'), v_club_id, 'Theo Clarke', '9', 'Trial', v_team_u14, 'U14 Falcons', 'Martin Clarke', 'demo.parent.07@footballplayer.test', '[{"name":"Martin Clarke","email":"demo.parent.07@footballplayer.test"}]'::jsonb, 'parent', array['ST'], 'active', 'Good first touch under pressure.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('player:grace-wilson'), v_club_id, 'Grace Wilson', '3', 'Squad', v_team_u16, 'U16 Lions', 'Jamie Wilson', 'demo.parent.08@footballplayer.test', '[{"name":"Jamie Wilson","email":"demo.parent.08@footballplayer.test"}]'::jsonb, 'parent', array['LB'], 'promoted', 'Reliable full back with improving delivery.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('player:ben-walker'), v_club_id, 'Ben Walker', '4', 'Squad', v_team_u16, 'U16 Lions', 'Nadia Walker', 'demo.parent.09@footballplayer.test', '[{"name":"Nadia Walker","email":"demo.parent.09@footballplayer.test"}]'::jsonb, 'parent', array['CB'], 'promoted', 'Voice in the back line and strong aerial timing.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('player:ella-price'), v_club_id, 'Ella Price', '10', 'Trial', v_team_u16, 'U16 Lions', 'Owen Price', 'demo.parent.10@footballplayer.test', '[{"name":"Owen Price","email":"demo.parent.10@footballplayer.test"}]'::jsonb, 'parent', array['CAM'], 'active', 'Creative passer who finds pockets well.', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online')
  on conflict (id) do update
  set
    club_id = excluded.club_id,
    player_name = excluded.player_name,
    shirt_number = excluded.shirt_number,
    section = excluded.section,
    team_id = excluded.team_id,
    team = excluded.team,
    parent_name = excluded.parent_name,
    parent_email = excluded.parent_email,
    parent_contacts = excluded.parent_contacts,
    contact_type = excluded.contact_type,
    positions = excluded.positions,
    status = excluded.status,
    notes = excluded.notes,
    archived_reason = null,
    archived_at = null,
    archived_by = null,
    archived_previous_status = null,
    archived_delete_at = null
  where (
    players.club_id, players.player_name, players.shirt_number, players.section,
    players.team_id, players.team, players.parent_name, players.parent_email,
    players.parent_contacts, players.contact_type, players.positions, players.status,
    players.notes, players.archived_reason, players.archived_at, players.archived_by,
    players.archived_previous_status, players.archived_delete_at
  ) is distinct from (
    excluded.club_id, excluded.player_name, excluded.shirt_number, excluded.section,
    excluded.team_id, excluded.team, excluded.parent_name, excluded.parent_email,
    excluded.parent_contacts, excluded.contact_type, excluded.positions, excluded.status,
    excluded.notes, null::text, null::timestamptz, null::uuid, null::text, null::timestamptz
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('players', v_count);
  v_updated_counts := v_updated_counts || jsonb_build_object('players', v_changed - v_count);

  select count(*)
  into v_count
  from unnest(array[
    public.demo_reset_uuid('evaluation:alex-pressing'),
    public.demo_reset_uuid('evaluation:alex-fen'),
    public.demo_reset_uuid('evaluation:alex-final-third'),
    public.demo_reset_uuid('evaluation:maya-angles'),
    public.demo_reset_uuid('evaluation:leo-west-cambs'),
    public.demo_reset_uuid('evaluation:sofia-back-four')
  ]) expected(id)
  where not exists (select 1 from public.evaluations evaluation where evaluation.id = expected.id);

  with seeds (
    id, player_id, session_name, day_offset,
    technical, tactical, physical, mentality, coachability,
    strengths, improvements, overall_comments
  ) as (
    values
      (public.demo_reset_uuid('evaluation:alex-pressing'), public.demo_reset_uuid('player:alex-morgan'), 'Training | Pressing from the front', -28, 3, 3, 4, 4, 4, 'Quick acceleration and brave first press.', 'Needs to check shoulder before receiving wide.', 'Positive month one record. Good energy and clear attacking intent.'),
      (public.demo_reset_uuid('evaluation:alex-fen'), public.demo_reset_uuid('player:alex-morgan'), 'Match | Cambourne Town vs Fen Tigers', -14, 4, 4, 4, 4, 4, 'Timed runs well and created two good chances.', 'Can recover into shape quicker after attacks break down.', 'Strong match contribution with better decision making in wide areas.'),
      (public.demo_reset_uuid('evaluation:alex-final-third'), public.demo_reset_uuid('player:alex-morgan'), 'Training | Final third combinations', -7, 4, 4, 5, 5, 4, 'Linked well with the number 10 and pressed with purpose.', 'Keep final pass lower when crossing under pressure.', 'Clear upward trend. Ready for more minutes against stronger opposition.'),
      (public.demo_reset_uuid('evaluation:maya-angles'), public.demo_reset_uuid('player:maya-singh'), 'Training | Midfield receiving angles', -14, 3, 4, 3, 4, 5, 'Shows early pictures and supports both sides of the ball.', 'Can be braver playing forward passes through midfield.', 'Reliable central player with strong coachability.'),
      (public.demo_reset_uuid('evaluation:leo-west-cambs'), public.demo_reset_uuid('player:leo-hughes'), 'Match | U14 Falcons vs West Cambs Colts', -1, 4, 4, 4, 5, 4, 'Beat the full back repeatedly and tracked back well.', 'Final delivery can be more consistent after a long carry.', 'Good match impact and strong recovery work.'),
      (public.demo_reset_uuid('evaluation:sofia-back-four'), public.demo_reset_uuid('player:sofia-brooks'), 'Training | Protecting the back four', -7, 4, 5, 4, 4, 5, 'Excellent screening position and simple distribution.', 'Use voice earlier when the press starts behind her.', 'Very mature session and strong tactical understanding.')
  )
  insert into public.evaluations (
    id, club_id, player_id, player_name, team, team_id, coach_id, coach,
    parent_name, parent_email, parent_contacts, session, date, scores,
    average_score, comments, form_responses, decision, status, section,
    created_by_name, created_by_email, updated_by, updated_by_name,
    updated_by_email, created_at
  )
  select
    seed.id,
    v_club_id,
    player.id,
    player.player_name,
    player.team,
    player.team_id,
    p_actor_id,
    'Jordan Ellis',
    player.parent_name,
    player.parent_email,
    player.parent_contacts,
    seed.session_name,
    to_char(v_today + seed.day_offset, 'DD/MM/YYYY'),
    jsonb_build_object(
      'Technical', seed.technical,
      'Tactical', seed.tactical,
      'Physical', seed.physical,
      'Mentality', seed.mentality,
      'Coachability', seed.coachability
    ),
    round((seed.technical + seed.tactical + seed.physical + seed.mentality + seed.coachability)::numeric / 5, 1),
    jsonb_build_object(
      'strengths', seed.strengths,
      'improvements', seed.improvements,
      'overall', seed.overall_comments
    ),
    jsonb_build_object(
      'Technical', seed.technical,
      'Tactical', seed.tactical,
      'Physical', seed.physical,
      'Mentality', seed.mentality,
      'Coachability', seed.coachability,
      'Strengths', seed.strengths,
      'Improvements', seed.improvements,
      'Overall Comments', seed.overall_comments
    ),
    '',
    'Submitted',
    player.section,
    'Jordan Ellis',
    'demo@playerfeedback.online',
    p_actor_id,
    'Jordan Ellis',
    'demo@playerfeedback.online',
    ((v_today + seed.day_offset)::timestamp at time zone 'UTC')
  from seeds seed
  join public.players player on player.id = seed.player_id
  on conflict (id) do update
  set
    club_id = excluded.club_id,
    player_id = excluded.player_id,
    player_name = excluded.player_name,
    team = excluded.team,
    team_id = excluded.team_id,
    coach_id = excluded.coach_id,
    coach = excluded.coach,
    parent_name = excluded.parent_name,
    parent_email = excluded.parent_email,
    parent_contacts = excluded.parent_contacts,
    session = excluded.session,
    date = excluded.date,
    scores = excluded.scores,
    average_score = excluded.average_score,
    comments = excluded.comments,
    form_responses = excluded.form_responses,
    decision = excluded.decision,
    status = excluded.status,
    section = excluded.section,
    updated_by = excluded.updated_by,
    updated_by_name = excluded.updated_by_name,
    updated_by_email = excluded.updated_by_email,
    created_at = excluded.created_at
  where (
    evaluations.club_id, evaluations.player_id, evaluations.player_name,
    evaluations.team, evaluations.team_id, evaluations.coach_id, evaluations.coach,
    evaluations.parent_name, evaluations.parent_email, evaluations.parent_contacts,
    evaluations.session, evaluations.date, evaluations.scores, evaluations.average_score,
    evaluations.comments, evaluations.form_responses, evaluations.decision,
    evaluations.status, evaluations.section, evaluations.created_at
  ) is distinct from (
    excluded.club_id, excluded.player_id, excluded.player_name,
    excluded.team, excluded.team_id, excluded.coach_id, excluded.coach,
    excluded.parent_name, excluded.parent_email, excluded.parent_contacts,
    excluded.session, excluded.date, excluded.scores, excluded.average_score,
    excluded.comments, excluded.form_responses, excluded.decision,
    excluded.status, excluded.section, excluded.created_at
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('evaluations', v_count);
  v_updated_counts := v_updated_counts || jsonb_build_object('evaluations', v_changed - v_count);

  select count(*)
  into v_count
  from unnest(array[
    public.demo_reset_uuid('session:u12-pressing'),
    public.demo_reset_uuid('session:u14-west-cambs'),
    public.demo_reset_uuid('session:u12-final-third'),
    public.demo_reset_uuid('session:u16-histon')
  ]) expected(id)
  where not exists (select 1 from public.assessment_sessions session where session.id = expected.id);

  insert into public.assessment_sessions (
    id, club_id, team_id, team, opponent, session_date, title,
    session_type, status, created_by, created_by_name, created_by_email
  ) values
    (public.demo_reset_uuid('session:u12-pressing'), v_club_id, v_team_u12, 'U12 Tigers', '', v_today - 7, 'U12 Tigers pressing practice', 'training', 'completed', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('session:u14-west-cambs'), v_club_id, v_team_u14, 'U14 Falcons', 'West Cambs Colts', v_today - 1, 'U14 Falcons vs West Cambs Colts', 'match', 'completed', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('session:u12-final-third'), v_club_id, v_team_u12, 'U12 Tigers', '', v_today + 2, 'U12 Tigers final third combinations', 'training', 'open', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online'),
    (public.demo_reset_uuid('session:u16-histon'), v_club_id, v_team_u16, 'U16 Lions', 'Histon Rangers', v_today + 5, 'U16 Lions vs Histon Rangers', 'match', 'open', p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online')
  on conflict (id) do update
  set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    team = excluded.team,
    opponent = excluded.opponent,
    session_date = excluded.session_date,
    title = excluded.title,
    session_type = excluded.session_type,
    status = excluded.status
  where (
    assessment_sessions.club_id, assessment_sessions.team_id, assessment_sessions.team,
    assessment_sessions.opponent, assessment_sessions.session_date,
    assessment_sessions.title, assessment_sessions.session_type, assessment_sessions.status
  ) is distinct from (
    excluded.club_id, excluded.team_id, excluded.team, excluded.opponent,
    excluded.session_date, excluded.title, excluded.session_type, excluded.status
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('assessment_sessions', v_count);
  v_updated_counts := v_updated_counts || jsonb_build_object('assessment_sessions', v_changed - v_count);

  with expected_links as (
    select
      public.demo_reset_uuid('session-player:' || session.id::text || ':' || player.id::text) as id,
      session.id as session_id,
      player.id as player_id,
      player.player_name,
      player.section,
      player.team,
      player.parent_name,
      player.parent_email,
      player.parent_contacts,
      row_number() over (partition by session.id order by player.player_name) as team_order
    from public.assessment_sessions session
    join public.players player on player.team_id = session.team_id
    where session.club_id = v_club_id
      and session.id = any(array[
        public.demo_reset_uuid('session:u12-pressing'),
        public.demo_reset_uuid('session:u14-west-cambs'),
        public.demo_reset_uuid('session:u12-final-third'),
        public.demo_reset_uuid('session:u16-histon')
      ])
  )
  insert into public.assessment_session_players (
    id, session_id, player_id, player_name, section, team,
    parent_name, parent_email, parent_contacts, notes,
    created_by, created_by_name, created_by_email
  )
  select
    link.id,
    link.session_id,
    link.player_id,
    link.player_name,
    link.section,
    link.team,
    link.parent_name,
    link.parent_email,
    link.parent_contacts,
    'Demo session note.',
    p_actor_id,
    'Jordan Ellis',
    'demo@playerfeedback.online'
  from expected_links link
  where link.team_order <= 4
  on conflict (id) do update
  set
    session_id = excluded.session_id,
    player_id = excluded.player_id,
    player_name = excluded.player_name,
    section = excluded.section,
    team = excluded.team,
    parent_name = excluded.parent_name,
    parent_email = excluded.parent_email,
    parent_contacts = excluded.parent_contacts,
    notes = excluded.notes
  where (
    assessment_session_players.session_id, assessment_session_players.player_id,
    assessment_session_players.player_name, assessment_session_players.section,
    assessment_session_players.team, assessment_session_players.parent_name,
    assessment_session_players.parent_email, assessment_session_players.parent_contacts,
    assessment_session_players.notes
  ) is distinct from (
    excluded.session_id, excluded.player_id, excluded.player_name, excluded.section,
    excluded.team, excluded.parent_name, excluded.parent_email,
    excluded.parent_contacts, excluded.notes
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('assessment_session_players', v_changed);

  insert into public.parent_player_links (
    id, club_id, team_id, player_id, link_type, email, status,
    invited_by, invited_by_name, accepted_at
  ) values
    (public.demo_reset_uuid('parent-link:alex'), v_club_id, v_team_u12, public.demo_reset_uuid('player:alex-morgan'), 'parent', 'demo.parent.01@footballplayer.test', 'active', p_actor_id, 'Jordan Ellis', ((v_today - 6)::timestamp at time zone 'UTC')),
    (public.demo_reset_uuid('parent-link:maya'), v_club_id, v_team_u12, public.demo_reset_uuid('player:maya-singh'), 'parent', 'demo.parent.02@footballplayer.test', 'active', p_actor_id, 'Jordan Ellis', ((v_today - 6)::timestamp at time zone 'UTC')),
    (public.demo_reset_uuid('parent-link:noah'), v_club_id, v_team_u12, public.demo_reset_uuid('player:noah-turner'), 'parent', 'demo.parent.03@footballplayer.test', 'active', p_actor_id, 'Jordan Ellis', ((v_today - 6)::timestamp at time zone 'UTC')),
    (public.demo_reset_uuid('parent-link:leo'), v_club_id, v_team_u14, public.demo_reset_uuid('player:leo-hughes'), 'parent', 'demo.parent.05@footballplayer.test', 'active', p_actor_id, 'Jordan Ellis', ((v_today - 6)::timestamp at time zone 'UTC')),
    (public.demo_reset_uuid('parent-link:sofia'), v_club_id, v_team_u14, public.demo_reset_uuid('player:sofia-brooks'), 'parent', 'demo.parent.06@footballplayer.test', 'active', p_actor_id, 'Jordan Ellis', ((v_today - 6)::timestamp at time zone 'UTC')),
    (public.demo_reset_uuid('parent-link:grace'), v_club_id, v_team_u16, public.demo_reset_uuid('player:grace-wilson'), 'parent', 'demo.parent.08@footballplayer.test', 'active', p_actor_id, 'Jordan Ellis', ((v_today - 6)::timestamp at time zone 'UTC')),
    (public.demo_reset_uuid('parent-link:ben'), v_club_id, v_team_u16, public.demo_reset_uuid('player:ben-walker'), 'parent', 'demo.parent.09@footballplayer.test', 'active', p_actor_id, 'Jordan Ellis', ((v_today - 6)::timestamp at time zone 'UTC'))
  on conflict (id) do update
  set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    player_id = excluded.player_id,
    link_type = excluded.link_type,
    email = excluded.email,
    status = excluded.status,
    invited_by = excluded.invited_by,
    invited_by_name = excluded.invited_by_name,
    accepted_at = excluded.accepted_at,
    auth_user_id = null,
    guardian_id = null,
    invite_sent_at = null
  where (
    parent_player_links.club_id, parent_player_links.team_id,
    parent_player_links.player_id, parent_player_links.link_type,
    parent_player_links.email, parent_player_links.status,
    parent_player_links.invited_by, parent_player_links.invited_by_name,
    parent_player_links.accepted_at, parent_player_links.auth_user_id,
    parent_player_links.guardian_id, parent_player_links.invite_sent_at
  ) is distinct from (
    excluded.club_id, excluded.team_id, excluded.player_id, excluded.link_type,
    excluded.email, excluded.status, excluded.invited_by, excluded.invited_by_name,
    excluded.accepted_at, null::uuid, null::uuid, null::timestamptz
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('parent_links', v_changed);

  insert into public.player_staff_notes (
    id, club_id, player_id, user_id, user_name, user_email, note, created_at
  ) values
    (public.demo_reset_uuid('staff-note:alex'), v_club_id, public.demo_reset_uuid('player:alex-morgan'), p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online', 'Worked on curved pressing runs after training. Next focus is the recovery sprint after losing the ball.', ((v_today - 2)::timestamp at time zone 'UTC')),
    (public.demo_reset_uuid('staff-note:maya'), v_club_id, public.demo_reset_uuid('player:maya-singh'), p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online', 'Good leadership in the rondo group. Ask her to call the switch earlier next session.', ((v_today - 2)::timestamp at time zone 'UTC')),
    (public.demo_reset_uuid('staff-note:sofia'), v_club_id, public.demo_reset_uuid('player:sofia-brooks'), p_actor_id, 'Jordan Ellis', 'demo@playerfeedback.online', 'Strong tactical detail. Ready to help demonstrate the holding midfield role.', ((v_today - 2)::timestamp at time zone 'UTC'))
  on conflict (id) do update
  set
    club_id = excluded.club_id,
    player_id = excluded.player_id,
    user_id = excluded.user_id,
    user_name = excluded.user_name,
    user_email = excluded.user_email,
    note = excluded.note,
    created_at = excluded.created_at
  where (
    player_staff_notes.club_id, player_staff_notes.player_id,
    player_staff_notes.user_id, player_staff_notes.user_name,
    player_staff_notes.user_email, player_staff_notes.note,
    player_staff_notes.created_at
  ) is distinct from (
    excluded.club_id, excluded.player_id, excluded.user_id, excluded.user_name,
    excluded.user_email, excluded.note, excluded.created_at
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('staff_notes', v_changed);

  insert into public.polls (
    id, club_id, team_id, title, description, audience, poll_type,
    options, status, closes_at, allow_multiple, allow_own_child_votes,
    allow_vote_changes, hide_votes, allow_comments, created_by, created_by_name
  ) values
    (
      public.demo_reset_uuid('poll:availability'),
      v_club_id,
      v_team_u12,
      'Saturday match availability',
      'Can your player make the fixture against Histon Rangers?',
      'parents',
      'text',
      '[{"id":"available","label":"Available"},{"id":"maybe","label":"Maybe"},{"id":"unavailable","label":"Unavailable"}]'::jsonb,
      'open',
      ((v_today + 3)::timestamp at time zone 'UTC'),
      false,
      true,
      true,
      false,
      false,
      p_actor_id,
      'Jordan Ellis'
    ),
    (
      public.demo_reset_uuid('poll:awards'),
      v_club_id,
      v_team_u14,
      'Player of the match shortlist',
      'Vote from the coach shortlist after the West Cambs Colts match.',
      'parents',
      'awards',
      jsonb_build_array(
        jsonb_build_object('id', 'alex', 'label', 'Alex Morgan #12', 'playerId', public.demo_reset_uuid('player:alex-morgan')::text),
        jsonb_build_object('id', 'maya', 'label', 'Maya Singh #8', 'playerId', public.demo_reset_uuid('player:maya-singh')::text),
        jsonb_build_object('id', 'noah', 'label', 'Noah Turner #5', 'playerId', public.demo_reset_uuid('player:noah-turner')::text)
      ),
      'open',
      ((v_today + 7)::timestamp at time zone 'UTC'),
      false,
      false,
      false,
      false,
      false,
      p_actor_id,
      'Jordan Ellis'
    )
  on conflict (id) do update
  set
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    title = excluded.title,
    description = excluded.description,
    audience = excluded.audience,
    poll_type = excluded.poll_type,
    options = excluded.options,
    status = excluded.status,
    closes_at = excluded.closes_at,
    allow_multiple = excluded.allow_multiple,
    allow_own_child_votes = excluded.allow_own_child_votes,
    allow_vote_changes = excluded.allow_vote_changes,
    hide_votes = excluded.hide_votes,
    allow_comments = excluded.allow_comments,
    created_by = excluded.created_by,
    created_by_name = excluded.created_by_name
  where (
    polls.club_id, polls.team_id, polls.title, polls.description, polls.audience,
    polls.poll_type, polls.options, polls.status, polls.closes_at,
    polls.allow_multiple, polls.allow_own_child_votes, polls.allow_vote_changes,
    polls.hide_votes, polls.allow_comments, polls.created_by, polls.created_by_name
  ) is distinct from (
    excluded.club_id, excluded.team_id, excluded.title, excluded.description,
    excluded.audience, excluded.poll_type, excluded.options, excluded.status,
    excluded.closes_at, excluded.allow_multiple, excluded.allow_own_child_votes,
    excluded.allow_vote_changes, excluded.hide_votes, excluded.allow_comments,
    excluded.created_by, excluded.created_by_name
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('polls', v_changed);

  insert into public.poll_votes (
    id, poll_id, club_id, team_id, voter_email, voter_name,
    option_id, parent_link_id
  ) values
    (public.demo_reset_uuid('poll-vote:availability:alex'), public.demo_reset_uuid('poll:availability'), v_club_id, v_team_u12, 'demo.parent.01@footballplayer.test', 'demo.parent.01@footballplayer.test', 'available', public.demo_reset_uuid('parent-link:alex')),
    (public.demo_reset_uuid('poll-vote:availability:maya'), public.demo_reset_uuid('poll:availability'), v_club_id, v_team_u12, 'demo.parent.02@footballplayer.test', 'demo.parent.02@footballplayer.test', 'available', public.demo_reset_uuid('parent-link:maya')),
    (public.demo_reset_uuid('poll-vote:availability:noah'), public.demo_reset_uuid('poll:availability'), v_club_id, v_team_u12, 'demo.parent.03@footballplayer.test', 'demo.parent.03@footballplayer.test', 'maybe', public.demo_reset_uuid('parent-link:noah')),
    (public.demo_reset_uuid('poll-vote:availability:leo'), public.demo_reset_uuid('poll:availability'), v_club_id, v_team_u12, 'demo.parent.05@footballplayer.test', 'demo.parent.05@footballplayer.test', 'available', public.demo_reset_uuid('parent-link:leo')),
    (public.demo_reset_uuid('poll-vote:awards:alex'), public.demo_reset_uuid('poll:awards'), v_club_id, v_team_u14, 'demo.parent.01@footballplayer.test', 'demo.parent.01@footballplayer.test', 'maya', public.demo_reset_uuid('parent-link:alex')),
    (public.demo_reset_uuid('poll-vote:awards:maya'), public.demo_reset_uuid('poll:awards'), v_club_id, v_team_u14, 'demo.parent.02@footballplayer.test', 'demo.parent.02@footballplayer.test', 'alex', public.demo_reset_uuid('parent-link:maya')),
    (public.demo_reset_uuid('poll-vote:awards:noah'), public.demo_reset_uuid('poll:awards'), v_club_id, v_team_u14, 'demo.parent.03@footballplayer.test', 'demo.parent.03@footballplayer.test', 'alex', public.demo_reset_uuid('parent-link:noah'))
  on conflict (id) do update
  set
    poll_id = excluded.poll_id,
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    voter_email = excluded.voter_email,
    voter_name = excluded.voter_name,
    option_id = excluded.option_id,
    parent_link_id = excluded.parent_link_id,
    auth_user_id = null
  where (
    poll_votes.poll_id, poll_votes.club_id, poll_votes.team_id,
    poll_votes.voter_email, poll_votes.voter_name, poll_votes.option_id,
    poll_votes.parent_link_id, poll_votes.auth_user_id
  ) is distinct from (
    excluded.poll_id, excluded.club_id, excluded.team_id, excluded.voter_email,
    excluded.voter_name, excluded.option_id, excluded.parent_link_id, null::uuid
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('poll_votes', v_changed);

  if exists (
    select 1
    from public.match_locations location
    where location.club_id = v_club_id
      and location.name not in ('Cambourne Sports Pavilion', 'Histon Recreation Ground')
  ) then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_LOCATION_DRIFT';
  end if;

  select id
  into v_home_location
  from public.match_locations
  where club_id = v_club_id
    and name = 'Cambourne Sports Pavilion';

  if v_home_location is null then
    v_home_location := public.demo_reset_uuid('match-location:home');
    insert into public.match_locations (id, club_id, name, address, notes, created_by)
    values (v_home_location, v_club_id, 'Cambourne Sports Pavilion', 'Back Lane, Cambourne', 'Main grass pitch beside the pavilion.', p_actor_id);
    v_created_counts := v_created_counts || jsonb_build_object('home_match_location', 1);
  else
    update public.match_locations
    set
      address = 'Back Lane, Cambourne',
      notes = 'Main grass pitch beside the pavilion.'
    where id = v_home_location
      and (address, notes) is distinct from ('Back Lane, Cambourne', 'Main grass pitch beside the pavilion.');
  end if;

  select id
  into v_away_location
  from public.match_locations
  where club_id = v_club_id
    and name = 'Histon Recreation Ground';

  if v_away_location is null then
    v_away_location := public.demo_reset_uuid('match-location:away');
    insert into public.match_locations (id, club_id, name, address, notes, created_by)
    values (v_away_location, v_club_id, 'Histon Recreation Ground', 'New Road, Histon', 'Away fixture venue.', p_actor_id);
    v_created_counts := v_created_counts || jsonb_build_object('away_match_location', 1);
  else
    update public.match_locations
    set
      address = 'New Road, Histon',
      notes = 'Away fixture venue.'
    where id = v_away_location
      and (address, notes) is distinct from ('New Road, Histon', 'Away fixture venue.');
  end if;

  if exists (
    select 1
    from public.match_days match_day
    where match_day.club_id = v_club_id
      and match_day.opponent not in ('Fen Tigers', 'Histon Rangers')
  ) then
    raise exception using errcode = '55000', message = 'DEMO_SCOPE_MATCH_DAY_DRIFT';
  end if;

  select id
  into v_previous_match
  from public.match_days
  where club_id = v_club_id
    and opponent = 'Fen Tigers';

  if v_previous_match is null then
    v_previous_match := public.demo_reset_uuid('match-day:fen');
    insert into public.match_days (
      id, club_id, team_id, location_id, opponent, match_date, kickoff_time,
      home_away, venue_name, venue_address, notes, scorer_request_message,
      status, home_score, away_score, created_by, created_by_name
    ) values (
      v_previous_match, v_club_id, v_team_u12, v_home_location, 'Fen Tigers',
      v_today - 7, '10:30', 'home', 'Cambourne Sports Pavilion',
      'Back Lane, Cambourne', 'Pressed well after half time and kept the ball in wide areas.',
      'Can one parent update the live score from the touchline?', 'full_time',
      3, 1, p_actor_id, 'Jordan Ellis'
    );
    v_created_counts := v_created_counts || jsonb_build_object('previous_match_day', 1);
  else
    update public.match_days
    set
      team_id = v_team_u12,
      location_id = v_home_location,
      match_date = v_today - 7,
      kickoff_time = '10:30',
      home_away = 'home',
      venue_name = 'Cambourne Sports Pavilion',
      venue_address = 'Back Lane, Cambourne',
      notes = 'Pressed well after half time and kept the ball in wide areas.',
      scorer_request_message = 'Can one parent update the live score from the touchline?',
      status = 'full_time',
      home_score = 3,
      away_score = 1,
      motm_poll_id = null,
      previous_hidden_at = null,
      previous_hidden_by = null
    where id = v_previous_match
      and (
        team_id, location_id, match_date, kickoff_time, home_away,
        venue_name, venue_address, notes, scorer_request_message,
        status, home_score, away_score, motm_poll_id,
        previous_hidden_at, previous_hidden_by
      ) is distinct from (
        v_team_u12, v_home_location, v_today - 7, '10:30'::time, 'home',
        'Cambourne Sports Pavilion', 'Back Lane, Cambourne',
        'Pressed well after half time and kept the ball in wide areas.',
        'Can one parent update the live score from the touchline?',
        'full_time', 3, 1, null::uuid, null::timestamptz, null::uuid
      );
  end if;

  select id
  into v_next_match
  from public.match_days
  where club_id = v_club_id
    and opponent = 'Histon Rangers';

  if v_next_match is null then
    v_next_match := public.demo_reset_uuid('match-day:histon');
    insert into public.match_days (
      id, club_id, team_id, location_id, opponent, match_date, kickoff_time,
      home_away, venue_name, venue_address, notes, scorer_request_message,
      status, home_score, away_score, created_by, created_by_name
    ) values (
      v_next_match, v_club_id, v_team_u16, v_away_location, 'Histon Rangers',
      v_today + 5, '11:00', 'away', 'Histon Recreation Ground',
      'New Road, Histon', 'Confirm availability before naming the squad.',
      'Volunteer scorer needed for the first half.', 'scorer_request',
      0, 0, p_actor_id, 'Jordan Ellis'
    );
    v_created_counts := v_created_counts || jsonb_build_object('next_match_day', 1);
  else
    update public.match_days
    set
      team_id = v_team_u16,
      location_id = v_away_location,
      match_date = v_today + 5,
      kickoff_time = '11:00',
      home_away = 'away',
      venue_name = 'Histon Recreation Ground',
      venue_address = 'New Road, Histon',
      notes = 'Confirm availability before naming the squad.',
      scorer_request_message = 'Volunteer scorer needed for the first half.',
      status = 'scorer_request',
      home_score = 0,
      away_score = 0,
      motm_poll_id = null,
      previous_hidden_at = null,
      previous_hidden_by = null
    where id = v_next_match
      and (
        team_id, location_id, match_date, kickoff_time, home_away,
        venue_name, venue_address, notes, scorer_request_message,
        status, home_score, away_score, motm_poll_id,
        previous_hidden_at, previous_hidden_by
      ) is distinct from (
        v_team_u16, v_away_location, v_today + 5, '11:00'::time, 'away',
        'Histon Recreation Ground', 'New Road, Histon',
        'Confirm availability before naming the squad.',
        'Volunteer scorer needed for the first half.',
        'scorer_request', 0, 0, null::uuid, null::timestamptz, null::uuid
      );
  end if;

  insert into public.match_day_events (
    id, match_day_id, club_id, team_id, event_type, team_side, minute,
    scorer_name, scorer_initials, scorer_shirt_number,
    assist_name, assist_initials, assist_shirt_number,
    home_score, away_score, notes, created_by, created_by_name
  ) values
    (public.demo_reset_uuid('match-event:fen-18'), v_previous_match, v_club_id, v_team_u12, 'goal', 'club', 18, 'Alex Morgan', 'AM', '12', 'Maya Singh', 'MS', '8', 1, 0, 'Low finish after a quick regain.', p_actor_id, 'Jordan Ellis'),
    (public.demo_reset_uuid('match-event:fen-52'), v_previous_match, v_club_id, v_team_u12, 'goal', 'club', 52, 'Noah Turner', 'NT', '5', 'Alex Morgan', 'AM', '12', 3, 1, 'Header from a back post corner.', p_actor_id, 'Jordan Ellis')
  on conflict (id) do update
  set
    match_day_id = excluded.match_day_id,
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    event_type = excluded.event_type,
    team_side = excluded.team_side,
    minute = excluded.minute,
    scorer_name = excluded.scorer_name,
    scorer_initials = excluded.scorer_initials,
    scorer_shirt_number = excluded.scorer_shirt_number,
    assist_name = excluded.assist_name,
    assist_initials = excluded.assist_initials,
    assist_shirt_number = excluded.assist_shirt_number,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    notes = excluded.notes,
    created_by = excluded.created_by,
    created_by_name = excluded.created_by_name
  where (
    match_day_events.match_day_id, match_day_events.club_id,
    match_day_events.team_id, match_day_events.event_type,
    match_day_events.team_side, match_day_events.minute,
    match_day_events.scorer_name, match_day_events.scorer_initials,
    match_day_events.scorer_shirt_number, match_day_events.assist_name,
    match_day_events.assist_initials, match_day_events.assist_shirt_number,
    match_day_events.home_score, match_day_events.away_score,
    match_day_events.notes, match_day_events.created_by,
    match_day_events.created_by_name
  ) is distinct from (
    excluded.match_day_id, excluded.club_id, excluded.team_id,
    excluded.event_type, excluded.team_side, excluded.minute,
    excluded.scorer_name, excluded.scorer_initials,
    excluded.scorer_shirt_number, excluded.assist_name,
    excluded.assist_initials, excluded.assist_shirt_number,
    excluded.home_score, excluded.away_score, excluded.notes,
    excluded.created_by, excluded.created_by_name
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('match_day_events', v_changed);

  insert into public.match_day_scorer_interest (
    id, match_day_id, club_id, team_id, parent_link_id,
    parent_name, parent_email, message, status
  ) values (
    public.demo_reset_uuid('scorer-interest:histon'),
    v_next_match,
    v_club_id,
    v_team_u16,
    public.demo_reset_uuid('parent-link:grace'),
    'Touchline volunteer',
    'demo.parent.08@footballplayer.test',
    'Happy to update the score during the first half.',
    'interested'
  )
  on conflict (id) do update
  set
    match_day_id = excluded.match_day_id,
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    parent_link_id = excluded.parent_link_id,
    parent_name = excluded.parent_name,
    parent_email = excluded.parent_email,
    message = excluded.message,
    status = excluded.status,
    auth_user_id = null
  where (
    match_day_scorer_interest.match_day_id, match_day_scorer_interest.club_id,
    match_day_scorer_interest.team_id, match_day_scorer_interest.parent_link_id,
    match_day_scorer_interest.parent_name, match_day_scorer_interest.parent_email,
    match_day_scorer_interest.message, match_day_scorer_interest.status,
    match_day_scorer_interest.auth_user_id
  ) is distinct from (
    excluded.match_day_id, excluded.club_id, excluded.team_id,
    excluded.parent_link_id, excluded.parent_name, excluded.parent_email,
    excluded.message, excluded.status, null::uuid
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('scorer_interest', v_changed);

  insert into public.match_day_availability_requests (
    id, match_day_id, club_id, team_id, player_id, player_name,
    recipient_email, recipient_name, recipient_type, channel, token_hash,
    status, responded_at, expires_at, sent_at, created_by, created_by_name
  ) values
    (public.demo_reset_uuid('availability:grace'), v_next_match, v_club_id, v_team_u16, public.demo_reset_uuid('player:grace-wilson'), 'Grace Wilson', 'demo.parent.08@footballplayer.test', 'Jamie Wilson', 'parent', 'email', replace(v_next_match::text || '-' || public.demo_reset_uuid('player:grace-wilson')::text, '-', ''), 'available', ((v_today - 1)::timestamp at time zone 'UTC'), ((v_today + 10)::timestamp at time zone 'UTC'), ((v_today - 2)::timestamp at time zone 'UTC'), p_actor_id, 'Jordan Ellis'),
    (public.demo_reset_uuid('availability:ben'), v_next_match, v_club_id, v_team_u16, public.demo_reset_uuid('player:ben-walker'), 'Ben Walker', 'demo.parent.09@footballplayer.test', 'Nadia Walker', 'parent', 'email', replace(v_next_match::text || '-' || public.demo_reset_uuid('player:ben-walker')::text, '-', ''), 'maybe', ((v_today - 1)::timestamp at time zone 'UTC'), ((v_today + 10)::timestamp at time zone 'UTC'), ((v_today - 2)::timestamp at time zone 'UTC'), p_actor_id, 'Jordan Ellis'),
    (public.demo_reset_uuid('availability:ella'), v_next_match, v_club_id, v_team_u16, public.demo_reset_uuid('player:ella-price'), 'Ella Price', 'demo.parent.10@footballplayer.test', 'Owen Price', 'parent', 'email', replace(v_next_match::text || '-' || public.demo_reset_uuid('player:ella-price')::text, '-', ''), 'available', ((v_today - 1)::timestamp at time zone 'UTC'), ((v_today + 10)::timestamp at time zone 'UTC'), ((v_today - 2)::timestamp at time zone 'UTC'), p_actor_id, 'Jordan Ellis')
  on conflict (id) do update
  set
    match_day_id = excluded.match_day_id,
    club_id = excluded.club_id,
    team_id = excluded.team_id,
    player_id = excluded.player_id,
    player_name = excluded.player_name,
    recipient_email = excluded.recipient_email,
    recipient_name = excluded.recipient_name,
    recipient_type = excluded.recipient_type,
    channel = excluded.channel,
    token_hash = excluded.token_hash,
    status = excluded.status,
    responded_at = excluded.responded_at,
    expires_at = excluded.expires_at,
    sent_at = excluded.sent_at,
    created_by = excluded.created_by,
    created_by_name = excluded.created_by_name
  where (
    match_day_availability_requests.match_day_id,
    match_day_availability_requests.club_id,
    match_day_availability_requests.team_id,
    match_day_availability_requests.player_id,
    match_day_availability_requests.player_name,
    match_day_availability_requests.recipient_email,
    match_day_availability_requests.recipient_name,
    match_day_availability_requests.recipient_type,
    match_day_availability_requests.channel,
    match_day_availability_requests.token_hash,
    match_day_availability_requests.status,
    match_day_availability_requests.responded_at,
    match_day_availability_requests.expires_at,
    match_day_availability_requests.sent_at,
    match_day_availability_requests.created_by,
    match_day_availability_requests.created_by_name
  ) is distinct from (
    excluded.match_day_id, excluded.club_id, excluded.team_id,
    excluded.player_id, excluded.player_name, excluded.recipient_email,
    excluded.recipient_name, excluded.recipient_type, excluded.channel,
    excluded.token_hash, excluded.status, excluded.responded_at,
    excluded.expires_at, excluded.sent_at, excluded.created_by,
    excluded.created_by_name
  );
  get diagnostics v_changed = row_count;
  v_created_counts := v_created_counts || jsonb_build_object('availability_requests', v_changed);

  select jsonb_build_object(
    'clubs', (select count(*) from public.clubs where id = v_club_id),
    'application_users', (select count(*) from public.users where id = p_actor_id and club_id = v_club_id),
    'memberships', (select count(*) from public.user_club_memberships where auth_user_id = p_actor_id and club_id = v_club_id),
    'roles', (select count(*) from public.club_roles where club_id = v_club_id),
    'teams', (select count(*) from public.teams where club_id = v_club_id),
    'team_staff', (
      select count(*)
      from public.team_staff staff
      join public.teams team on team.id = staff.team_id
      where team.club_id = v_club_id
    ),
    'form_fields', (select count(*) from public.form_fields where club_id = v_club_id),
    'players', (select count(*) from public.players where club_id = v_club_id),
    'evaluations', (select count(*) from public.evaluations where club_id = v_club_id),
    'assessment_sessions', (select count(*) from public.assessment_sessions where club_id = v_club_id),
    'assessment_session_players', (
      select count(*)
      from public.assessment_session_players link
      join public.assessment_sessions session on session.id = link.session_id
      where session.club_id = v_club_id
    ),
    'parent_links', (select count(*) from public.parent_player_links where club_id = v_club_id),
    'staff_notes', (select count(*) from public.player_staff_notes where club_id = v_club_id),
    'polls', (select count(*) from public.polls where club_id = v_club_id),
    'poll_votes', (select count(*) from public.poll_votes where club_id = v_club_id),
    'match_locations', (select count(*) from public.match_locations where club_id = v_club_id),
    'match_days', (select count(*) from public.match_days where club_id = v_club_id),
    'match_day_events', (select count(*) from public.match_day_events where club_id = v_club_id),
    'scorer_interest', (select count(*) from public.match_day_scorer_interest where club_id = v_club_id),
    'availability_requests', (select count(*) from public.match_day_availability_requests where club_id = v_club_id),
    'calendar_events', (select count(*) from public.calendar_events where club_id = v_club_id)
  )
  into v_actual_counts;

  if v_actual_counts <> jsonb_build_object(
    'clubs', 1,
    'application_users', 1,
    'memberships', 1,
    'roles', 5,
    'teams', 3,
    'team_staff', 3,
    'form_fields', 8,
    'players', 10,
    'evaluations', 6,
    'assessment_sessions', 4,
    'assessment_session_players', 14,
    'parent_links', 7,
    'staff_notes', 3,
    'polls', 2,
    'poll_votes', 7,
    'match_locations', 2,
    'match_days', 2,
    'match_day_events', 2,
    'scorer_interest', 1,
    'availability_requests', 3,
    'calendar_events', 0
  ) then
    raise exception using errcode = '23514', message = 'DEMO_RESET_FINAL_STATE_MISMATCH';
  end if;

  v_communication_after := public.demo_reset_communication_fingerprint(v_club_id);

  if v_communication_after is distinct from v_communication_before then
    raise exception using errcode = '23514', message = 'DEMO_RESET_COMMUNICATION_SIDE_EFFECT';
  end if;

  v_final_fingerprint := public.demo_reset_state_fingerprint(v_club_id, p_actor_id);

  insert into public.demo_reset_operations (
    operation_id,
    demo_scope,
    actor_id,
    actor_category,
    finished_at,
    lock_result,
    initial_state_fingerprint,
    final_state_fingerprint,
    created_counts,
    updated_counts,
    removed_counts,
    outcome
  ) values (
    p_operation_id,
    'public-demo-v1',
    p_actor_id,
    'approved_demo_identity',
    timezone('utc', now()),
    'acquired',
    v_initial_fingerprint,
    v_final_fingerprint,
    v_created_counts,
    v_updated_counts,
    v_removed_counts,
    'completed'
  );

  return jsonb_build_object(
    'success', true,
    'cached', false,
    'lock_result', 'acquired',
    'operation_id', p_operation_id,
    'initial_state_fingerprint', v_initial_fingerprint,
    'final_state_fingerprint', v_final_fingerprint,
    'created_counts', v_created_counts,
    'updated_counts', v_updated_counts,
    'removed_counts', v_removed_counts,
    'expected_counts', v_actual_counts
  );
end;
$$;

revoke all on table public.demo_reset_operations from public;
revoke all on table public.demo_reset_operations from anon;
revoke all on table public.demo_reset_operations from authenticated;
grant select, insert on table public.demo_reset_operations to service_role;

revoke all on function public.prevent_demo_reset_operation_mutation() from public;
revoke all on function public.prevent_demo_reset_operation_mutation() from anon;
revoke all on function public.prevent_demo_reset_operation_mutation() from authenticated;

revoke all on function public.demo_reset_uuid(text) from public;
revoke all on function public.demo_reset_uuid(text) from anon;
revoke all on function public.demo_reset_uuid(text) from authenticated;

revoke all on function public.demo_reset_communication_fingerprint(uuid) from public;
revoke all on function public.demo_reset_communication_fingerprint(uuid) from anon;
revoke all on function public.demo_reset_communication_fingerprint(uuid) from authenticated;

revoke all on function public.demo_reset_state_fingerprint(uuid, uuid) from public;
revoke all on function public.demo_reset_state_fingerprint(uuid, uuid) from anon;
revoke all on function public.demo_reset_state_fingerprint(uuid, uuid) from authenticated;

revoke all on function public.reset_demo_account_atomic(uuid, uuid) from public;
revoke all on function public.reset_demo_account_atomic(uuid, uuid) from anon;
revoke all on function public.reset_demo_account_atomic(uuid, uuid) from authenticated;
grant execute on function public.reset_demo_account_atomic(uuid, uuid) to service_role;

comment on table public.demo_reset_operations is
  'Append-only, privacy-safe audit evidence for the approved public demo reset operation.';

comment on function public.reset_demo_account_atomic(uuid, uuid) is
  'Serialises and atomically reconciles only the approved public demo scope. Service role only.';
