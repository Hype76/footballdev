import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(
  new URL('../supabase/migrations/20260731091334_shared_child_rsvp_12c.sql', import.meta.url),
  'utf8',
)

const ids = {
  adultUser: '90000000-0000-4000-8000-000000000001',
  club: '10000000-0000-4000-8000-000000000001',
  event: '50000000-0000-4000-8000-000000000001',
  linkA: '40000000-0000-4000-8000-000000000001',
  linkB: '40000000-0000-4000-8000-000000000002',
  match: '70000000-0000-4000-8000-000000000001',
  matchRequestA: '71000000-0000-4000-8000-000000000001',
  matchRequestB: '71000000-0000-4000-8000-000000000002',
  player: '30000000-0000-4000-8000-000000000001',
  request: '60000000-0000-4000-8000-000000000001',
  requestPlayerA: '61000000-0000-4000-8000-000000000001',
  requestPlayerB: '61000000-0000-4000-8000-000000000002',
  requestPlayerAdult: '61000000-0000-4000-8000-000000000003',
  staffUser: '90000000-0000-4000-8000-000000000002',
  team: '20000000-0000-4000-8000-000000000001',
}

const tokens = {
  parentA: 'a'.repeat(64),
  parentB: 'b'.repeat(64),
  matchA: 'd'.repeat(64),
  matchB: 'e'.repeat(64),
  adult: 'c'.repeat(64),
}

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;

    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid
    language sql stable set search_path = ''
    as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.clubs (id uuid primary key);
    create table public.teams (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      name text not null
    );
    create table public.users (
      id uuid primary key references auth.users(id),
      status text,
      role text,
      role_rank integer,
      name text,
      username text,
      email text,
      club_id uuid
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      player_name text not null,
      status text
    );
    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      player_id uuid not null references public.players(id),
      auth_user_id uuid,
      email text,
      status text
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      title text,
      location text,
      notes text,
      cancelled_at timestamptz
    );
    create table public.training_availability_requests (
      id uuid primary key,
      calendar_event_id uuid not null references public.calendar_events(id),
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      occurrence_date date not null,
      occurrence_starts_at timestamptz not null,
      occurrence_ends_at timestamptz,
      status text not null,
      created_at timestamptz not null default now()
    );
    create table public.training_availability_request_players (
      id uuid primary key,
      request_id uuid not null references public.training_availability_requests(id),
      calendar_event_id uuid not null references public.calendar_events(id),
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      player_id uuid not null references public.players(id),
      player_name text not null,
      parent_link_id uuid references public.parent_player_links(id),
      recipient_type text,
      recipient_name text,
      recipient_email text,
      token_hash text unique,
      status text,
      responded_at timestamptz,
      updated_at timestamptz default now()
    );
    create table public.training_availability_responses (
      id uuid primary key default gen_random_uuid(),
      request_player_id uuid not null references public.training_availability_request_players(id),
      request_id uuid not null references public.training_availability_requests(id),
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      calendar_event_id uuid not null references public.calendar_events(id),
      player_id uuid not null references public.players(id),
      parent_link_id uuid references public.parent_player_links(id),
      status text not null,
      note text,
      responded_by_name text,
      responded_by_email text,
      responded_at timestamptz,
      updated_at timestamptz default now(),
      unique (request_id, player_id)
    );
    create table public.match_days (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id)
    );
    create table public.match_day_availability_requests (
      id uuid primary key,
      match_day_id uuid not null references public.match_days(id),
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      player_id uuid not null references public.players(id),
      player_name text,
      parent_link_id uuid references public.parent_player_links(id),
      recipient_type text,
      recipient_name text,
      recipient_email text,
      token_hash text unique,
      status text,
      responded_at timestamptz,
      expires_at timestamptz,
      volunteer_scorer_response text,
      volunteer_linesman_response text,
      volunteer_referee_response text,
      volunteer_responded_at timestamptz,
      transport_needs_lift boolean,
      transport_can_offer_lift boolean,
      transport_seats_offered integer,
      transport_responded_at timestamptz,
      updated_at timestamptz default now()
    );
    create table public.match_day_player_availability (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null references public.match_days(id),
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      player_id uuid not null references public.players(id),
      player_name text,
      status text,
      selected_by_parent_link_id uuid,
      selected_by_request_id uuid,
      selected_by_name text,
      selected_by_email text,
      selected_at timestamptz,
      updated_at timestamptz,
      unique (match_day_id, player_id)
    );
    create table public.match_day_player_availability_history (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      request_id uuid,
      parent_link_id uuid,
      player_name text,
      previous_status text,
      status text,
      selected_by_name text,
      selected_by_email text,
      created_at timestamptz not null default now()
    );

    create function public.current_user_can_access_team(uuid, uuid)
    returns boolean language sql stable set search_path = ''
    as $$ select true $$;

    create function public.is_match_day_action_token_current_internal(token_hash_value text)
    returns boolean language sql stable security definer set search_path = ''
    as $$
      select exists (
        select 1
        from public.match_day_availability_requests request
        where request.token_hash = token_hash_value
          and request.expires_at > now()
      )
    $$;

    create function public.is_training_availability_token_current_internal(token_hash_value text)
    returns boolean language sql stable security definer set search_path = ''
    as $$
      select exists (
        select 1
        from public.training_availability_request_players request_player
        where request_player.token_hash = token_hash_value
          and request_player.status not in ('cancelled', 'expired')
      )
    $$;

    create function public.get_training_availability_response(token_hash_value text)
    returns table (
      request_player_id uuid, request_id uuid, calendar_event_id uuid, player_id uuid,
      player_name text, recipient_name text, recipient_email text, response_status text,
      response_note text, responded_at timestamptz, team_name text, event_title text,
      occurrence_date date, occurrence_starts_at timestamptz,
      occurrence_ends_at timestamptz, location text, notes text
    ) language sql security definer set search_path = ''
    as $$ select null::uuid, null::uuid, null::uuid, null::uuid, ''::text, ''::text,
      ''::text, ''::text, ''::text, null::timestamptz, ''::text, ''::text,
      null::date, null::timestamptz, null::timestamptz, ''::text, ''::text where false $$;

    create function public.submit_training_availability_response(
      token_hash_value text, status_value text, note_value text default ''
    ) returns table (
      request_player_id uuid, request_id uuid, player_name text, response_status text,
      response_note text, responded_at timestamptz
    ) language sql security definer set search_path = ''
    as $$ select null::uuid, null::uuid, ''::text, ''::text, ''::text,
      null::timestamptz where false $$;

    create function public.submit_match_day_availability_response(
      token_hash_value text,
      status_value text,
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
    ) language plpgsql security definer set search_path = ''
    as $$
    declare
      request_row public.match_day_availability_requests%rowtype;
      previous_status text := 'pending';
    begin
      select request.*
      into request_row
      from public.match_day_availability_requests request
      where request.token_hash = token_hash_value;

      select coalesce(availability.status, 'pending')
      into previous_status
      from public.match_day_player_availability availability
      where availability.match_day_id = request_row.match_day_id
        and availability.player_id = request_row.player_id;

      previous_status := coalesce(previous_status, 'pending');

      insert into public.match_day_player_availability (
        match_day_id, club_id, team_id, player_id, player_name, status,
        selected_by_parent_link_id, selected_by_request_id, selected_by_name,
        selected_by_email, selected_at, updated_at
      ) values (
        request_row.match_day_id, request_row.club_id, request_row.team_id,
        request_row.player_id, request_row.player_name, status_value,
        request_row.parent_link_id, request_row.id, request_row.recipient_name,
        request_row.recipient_email, now(), now()
      )
      on conflict (match_day_id, player_id) do update
      set status = excluded.status,
          selected_by_parent_link_id = excluded.selected_by_parent_link_id,
          selected_by_request_id = excluded.selected_by_request_id,
          selected_by_name = excluded.selected_by_name,
          selected_by_email = excluded.selected_by_email,
          selected_at = excluded.selected_at,
          updated_at = excluded.updated_at;

      insert into public.match_day_player_availability_history (
        match_day_id, club_id, team_id, player_id, request_id, parent_link_id,
        player_name, previous_status, status, selected_by_name, selected_by_email
      ) values (
        request_row.match_day_id, request_row.club_id, request_row.team_id,
        request_row.player_id, request_row.id, request_row.parent_link_id,
        request_row.player_name, previous_status, status_value,
        request_row.recipient_name, request_row.recipient_email
      );

      return query
      select request_row.id, request_row.player_name, status_value, now(),
        request_row.volunteer_scorer_response, request_row.volunteer_linesman_response,
        request_row.volunteer_referee_response, request_row.volunteer_responded_at,
        request_row.transport_needs_lift, request_row.transport_can_offer_lift,
        request_row.transport_seats_offered, request_row.transport_responded_at;
    end;
    $$;
  `)

  await db.exec(migration)

  await db.exec(`
    insert into public.clubs values ('${ids.club}');
    insert into public.teams values ('${ids.team}', '${ids.club}', 'FP TEST');
    insert into public.players values (
      '${ids.player}', '${ids.club}', '${ids.team}', 'Shared Child', 'active'
    );
    insert into public.parent_player_links values
      ('${ids.linkA}', '${ids.club}', '${ids.team}', '${ids.player}', null, 'parent-a@example.test', 'active'),
      ('${ids.linkB}', '${ids.club}', '${ids.team}', '${ids.player}', null, 'parent-b@example.test', 'active');
    insert into public.calendar_events values (
      '${ids.event}', '${ids.club}', '${ids.team}', 'Training', 'Pitch', '', null
    );
    insert into public.training_availability_requests values (
      '${ids.request}', '${ids.event}', '${ids.club}', '${ids.team}',
      current_date + 3, now() + interval '3 days', now() + interval '3 days 1 hour',
      'scheduled', now()
    );
    insert into public.training_availability_request_players (
      id, request_id, calendar_event_id, club_id, team_id, player_id, player_name,
      parent_link_id, recipient_type, recipient_name, recipient_email, token_hash, status
    ) values
      (
        '${ids.requestPlayerA}', '${ids.request}', '${ids.event}', '${ids.club}',
        '${ids.team}', '${ids.player}', 'Shared Child', '${ids.linkA}', 'parent',
        'Parent A', 'parent-a@example.test', '${tokens.parentA}', 'sent'
      ),
      (
        '${ids.requestPlayerB}', '${ids.request}', '${ids.event}', '${ids.club}',
        '${ids.team}', '${ids.player}', 'Shared Child', '${ids.linkB}', 'parent',
        'Parent B', 'parent-b@example.test', '${tokens.parentB}', 'sent'
      );
    insert into public.match_days values ('${ids.match}', '${ids.club}', '${ids.team}');
    insert into public.match_day_availability_requests (
      id, match_day_id, club_id, team_id, player_id, player_name, parent_link_id,
      recipient_type, recipient_name, recipient_email, token_hash, status, expires_at
    ) values
      (
        '${ids.matchRequestA}', '${ids.match}', '${ids.club}', '${ids.team}',
        '${ids.player}', 'Shared Child', '${ids.linkA}', 'parent', 'Parent A',
        'parent-a@example.test', '${tokens.matchA}', 'pending', now() + interval '3 days'
      ),
      (
        '${ids.matchRequestB}', '${ids.match}', '${ids.club}', '${ids.team}',
        '${ids.player}', 'Shared Child', '${ids.linkB}', 'parent', 'Parent B',
        'parent-b@example.test', '${tokens.matchB}', 'pending', now() + interval '3 days'
      );
  `)

  return db
}

test('Phase 3 migration makes Training current state shared and preserves both parent actors', async () => {
  const db = await createDatabase()

  await db.query(
    'select * from public.submit_training_availability_response($1, $2, $3)',
    [tokens.parentA, 'available', 'Parent A note'],
  )

  const parentBView = await db.query(
    'select response_status, response_note from public.get_training_availability_response($1)',
    [tokens.parentB],
  )
  assert.deepEqual(parentBView.rows, [{
    response_status: 'available',
    response_note: 'Parent A note',
  }])

  await db.query(
    'select * from public.submit_training_availability_response($1, $2, $3)',
    [tokens.parentB, 'maybe', 'Parent B note'],
  )

  const parentAView = await db.query(
    'select response_status, response_note from public.get_training_availability_response($1)',
    [tokens.parentA],
  )
  assert.deepEqual(parentAView.rows, [{
    response_status: 'maybe',
    response_note: 'Parent B note',
  }])

  const current = await db.query(`
    select status, parent_link_id, response_source
    from public.training_availability_responses
    where request_id = '${ids.request}' and player_id = '${ids.player}'
  `)
  assert.deepEqual(current.rows, [{
    status: 'maybe',
    parent_link_id: ids.linkB,
    response_source: 'parent',
  }])

  const history = await db.query(`
    select parent_link_id, previous_status, status, source
    from public.training_availability_response_history
    where request_id = '${ids.request}' and player_id = '${ids.player}'
    order by created_at, id
  `)
  assert.deepEqual(history.rows, [
    {
      parent_link_id: ids.linkA,
      previous_status: 'pending',
      status: 'available',
      source: 'parent',
    },
    {
      parent_link_id: ids.linkB,
      previous_status: 'available',
      status: 'maybe',
      source: 'parent',
    },
  ])

  const recipientStates = await db.query(`
    select status, count(*)::int as count
    from public.training_availability_request_players
    where request_id = '${ids.request}' and player_id = '${ids.player}'
    group by status
  `)
  assert.deepEqual(recipientStates.rows, [{ status: 'responded', count: 2 }])

  await db.close()
})

test('near-simultaneous parent updates keep one current row and one audit entry per update', async () => {
  const db = await createDatabase()

  await Promise.all([
    db.query(
      'select * from public.submit_training_availability_response($1, $2, $3)',
      [tokens.parentA, 'available', 'A'],
    ),
    db.query(
      'select * from public.submit_training_availability_response($1, $2, $3)',
      [tokens.parentB, 'unavailable', 'B'],
    ),
  ])

  const evidence = await db.query(`
    select
      (select count(*)::int from public.training_availability_responses
        where request_id = '${ids.request}' and player_id = '${ids.player}') as current_count,
      (select count(*)::int from public.training_availability_response_history
        where request_id = '${ids.request}' and player_id = '${ids.player}') as history_count,
      (select count(distinct parent_link_id)::int from public.training_availability_response_history
        where request_id = '${ids.request}' and player_id = '${ids.player}') as actor_count
  `)

  assert.deepEqual(evidence.rows, [{
    current_count: 1,
    history_count: 2,
    actor_count: 2,
  }])

  await db.close()
})

test('adult-player and staff-on-behalf updates reuse the shared Training current row', async () => {
  const db = await createDatabase()

  await db.exec(`
    insert into auth.users values ('${ids.adultUser}'), ('${ids.staffUser}');
    insert into public.users (
      id, status, role, role_rank, name, username, email, club_id
    ) values
      (
        '${ids.adultUser}', 'active', 'player', 10, 'Adult Player', 'adult-player',
        'adult@example.test', '${ids.club}'
      ),
      (
        '${ids.staffUser}', 'active', 'manager', 50, 'FP TEST Manager', 'fp-test-manager',
        'manager@example.test', '${ids.club}'
      );
    insert into public.training_availability_request_players (
      id, request_id, calendar_event_id, club_id, team_id, player_id, player_name,
      parent_link_id, recipient_type, recipient_name, recipient_email, token_hash, status
    ) values (
      '${ids.requestPlayerAdult}', '${ids.request}', '${ids.event}', '${ids.club}',
      '${ids.team}', '${ids.player}', 'Shared Child', null, 'player',
      'Adult Player', 'adult@example.test', '${tokens.adult}', 'sent'
    );
  `)

  await db.query(
    'select set_config($1, $2, false)',
    ['request.jwt.claims', JSON.stringify({ sub: ids.adultUser })],
  )
  await db.query(
    'select * from public.submit_training_availability_response($1, $2, $3)',
    [tokens.adult, 'available', 'Adult response'],
  )

  let current = await db.query(`
    select status, response_source, responded_by_user_id
    from public.training_availability_responses
    where request_id = '${ids.request}' and player_id = '${ids.player}'
  `)
  assert.deepEqual(current.rows, [{
    status: 'available',
    response_source: 'adult_player',
    responded_by_user_id: ids.adultUser,
  }])

  await db.query(
    'select set_config($1, $2, false)',
    ['request.jwt.claims', JSON.stringify({ sub: ids.staffUser })],
  )
  await db.exec(`
    update public.training_availability_responses
    set request_player_id = '${ids.requestPlayerA}',
        parent_link_id = null,
        status = 'unavailable',
        note = '',
        responded_by_name = 'FP TEST Manager',
        responded_by_email = 'manager@example.test',
        responded_at = now(),
        updated_at = now()
    where request_id = '${ids.request}' and player_id = '${ids.player}';
  `)

  current = await db.query(`
    select status, response_source, responded_by_user_id
    from public.training_availability_responses
    where request_id = '${ids.request}' and player_id = '${ids.player}'
  `)
  assert.deepEqual(current.rows, [{
    status: 'unavailable',
    response_source: 'staff_on_behalf',
    responded_by_user_id: ids.staffUser,
  }])

  const history = await db.query(`
    select source, previous_status, status
    from public.training_availability_response_history
    where request_id = '${ids.request}' and player_id = '${ids.player}'
    order by created_at, id
  `)
  assert.deepEqual(history.rows, [
    { source: 'adult_player', previous_status: 'pending', status: 'available' },
    { source: 'staff_on_behalf', previous_status: 'available', status: 'unavailable' },
  ])

  await db.close()
})

test('Match Day updates stay on the approved shared model with serialized audit', async () => {
  const db = await createDatabase()

  await Promise.all([
    db.query(
      'select * from public.submit_match_day_availability_response($1, $2)',
      [tokens.matchA, 'available'],
    ),
    db.query(
      'select * from public.submit_match_day_availability_response($1, $2)',
      [tokens.matchB, 'maybe'],
    ),
  ])

  const evidence = await db.query(`
    select
      (select count(*)::int from public.match_day_player_availability
        where match_day_id = '${ids.match}' and player_id = '${ids.player}') as current_count,
      (select count(*)::int from public.match_day_player_availability_history
        where match_day_id = '${ids.match}' and player_id = '${ids.player}') as history_count,
      (select count(distinct parent_link_id)::int from public.match_day_player_availability_history
        where match_day_id = '${ids.match}' and player_id = '${ids.player}') as actor_count,
      (select count(*)::int from public.match_day_player_availability_history
        where match_day_id = '${ids.match}' and player_id = '${ids.player}'
          and source = 'parent') as parent_source_count
  `)

  assert.deepEqual(evidence.rows, [{
    current_count: 1,
    history_count: 2,
    actor_count: 2,
    parent_source_count: 2,
  }])

  assert.match(
    migration,
    /submit_match_day_availability_response_12c_legacy\([\s\S]*volunteer_scorer_response_value[\s\S]*transport_seats_offered_value/,
  )

  await db.close()
})

test('Phase 3 migration keeps tenant scope implicit in token lookup and records all response sources', () => {
  assert.match(
    migration,
    /response\.request_id = request_player_row\.request_id[\s\S]*response\.player_id = request_player_row\.player_id[\s\S]*response\.club_id = request_player_row\.club_id[\s\S]*response\.team_id = request_player_row\.team_id/,
  )
  assert.match(migration, /shared_child_rsvp:training:/)
  assert.match(migration, /shared_child_rsvp:match:/)
  assert.match(migration, /when actor_is_staff then 'staff_on_behalf'/)
  assert.match(migration, /when request_recipient_type = 'player' then 'adult_player'/)
  assert.match(migration, /when new\.parent_link_id is not null then 'parent'/)
  assert.doesNotMatch(
    migration,
    /submit_training_availability_response\([\s\S]*player_id_value uuid/,
  )
})
