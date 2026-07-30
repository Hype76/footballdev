import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260730110000_adult_player_account_foundation.sql', import.meta.url)

const ids = {
  club: '11000000-0000-4000-8000-000000000001',
  team: '21000000-0000-4000-8000-000000000001',
  user: '31000000-0000-4000-8000-000000000001',
  player: '41000000-0000-4000-8000-000000000001',
  otherPlayer: '41000000-0000-4000-8000-000000000002',
  match: '51000000-0000-4000-8000-000000000001',
  ownMatchRequest: '61000000-0000-4000-8000-000000000001',
  otherMatchRequest: '61000000-0000-4000-8000-000000000002',
  event: '71000000-0000-4000-8000-000000000001',
  trainingRequest: '81000000-0000-4000-8000-000000000001',
  trainingPlayerRequest: '91000000-0000-4000-8000-000000000001',
}

async function setClaims(db, userId = '') {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    userId ? JSON.stringify({ sub: userId }) : '',
  ])
}

async function createDatabase() {
  const migration = await readFile(migrationUrl, 'utf8')
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;

    create table auth.users (id uuid primary key);
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.clubs (
      id uuid primary key,
      name text not null,
      logo_url text,
      contact_email text,
      theme_accent text,
      theme_button_style text
    );
    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs (id),
      name text not null,
      theme_mode text,
      theme_accent text,
      theme_button_style text
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs (id),
      team_id uuid references public.teams (id),
      player_name text not null,
      team text not null default '',
      status text not null default 'active',
      archived_at timestamptz,
      date_of_birth date,
      contact_type text not null default 'parent'
    );
    create table public.users (id uuid primary key);
    create table public.parent_player_links (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid,
      player_id uuid not null references public.players (id),
      status text not null default 'active'
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      event_type text not null,
      title text not null,
      starts_at timestamptz not null,
      ends_at timestamptz,
      location text not null default '',
      cancelled_at timestamptz
    );
    create table public.calendar_event_invites (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid,
      player_id uuid not null,
      recipient_type text not null,
      invite_status text not null default 'active',
      responded_at timestamptz
    );
    create table public.training_availability_requests (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid not null,
      occurrence_starts_at timestamptz not null,
      occurrence_ends_at timestamptz,
      status text not null default 'sent'
    );
    create table public.training_availability_request_players (
      id uuid primary key,
      request_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid not null,
      player_id uuid not null,
      player_name text not null,
      parent_link_id uuid,
      recipient_type text not null,
      token_hash text not null,
      status text not null default 'sent',
      responded_at timestamptz
    );
    create table public.training_availability_responses (
      id uuid primary key default gen_random_uuid(),
      request_player_id uuid not null,
      request_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid not null,
      player_id uuid not null,
      parent_link_id uuid,
      status text not null,
      responded_at timestamptz not null,
      constraint training_response_request_player_key unique (request_id, player_id)
    );
    create table public.match_days (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      opponent text not null default '',
      match_date date,
      kickoff_time time,
      venue_name text not null default '',
      venue_address text not null default '',
      status text not null default 'scheduled',
      concluded_at timestamptz,
      deleted_at timestamptz
    );
    create table public.match_day_availability_requests (
      id uuid primary key,
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      parent_link_id uuid,
      recipient_type text not null,
      token_hash text not null,
      status text not null default 'pending',
      expires_at timestamptz not null,
      responded_at timestamptz
    );
    create table public.match_day_player_availability (
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid,
      player_id uuid not null,
      status text not null,
      selected_at timestamptz,
      unique (match_day_id, player_id)
    );
    create table public.match_day_player_squad_decisions (
      match_day_id uuid not null,
      player_id uuid not null,
      status text not null,
      unique (match_day_id, player_id)
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      actor_id uuid,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create function public.submit_match_day_availability_response(
      token_hash_value text,
      status_value text,
      volunteer_scorer_response_value text default null,
      volunteer_linesman_response_value text default null,
      volunteer_referee_response_value text default null,
      transport_needs_lift_value boolean default null,
      transport_can_offer_lift_value boolean default null,
      transport_seats_offered_value integer default null
    )
    returns table (
      request_id uuid,
      player_name text,
      response_status text,
      responded_at timestamptz,
      volunteer_scorer_response text,
      volunteer_linesman_response text,
      volunteer_referee_response text,
      volunteer_responded_at timestamptz,
      transport_needs_lift boolean,
      transport_can_offer_lift boolean,
      transport_seats_offered integer,
      transport_responded_at timestamptz
    )
    language plpgsql
    as $$
    declare
      request_row public.match_day_availability_requests%rowtype;
    begin
      update public.match_day_availability_requests request
      set status = status_value, responded_at = now()
      where request.token_hash = token_hash_value
      returning request.* into request_row;

      if request_row.id is null then
        return;
      end if;

      insert into public.match_day_player_availability (
        match_day_id, club_id, team_id, player_id, status, selected_at
      )
      values (
        request_row.match_day_id, request_row.club_id, request_row.team_id,
        request_row.player_id, status_value, now()
      )
      on conflict (match_day_id, player_id)
      do update set status = excluded.status, selected_at = excluded.selected_at;

      return query select
        request_row.id, 'Player'::text, status_value, request_row.responded_at,
        null::text, null::text, null::text, null::timestamptz,
        null::boolean, null::boolean, null::integer, null::timestamptz;
    end;
    $$;

    create function public.submit_training_availability_response(
      token_hash_value text,
      status_value text,
      note_value text default ''
    )
    returns table (
      request_player_id uuid,
      request_id uuid,
      player_name text,
      response_status text,
      response_note text,
      responded_at timestamptz
    )
    language plpgsql
    as $$
    declare
      request_player_row public.training_availability_request_players%rowtype;
    begin
      update public.training_availability_request_players request_player
      set status = 'responded', responded_at = now()
      where request_player.token_hash = token_hash_value
      returning request_player.* into request_player_row;

      if request_player_row.id is null then
        return;
      end if;

      insert into public.training_availability_responses (
        request_player_id, request_id, club_id, team_id, calendar_event_id,
        player_id, parent_link_id, status, responded_at
      )
      values (
        request_player_row.id, request_player_row.request_id, request_player_row.club_id,
        request_player_row.team_id, request_player_row.calendar_event_id,
        request_player_row.player_id, null, status_value, now()
      )
      on conflict on constraint training_response_request_player_key
      do update set status = excluded.status, responded_at = excluded.responded_at;

      return query select
        request_player_row.id, request_player_row.request_id,
        request_player_row.player_name, status_value, note_value, now();
    end;
    $$;
  `)

  await db.exec(migration)

  await db.exec(`
    insert into public.clubs (id, name, contact_email)
    values ('${ids.club}', 'FP TEST Club', 'club@example.invalid');
    insert into public.teams (id, club_id, name)
    values ('${ids.team}', '${ids.club}', 'FP TEST Team');
    insert into auth.users (id) values ('${ids.user}');
    insert into public.players (
      id, club_id, team_id, player_name, team, status, date_of_birth, contact_type
    )
    values
      ('${ids.player}', '${ids.club}', '${ids.team}', 'Adult Player', 'FP TEST Team', 'active', current_date - interval '25 years', 'self'),
      ('${ids.otherPlayer}', '${ids.club}', '${ids.team}', 'Other Player', 'FP TEST Team', 'active', current_date - interval '22 years', 'self');
    insert into public.adult_player_account_links (user_id, player_id, created_by)
    values ('${ids.user}', '${ids.player}', '${ids.user}');
    insert into public.match_days (
      id, club_id, team_id, opponent, match_date, kickoff_time, venue_name, status
    )
    values (
      '${ids.match}', '${ids.club}', '${ids.team}', 'FP TEST Opponent',
      current_date + 7, time '15:00', 'FP TEST Ground', 'scheduled'
    );
    insert into public.match_day_availability_requests (
      id, match_day_id, club_id, team_id, player_id, parent_link_id,
      recipient_type, token_hash, status, expires_at
    )
    values
      (
        '${ids.ownMatchRequest}', '${ids.match}', '${ids.club}', '${ids.team}',
        '${ids.player}', null, 'player', repeat('a', 64), 'pending', now() + interval '3 days'
      ),
      (
        '${ids.otherMatchRequest}', '${ids.match}', '${ids.club}', '${ids.team}',
        '${ids.otherPlayer}', null, 'player', repeat('b', 64), 'pending', now() + interval '3 days'
      );
    insert into public.calendar_events (
      id, club_id, team_id, event_type, title, starts_at, ends_at, location
    )
    values (
      '${ids.event}', '${ids.club}', '${ids.team}', 'training', 'FP TEST Training',
      now() + interval '5 days', now() + interval '5 days 2 hours', 'FP TEST Pitch'
    );
    insert into public.training_availability_requests (
      id, club_id, team_id, calendar_event_id, occurrence_starts_at, occurrence_ends_at, status
    )
    values (
      '${ids.trainingRequest}', '${ids.club}', '${ids.team}', '${ids.event}',
      now() + interval '5 days', now() + interval '5 days 2 hours', 'sent'
    );
    insert into public.training_availability_request_players (
      id, request_id, club_id, team_id, calendar_event_id, player_id, player_name,
      parent_link_id, recipient_type, token_hash, status
    )
    values (
      '${ids.trainingPlayerRequest}', '${ids.trainingRequest}', '${ids.club}',
      '${ids.team}', '${ids.event}', '${ids.player}', 'Adult Player',
      null, 'player', repeat('c', 64), 'sent'
    );
  `)

  return db
}

test('adult player sees and responds only to own direct invitations', async () => {
  const db = await createDatabase()
  await setClaims(db, ids.user)

  let invitations = await db.query('select * from public.get_own_adult_player_invitation_state()')
  assert.deepEqual(
    invitations.rows.map((row) => row.source_record_id).sort(),
    [ids.ownMatchRequest, ids.trainingPlayerRequest].sort(),
  )

  const matchResponse = await db.query(
    'select public.respond_own_adult_player_match_invitation($1, $2) as result',
    [ids.ownMatchRequest, 'available'],
  )
  assert.equal(matchResponse.rows[0].result.success, true)
  assert.equal(matchResponse.rows[0].result.responseSource, 'adult_player')

  const repeatedResponse = await db.query(
    'select public.respond_own_adult_player_match_invitation($1, $2) as result',
    [ids.ownMatchRequest, 'available'],
  )
  assert.equal(repeatedResponse.rows[0].result.success, true)

  const trainingResponse = await db.query(
    'select public.respond_own_adult_player_training_invitation($1, $2) as result',
    [ids.trainingPlayerRequest, 'unavailable'],
  )
  assert.equal(trainingResponse.rows[0].result.success, true)
  assert.equal(trainingResponse.rows[0].result.responseSource, 'adult_player')

  invitations = await db.query('select * from public.get_own_adult_player_invitation_state()')
  assert.equal(
    invitations.rows.find((row) => row.source_record_id === ids.ownMatchRequest).response_state,
    'available',
  )
  assert.equal(
    invitations.rows.find((row) => row.source_record_id === ids.trainingPlayerRequest).response_state,
    'unavailable',
  )

  const audits = await db.query(`
    select action, metadata
    from public.audit_logs
    where actor_id = $1
    order by created_at
  `, [ids.user])
  assert.equal(audits.rows.length, 3)
  assert.ok(audits.rows.every((row) => row.metadata.responseSource === 'adult_player'))
  assert.ok(audits.rows.every((row) => row.metadata.playerId === ids.player))
  await db.close()
})

test('same-team other player and revoked-link responses are denied safely', async () => {
  const db = await createDatabase()
  await setClaims(db, ids.user)

  const denied = await db.query(
    'select public.respond_own_adult_player_match_invitation($1, $2) as result',
    [ids.otherMatchRequest, 'available'],
  )
  assert.equal(denied.rows[0].result.success, false)
  assert.equal(denied.rows[0].result.denialCategory, 'invitation_not_owned')

  const deniedAudit = await db.query(`
    select metadata
    from public.audit_logs
    where action = 'adult_player_match_response_denied'
  `)
  assert.equal(deniedAudit.rows.length, 1)
  assert.equal(deniedAudit.rows[0].metadata.denialCategory, 'invitation_not_owned')

  await db.query(`
    update public.adult_player_account_links
    set status = 'revoked', revoked_by = $1
    where user_id = $1
  `, [ids.user])

  const revoked = await db.query(
    'select public.respond_own_adult_player_match_invitation($1, $2) as result',
    [ids.ownMatchRequest, 'maybe'],
  )
  assert.equal(revoked.rows[0].result.success, false)
  assert.equal(revoked.rows[0].result.denialCategory, 'adult_player_context_denied')

  const invitations = await db.query('select * from public.get_own_adult_player_invitation_state()')
  assert.equal(invitations.rows.length, 0)
  await db.close()
})

test('signed-out calls resolve no adult-player authority', async () => {
  const db = await createDatabase()
  await setClaims(db)

  const state = await db.query('select * from public.get_own_adult_player_account_state()')
  assert.equal(state.rows.length, 0)

  const response = await db.query(
    'select public.respond_own_adult_player_match_invitation($1, $2) as result',
    [ids.ownMatchRequest, 'available'],
  )
  assert.equal(response.rows[0].result.success, false)
  assert.equal(response.rows[0].result.denialCategory, 'adult_player_context_denied')
  await db.close()
})
