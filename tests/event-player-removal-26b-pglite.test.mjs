import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260802205428_event_player_removal_26b.sql', import.meta.url),
  'utf8',
)
const trainingParticipationMigration = await readFile(
  new URL('../supabase/migrations/20260826162759_coach_training_event_removal_participation.sql', import.meta.url),
  'utf8',
)

const IDS = {
  club: '10000000-0000-4000-8000-000000000001',
  otherClub: '10000000-0000-4000-8000-000000000002',
  team: '20000000-0000-4000-8000-000000000001',
  otherTeam: '20000000-0000-4000-8000-000000000002',
  manager: '30000000-0000-4000-8000-000000000001',
  parent: '30000000-0000-4000-8000-000000000002',
  outsider: '30000000-0000-4000-8000-000000000003',
  player: '40000000-0000-4000-8000-000000000001',
  secondPlayer: '40000000-0000-4000-8000-000000000002',
  event: '50000000-0000-4000-8000-000000000001',
  otherEvent: '50000000-0000-4000-8000-000000000002',
  standaloneEvent: '50000000-0000-4000-8000-000000000003',
  match: '60000000-0000-4000-8000-000000000001',
  request: '70000000-0000-4000-8000-000000000001',
  requestFuture: '70000000-0000-4000-8000-000000000002',
  queueClaimed: '90000000-0000-4000-8000-000000000001',
  queueDelivered: '90000000-0000-4000-8000-000000000002',
}

async function setActor(db, actorId) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [actorId])
}

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;

    create table auth.users (id uuid primary key);

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.clubs (id uuid primary key);
    create table public.teams (id uuid primary key, club_id uuid not null references public.clubs(id));
    create table public.users (
      id uuid primary key,
      club_id uuid,
      email text,
      name text,
      display_name text,
      role text,
      role_rank integer,
      status text
    );
    create table public.team_staff (team_id uuid, user_id uuid);
    create table public.players (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      player_name text,
      status text
    );
    create table public.parent_player_links (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      player_id uuid,
      auth_user_id uuid,
      status text
    );
    create table public.adult_player_account_links (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      player_id uuid,
      user_id uuid,
      status text,
      revoked_at timestamptz
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      title text,
      event_type text,
      starts_at timestamptz,
      ends_at timestamptz,
      recurrence_frequency text,
      recurrence_until date,
      cancelled_at timestamptz
    );
    create table public.match_days (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      opponent text,
      match_date date,
      kickoff_time time,
      kickoff_time_tbc boolean,
      status text,
      deleted_at timestamptz
    );
    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      calendar_event_id uuid,
      match_day_id uuid,
      player_id uuid,
      invite_status text,
      notify_requested boolean,
      cancelled_at timestamptz,
      updated_by uuid,
      updated_by_name text,
      updated_by_email text,
      updated_at timestamptz
    );
    create table public.match_day_availability_requests (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      token_revoked_at timestamptz,
      token_revoked_reason text,
      token_revoked_by uuid,
      token_revoked_source text,
      updated_at timestamptz
    );
    create table public.training_availability_requests (
      id uuid primary key,
      calendar_event_id uuid,
      occurrence_date date
    );
    create table public.training_availability_request_players (
      id uuid primary key default gen_random_uuid(),
      request_id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      email_queue_id uuid,
      status text,
      token_revoked_at timestamptz,
      token_revoked_reason text,
      token_revoked_by uuid,
      token_revoked_source text,
      updated_at timestamptz
    );
    create type public.email_delivery_state_v1 as enum (
      'scheduled', 'queued', 'processing', 'provider_accepted', 'delivered',
      'deferred', 'bounced', 'complained', 'failed', 'retrying', 'cancelled', 'suppressed'
    );
    create table public.scheduled_email_queue (
      id uuid primary key default gen_random_uuid(),
      status text,
      delivery_state public.email_delivery_state_v1,
      provider_message_id text,
      provider_accepted_at timestamptz,
      retry_enabled boolean,
      next_retry_at timestamptz,
      lease_owner text,
      leased_at timestamptz,
      lease_expires_at timestamptz,
      terminal_at timestamptz,
      failure_category text,
      safe_error_code text,
      last_error text,
      updated_at timestamptz,
      payload jsonb
    );
    create table public.match_day_player_squad_decisions (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      status text,
      decided_by uuid,
      decided_by_name text,
      decided_at timestamptz,
      updated_at timestamptz,
      constraint match_day_player_squad_decisions_match_player_key unique (match_day_id, player_id)
    );
    create table public.calendar_trial_event_invitations (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      player_id uuid,
      calendar_event_id uuid,
      match_day_id uuid,
      email_queue_id uuid,
      status text,
      revoked_at timestamptz,
      revoked_reason text,
      updated_at timestamptz
    );
    create table public.event_player_change_commands (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      calendar_event_id uuid,
      match_day_id uuid
    );
    create table public.event_player_notification_events (
      id uuid primary key default gen_random_uuid(),
      command_id uuid,
      player_id uuid,
      email_queue_id uuid,
      status text,
      last_error text
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      actor_id uuid,
      action text,
      entity_type text,
      entity_id uuid,
      outcome text,
      metadata jsonb
    );

    create function public.current_user_club_id() returns uuid language sql stable as $$
      select club_id from public.users where id = auth.uid()
    $$;
    create function public.current_user_role_rank() returns integer language sql stable as $$
      select role_rank from public.users where id = auth.uid()
    $$;
    create function public.current_user_role() returns text language sql stable as $$
      select role from public.users where id = auth.uid()
    $$;
  `)

  await db.exec(migration)
  await db.exec(trainingParticipationMigration)
  await db.query(`insert into public.clubs (id) values ($1), ($2)`, [IDS.club, IDS.otherClub])
  await db.query(`insert into public.teams (id, club_id) values ($1, $2), ($3, $2)`, [IDS.team, IDS.club, IDS.otherTeam])
  await db.query(`
    insert into auth.users (id) values ($1), ($2), ($3)
  `, [IDS.manager, IDS.parent, IDS.outsider])
  await db.query(`
    insert into public.users (id, club_id, email, name, display_name, role, role_rank, status)
    values
      ($1, $4, 'manager@example.test', 'Manager', 'Manager', 'manager', 30, 'active'),
      ($2, $4, 'parent@example.test', 'Parent', 'Parent', 'parent_portal', 10, 'active'),
      ($3, $4, 'outsider@example.test', 'Outsider', 'Outsider', 'manager', 30, 'active')
  `, [IDS.manager, IDS.parent, IDS.outsider, IDS.club])
  await db.query(`insert into public.team_staff (team_id, user_id) values ($1, $2), ($3, $4)`, [IDS.team, IDS.manager, IDS.otherTeam, IDS.outsider])
  await db.query(`
    insert into public.players (id, club_id, team_id, player_name, status)
    values ($1, $3, $4, 'FP TEST Player', 'active'), ($2, $3, $4, 'FP TEST Second', 'active')
  `, [IDS.player, IDS.secondPlayer, IDS.club, IDS.team])
  await db.query(`
    insert into public.calendar_events
      (id, club_id, team_id, title, event_type, starts_at, ends_at, recurrence_frequency, recurrence_until)
    values
      ($1, $3, $4, 'FP TEST Training', 'training', '2099-01-05T18:00:00Z', '2099-01-05T19:00:00Z', 'weekly', '2099-01-26'),
      ($2, $3, $4, 'FP TEST Other Series', 'training', '2099-02-02T18:00:00Z', '2099-02-02T19:00:00Z', 'weekly', '2099-02-23')
  `, [IDS.event, IDS.otherEvent, IDS.club, IDS.team])
  await db.query(`
    insert into public.calendar_event_invites (club_id, team_id, calendar_event_id, player_id, invite_status, notify_requested)
    values ($1, $2, $3, $4, 'pending', true), ($1, $2, $5, $4, 'pending', true)
  `, [IDS.club, IDS.team, IDS.event, IDS.player, IDS.otherEvent])
  await db.query(`
    insert into public.training_availability_requests (id, calendar_event_id, occurrence_date)
    values ($1, $3, '2099-01-12'), ($2, $3, '2099-01-19')
  `, [IDS.request, IDS.requestFuture, IDS.event])

  return db
}

test('Training occurrence removal accepts an active availability recipient without a Calendar invite row', async () => {
  const db = await createDatabase()

  try {
    await setActor(db, IDS.manager)
    await db.query(`
      insert into public.training_availability_request_players
        (request_id, club_id, team_id, player_id, status)
      values ($1, $2, $3, $4, 'failed')
    `, [IDS.request, IDS.club, IDS.team, IDS.secondPlayer])

    const preview = await db.query(
      `select public.preview_event_player_removal('calendar', $1, $2, '2099-01-12', 'occurrence') as result`,
      [IDS.event, IDS.secondPlayer],
    )
    assert.equal(preview.rows[0].result.alreadyRemoved, false)
    assert.equal(preview.rows[0].result.affectedOccurrenceCount, 1)
    assert.equal(preview.rows[0].result.revokedTokenCount, 1)

    const token = '80000000-0000-4000-8000-000000000112'
    const removal = await db.query(
      `select public.remove_player_from_event('calendar', $1, $2, '2099-01-12', 'occurrence', $3, false) as result`,
      [IDS.event, IDS.secondPlayer, token],
    )
    assert.equal(removal.rows[0].result.status, 'completed')
    assert.equal(removal.rows[0].result.communicationSent, false)

    const state = await db.query(`
      select
        (select count(*) from public.calendar_event_invites where calendar_event_id = $1 and player_id = $2) as calendar_invite_count,
        (select count(*) from public.event_player_occurrence_exclusions where calendar_event_id = $1 and player_id = $2 and effective_from_date = '2099-01-12') as exclusion_count,
        (select count(*) from public.event_player_removal_commands where calendar_event_id = $1 and player_id = $2) as command_count,
        (select status from public.training_availability_request_players where request_id = $3 and player_id = $2) as recipient_status,
        (select token_revoked_at is not null from public.training_availability_request_players where request_id = $3 and player_id = $2) as recipient_revoked,
        (select count(*) from public.players where id = $2 and team_id = $4) as preserved_player_count
    `, [IDS.event, IDS.secondPlayer, IDS.request, IDS.team])
    assert.deepEqual(state.rows[0], {
      calendar_invite_count: 0,
      exclusion_count: 1,
      command_count: 1,
      recipient_status: 'cancelled',
      recipient_revoked: true,
      preserved_player_count: 1,
    })
  } finally {
    await db.close()
  }
})

test('occurrence removal is staff-only, idempotent, scoped, and preserves the Team and history', async () => {
  const db = await createDatabase()

  try {
    await setActor(db, IDS.manager)
    await db.query(`
      insert into public.scheduled_email_queue
        (id, status, delivery_state, provider_message_id, provider_accepted_at, retry_enabled, lease_owner, leased_at, lease_expires_at, payload)
      values
        ($1, 'sending', 'processing', null, null, true, 'worker-1', now(), now() + interval '1 minute', '{}'::jsonb),
        ($2, 'sending', 'delivered', 'provider-accepted-1', now(), false, null, null, null, '{}'::jsonb)
    `, [IDS.queueClaimed, IDS.queueDelivered])
    await db.query(`
      insert into public.training_availability_request_players
        (request_id, club_id, team_id, player_id, email_queue_id, status)
      values
        ($1, $2, $3, $4, $5, 'queued'),
        ($1, $2, $3, $4, $6, 'sent')
    `, [IDS.request, IDS.club, IDS.team, IDS.player, IDS.queueClaimed, IDS.queueDelivered])
    const preview = await db.query(`select public.preview_event_player_removal('calendar', $1, $2, '2099-01-12', 'occurrence') as result`, [IDS.event, IDS.player])
    assert.equal(preview.rows[0].result.affectedOccurrenceCount, 1)
    assert.equal(preview.rows[0].result.suppressedInvitationCount, 1)
    assert.equal(preview.rows[0].result.revokedTokenCount, 2)
    assert.equal(preview.rows[0].result.teamMembershipUnchanged, true)

    const token = '80000000-0000-4000-8000-000000000001'
    const first = await db.query(`select public.remove_player_from_event('calendar', $1, $2, '2099-01-12', 'occurrence', $3, false) as result`, [IDS.event, IDS.player, token])
    const repeat = await db.query(`select public.remove_player_from_event('calendar', $1, $2, '2099-01-12', 'occurrence', $3, false) as result`, [IDS.event, IDS.player, token])
    assert.equal(first.rows[0].result.communicationSent, false)
    assert.equal(first.rows[0].result.suppressedInvitationCount, 1)
    assert.equal(first.rows[0].result.revokedTokenCount, 2)
    assert.equal(repeat.rows[0].result.duplicate, true)

    const state = await db.query(`
      select
        (select count(*) from public.event_player_occurrence_exclusions where calendar_event_id = $1 and player_id = $2) as exclusion_count,
        (select count(*) from public.event_player_removal_commands where calendar_event_id = $1 and player_id = $2) as command_count,
        (select count(*) from public.players where id = $2) as player_count,
        (select count(*) from public.team_staff where team_id = $3 and user_id = $4) as staff_count,
        (select count(*) from public.calendar_event_invites where calendar_event_id = $5 and player_id = $2 and invite_status <> 'cancelled') as other_series_count
    `, [IDS.event, IDS.player, IDS.team, IDS.manager, IDS.otherEvent])
    assert.deepEqual(state.rows[0], {
      exclusion_count: 1,
      command_count: 1,
      player_count: 1,
      staff_count: 1,
      other_series_count: 1,
    })

    const queueState = await db.query(`
      select id, delivery_state, provider_message_id, lease_owner
      from public.scheduled_email_queue
      where id in ($1, $2)
      order by id
    `, [IDS.queueClaimed, IDS.queueDelivered])
    assert.deepEqual(queueState.rows, [
      { id: IDS.queueClaimed, delivery_state: 'cancelled', provider_message_id: null, lease_owner: null },
      { id: IDS.queueDelivered, delivery_state: 'delivered', provider_message_id: 'provider-accepted-1', lease_owner: null },
    ])

    const recipientState = await db.query(`
      select status, token_revoked_at is not null as revoked
      from public.training_availability_request_players
      where request_id = $1
      order by status
    `, [IDS.request])
    assert.deepEqual(recipientState.rows, [
      { status: 'cancelled', revoked: true },
      { status: 'sent', revoked: true },
    ])

    const selected = await db.query(`select public.is_calendar_event_player_excluded_internal($1, $2, '2099-01-12') as excluded`, [IDS.event, IDS.player])
    const later = await db.query(`select public.is_calendar_event_player_excluded_internal($1, $2, '2099-01-19') as excluded`, [IDS.event, IDS.player])
    assert.equal(selected.rows[0].excluded, true)
    assert.equal(later.rows[0].excluded, false)

    await setActor(db, IDS.parent)
    await assert.rejects(
      db.query(`select public.preview_event_player_removal('calendar', $1, $2, '2099-01-19', 'occurrence')`, [IDS.event, IDS.player]),
      /Coach or manager access is required/,
    )

    await setActor(db, IDS.outsider)
    await assert.rejects(
      db.query(`select public.preview_event_player_removal('calendar', $1, $2, '2099-01-19', 'occurrence')`, [IDS.event, IDS.player]),
      /permission to remove Players from this event team/,
    )
  } finally {
    await db.close()
  }
})

test('this-and-future removal preserves earlier occurrences and completed events fail closed', async () => {
  const db = await createDatabase()

  try {
    await setActor(db, IDS.manager)
    const token = '80000000-0000-4000-8000-000000000002'
    const result = await db.query(`select public.remove_player_from_event('calendar', $1, $2, '2099-01-12', 'this_and_future', $3, false) as result`, [IDS.event, IDS.player, token])
    assert.equal(result.rows[0].result.affectedOccurrenceCount, 3)

    const earlier = await db.query(`select public.is_calendar_event_player_excluded_internal($1, $2, '2099-01-05') as excluded`, [IDS.event, IDS.player])
    const selected = await db.query(`select public.is_calendar_event_player_excluded_internal($1, $2, '2099-01-12') as excluded`, [IDS.event, IDS.player])
    const future = await db.query(`select public.is_calendar_event_player_excluded_internal($1, $2, '2099-01-26') as excluded`, [IDS.event, IDS.player])
    assert.equal(earlier.rows[0].excluded, false)
    assert.equal(selected.rows[0].excluded, true)
    assert.equal(future.rows[0].excluded, true)

    await db.query(`
      insert into public.match_days (id, club_id, team_id, opponent, match_date, kickoff_time, kickoff_time_tbc, status)
      values ($1, $2, $3, 'Past Opponent', '2020-01-01', '10:00', false, 'scheduled')
    `, [IDS.match, IDS.club, IDS.team])
    await db.query(`
      insert into public.calendar_event_invites (club_id, team_id, match_day_id, player_id, invite_status, notify_requested)
      values ($1, $2, $3, $4, 'pending', true)
    `, [IDS.club, IDS.team, IDS.match, IDS.player])
    await assert.rejects(
      db.query(`select public.preview_event_player_removal('match-day', $1, $2, null, 'event')`, [IDS.match, IDS.player]),
      /Completed event participation cannot be removed from history/,
    )
  } finally {
    await db.close()
  }
})

test('standalone informational removal suppresses unsent generic communication without deleting the Player', async () => {
  const db = await createDatabase()

  try {
    await setActor(db, IDS.manager)
    await db.query(`
      insert into public.calendar_events
        (id, club_id, team_id, title, event_type, starts_at, ends_at, recurrence_frequency, recurrence_until)
      values ($1, $2, $3, 'FP TEST Information', 'general', '2099-03-01T18:00:00Z', '2099-03-01T19:00:00Z', 'none', null)
    `, [IDS.standaloneEvent, IDS.club, IDS.team])
    await db.query(`
      insert into public.calendar_event_invites (club_id, team_id, calendar_event_id, player_id, invite_status, notify_requested)
      values ($1, $2, $3, $4, 'pending', true)
    `, [IDS.club, IDS.team, IDS.standaloneEvent, IDS.player])
    const queueId = '90000000-0000-4000-8000-000000000003'
    const commandId = '91000000-0000-4000-8000-000000000001'
    await db.query(`
      insert into public.scheduled_email_queue
        (id, status, delivery_state, retry_enabled, lease_owner, leased_at, lease_expires_at, payload)
      values ($1, 'sending', 'processing', true, 'worker-2', now(), now() + interval '1 minute', '{}'::jsonb)
    `, [queueId])
    await db.query(`
      insert into public.event_player_change_commands (id, club_id, team_id, calendar_event_id)
      values ($1, $2, $3, $4)
    `, [commandId, IDS.club, IDS.team, IDS.standaloneEvent])
    await db.query(`
      insert into public.event_player_notification_events (command_id, player_id, email_queue_id, status)
      values ($1, $2, $3, 'queued')
    `, [commandId, IDS.player, queueId])

    const token = '80000000-0000-4000-8000-000000000003'
    const removal = await db.query(`select public.remove_player_from_event('calendar', $1, $2, null, 'event', $3, false) as result`, [IDS.standaloneEvent, IDS.player, token])
    assert.equal(removal.rows[0].result.suppressedInvitationCount, 1)
    assert.equal(removal.rows[0].result.playerRecordPreserved, true)

    const state = await db.query(`
      select
        (select invite_status from public.calendar_event_invites where calendar_event_id = $1 and player_id = $2) as invite_status,
        (select status from public.event_player_notification_events where command_id = $3) as notification_status,
        (select delivery_state from public.scheduled_email_queue where id = $4) as queue_state,
        (select count(*) from public.players where id = $2) as player_count
    `, [IDS.standaloneEvent, IDS.player, commandId, queueId])
    assert.deepEqual(state.rows[0], {
      invite_status: 'cancelled',
      notification_status: 'failed',
      queue_state: 'cancelled',
      player_count: 1,
    })
  } finally {
    await db.close()
  }
})

test('an in-progress event requires explicit confirmation and keeps recorded history intact', async () => {
  const db = await createDatabase()

  try {
    await setActor(db, IDS.manager)
    await db.query(`
      insert into public.calendar_events
        (id, club_id, team_id, title, event_type, starts_at, ends_at, recurrence_frequency)
      values ($1, $2, $3, 'FP TEST In Progress', 'training', now() - interval '30 minutes', now() + interval '30 minutes', 'none')
    `, [IDS.standaloneEvent, IDS.club, IDS.team])
    await db.query(`
      insert into public.calendar_event_invites (club_id, team_id, calendar_event_id, player_id, invite_status, notify_requested)
      values ($1, $2, $3, $4, 'pending', false)
    `, [IDS.club, IDS.team, IDS.standaloneEvent, IDS.player])
    const token = '80000000-0000-4000-8000-000000000004'
    const preview = await db.query(`select public.preview_event_player_removal('calendar', $1, $2, null, 'event') as result`, [IDS.standaloneEvent, IDS.player])
    assert.equal(preview.rows[0].result.requiresInProgressConfirmation, true)

    await assert.rejects(
      db.query(`select public.remove_player_from_event('calendar', $1, $2, null, 'event', $3, false)`, [IDS.standaloneEvent, IDS.player, token]),
      /Confirm removal from the event currently in progress/,
    )
    const deniedState = await db.query(`select count(*) as count from public.event_player_removal_commands where request_token = $1`, [token])
    assert.equal(deniedState.rows[0].count, 0)

    const confirmed = await db.query(`select public.remove_player_from_event('calendar', $1, $2, null, 'event', $3, true) as result`, [IDS.standaloneEvent, IDS.player, token])
    assert.equal(confirmed.rows[0].result.historyPreserved, true)
  } finally {
    await db.close()
  }
})
