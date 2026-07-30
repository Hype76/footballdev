import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL(
  '../supabase/migrations/20260730151849_calendar_response_polish_10a.sql',
  import.meta.url,
)
const trainingUpsertMigrationUrl = new URL(
  '../supabase/migrations/20260730160636_training_invitation_upsert_constraint.sql',
  import.meta.url,
)

async function createDatabase() {
  const db = new PGlite()

  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;

    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable set search_path = '' as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;

    create table public.clubs (id uuid primary key);
    create table public.teams (id uuid primary key);
    create table public.users (
      id uuid primary key references auth.users(id),
      status text,
      role text,
      role_rank integer,
      name text,
      username text,
      email text,
      role_label text,
      club_id uuid
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null references public.clubs(id),
      team_id uuid not null references public.teams(id),
      status text,
      player_name text,
      parent_email text,
      parent_contacts jsonb
    );
    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      email text,
      status text
    );
    create table public.match_days (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid not null,
      deleted_at timestamptz,
      previous_hidden_at timestamptz,
      status text
    );
    create table public.match_day_availability_requests (
      id uuid primary key,
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      parent_link_id uuid,
      recipient_type text,
      recipient_email text,
      token_hash text,
      status text,
      expires_at timestamptz
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      event_type text,
      cancelled_at timestamptz
    );
    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      match_day_id uuid,
      calendar_event_id uuid,
      player_id uuid not null,
      invite_status text,
      cancelled_at timestamptz
    );
    create table public.match_day_player_availability (
      id uuid primary key default gen_random_uuid(),
      match_day_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      player_name text not null,
      status text not null,
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
      selected_by_email text
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
      metadata jsonb,
      created_at timestamptz
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      actor_id uuid,
      action text,
      entity_type text,
      entity_id uuid,
      metadata jsonb,
      created_at timestamptz
    );
    create table public.training_availability_requests (
      id uuid primary key,
      calendar_event_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      occurrence_date date not null,
      occurrence_starts_at timestamptz not null,
      status text not null,
      created_at timestamptz default timezone('utc', now())
    );
    create table public.training_availability_request_players (
      id uuid primary key,
      request_id uuid not null,
      calendar_event_id uuid not null,
      club_id uuid not null,
      team_id uuid not null,
      player_id uuid not null,
      recipient_email text not null,
      status text not null,
      responded_at timestamptz,
      updated_at timestamptz
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
      note text,
      responded_by_name text,
      responded_by_email text,
      responded_at timestamptz,
      updated_at timestamptz,
      unique (request_id, player_id)
    );
    create table public.scheduled_email_queue (
      id uuid primary key default gen_random_uuid(),
      payload jsonb not null default '{}'::jsonb
    );

    create function public.can_manage_match_day(uuid) returns boolean
    language sql stable security definer set search_path = '' as $$ select true $$;
    create function public.current_user_can_access_team(uuid, uuid) returns boolean
    language sql stable security definer set search_path = '' as $$ select true $$;
  `)

  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(await readFile(trainingUpsertMigrationUrl, 'utf8'))
  return db
}

test('complete response polish migration applies and keeps token authority current-contact scoped', async () => {
  const db = await createDatabase()
  const ids = {
    club: '10000000-0000-0000-0000-000000000001',
    team: '20000000-0000-0000-0000-000000000001',
    player: '30000000-0000-0000-0000-000000000001',
    match: '40000000-0000-0000-0000-000000000001',
    request: '50000000-0000-0000-0000-000000000001',
    link: '60000000-0000-0000-0000-000000000001',
  }
  const tokenHash = 'a'.repeat(64)

  await db.query('insert into public.clubs (id) values ($1)', [ids.club])
  await db.query('insert into public.teams (id) values ($1)', [ids.team])
  await db.query(`
    insert into public.players (id, club_id, team_id, status, player_name, parent_email, parent_contacts)
    values ($1, $2, $3, 'active', 'FP TEST Player', 'current@example.test', '[]'::jsonb)
  `, [ids.player, ids.club, ids.team])
  await db.query(`
    insert into public.match_days (id, club_id, team_id, status)
    values ($1, $2, $3, 'scheduled')
  `, [ids.match, ids.club, ids.team])
  await db.query(`
    insert into public.match_day_availability_requests (
      id, match_day_id, club_id, team_id, player_id, recipient_type, recipient_email,
      token_hash, status, expires_at
    ) values (
      $1, $2, $3, $4, $5, 'parent', 'current@example.test',
      $6, 'pending', timezone('utc', now()) + interval '1 day'
    )
  `, [ids.request, ids.match, ids.club, ids.team, ids.player, tokenHash])

  const currentContact = await db.query(
    'select public.is_match_day_action_token_current_internal($1) current',
    [tokenHash],
  )
  assert.equal(currentContact.rows[0].current, true)

  await db.query(
    'update public.match_day_availability_requests set recipient_email = $1 where id = $2',
    ['stale@example.test', ids.request],
  )
  const staleContact = await db.query(
    'select public.is_match_day_action_token_current_internal($1) current',
    [tokenHash],
  )
  assert.equal(staleContact.rows[0].current, false)

  await db.query(`
    insert into public.parent_player_links (id, club_id, team_id, player_id, email, status)
    values ($1, $2, $3, $4, 'linked@example.test', 'active')
  `, [ids.link, ids.club, ids.team, ids.player])
  await db.query(`
    update public.match_day_availability_requests
    set parent_link_id = $1, recipient_email = 'linked@example.test'
    where id = $2
  `, [ids.link, ids.request])
  const linkedParent = await db.query(
    'select public.is_match_day_action_token_current_internal($1) current',
    [tokenHash],
  )
  assert.equal(linkedParent.rows[0].current, true)

  await db.query("update public.match_days set status = 'full_time' where id = $1", [ids.match])
  const closedFixture = await db.query(
    'select public.is_match_day_action_token_current_internal($1) current',
    [tokenHash],
  )
  assert.equal(closedFixture.rows[0].current, false)

  await db.close()
})

test('training invitation upsert has a matching plain-column unique key', async () => {
  const db = await createDatabase()
  const index = await db.query(`
    select indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'training_availability_request_players'
      and indexname = 'training_availability_request_players_upsert_key'
  `)

  assert.equal(index.rows.length, 1)
  assert.match(index.rows[0].indexdef, /\(request_id, player_id, recipient_email\)/i)
  await db.close()
})
