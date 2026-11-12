import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { getPlatformMatchDaySupportActions, getPlatformMatchDaySupportError } from '../src/lib/platform-match-day-support.js'

test('Platform Match Day displays valid actions for the current clock phase', () => {
  const keys = (match) => getPlatformMatchDaySupportActions(match).map(({ action }) => action)
  assert.deepEqual(keys({ status: 'scheduled', timerStatus: 'not_started', isToday: false }), [])
  assert.deepEqual(keys({ status: 'scheduled', timerStatus: 'not_started', isToday: true }), ['start'])
  assert.deepEqual(keys({ status: 'second_half', timerStatus: 'paused' }), ['resume', 'full_time'])
  assert.deepEqual(keys({ status: 'full_time', timerStatus: 'full_time' }), ['resume', 'conclude'])
  assert.deepEqual(keys({ status: 'penalties', currentMatchPhase: 'penalties' }), ['end_shootout_without_result'])
  assert.deepEqual(keys({ status: 'penalties', currentMatchPhase: 'penalties', shootoutCanFinish: true }), ['full_time'])
  assert.match(getPlatformMatchDaySupportError({ code: '40001' }), /Review the latest match/)
})

test('only active Platform Admin can list or operate a current match in the explicit club and team scope', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`
  const [club, foreignClub, team, otherTeam, archivedTeam, live, today, oldScheduled, closed, foreign, archived, shootout] =
    Array.from({ length: 12 }, (_, index) => id(index + 1))
  const updatedAt = '2026-11-11T08:00:00Z'
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema app_private;
    grant usage on schema app_private to authenticated;
    create table clubs (id uuid primary key, status text, archived_at timestamptz);
    create table teams (id uuid primary key, club_id uuid, status text, archived_at timestamptz);
    create table match_days (
      id uuid primary key, team_id uuid, club_id uuid, match_date date, opponent text,
      status text, timer_status text, current_match_phase text, match_conclusion_rule text,
      extra_time_period_count integer, home_score integer, away_score integer, home_away text,
      deleted_at timestamptz, previous_hidden_at timestamptz, concluded_at timestamptz, updated_at timestamptz,
      internal_note text default 'Private note'
    );
    create table action_audit (match_id uuid, action text, actor text);
    create function matchday_current_actor_is_platform_admin() returns boolean language sql as
      $$ select current_setting('test.actor', true) = 'active-admin' $$;
    create function match_day_local_date_is_today(uuid) returns boolean language sql as
      $$ select match_date = date '2026-11-12' from public.match_days where id = $1 $$;
    create function match_day_shootout_can_finish(uuid) returns boolean language sql as $$ select true $$;
    create function set_match_day_timer_state(uuid, text) returns jsonb language plpgsql as $$
    begin
      insert into public.action_audit values ($1, $2, current_setting('test.actor', true));
      update public.match_days set status = 'full_time', updated_at = now() where id = $1;
      return jsonb_build_object('action', $2);
    end $$;
    create function start_match_day(uuid) returns jsonb language sql as $$ select public.set_match_day_timer_state($1, 'start') $$;
    create function set_match_day_extended_state(uuid, text) returns jsonb language sql as $$ select public.set_match_day_timer_state($1, $2) $$;
    create function end_match_day_without_shootout_result(uuid) returns jsonb language sql as $$ select public.set_match_day_timer_state($1, 'end_shootout_without_result') $$;
    insert into clubs values ('${club}','active',null), ('${foreignClub}','active',null);
    insert into teams values ('${team}','${club}','active',null), ('${otherTeam}','${foreignClub}','active',null),
      ('${archivedTeam}','${club}','archived',now());
    insert into match_days (
      id,team_id,club_id,match_date,opponent,status,timer_status,current_match_phase,match_conclusion_rule,
      extra_time_period_count,home_score,away_score,home_away,concluded_at,updated_at
    ) values
      ('${live}','${team}','${club}','2026-11-07','Visitors','second_half','running','second_half','normal_time',2,2,0,'home',null,'${updatedAt}'),
      ('${today}','${team}','${club}','2026-11-12','Today','scheduled','not_started','pre_match','normal_time',2,0,0,'home',null,'${updatedAt}'),
      ('${oldScheduled}','${team}','${club}','2026-11-01','Past','scheduled','not_started','pre_match','normal_time',2,0,0,'home',null,'${updatedAt}'),
      ('${closed}','${team}','${club}','2026-11-05','Complete','full_time','full_time','full_time','normal_time',2,0,0,'home',now(),'${updatedAt}'),
      ('${foreign}','${otherTeam}','${foreignClub}','2026-11-12','Other','live','running','first_half','normal_time',2,0,0,'home',null,'${updatedAt}'),
      ('${archived}','${archivedTeam}','${club}','2026-11-12','Archived','live','running','first_half','normal_time',2,0,0,'home',null,'${updatedAt}'),
      ('${shootout}','${team}','${club}','2026-11-08','Cup','penalties','paused','penalties','straight_to_penalties',2,0,0,'home',null,'${updatedAt}');
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261112082608_platform_match_day_support.sql', import.meta.url), 'utf8'))
  const list = (clubId, teamId, offset = 0) => db.query('select platform_list_match_day_support($1, $2, $3) as matches', [clubId, teamId, offset])
  const act = (clubId, teamId, matchId, revision = updatedAt, action = 'full_time') =>
    db.query('select platform_apply_match_day_support_action($1, $2, $3, $4, $5) as result', [clubId, teamId, matchId, revision, action])

  await db.exec("set role authenticated; select set_config('test.actor','revoked-admin',false)")
  await assert.rejects(list(club, team), { code: '42501' })
  await assert.rejects(act(club, team, live), { code: '42501' })
  await db.exec("select set_config('test.actor','active-admin',false)")
  const matches = (await list(club, team)).rows[0].matches
  assert.deepEqual(matches.map((match) => match.id), [live, shootout, today])
  assert.equal(matches[1].shootoutCanFinish, true)
  assert.equal(Object.hasOwn(matches[0], 'internal_note'), false)
  assert.deepEqual((await list(foreignClub, otherTeam)).rows[0].matches.map((match) => match.id), [foreign])
  await assert.rejects(list(club, otherTeam), { code: '42501' })
  await assert.rejects(list(club, archivedTeam), { code: '42501' })
  await assert.rejects(act(club, team, foreign), { code: '42501' })
  await assert.rejects(act(club, archivedTeam, archived), { code: '42501' })
  await assert.rejects(act(club, team, closed), { code: '22023' })
  await assert.rejects(act(club, team, live, null), { code: '40001' })
  await assert.rejects(act(club, team, live, updatedAt, 'change_team'), { code: '22023' })
  assert.equal((await act(club, team, live)).rows[0].result.action, 'full_time')
  await assert.rejects(act(club, team, live), { code: '40001' })
  await db.exec('reset role')
  assert.deepEqual((await db.query('select * from action_audit')).rows, [{ match_id: live, action: 'full_time', actor: 'active-admin' }])
  await db.exec("set role anon; select set_config('test.actor','active-admin',false)")
  await assert.rejects(list(club, team), { code: '42501' })
  await assert.rejects(act(club, team, live), { code: '42501' })
})
