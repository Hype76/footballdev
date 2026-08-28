import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260828123000_parent_trial_access_and_safe_player_archive.sql', import.meta.url)

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create schema if not exists auth;
    create schema if not exists public;
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end;
    $$;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select jsonb_build_object('email', current_setting('test.email', true))
    $$;

    create table public.users (
      id uuid primary key,
      club_id uuid,
      role text,
      role_rank integer,
      status text,
      display_name text,
      name text,
      email text
    );
    create table public.players (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      player_name text,
      section text,
      team text,
      status text,
      archived_reason text,
      archived_at timestamptz,
      archived_delete_at timestamptz,
      archived_by uuid,
      archived_previous_status text,
      updated_by uuid,
      updated_by_name text,
      updated_by_email text
    );
    create table public.parent_player_links (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      parent_link_id uuid,
      link_type text,
      email text,
      auth_user_id uuid,
      invite_token uuid,
      status text,
      invited_by uuid,
      invited_by_name text,
      accepted_at timestamptz,
      expires_at timestamptz,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    create table public.team_staff (team_id uuid, user_id uuid);
    create table public.match_days (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      match_date date,
      kickoff_time time,
      kickoff_time_tbc boolean default false,
      status text,
      deleted_at timestamptz
    );
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      starts_at timestamptz,
      ends_at timestamptz,
      recurrence_frequency text,
      recurrence_until date,
      cancelled_at timestamptz
    );
    create table public.calendar_event_invites (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      calendar_event_id uuid,
      match_day_id uuid,
      player_id uuid,
      invite_status text,
      cancelled_at timestamptz
    );
    create table public.match_day_player_squad_decisions (
      id uuid primary key,
      match_day_id uuid,
      player_id uuid,
      status text
    );
    create table public.match_day_availability_requests (
      id uuid primary key,
      match_day_id uuid,
      player_id uuid,
      token_revoked_at timestamptz
    );
    create table public.player_team_memberships (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      status text,
      ended_at timestamptz,
      ended_by uuid,
      ended_reason text,
      ended_source text
    );
    create table public.audit_logs (
      id bigserial primary key,
      club_id uuid,
      actor_id uuid,
      action text,
      entity_type text,
      entity_id uuid,
      outcome text,
      metadata jsonb
    );
    create table public.development_history (
      id uuid primary key,
      player_id uuid,
      note text
    );
    create table public.removal_calls (
      id bigserial primary key,
      source_type text,
      event_id uuid,
      player_id uuid,
      occurrence_date date,
      scope text
    );

    create function public.is_calendar_event_player_excluded_internal(uuid, uuid, date)
    returns boolean language sql stable as $$ select false $$;

    create function public.remove_player_from_event(
      source_type_value text,
      event_id_value uuid,
      player_id_value uuid,
      occurrence_date_value date default null,
      scope_value text default 'event',
      request_token_value uuid default null,
      confirm_in_progress_value boolean default false
    ) returns jsonb language plpgsql as $$
    begin
      insert into public.removal_calls (source_type, event_id, player_id, occurrence_date, scope)
      values (source_type_value, event_id_value, player_id_value, occurrence_date_value, scope_value);
      return jsonb_build_object(
        'affectedOccurrenceCount', 1,
        'suppressedInvitationCount', 1,
        'revokedTokenCount', 1
      );
    end;
    $$;
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  return db
}

test('migration accepts an active Trial Parent link without changing the player record', async () => {
  const db = await createDatabase()
  try {
    const actorId = '00000000-0000-4000-8000-000000000001'
    const clubId = '00000000-0000-4000-8000-000000000002'
    const teamId = '00000000-0000-4000-8000-000000000003'
    const playerId = '00000000-0000-4000-8000-000000000004'
    const linkId = '00000000-0000-4000-8000-000000000005'
    const token = '00000000-0000-4000-8000-000000000006'
    await db.exec(`
      select set_config('test.uid', '${actorId}', false);
      select set_config('test.email', 'parent@example.test', false);
      insert into public.players (id, club_id, team_id, player_name, section, team, status)
      values ('${playerId}', '${clubId}', '${teamId}', 'Trial Player', 'Trial', 'U14', 'active');
      insert into public.parent_player_links (
        id, club_id, team_id, player_id, link_type, email, invite_token, status, expires_at
      ) values (
        '${linkId}', '${clubId}', '${teamId}', '${playerId}', 'parent',
        'parent@example.test', '${token}', 'pending', now() + interval '1 day'
      );
    `)

    const accepted = await db.query(
      'select id, status, auth_user_id from public.accept_parent_player_link($1)',
      [token],
    )
    assert.deepEqual(accepted.rows, [{ auth_user_id: actorId, id: linkId, status: 'active' }])
    const player = await db.query('select section, status from public.players where id = $1', [playerId])
    assert.deepEqual(player.rows, [{ section: 'Trial', status: 'active' }])
  } finally {
    await db.close()
  }
})

test('archive removes future participation atomically and preserves player and development history rows', async () => {
  const db = await createDatabase()
  try {
    const actorId = '10000000-0000-4000-8000-000000000001'
    const clubId = '10000000-0000-4000-8000-000000000002'
    const teamId = '10000000-0000-4000-8000-000000000003'
    const playerId = '10000000-0000-4000-8000-000000000004'
    const matchId = '10000000-0000-4000-8000-000000000005'
    const eventId = '10000000-0000-4000-8000-000000000006'
    await db.exec(`
      select set_config('test.uid', '${actorId}', false);
      select set_config('test.email', 'admin@example.test', false);
      insert into public.users (id, club_id, role, role_rank, status, display_name, email)
      values ('${actorId}', '${clubId}', 'admin', 100, 'active', 'Club Admin', 'admin@example.test');
      insert into public.players (id, club_id, team_id, player_name, section, team, status)
      values ('${playerId}', '${clubId}', '${teamId}', 'Saved Player', 'Squad', 'U14', 'active');
      insert into public.player_team_memberships (id, club_id, team_id, player_id, status)
      values ('10000000-0000-4000-8000-000000000007', '${clubId}', '${teamId}', '${playerId}', 'active');
      insert into public.development_history (id, player_id, note)
      values ('10000000-0000-4000-8000-000000000008', '${playerId}', 'Preserve this report');
      insert into public.match_days (id, club_id, team_id, match_date, kickoff_time, status)
      values ('${matchId}', '${clubId}', '${teamId}', current_date + 7, '10:00', 'scheduled');
      insert into public.calendar_events (id, club_id, team_id, starts_at, ends_at, recurrence_frequency)
      values ('${eventId}', '${clubId}', '${teamId}', now() + interval '2 days', now() + interval '2 days 1 hour', 'none');
      insert into public.calendar_event_invites (id, club_id, team_id, player_id, match_day_id, invite_status)
      values ('10000000-0000-4000-8000-000000000009', '${clubId}', '${teamId}', '${playerId}', '${matchId}', 'sent');
      insert into public.calendar_event_invites (id, club_id, team_id, player_id, calendar_event_id, invite_status)
      values ('10000000-0000-4000-8000-000000000010', '${clubId}', '${teamId}', '${playerId}', '${eventId}', 'sent');
    `)

    const archived = await db.query(
      'select public.archive_player_with_future_events($1, $2, $3) as result',
      [playerId, 'Left the club', '10000000-0000-4000-8000-000000000011'],
    )
    assert.equal(archived.rows[0].result.status, 'archived')
    assert.equal(archived.rows[0].result.affectedOccurrenceCount, 2)
    assert.equal(archived.rows[0].result.historyPreserved, true)

    const player = await db.query(`
      select status, archived_previous_status, archived_reason
      from public.players where id = $1
    `, [playerId])
    assert.deepEqual(player.rows, [{
      archived_previous_status: 'active',
      archived_reason: 'Left the club',
      status: 'archived',
    }])
    const membership = await db.query('select status, ended_source from public.player_team_memberships where player_id = $1', [playerId])
    assert.deepEqual(membership.rows, [{ ended_source: 'archive_player_with_future_events', status: 'inactive' }])
    const history = await db.query('select note from public.development_history where player_id = $1', [playerId])
    assert.deepEqual(history.rows, [{ note: 'Preserve this report' }])
    const calls = await db.query('select source_type from public.removal_calls order by source_type')
    assert.deepEqual(calls.rows, [{ source_type: 'calendar' }, { source_type: 'match-day' }])
  } finally {
    await db.close()
  }
})

test('archive rolls back every change if any future-event removal fails', async () => {
  const db = await createDatabase()
  try {
    const actorId = '20000000-0000-4000-8000-000000000001'
    const clubId = '20000000-0000-4000-8000-000000000002'
    const teamId = '20000000-0000-4000-8000-000000000003'
    const playerId = '20000000-0000-4000-8000-000000000004'
    const matchId = '20000000-0000-4000-8000-000000000005'
    await db.exec(`
      select set_config('test.uid', '${actorId}', false);
      select set_config('test.email', 'admin@example.test', false);
      insert into public.users (id, club_id, role, role_rank, status, display_name, email)
      values ('${actorId}', '${clubId}', 'admin', 100, 'active', 'Club Admin', 'admin@example.test');
      insert into public.players (id, club_id, team_id, player_name, section, team, status)
      values ('${playerId}', '${clubId}', '${teamId}', 'Rollback Player', 'Squad', 'U14', 'active');
      insert into public.player_team_memberships (id, club_id, team_id, player_id, status)
      values ('20000000-0000-4000-8000-000000000006', '${clubId}', '${teamId}', '${playerId}', 'active');
      insert into public.match_days (id, club_id, team_id, match_date, kickoff_time, status)
      values ('${matchId}', '${clubId}', '${teamId}', current_date + 7, '10:00', 'scheduled');
      insert into public.calendar_event_invites (id, club_id, team_id, player_id, match_day_id, invite_status)
      values ('20000000-0000-4000-8000-000000000007', '${clubId}', '${teamId}', '${playerId}', '${matchId}', 'sent');

      create or replace function public.remove_player_from_event(
        source_type_value text,
        event_id_value uuid,
        player_id_value uuid,
        occurrence_date_value date default null,
        scope_value text default 'event',
        request_token_value uuid default null,
        confirm_in_progress_value boolean default false
      ) returns jsonb language plpgsql as $$
      begin
        insert into public.removal_calls (source_type, event_id, player_id, occurrence_date, scope)
        values (source_type_value, event_id_value, player_id_value, occurrence_date_value, scope_value);
        raise exception 'simulated event removal failure';
      end;
      $$;
    `)

    await assert.rejects(
      db.query(
        'select public.archive_player_with_future_events($1, $2, $3)',
        [playerId, 'Should roll back', '20000000-0000-4000-8000-000000000008'],
      ),
      /simulated event removal failure/,
    )
    const player = await db.query('select status, archived_at from public.players where id = $1', [playerId])
    assert.deepEqual(player.rows, [{ archived_at: null, status: 'active' }])
    const membership = await db.query('select status from public.player_team_memberships where player_id = $1', [playerId])
    assert.deepEqual(membership.rows, [{ status: 'active' }])
    const calls = await db.query('select count(*)::int as count from public.removal_calls')
    assert.deepEqual(calls.rows, [{ count: 0 }])
  } finally {
    await db.close()
  }
})
