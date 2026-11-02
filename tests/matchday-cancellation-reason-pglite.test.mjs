import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = (await readFile(new URL('../supabase/migrations/20261102083200_event_cancellation_reasons.sql', import.meta.url), 'utf8')).split('-- section: match')[1].split('-- section: calendar')[0]
const ids = { actor: '00000000-0000-0000-0000-000000000001', other: '00000000-0000-0000-0000-000000000002', club: '00000000-0000-0000-0000-000000000003', team: '00000000-0000-0000-0000-000000000004', otherTeam: '00000000-0000-0000-0000-000000000005', player: '00000000-0000-0000-0000-000000000006', link: '00000000-0000-0000-0000-000000000007', match: '00000000-0000-0000-0000-000000000008' }

async function setup(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function app_private.actor_can_manage_team_resource(uuid, uuid, uuid, integer) returns boolean language sql as $$ select $1 = '${ids.actor}'::uuid $$;
    create function public.current_user_can_access_parent_link(uuid, uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.user_status', true), 'active') = 'active' and coalesce(current_setting('test.player_status', true), 'active') <> 'archived' and coalesce(current_setting('test.plan_enabled', true), 'true') = 'true' $$;
    create table public.clubs (id uuid primary key, status text);
    create table public.teams (id uuid primary key, club_id uuid, name text, status text);
    create table public.players (id uuid primary key, club_id uuid, team_id uuid, status text);
    create table public.parent_player_links (id uuid primary key, auth_user_id uuid, status text, club_id uuid, team_id uuid, player_id uuid);
    create table public.match_days (id uuid primary key, club_id uuid, team_id uuid, opponent text, fixture_type text, match_date date, kickoff_time time, kickoff_time_tbc boolean, arrival_time time, home_away text, venue_name text, venue_address text, status text, deleted_at timestamptz, previous_hidden_at timestamptz, parent_visible boolean, parent_audience text, concluded_at timestamptz, created_at timestamptz, updated_at timestamptz);
    create table public.match_day_availability_requests (match_day_id uuid, club_id uuid, player_id uuid, status text);
    create table public.calendar_event_invites (match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, invite_status text);
    create table public.match_day_player_squad_decisions (match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, status text, notified_at timestamptz);
    create table public.audit_logs (club_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, metadata jsonb);
    insert into public.clubs values ('${ids.club}', 'active');
    insert into public.teams values ('${ids.team}', '${ids.club}', 'Team', 'active'), ('${ids.otherTeam}', '${ids.club}', 'Other', 'active');
    insert into public.players values ('${ids.player}', '${ids.club}', '${ids.team}', 'active');
    insert into public.parent_player_links values ('${ids.link}', '${ids.actor}', 'active', '${ids.club}', '${ids.team}', '${ids.player}');
    insert into public.match_days (id, club_id, team_id, opponent, status, parent_visible, parent_audience) values ('${ids.match}', '${ids.club}', '${ids.team}', 'Opponents', 'scheduled', true, 'all_team_parents');
  `)
  await db.exec(migration)
  await db.query(`select set_config('test.uid', $1, false)`, [ids.actor])
  return db
}

async function visible(db) {
  return (await db.query('select * from public.get_parent_cancelled_match_days($1)', [ids.link])).rows.map((r) => Object.values(r)[0])
}

test('fixture cancellation checks team management, saves an optional trimmed reason and audits', async (t) => {
  const db = await setup(t)
  await db.query(`select set_config('test.uid', $1, false)`, [ids.other])
  await assert.rejects(db.query('select public.cancel_match_day_fixture_for_team($1, $2, $3)', [ids.match, ids.team, 'Weather']), /match_day_fixture_not_permitted/)
  await db.query(`select set_config('test.uid', $1, false)`, [ids.actor])
  await assert.rejects(db.query('select public.cancel_match_day_fixture_for_team($1, $2, $3)', [ids.match, ids.otherTeam, 'Weather']), /match_day_fixture_not_permitted/)
  await db.query('select public.cancel_match_day_fixture_for_team($1, $2, $3)', [ids.match, ids.team, '  Waterlogged pitch  '])
  const { rows } = await db.query('select status, cancellation_reason from public.match_days where id = $1', [ids.match])
  assert.deepEqual(rows[0], { status: 'cancelled', cancellation_reason: 'Waterlogged pitch' })
  assert.equal((await db.query('select * from public.audit_logs')).rows.length, 1)
  assert.equal((await visible(db))[0].cancellation_reason, 'Waterlogged pitch')
})

test('cancelled fixture visibility checks active identity, audience, team and involvement', async (t) => {
  const db = await setup(t)
  await db.query('select public.cancel_match_day_fixture_for_team($1, $2, $3)', [ids.match, ids.team, null])
  assert.equal((await visible(db))[0].cancellation_reason, '')
  for (const [key, denied, allowed] of [['test.user_status', 'suspended', 'active'], ['test.player_status', 'archived', 'active'], ['test.plan_enabled', 'false', 'true']]) {
    await db.query("select set_config($1, $2, false)", [key, denied])
    assert.equal((await visible(db)).length, 0, denied)
    await db.query("select set_config($1, $2, false)", [key, allowed])
  }
  await db.query(`select set_config('test.uid', $1, false)`, [ids.other])
  assert.equal((await visible(db)).length, 0)
  await db.query(`select set_config('test.uid', $1, false)`, [ids.actor])
  await db.query("update public.parent_player_links set status = 'inactive'")
  assert.equal((await visible(db)).length, 0)
  await db.query("update public.parent_player_links set status = 'active', team_id = $1", [ids.otherTeam])
  assert.equal((await visible(db)).length, 0)
  await db.query('update public.parent_player_links set team_id = $1', [ids.team])
  await db.query('update public.match_days set parent_visible = false')
  assert.equal((await visible(db)).length, 0)
  await db.query("update public.match_days set parent_visible = true, parent_audience = 'involved_players'")
  assert.equal((await visible(db)).length, 0)
  await db.query("insert into public.match_day_availability_requests values ($1, $2, $3, 'active')", [ids.match, ids.club, ids.player])
  assert.equal((await visible(db)).length, 1)
  await db.query("select set_config('test.plan_enabled', 'false', false)")
  assert.equal((await visible(db)).length, 0)
  await db.query("select set_config('test.plan_enabled', 'true', false)")
  await db.query("update public.match_days set parent_audience = 'all_club_parents'")
  await db.query("select set_config('test.user_status', 'suspended', false)")
  assert.equal((await visible(db)).length, 0)
  await db.query("select set_config('test.user_status', 'active', false)")
  await db.query("update public.match_days set parent_audience = 'involved_players'")
  await db.query("update public.match_day_availability_requests set status = 'expired'")
  assert.equal((await visible(db)).length, 0)
})
