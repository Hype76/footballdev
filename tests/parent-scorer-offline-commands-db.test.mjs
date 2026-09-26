import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260926114556_parent_scorer_offline_commands.sql', import.meta.url), 'utf8')

test('Parent scorer commands save captured time, replay once, and enforce actor and sequence', async () => {
  const db = new PGlite()
  const actor = randomUUID(), other = randomUUID(), link = randomUUID(), match = randomUUID()
  const now = Date.now()
  const captured = new Date(now - 10 * 60000).toISOString()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.match_days(
        id uuid primary key, club_id uuid, team_id uuid, deleted_at timestamptz, previous_hidden_at timestamptz,
        status text default 'scheduled', concluded_at timestamptz, timer_started_at timestamptz,
        phase_started_at timestamptz, timer_paused_at timestamptz, timer_status text default 'not_started',
        current_match_phase text default 'pre_match', home_score integer default 0, away_score integer default 0,
        updated_at timestamptz default now()
      );
      create table public.match_day_role_assignments(match_day_id uuid, role text, parent_link_id uuid, auth_user_id uuid);
      create table public.match_day_shootout_kicks(match_day_id uuid, created_at timestamptz);
      create function public.current_user_has_match_day_scorer_assignment(target uuid) returns boolean language sql
        as $$select exists(select 1 from public.match_day_role_assignments where match_day_id=target and auth_user_id=auth.uid())$$;
      create function public.start_match_day(target uuid) returns jsonb language plpgsql as $$
      begin update public.match_days set status='live',timer_status='running',current_match_phase='first_half',
        timer_started_at=now(),phase_started_at=now(),updated_at=clock_timestamp() where id=target;
        return '{}'::jsonb; end; $$;
      create function public.record_match_day_goal_v3(uuid,uuid,text,text,text,text,text,integer,text,boolean,uuid,boolean,integer)
        returns jsonb language plpgsql as $$
      begin update public.match_days set home_score=home_score+1,updated_at=clock_timestamp() where id=$1;
        return jsonb_build_object('id',gen_random_uuid(),'event_type','goal'); end; $$;
      create function public.correct_match_day_goal_v2(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,boolean,integer)
        returns jsonb language plpgsql as $$
      begin update public.match_days set updated_at=clock_timestamp() where id=$1;
        return jsonb_build_object('id',$2,'event_type','goal'); end; $$;
    `)
    await db.exec(migration)
    await db.query('insert into auth.users(id) values($1),($2)', [actor, other])
    await db.query('insert into public.match_days(id,updated_at) values($1,$2)', [match, new Date(now - 11 * 60000).toISOString()])
    await db.query('insert into public.match_day_role_assignments values($1,$2,$3,$4)', [match, 'scorer', link, actor])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
    const version = (await db.query('select updated_at from public.match_days where id=$1', [match])).rows[0].updated_at
    const startId = randomUUID()
    const call = (id, kind, payload, previous = null, expected = version, time = captured) => db.query(
      'select public.apply_parent_match_day_command($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [id, match, link, kind, JSON.stringify(payload), time, expected, previous])
    const started = (await call(startId, 'start', {})).rows[0].result
    assert.equal(started.match.status, 'live')
    assert.equal(Date.parse(started.match.timer_started_at), Date.parse(captured))
    assert.deepEqual((await call(startId, 'start', {})).rows[0].result, started)
    await assert.rejects(call(startId, 'start', { changed: true }), /identifier/)
    const goalId = randomUUID()
    const goal = (await call(goalId, 'goal', { teamSide: 'club', scorerName: 'FP TEST', minute: 1 }, startId, null)).rows[0].result
    assert.equal(goal.match.home_score, 1)
    assert.notEqual(goal.savedEvent.id, goalId)
    assert.deepEqual((await call(goalId, 'goal', { teamSide: 'club', scorerName: 'FP TEST', minute: 1 }, startId, null)).rows[0].result, goal)
    assert.equal((await db.query('select home_score from public.match_days where id=$1', [match])).rows[0].home_score, 1)
    const correction = (await call(randomUUID(), 'correct-goal', { eventId: goalId, goal: { teamSide: 'club', scorerName: 'FP TEST', minute: 1 } }, goalId, null)).rows[0].result
    assert.equal(correction.savedEvent.id, goal.savedEvent.id)
    await assert.rejects(call(randomUUID(), 'goal', { teamSide: 'club', scorerName: 'FP TEST', minute: 2 }, null, version), error => error.code === '40001')
    await assert.rejects(call(randomUUID(), 'goal', { teamSide: 'club', scorerName: 'FP TEST', minute: 2 }, goalId, null, new Date(now - 25 * 3600000).toISOString()), /over 24 hours/)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other])
    await assert.rejects(call(randomUUID(), 'goal', { teamSide: 'club', scorerName: 'FP TEST', minute: 2 }, goalId, null), /Parent scorer access/)
    await assert.rejects(call(goalId, 'goal', { teamSide: 'club', scorerName: 'FP TEST', minute: 1 }, startId, null), /identifier/)
    const grants = (await db.query(`select has_function_privilege('anon','public.apply_parent_match_day_command(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid)','execute') as anon,
      has_function_privilege('authenticated','public.claim_parent_scorer_command_notifications(uuid,uuid)','execute') as claim`)).rows[0]
    assert.deepEqual(grants, { anon: false, claim: false })
    const pending = (await db.query('select public.claim_parent_scorer_command_notifications() as result')).rows[0].result
    assert.equal(pending.length, 2)
    assert.deepEqual((await db.query('select public.claim_parent_scorer_command_notifications() as result')).rows[0].result, [])
  } finally { await db.close() }
})
