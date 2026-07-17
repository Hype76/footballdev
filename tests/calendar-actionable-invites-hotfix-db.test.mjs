import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pgliteModule = await import('@electric-sql/pglite').catch(async (error) => {
  if (!process.env.PGLITE_MODULE_URL) {
    throw error
  }
  return import(process.env.PGLITE_MODULE_URL)
})
const { PGlite } = pgliteModule

const migration = await readFile(new URL('../supabase/migrations/20260717081923_calendar_actionable_invites_hotfix.sql', import.meta.url), 'utf8')

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const CLUB_ID = '20000000-0000-4000-8000-000000000001'
const TEAM_ID = '30000000-0000-4000-8000-000000000001'
const OTHER_TEAM_ID = '30000000-0000-4000-8000-000000000002'
const MATCH_ID = '40000000-0000-4000-8000-000000000001'
const OTHER_MATCH_ID = '40000000-0000-4000-8000-000000000002'
const COMMAND_ID = '50000000-0000-4000-8000-000000000001'
const PLAYER_ONE = '60000000-0000-4000-8000-000000000001'
const PLAYER_TWO = '60000000-0000-4000-8000-000000000002'
const PLAYER_THREE = '60000000-0000-4000-8000-000000000003'

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select '${ACTOR_ID}'::uuid $$;

    create table public.users (
      id uuid primary key, club_id uuid, role text, status text, role_rank integer,
      display_name text, name text, email text
    );
    create table public.clubs (id uuid primary key, name text);
    create table public.teams (id uuid primary key, club_id uuid, name text);
    create table public.team_staff (team_id uuid, user_id uuid);
    create table public.players (
      id uuid primary key, club_id uuid, team_id uuid, player_name text,
      status text, section text
    );
    create table public.parent_player_links (
      id uuid primary key, club_id uuid, team_id uuid, player_id uuid,
      auth_user_id uuid, email text, status text, created_at timestamptz default now()
    );
    create table public.match_days (
      id uuid primary key, club_id uuid, team_id uuid, opponent text,
      match_date date, kickoff_time time, kickoff_time_tbc boolean default false,
      arrival_time time, venue_name text, status text,
      request_scorer boolean default false, request_linesman boolean default false,
      request_referee boolean default false
    );
    create table public.calendar_event_notification_commands (
      id uuid primary key, club_id uuid, team_id uuid, calendar_event_id uuid,
      match_day_id uuid, event_revision bigint, notification_type text,
      request_token uuid, player_ids uuid[], requested_by uuid,
      result jsonb, created_at timestamptz default now(), completed_at timestamptz
    );
    create unique index command_request_key on public.calendar_event_notification_commands (
      requested_by, coalesce(calendar_event_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(match_day_id, '00000000-0000-0000-0000-000000000000'::uuid), request_token
    );
    create table public.match_day_availability_requests (
      id uuid primary key default gen_random_uuid(), match_day_id uuid, club_id uuid,
      team_id uuid, player_id uuid, player_name text default '', recipient_email text,
      recipient_name text default '', recipient_type text default 'parent', parent_link_id uuid,
      channel text default 'email', token_hash text, status text default 'pending',
      responded_at timestamptz, expires_at timestamptz default now() + interval '21 days',
      sent_at timestamptz, created_by uuid, created_by_name text default '',
      volunteer_scorer_response text default 'no_response',
      volunteer_linesman_response text default 'no_response',
      volunteer_referee_response text default 'no_response',
      volunteer_responded_at timestamptz, created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    create unique index match_day_availability_request_unique_recipient
      on public.match_day_availability_requests (match_day_id, player_id, recipient_email, recipient_type, channel);
    create unique index match_day_availability_token_hash_key
      on public.match_day_availability_requests (token_hash);
    create table public.match_day_role_assignments (
      id uuid primary key default gen_random_uuid(), match_day_id uuid, club_id uuid,
      team_id uuid, role text, parent_link_id uuid
    );
    create table public.calendar_event_notification_events (
      id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid,
      notification_command_id uuid, email_queue_id uuid, parent_link_id uuid,
      player_id uuid, event_action_type text default 'informational',
      response_requirement text default 'informational', status text default 'queued',
      last_error text, updated_at timestamptz default now()
    );
    create table public.scheduled_email_queue (
      id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid,
      subject text, status text, payload jsonb default '{}'::jsonb
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(), club_id uuid, actor_id uuid,
      action text, entity_type text, entity_id uuid, metadata jsonb
    );
    create table public.match_day_event_log (
      id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid,
      match_day_id uuid, actor_user_id uuid, actor_display_name text, actor_role text,
      event_type text, event_label text, new_value jsonb, metadata jsonb
    );
    create function public.calendar_event_notification_escape_html(text) returns text
      language sql immutable as $$ select coalesce($1, '') $$;
    create function public.notify_calendar_event_parents_authoritative_scope_internal(uuid, text, uuid, uuid, uuid[])
    returns jsonb language plpgsql security definer set search_path = '' as $$
    declare existing_command public.calendar_event_notification_commands%rowtype;
    begin
      if $3 is null then
        return jsonb_build_object('eventId', $1, 'eventSource', 'calendar', 'eventActionType', 'informational', 'responseRequirement', 'informational');
      end if;
      select * into existing_command from public.calendar_event_notification_commands
      where match_day_id = $3 and requested_by = auth.uid() and request_token = $4;
      if existing_command.id is not null then
        return existing_command.result || jsonb_build_object('duplicateCount', 1);
      end if;
      insert into public.calendar_event_notification_commands (
        id, club_id, team_id, match_day_id, event_revision, notification_type,
        request_token, player_ids, requested_by, result
      ) values (
        '${COMMAND_ID}', '${CLUB_ID}', '${TEAM_ID}', $3, 1, $2, $4,
        array['${PLAYER_ONE}'::uuid, '${PLAYER_TWO}'::uuid], auth.uid(),
        jsonb_build_object('notificationCommandId', '${COMMAND_ID}', 'eventSource', 'match-day',
          'portalRecordCount', 2, 'eligibleRecipientCount', 2, 'queuedCount', 0,
          'failedCount', 0, 'duplicateCount', 0)
      ) returning * into existing_command;
      return existing_command.result;
    end $$;
  `)
  await db.exec(migration)
  await db.exec(`
    insert into public.users values
      ('${ACTOR_ID}', '${CLUB_ID}', 'coach', 'active', 20, 'Coach', 'Coach', 'coach@example.test'),
      ('90000000-0000-4000-8000-000000000001', '${CLUB_ID}', 'parent_portal', 'active', 10, 'Parent One', 'Parent One', 'one@example.test'),
      ('90000000-0000-4000-8000-000000000002', '${CLUB_ID}', 'parent_portal', 'active', 10, 'Parent Two', 'Parent Two', 'two@example.test'),
      ('90000000-0000-4000-8000-000000000003', '${CLUB_ID}', 'parent_portal', 'active', 10, 'Parent Three', 'Parent Three', 'three@example.test');
    insert into public.clubs values ('${CLUB_ID}', 'Test Club');
    insert into public.teams values
      ('${TEAM_ID}', '${CLUB_ID}', 'Test Team'),
      ('${OTHER_TEAM_ID}', '${CLUB_ID}', 'Other Team');
    insert into public.team_staff values ('${TEAM_ID}', '${ACTOR_ID}');
    insert into public.players values
      ('${PLAYER_ONE}', '${CLUB_ID}', '${TEAM_ID}', 'Player One', 'active', 'Squad'),
      ('${PLAYER_TWO}', '${CLUB_ID}', '${TEAM_ID}', 'Player Two', 'active', 'Squad'),
      ('${PLAYER_THREE}', '${CLUB_ID}', '${TEAM_ID}', 'Player Three', 'active', 'Squad');
    insert into public.parent_player_links values
      ('70000000-0000-4000-8000-000000000001', '${CLUB_ID}', '${TEAM_ID}', '${PLAYER_ONE}', '90000000-0000-4000-8000-000000000001', 'one@example.test', 'active', now()),
      ('70000000-0000-4000-8000-000000000002', '${CLUB_ID}', '${TEAM_ID}', '${PLAYER_TWO}', '90000000-0000-4000-8000-000000000002', 'two@example.test', 'active', now()),
      ('70000000-0000-4000-8000-000000000003', '${CLUB_ID}', '${TEAM_ID}', '${PLAYER_THREE}', '90000000-0000-4000-8000-000000000003', 'three@example.test', 'active', now());
    insert into public.match_days values
      ('${MATCH_ID}', '${CLUB_ID}', '${TEAM_ID}', 'Opposition', current_date + 7, '11:00', false, '10:15', 'Test Ground', 'scheduled', true, true, false),
      ('${OTHER_MATCH_ID}', '${CLUB_ID}', '${OTHER_TEAM_ID}', 'Other', current_date + 7, '11:00', false, '10:15', 'Other Ground', 'scheduled', false, false, false);
    insert into public.match_day_availability_requests (
      match_day_id, club_id, team_id, player_id, player_name, recipient_email,
      recipient_name, parent_link_id, token_hash, status,
      volunteer_scorer_response, volunteer_linesman_response
    ) values
      ('${MATCH_ID}', '${CLUB_ID}', '${TEAM_ID}', '${PLAYER_TWO}', 'Player Two', 'two@example.test', 'Parent Two', '70000000-0000-4000-8000-000000000002', repeat('a', 64), 'available', 'yes', 'no'),
      ('${MATCH_ID}', '${CLUB_ID}', '${TEAM_ID}', '${PLAYER_THREE}', 'Player Three', 'three@example.test', 'Parent Three', '70000000-0000-4000-8000-000000000003', repeat('b', 64), 'pending', 'no_response', 'no_response');
    insert into public.match_day_role_assignments (match_day_id, club_id, team_id, role, parent_link_id)
      values ('${MATCH_ID}', '${CLUB_ID}', '${TEAM_ID}', 'scorer', '70000000-0000-4000-8000-000000000002');
  `)
  return db
}

test('database reconciliation creates missing requests and preserves answered and volunteer state', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`
      insert into public.calendar_event_notification_commands (
        id, club_id, team_id, match_day_id, event_revision, notification_type,
        request_token, player_ids, requested_by, result
      ) values (
        '${COMMAND_ID}', '${CLUB_ID}', '${TEAM_ID}', '${MATCH_ID}', 1, 'update',
        '80000000-0000-4000-8000-000000000001',
        array['${PLAYER_ONE}'::uuid, '${PLAYER_TWO}'::uuid], '${ACTOR_ID}',
        jsonb_build_object('notificationCommandId', '${COMMAND_ID}', 'eligibleRecipientCount', 2)
      )
    `)
    const result = await db.query(`select public.reconcile_match_day_calendar_actions_internal('${COMMAND_ID}') as result`)
    const value = result.rows[0].result

    assert.equal(value.actionReconciliationState, 'ready')
    assert.equal(value.authoritativePlayerCount, 2)
    assert.equal(value.playerRequestCreatedCount, 1)
    assert.equal(value.playerRequestPreservedCount, 1)
    assert.equal(value.playerRequestClosedCount, 1)
    assert.equal(value.volunteerConfiguredRoleCount, 2)
    assert.equal(value.volunteerOpenRoleCount, 1)
    assert.equal(value.acceptedVolunteerAssignmentCount, 1)

    const rows = await db.query(`
      select player_id, status, volunteer_scorer_response, volunteer_linesman_response
      from public.match_day_availability_requests order by player_id
    `)
    assert.deepEqual(rows.rows.map((row) => row.status), ['pending', 'available', 'expired'])
    assert.equal(rows.rows[1].volunteer_scorer_response, 'yes')
    assert.equal(rows.rows[1].volunteer_linesman_response, 'no')

    const second = await db.query(`select public.reconcile_match_day_calendar_actions_internal('${COMMAND_ID}') as result`)
    assert.deepEqual(second.rows[0].result, value)
    const evidence = await db.query(`select (select count(*) from public.audit_logs) as audits, (select count(*) from public.match_day_event_log) as events`)
    assert.equal(Number(evidence.rows[0].audits), 1)
    assert.equal(Number(evidence.rows[0].events), 1)
  } finally {
    await db.close()
  }
})

test('public wrapper leaves generic Calendar notifications informational and rejects browser scope', async () => {
  const db = await createDatabase()
  try {
    const generic = await db.query(`
      select public.notify_calendar_event_parents(
        'a0000000-0000-4000-8000-000000000001', 'update', null,
        'b0000000-0000-4000-8000-000000000001', '{}'::uuid[]
      ) as result
    `)
    assert.equal(generic.rows[0].result.responseRequirement, 'informational')
    assert.equal(Number((await db.query('select count(*) from public.match_day_availability_requests')).rows[0].count), 2)

    await assert.rejects(
      () => db.query(`
        select public.notify_calendar_event_parents(
          null, 'update', '${MATCH_ID}', 'b0000000-0000-4000-8000-000000000002',
          array['${PLAYER_ONE}'::uuid]
        )
      `),
      /resolved from saved server-side event scope/,
    )
  } finally {
    await db.close()
  }
})

test('cross-team commands fail closed before request mutation', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`
      insert into public.calendar_event_notification_commands (
        id, club_id, team_id, match_day_id, event_revision, notification_type,
        request_token, player_ids, requested_by, result
      ) values (
        '50000000-0000-4000-8000-000000000002', '${CLUB_ID}', '${OTHER_TEAM_ID}', '${OTHER_MATCH_ID}', 1, 'update',
        '80000000-0000-4000-8000-000000000002', '{}'::uuid[], '${ACTOR_ID}',
        jsonb_build_object('notificationCommandId', '50000000-0000-4000-8000-000000000002')
      )
    `)
    await assert.rejects(
      () => db.query(`select public.reconcile_match_day_calendar_actions_internal('50000000-0000-4000-8000-000000000002')`),
      /do not have permission/,
    )

    await db.exec(`update public.users set status = 'suspended' where id = '${ACTOR_ID}'`)
    await assert.rejects(
      () => db.query(`select public.reconcile_match_day_calendar_actions_internal('50000000-0000-4000-8000-000000000002')`),
      /Coach or manager access is required/,
    )
    await db.exec(`update public.users set status = 'active' where id = '${ACTOR_ID}'`)

    await db.exec(`
      insert into public.calendar_event_notification_commands (
        id, club_id, team_id, match_day_id, event_revision, notification_type,
        request_token, player_ids, requested_by, result
      ) values (
        '50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000099', '${OTHER_TEAM_ID}', '${OTHER_MATCH_ID}', 1, 'update',
        '80000000-0000-4000-8000-000000000003', '{}'::uuid[], '${ACTOR_ID}',
        jsonb_build_object('notificationCommandId', '50000000-0000-4000-8000-000000000003')
      )
    `)
    await assert.rejects(
      () => db.query(`select public.reconcile_match_day_calendar_actions_internal('50000000-0000-4000-8000-000000000003')`),
      /was not found for this account/,
    )

    assert.equal(Number((await db.query('select count(*) from public.match_day_availability_requests')).rows[0].count), 2)
  } finally {
    await db.close()
  }
})

test('player reconciliation failure is audited and blocks email processing truthfully', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`update public.players set status = 'archived' where id = '${PLAYER_TWO}'`)
    const response = await db.query(`
      select public.notify_calendar_event_parents(
        null, 'update', '${MATCH_ID}', 'b0000000-0000-4000-8000-000000000003', '{}'::uuid[]
      ) as result
    `)
    const result = response.rows[0].result

    assert.equal(result.actionReconciliationState, 'failed')
    assert.equal(result.failureCategory, 'player_request_reconciliation_failed')
    assert.equal(result.eligibleRecipientCount, 0)
    assert.equal(result.queuedCount, 0)
    assert.equal(result.playerRequestCreatedCount, 0)
    assert.equal(Number((await db.query('select count(*) from public.match_day_availability_requests')).rows[0].count), 2)
    const audit = await db.query(`select action, metadata from public.audit_logs`)
    assert.equal(audit.rows[0].action, 'match_day_calendar_parent_actions_failed')
    assert.equal(audit.rows[0].metadata.failureCategory, 'player_request_reconciliation_failed')
  } finally {
    await db.close()
  }
})
