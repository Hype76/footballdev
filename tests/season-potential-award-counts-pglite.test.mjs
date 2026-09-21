import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260921083351_potm_match_award_counts.sql', import.meta.url)
const clubId = '10000000-0000-4000-8000-000000000001'
const teamId = '20000000-0000-4000-8000-000000000001'
const adminId = '30000000-0000-4000-8000-000000000001'
const alexId = '40000000-0000-4000-8000-000000000001'
const baileyId = '40000000-0000-4000-8000-000000000002'
const caseyId = '40000000-0000-4000-8000-000000000003'

async function database() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create schema app_private;
    create role anon;
    create role authenticated;
    grant usage on schema app_private to authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.users (id uuid primary key, club_id uuid, role text);
    create table public.teams (id uuid primary key, name text);
    create table public.team_staff (team_id uuid, user_id uuid);
    create table public.players (id uuid primary key, club_id uuid, player_name text, shirt_number text, team_id uuid, status text, section text, archived_at timestamptz);
    create table public.match_days (id uuid primary key, club_id uuid, team_id uuid, match_date date, deleted_at timestamptz, status text, motm_poll_id uuid);
    create table public.match_day_events (match_day_id uuid, event_type text, team_side text, event_status text, voided_at timestamptz, is_own_goal boolean, scorer_name text, assist_name text);
    create table public.polls (id uuid primary key, status text, closes_at timestamptz);
    create table public.poll_votes (id uuid primary key, poll_id uuid, option_id text);
    create function public.current_user_club_id() returns uuid language sql stable as $$
      select club_id from public.users where id = auth.uid()
    $$;
    create function public.current_user_role() returns text language sql stable as $$
      select role from public.users where id = auth.uid()
    $$;
    create function public.current_user_role_rank() returns integer language sql stable as $$
      select case when public.current_user_role() = 'admin' then 90 when public.current_user_role() = 'coach' then 20 else 0 end
    $$;
    insert into public.users values ('${adminId}', '${clubId}', 'admin');
    insert into public.teams values ('${teamId}', 'U16 Green');
    insert into public.players values
      ('${alexId}', '${clubId}', 'Alex', '9', '${teamId}', 'active', 'Squad', null),
      ('${baileyId}', '${clubId}', 'Bailey', '8', '${teamId}', 'active', 'Squad', null),
      ('${caseyId}', '${clubId}', 'Casey', '4', '${teamId}', 'active', 'Squad', null);
    insert into public.match_days values
      ('50000000-0000-4000-8000-000000000001', '${clubId}', '${teamId}', current_date, null, 'full_time', '60000000-0000-4000-8000-000000000001'),
      ('50000000-0000-4000-8000-000000000002', '${clubId}', '${teamId}', current_date, null, 'full_time', '60000000-0000-4000-8000-000000000002'),
      ('50000000-0000-4000-8000-000000000003', '${clubId}', '${teamId}', current_date, null, 'full_time', '60000000-0000-4000-8000-000000000003'),
      ('50000000-0000-4000-8000-000000000004', '${clubId}', '${teamId}', current_date, null, 'full_time', '60000000-0000-4000-8000-000000000004');
    insert into public.polls values
      ('60000000-0000-4000-8000-000000000001', 'closed', null),
      ('60000000-0000-4000-8000-000000000002', 'open', now() - interval '1 minute'),
      ('60000000-0000-4000-8000-000000000003', 'closed', now() + interval '1 day'),
      ('60000000-0000-4000-8000-000000000004', 'open', now() + interval '1 day');
    insert into public.poll_votes values
      ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '${alexId}'),
      ('70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '${alexId}'),
      ('70000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001', '${alexId}'),
      ('70000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001', '${baileyId}'),
      ('70000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000002', '${alexId}'),
      ('70000000-0000-4000-8000-000000000006', '60000000-0000-4000-8000-000000000002', '${baileyId}'),
      ('70000000-0000-4000-8000-000000000007', '60000000-0000-4000-8000-000000000003', '${baileyId}'),
      ('70000000-0000-4000-8000-000000000008', '60000000-0000-4000-8000-000000000003', '${baileyId}'),
      ('70000000-0000-4000-8000-000000000009', '60000000-0000-4000-8000-000000000003', '${baileyId}'),
      ('70000000-0000-4000-8000-000000000010', '60000000-0000-4000-8000-000000000003', '${baileyId}'),
      ('70000000-0000-4000-8000-000000000011', '60000000-0000-4000-8000-000000000003', '${caseyId}'),
      ('70000000-0000-4000-8000-000000000012', '60000000-0000-4000-8000-000000000004', '${alexId}'),
      ('70000000-0000-4000-8000-000000000013', '60000000-0000-4000-8000-000000000004', '${alexId}'),
      ('70000000-0000-4000-8000-000000000014', '60000000-0000-4000-8000-000000000004', '${alexId}');
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/20260921105720_season_report_date_range.sql', import.meta.url), 'utf8'))
  await db.exec(`select set_config('request.jwt.claim.sub', '${adminId}', false);`)
  return db
}

test('season POTM counts final outright and joint winners, never an open poll leader', async () => {
  const db = await database()
  try {
    const { rows } = await db.query('select player_name, motm_votes from public.get_end_season_stats(null) order by player_name')
    assert.deepEqual(rows, [
      { player_name: 'Alex', motm_votes: 2 },
      { player_name: 'Bailey', motm_votes: 2 },
      { player_name: 'Casey', motm_votes: 0 },
    ])
  } finally {
    await db.close()
  }
})

test('season date range is inclusive across years and preserves final tied awards', async () => {
  const db = await database()
  try {
    await db.exec(`update match_days set match_date = case
      when id::text like '%001' then date '2026-07-01'
      when id::text like '%002' then date '2027-06-30'
      when id::text like '%003' then date '2027-07-01'
      else date '2026-06-30' end;
      insert into match_day_events values
      ('50000000-0000-4000-8000-000000000001', 'goal', 'club', 'active', null, false, 'Alex', 'Bailey'),
      ('50000000-0000-4000-8000-000000000002', 'goal', 'club', 'active', null, false, 'Alex', 'Bailey'),
      ('50000000-0000-4000-8000-000000000003', 'goal', 'club', 'active', null, false, 'Alex', 'Bailey'),
      ('50000000-0000-4000-8000-000000000001', 'goal', 'club', 'active', null, true, 'Alex', 'Bailey'),
      ('50000000-0000-4000-8000-000000000001', 'goal', 'club', 'void', now(), false, 'Alex', 'Bailey');`)
    const { rows } = await db.query("select player_name, goals, assists, motm_votes from public.get_end_season_stats_range(null, '2026-07-01', '2027-06-30') order by player_name")
    assert.deepEqual(rows, [
      { player_name: 'Alex', goals: 2, assists: 0, motm_votes: 2 },
      { player_name: 'Bailey', goals: 0, assists: 2, motm_votes: 1 },
      { player_name: 'Casey', goals: 0, assists: 0, motm_votes: 0 },
    ])
    for (const dates of ["null, '2027-06-30'", "'2027-07-01', '2027-06-30'", "'-infinity', '2027-06-30'"]) {
      await assert.rejects(db.query(`select * from public.get_end_season_stats_range(null, ${dates})`), /valid start and end date/)
    }
    await db.exec(`update users set role = 'coach' where id = '${adminId}'`)
    const teamQuery = `select * from public.get_end_season_stats_range('${teamId}', '2026-07-01', '2027-06-30')`
    assert.equal((await db.query(teamQuery)).rows.length, 0, 'unassigned staff cannot read team totals')
    await db.exec(`insert into team_staff values ('${teamId}', '${adminId}')`)
    assert.equal((await db.query(teamQuery)).rows.length, 3, 'assigned staff can read their team')
    assert.equal((await db.query("select * from public.get_end_season_stats_range(null, '2026-07-01', '2027-06-30')")).rows.length, 0, 'staff cannot read all teams')
    await db.exec(`update users set club_id = '10000000-0000-4000-8000-000000000002' where id = '${adminId}'`)
    assert.equal((await db.query(teamQuery)).rows.length, 0, 'club boundary is retained')
    await db.exec("select set_config('request.jwt.claim.sub', '', false)")
    assert.equal((await db.query("select * from public.get_end_season_stats_range(null, '2026-07-01', '2027-06-30')")).rows.length, 0)
    await db.exec('set role anon')
    await assert.rejects(db.query("select * from public.get_end_season_stats_range(null, '2026-07-01', '2027-06-30')"), /permission denied/)
  } finally {
    await db.close()
  }
})
