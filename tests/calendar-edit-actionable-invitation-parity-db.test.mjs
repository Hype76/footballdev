import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260718055023_calendar_edit_actionable_invitation_parity.sql', import.meta.url), 'utf8')
const TOKEN_HASH = 'a'.repeat(64)

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.clubs (id uuid primary key);
    create table public.teams (id uuid primary key, club_id uuid);
    create table public.players (
      id uuid primary key, club_id uuid, team_id uuid, player_name text, status text
    );
    create table public.parent_player_links (
      id uuid primary key, club_id uuid, team_id uuid, player_id uuid,
      email text, status text
    );
    create table public.match_days (
      id uuid primary key, club_id uuid, team_id uuid, status text,
      deleted_at timestamptz
    );
    create table public.calendar_event_invites (
      id uuid primary key, club_id uuid, team_id uuid, match_day_id uuid,
      player_id uuid, invite_status text
    );
    create table public.match_day_availability_requests (
      id uuid primary key, match_day_id uuid, club_id uuid, team_id uuid,
      player_id uuid, player_name text, recipient_name text, recipient_email text,
      recipient_type text, parent_link_id uuid, token_hash text, status text,
      responded_at timestamptz, expires_at timestamptz,
      volunteer_scorer_response text, volunteer_linesman_response text,
      volunteer_referee_response text, volunteer_responded_at timestamptz,
      transport_needs_lift boolean, transport_can_offer_lift boolean,
      transport_seats_offered integer, transport_responded_at timestamptz,
      updated_at timestamptz default now()
    );

    create function public.get_match_day_availability_response_v2(token_hash_value text)
    returns table (
      request_id uuid, player_id uuid, player_name text, recipient_name text,
      recipient_email text, response_status text, responded_at timestamptz,
      expires_at timestamptz, match_day_id uuid, current_availability_status text,
      current_availability_selected_by_name text, current_availability_selected_by_email text,
      current_availability_selected_at timestamptz, team_name text, opponent text,
      match_date date, kickoff_time time, kickoff_time_tbc boolean, arrival_time time,
      venue_name text, venue_address text, request_scorer boolean,
      request_linesman boolean, request_referee boolean,
      volunteer_scorer_response text, volunteer_linesman_response text,
      volunteer_referee_response text, volunteer_responded_at timestamptz,
      transport_needs_lift boolean, transport_can_offer_lift boolean,
      transport_seats_offered integer, transport_responded_at timestamptz
    ) language sql security definer set search_path = '' as $$
      select request.id, request.player_id, request.player_name, request.recipient_name,
        request.recipient_email, request.status, request.responded_at, request.expires_at,
        request.match_day_id, request.status, ''::text, ''::text, null::timestamptz,
        'Team'::text, 'Opponent'::text, current_date, '14:00'::time, false,
        '13:15'::time, 'Ground'::text, 'Address'::text, true, true, false,
        request.volunteer_scorer_response, request.volunteer_linesman_response,
        request.volunteer_referee_response, request.volunteer_responded_at,
        request.transport_needs_lift, request.transport_can_offer_lift,
        request.transport_seats_offered, request.transport_responded_at
      from public.match_day_availability_requests request
      where request.token_hash = token_hash_value;
    $$;

    create function public.submit_match_day_availability_response(
      token_hash_value text, status_value text,
      volunteer_scorer_response_value text default null,
      volunteer_linesman_response_value text default null,
      volunteer_referee_response_value text default null,
      transport_needs_lift_value boolean default null,
      transport_can_offer_lift_value boolean default null,
      transport_seats_offered_value integer default null
    ) returns table (
      request_id uuid, player_name text, response_status text, responded_at timestamptz,
      volunteer_scorer_response text, volunteer_linesman_response text,
      volunteer_referee_response text, volunteer_responded_at timestamptz,
      transport_needs_lift boolean, transport_can_offer_lift boolean,
      transport_seats_offered integer, transport_responded_at timestamptz
    ) language sql security definer set search_path = '' as $$
      select request.id, request.player_name, status_value, now(),
        request.volunteer_scorer_response, request.volunteer_linesman_response,
        request.volunteer_referee_response, request.volunteer_responded_at,
        request.transport_needs_lift, request.transport_can_offer_lift,
        request.transport_seats_offered, request.transport_responded_at
      from public.match_day_availability_requests request
      where request.token_hash = token_hash_value;
    $$;

    insert into public.clubs values ('10000000-0000-4000-8000-000000000001');
    insert into public.teams values (
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001'
    );
    insert into public.players values (
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Player One', 'active'
    );
    insert into public.parent_player_links values (
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'parent@example.com', 'active'
    );
    insert into public.match_days values (
      '50000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'scheduled', null
    );
    insert into public.match_day_availability_requests values (
      '60000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Player One', 'Parent One', 'parent@example.com', 'parent',
      '40000000-0000-4000-8000-000000000001', '${TOKEN_HASH}',
      'available', now(), now() + interval '3 days',
      'yes', 'no', 'no_response', now(), false, false, 0, null
    );
    insert into public.calendar_event_invites values (
      '70000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'active'
    );
  `)
  await db.exec(migration)
  return db
}

test('token guard preserves a valid existing response and rejects expired or inactive scope', async () => {
  const db = await createDatabase()
  try {
    const valid = await db.query(`select public.is_match_day_action_token_current_internal('${TOKEN_HASH}') as allowed`)
    assert.equal(valid.rows[0].allowed, true)

    const visible = await db.query(`select response_status from public.get_match_day_availability_response_v2('${TOKEN_HASH}')`)
    assert.deepEqual(visible.rows.map((row) => row.response_status), ['available'])

    await db.exec("update public.parent_player_links set status = 'revoked'")
    const revoked = await db.query(`select * from public.get_match_day_availability_response_v2('${TOKEN_HASH}')`)
    assert.equal(revoked.rows.length, 0)

    await db.exec("update public.parent_player_links set status = 'active'; update public.match_days set status = 'cancelled'")
    const cancelled = await db.query(`select * from public.submit_match_day_availability_response('${TOKEN_HASH}', 'maybe')`)
    assert.equal(cancelled.rows.length, 0)

    await db.exec("update public.match_days set status = 'scheduled'; update public.match_day_availability_requests set expires_at = now() - interval '1 minute'")
    const expired = await db.query(`select public.is_match_day_action_token_current_internal('${TOKEN_HASH}') as allowed`)
    assert.equal(expired.rows[0].allowed, false)
  } finally {
    await db.close()
  }
})

test('token guard denies cross-team drift, deleted fixtures and guessed tokens', async () => {
  const db = await createDatabase()
  try {
    const guessed = await db.query(`select public.is_match_day_action_token_current_internal('${'b'.repeat(64)}') as allowed`)
    assert.equal(guessed.rows[0].allowed, false)

    await db.exec("update public.players set team_id = '20000000-0000-4000-8000-000000000002'")
    const moved = await db.query(`select public.is_match_day_action_token_current_internal('${TOKEN_HASH}') as allowed`)
    assert.equal(moved.rows[0].allowed, false)

    await db.exec(`
      update public.players set team_id = '20000000-0000-4000-8000-000000000001';
      update public.match_days set deleted_at = now();
    `)
    const deleted = await db.query(`select public.is_match_day_action_token_current_internal('${TOKEN_HASH}') as allowed`)
    assert.equal(deleted.rows[0].allowed, false)
  } finally {
    await db.close()
  }
})

test('removing a player from saved invite scope invalidates tokens without deleting responses', async () => {
  const db = await createDatabase()
  try {
    await db.exec("update public.calendar_event_invites set invite_status = 'cancelled'")
    const request = await db.query('select token_hash, status, volunteer_scorer_response, expires_at from public.match_day_availability_requests')
    assert.notEqual(request.rows[0].token_hash, TOKEN_HASH)
    assert.equal(request.rows[0].status, 'available')
    assert.equal(request.rows[0].volunteer_scorer_response, 'yes')
    assert.ok(new Date(request.rows[0].expires_at).getTime() <= 0)
  } finally {
    await db.close()
  }
})
