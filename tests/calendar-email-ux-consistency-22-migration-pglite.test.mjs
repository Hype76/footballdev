import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260801133232_calendar_email_ux_consistency_22.sql', import.meta.url)

test('calendar email consistency migration enforces and reverses the RSVP contract safely', async () => {
  const db = new PGlite()
  const migration = await readFile(migrationUrl, 'utf8')
  const actorId = '11111111-1111-4111-8111-111111111111'
  const clubId = '22222222-2222-4222-8222-222222222222'
  const teamId = '33333333-3333-4333-8333-333333333333'
  const eventId = '44444444-4444-4444-8444-444444444444'
  const activePlayerId = '55555555-5555-4555-8555-555555555555'
  const cancelledPlayerId = '66666666-6666-4666-8666-666666666666'

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''test.actor_id'', true), '''')::uuid';
    create table public.calendar_events (
      id uuid primary key,
      club_id uuid not null,
      team_id uuid,
      event_type text not null,
      cancelled_at timestamptz,
      parent_visible boolean not null default false,
      parent_audience text not null default 'none',
      updated_by uuid,
      updated_at timestamptz not null default now()
    );
    create table public.training_availability_settings (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid not null unique,
      enabled boolean not null,
      send_days_before integer not null,
      created_by uuid,
      updated_by uuid
    );
    create table public.calendar_event_invites (
      id uuid primary key default gen_random_uuid(),
      club_id uuid not null,
      team_id uuid not null,
      calendar_event_id uuid not null,
      player_id uuid not null,
      invite_status text not null default 'invited',
      training_availability_requested boolean not null default false,
      notify_requested boolean not null default false,
      response_requirement text not null default 'informational',
      updated_by uuid,
      updated_at timestamptz not null default now()
    );
    create table public.training_availability_request_players (
      id uuid primary key default gen_random_uuid(),
      calendar_event_id uuid not null,
      player_id uuid not null,
      status text not null
    );
    create function public.training_availability_user_can_manage(uuid, uuid)
    returns boolean language sql stable as 'select auth.uid() is not null';
  `)
  await db.exec(migration)
  await db.exec(`
    set test.actor_id = '${actorId}';
    insert into public.calendar_events (id, club_id, team_id, event_type)
    values ('${eventId}', '${clubId}', '${teamId}', 'training');
    insert into public.calendar_event_invites (
      club_id, team_id, calendar_event_id, player_id, invite_status
    ) values
      ('${clubId}', '${teamId}', '${eventId}', '${activePlayerId}', 'invited'),
      ('${clubId}', '${teamId}', '${eventId}', '${cancelledPlayerId}', 'cancelled');
  `)

  await db.query(`select * from public.save_training_availability_setting_v3($1, true, 40, false)`, [eventId])
  const enabledEvent = await db.query('select parent_visible, parent_audience, updated_by from public.calendar_events where id = $1', [eventId])
  const enabledInvites = await db.query('select player_id, invite_status, training_availability_requested, notify_requested, response_requirement from public.calendar_event_invites order by invite_status')
  const enabledSetting = await db.query('select enabled, send_days_before from public.training_availability_settings where calendar_event_id = $1', [eventId])

  assert.deepEqual(enabledEvent.rows[0], {
    parent_visible: true,
    parent_audience: 'involved_players',
    updated_by: actorId,
  })
  assert.deepEqual(enabledSetting.rows[0], { enabled: true, send_days_before: 30 })
  assert.deepEqual(enabledInvites.rows, [
    {
      player_id: cancelledPlayerId,
      invite_status: 'cancelled',
      training_availability_requested: false,
      notify_requested: false,
      response_requirement: 'informational',
    },
    {
      player_id: activePlayerId,
      invite_status: 'invited',
      training_availability_requested: true,
      notify_requested: true,
      response_requirement: 'response_required',
    },
  ])

  await db.query(`select * from public.save_training_availability_setting_v3($1, false, -2, false)`, [eventId])
  const disabledInvite = await db.query('select training_availability_requested, notify_requested, response_requirement from public.calendar_event_invites where player_id = $1', [activePlayerId])
  const disabledSetting = await db.query('select enabled, send_days_before from public.training_availability_settings where calendar_event_id = $1', [eventId])

  assert.deepEqual(disabledInvite.rows[0], {
    training_availability_requested: false,
    notify_requested: false,
    response_requirement: 'informational',
  })
  assert.deepEqual(disabledSetting.rows[0], { enabled: false, send_days_before: 0 })

  await db.close()
})

test('calendar email consistency function grants remain authenticated and service-only', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /security definer/)
  assert.match(migration, /set search_path = ''/)
  assert.match(migration, /revoke all on function public\.save_training_availability_setting_v3\([\s\S]*from public, anon/)
  assert.match(migration, /grant execute on function public\.save_training_availability_setting_v3\([\s\S]*to authenticated, service_role/)
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/)
})
