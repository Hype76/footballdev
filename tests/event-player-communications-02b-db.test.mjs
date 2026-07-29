import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260729090000_event_player_communications_v1.sql', import.meta.url)
const migration = await readFile(migrationUrl, 'utf8')

const ids = {
  actor: '10000000-0000-4000-8000-000000000001',
  parent: '10000000-0000-4000-8000-000000000002',
  club: '20000000-0000-4000-8000-000000000001',
  team: '30000000-0000-4000-8000-000000000001',
  otherTeam: '30000000-0000-4000-8000-000000000002',
  event: '40000000-0000-4000-8000-000000000001',
  match: '50000000-0000-4000-8000-000000000001',
  session: '60000000-0000-4000-8000-000000000001',
  player1: '70000000-0000-4000-8000-000000000001',
  player2: '70000000-0000-4000-8000-000000000002',
  player3: '70000000-0000-4000-8000-000000000003',
  player4: '70000000-0000-4000-8000-000000000004',
  crossTeamPlayer: '70000000-0000-4000-8000-000000000005',
}

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;

    create table auth.users (id uuid primary key);
    create table public.clubs (id uuid primary key, name text);
    create table public.teams (id uuid primary key, club_id uuid, name text);
    create table public.users (
      id uuid primary key references auth.users(id),
      club_id uuid,
      email text,
      name text,
      display_name text,
      role text,
      role_label text,
      role_rank integer,
      status text
    );
    create table public.team_staff (team_id uuid, user_id uuid);
    create table public.players (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      player_name text,
      parent_name text,
      parent_email text,
      parent_contacts jsonb default '[]'::jsonb,
      contact_type text default 'parent',
      section text,
      status text
    );
    create table public.parent_player_links (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      player_id uuid,
      auth_user_id uuid,
      email text,
      status text,
      created_at timestamptz default now()
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      title text,
      event_type text,
      starts_at timestamptz,
      location text,
      cancelled_at timestamptz
    );
    create table public.match_days (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      opponent text,
      match_date date,
      kickoff_time time,
      kickoff_time_tbc boolean default false,
      venue_name text,
      status text,
      deleted_at timestamptz
    );
    create table public.assessment_sessions (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      title text,
      session_type text,
      session_date date,
      start_time time,
      location text,
      status text
    );
    create table public.scheduled_email_queue (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      created_by uuid,
      created_by_email text,
      to_email text,
      subject text,
      status text,
      scheduled_at timestamptz,
      payload jsonb
    );
    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid,
      assessment_session_id uuid,
      match_day_id uuid,
      player_id uuid not null,
      parent_link_id uuid,
      player_status_at_invite text,
      recipient_type text,
      parent_contact_name text,
      parent_contact_email text,
      player_contact_email text,
      recipient_contacts jsonb,
      invite_status text,
      notify_requested boolean,
      response_requirement text,
      cancelled_at timestamptz,
      responded_at timestamptz,
      created_by uuid,
      created_by_name text,
      created_by_email text,
      updated_by uuid,
      updated_by_name text,
      updated_by_email text,
      constraint calendar_event_invites_source_player_key
        unique nulls not distinct (club_id, player_id, calendar_event_id, assessment_session_id, match_day_id)
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
      created_at timestamptz default now(),
      updated_at timestamptz,
      constraint match_day_player_squad_decisions_match_player_key unique (match_day_id, player_id)
    );
    create table public.match_day_event_log (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      team_id uuid,
      match_day_id uuid,
      player_id uuid,
      actor_user_id uuid,
      actor_display_name text,
      actor_role text,
      event_type text,
      event_label text,
      previous_value jsonb,
      new_value jsonb,
      metadata jsonb
    );
    create table public.training_availability_request_players (
      id uuid primary key default gen_random_uuid(),
      calendar_event_id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      status text,
      updated_at timestamptz
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      actor_id uuid,
      action text,
      entity_type text,
      entity_id uuid,
      metadata jsonb
    );

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create function public.current_user_club_id()
    returns uuid
    language sql
    stable
    as $$
      select club_id from public.users where id = auth.uid()
    $$;

    create function public.current_user_role_rank()
    returns integer
    language sql
    stable
    as $$
      select coalesce(role_rank, 0) from public.users where id = auth.uid()
    $$;

    create function public.can_use_plan_feature(uuid, text)
    returns boolean
    language sql
    stable
    as $$ select true $$;

    create function public.calendar_event_notification_escape_html(value text)
    returns text
    language sql
    immutable
    as $$
      select replace(replace(replace(coalesce(value, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
    $$;
  `)

  await db.exec(migration)

  await db.exec(`
    insert into auth.users(id) values ('${ids.actor}'), ('${ids.parent}');
    insert into public.clubs(id, name) values ('${ids.club}', 'FP TEST');
    insert into public.teams(id, club_id, name) values
      ('${ids.team}', '${ids.club}', 'FP TEST Team'),
      ('${ids.otherTeam}', '${ids.club}', 'Other Team');
    insert into public.users(id, club_id, email, name, display_name, role, role_label, role_rank, status) values
      ('${ids.actor}', '${ids.club}', 'staff@example.test', 'Staff', 'Staff', 'admin', 'Club Admin', 100, 'active'),
      ('${ids.parent}', '${ids.club}', 'parent@example.test', 'Parent', 'Parent', 'parent_portal', 'Parent', 10, 'active');
    insert into public.players(id, club_id, team_id, player_name, parent_name, parent_email, parent_contacts, contact_type, section, status) values
      ('${ids.player1}', '${ids.club}', '${ids.team}', 'Player One', 'Parent One', 'one@example.test', '[]', 'parent', 'Squad', 'active'),
      ('${ids.player2}', '${ids.club}', '${ids.team}', 'Player Two', 'Player Two', 'two@example.test', '[{"name":"Player Two","email":"two@example.test","type":"self"}]', 'self', 'Squad', 'active'),
      ('${ids.player3}', '${ids.club}', '${ids.team}', 'Player Three', 'Parent Three', 'three@example.test', '[]', 'parent', 'Squad', 'active'),
      ('${ids.player4}', '${ids.club}', '${ids.team}', 'Player Four', '', '', '[]', 'parent', 'Squad', 'active'),
      ('${ids.crossTeamPlayer}', '${ids.club}', '${ids.otherTeam}', 'Wrong Team', 'Wrong Team Parent', 'wrong@example.test', '[]', 'parent', 'Squad', 'active');
    insert into public.parent_player_links(club_id, team_id, player_id, email, status) values
      ('${ids.club}', '${ids.team}', '${ids.player1}', 'one@example.test', 'active'),
      ('${ids.club}', '${ids.team}', '${ids.player3}', 'three@example.test', 'active');
    insert into public.calendar_events(id, club_id, team_id, title, event_type, starts_at, location) values
      ('${ids.event}', '${ids.club}', '${ids.team}', 'FP TEST Training', 'training', '2026-08-01T10:00:00Z', 'FP TEST Ground');
    insert into public.match_days(id, club_id, team_id, opponent, match_date, kickoff_time, status) values
      ('${ids.match}', '${ids.club}', '${ids.team}', 'FP TEST Opponent', '2026-08-02', '10:00', 'scheduled');
    insert into public.assessment_sessions(id, club_id, team_id, title, session_type, session_date, start_time, status) values
      ('${ids.session}', '${ids.club}', '${ids.team}', 'FP TEST Session', 'training', '2026-08-03', '10:00', 'scheduled');
    insert into public.calendar_event_invites(
      club_id, team_id, calendar_event_id, player_id, invite_status, notify_requested, response_requirement
    ) values (
      '${ids.club}', '${ids.team}', '${ids.event}', '${ids.player1}', 'active', false, 'informational'
    );
    select set_config('request.jwt.claim.sub', '${ids.actor}', false);
  `)

  return db
}

test('migration parses and add without notification is idempotent with zero queue rows', async () => {
  const db = await createDatabase()
  const preview = await db.query(`
    select public.preview_event_player_changes(
      'calendar',
      '${ids.event}',
      array['${ids.player1}'::uuid, '${ids.player2}'::uuid]
    ) as result
  `)

  assert.deepEqual(preview.rows[0].result.addedPlayerIds, [ids.player2])
  assert.deepEqual(preview.rows[0].result.unchangedPlayerIds, [ids.player1])
  assert.equal(preview.rows[0].result.addedRecipientCount, 1)

  const token = '80000000-0000-4000-8000-000000000001'
  const first = await db.query(`
    select public.apply_event_player_changes(
      'calendar',
      '${ids.event}',
      array['${ids.player1}'::uuid, '${ids.player2}'::uuid],
      'none',
      '${token}',
      false
    ) as result
  `)
  const retry = await db.query(`
    select public.apply_event_player_changes(
      'calendar',
      '${ids.event}',
      array['${ids.player1}'::uuid, '${ids.player2}'::uuid],
      'none',
      '${token}',
      false
    ) as result
  `)
  const counts = await db.query(`
    select
      (select count(*)::integer from public.event_player_change_commands) as commands,
      (select count(*)::integer from public.scheduled_email_queue) as queue_rows,
      (select count(*)::integer from public.calendar_event_invites where invite_status = 'active') as active_invites
  `)

  assert.equal(first.rows[0].result.queuedCount, 0)
  assert.equal(retry.rows[0].result.duplicate, true)
  assert.deepEqual(counts.rows[0], { commands: 1, queue_rows: 0, active_invites: 2 })
  await db.close()
})

test('delta notification queues only new valid contacts and keeps missing contacts non-blocking', async () => {
  const db = await createDatabase()
  const result = await db.query(`
    select public.apply_event_player_changes(
      'calendar',
      '${ids.event}',
      array['${ids.player1}'::uuid, '${ids.player3}'::uuid, '${ids.player4}'::uuid],
      'notify_added',
      '80000000-0000-4000-8000-000000000002',
      false
    ) as result
  `)
  const queue = await db.query(`
    select to_email, payload #>> '{communicationLog,metadata,notificationKind}' as notification_kind
    from public.scheduled_email_queue
    order by to_email
  `)

  assert.deepEqual(result.rows[0].result.addedPlayerIds, [ids.player3, ids.player4])
  assert.deepEqual(result.rows[0].result.unchangedPlayerIds, [ids.player1])
  assert.equal(result.rows[0].result.queuedCount, 1)
  assert.equal(result.rows[0].result.missingContactCount, 1)
  assert.deepEqual(queue.rows, [{ to_email: 'three@example.test', notification_kind: 'player_added' }])
  await db.close()
})

test('removal soft-cancels invite history and cross-team or parent commands fail closed', async () => {
  const db = await createDatabase()
  await db.query(`
    select public.apply_event_player_changes(
      'calendar',
      '${ids.event}',
      array[]::uuid[],
      'none',
      '80000000-0000-4000-8000-000000000003',
      false
    )
  `)
  const removed = await db.query(`
    select invite_status, cancelled_at is not null as has_cancelled_at
    from public.calendar_event_invites
    where player_id = '${ids.player1}'
  `)

  assert.deepEqual(removed.rows[0], { invite_status: 'cancelled', has_cancelled_at: true })

  await assert.rejects(
    db.query(`
      select public.preview_event_player_changes(
        'calendar',
        '${ids.event}',
        array['${ids.crossTeamPlayer}'::uuid]
      )
    `),
    /outside the event team/i,
  )

  await db.exec(`select set_config('request.jwt.claim.sub', '${ids.parent}', false)`)
  await assert.rejects(
    db.query(`
      select public.preview_event_player_changes(
        'calendar',
        '${ids.event}',
        array[]::uuid[]
      )
    `),
    /Coach or manager access is required/i,
  )
  await db.close()
})

test('selected match player removal requires confirmation and preserves a Not selected decision', async () => {
  const db = await createDatabase()
  await db.exec(`
    insert into public.calendar_event_invites(
      club_id, team_id, match_day_id, player_id, invite_status, notify_requested, response_requirement
    ) values (
      '${ids.club}', '${ids.team}', '${ids.match}', '${ids.player1}', 'active', true, 'response_required'
    );
    insert into public.match_day_player_squad_decisions(
      match_day_id, club_id, team_id, player_id, status
    ) values (
      '${ids.match}', '${ids.club}', '${ids.team}', '${ids.player1}', 'selected'
    );
  `)

  await assert.rejects(
    db.query(`
      select public.apply_event_player_changes(
        'match-day',
        '${ids.match}',
        array[]::uuid[],
        'none',
        '80000000-0000-4000-8000-000000000004',
        false
      )
    `),
    /Confirm that selected match players/i,
  )

  await db.query(`
    select public.apply_event_player_changes(
      'match-day',
      '${ids.match}',
      array[]::uuid[],
      'none',
      '80000000-0000-4000-8000-000000000005',
      true
    )
  `)
  const decision = await db.query(`
    select status
    from public.match_day_player_squad_decisions
    where match_day_id = '${ids.match}' and player_id = '${ids.player1}'
  `)
  const history = await db.query(`
    select count(*)::integer as count
    from public.match_day_event_log
    where match_day_id = '${ids.match}'
      and player_id = '${ids.player1}'
      and event_type = 'player_squad_decision_changed'
  `)

  assert.equal(decision.rows[0].status, 'not_selected')
  assert.equal(history.rows[0].count, 1)
  await db.close()
})
