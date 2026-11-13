import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261103082500_live_match_follows.sql', import.meta.url), 'utf8')
const queueMigration = readFileSync(new URL('../supabase/migrations/20261113085415_prioritise_current_live_match_updates.sql', import.meta.url), 'utf8')
  .split('-- A Club Admin acts')[0]

test('live match migration protects followers and queues confirmed match changes', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id), not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id', current_setting('request.jwt.claim.session_id', true)) $$;
      create table public.parent_player_links(id uuid primary key);
      create table public.match_days(
        id uuid primary key, team_id uuid, status text, home_score integer, away_score integer,
        timer_status text, timer_started_at timestamptz, timer_elapsed_seconds integer,
        current_match_phase text, home_shootout_score integer, away_shootout_score integer,
        concluded_at timestamptz, deleted_at timestamptz, previous_hidden_at timestamptz
      );
      create function public.can_read_match_day(uuid) returns boolean language sql stable as $$ select true $$;
      create function public.current_user_role() returns text language sql stable as $$ select 'coach'::text $$;
      create function public.get_parent_portal_match_days(uuid) returns table(id uuid) language sql stable as $$ select null::uuid where false $$;
    `)
    await db.exec(migration)
    const userId = '11111111-1111-4111-8111-111111111111'
    const sessionId = '33333333-3333-4333-8333-333333333333'
    const matchId = '22222222-2222-4222-8222-222222222222'
    await db.query('insert into auth.users(id) values ($1)', [userId])
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [sessionId, userId])
    await db.query("insert into public.match_days(id,team_id,status,home_score,away_score) values ($1,$1,'live',0,0)", [matchId])
    await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)", [userId])
    await db.query("select set_config('request.jwt.claim.session_id',$1,false)", [sessionId])
    const token = 'ab'.repeat(32)
    const followed = await db.query("select public.follow_live_match($1,'coach','ios',$2)", [matchId, token])
    assert.ok(followed.rows[0].follow_live_match)
    await assert.rejects(db.query("select public.follow_live_match($1,'parent','ios',$2)", [matchId, token]), /Match access is required/)
    await db.query("update public.match_days set home_score=1 where id=$1", [matchId])
    const queued = await db.query('select count(*)::int as total from private.live_match_changes')
    assert.equal(queued.rows[0].total, 1)
    await db.query("select set_config('request.jwt.claim.role','service_role',false)")
    const delivery = await db.query('select * from public.get_live_match_follows_for_delivery($1)', [matchId])
    assert.equal(delivery.rows.length, 1)
    assert.equal(delivery.rows[0].access_allowed, true)
    const active = await db.query('select public.is_live_match_follow_active($1) as active', [followed.rows[0].follow_live_match])
    assert.equal(active.rows[0].active, true)
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
    const stopped = await db.query('select public.stop_following_live_match($1) as stopped', [followed.rows[0].follow_live_match])
    assert.equal(stopped.rows[0].stopped, true)
    await db.query("select set_config('request.jwt.claim.role','service_role',false)")
    const afterSignOut = await db.query('select * from public.get_live_match_follows_for_delivery($1)', [matchId])
    assert.equal(afterSignOut.rows.length, 0)
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
    await db.query("select public.follow_live_match($1,'coach','ios',$2)", [matchId, token])
    await db.query("update private.live_match_follows set updated_at = now() - interval '4 hours'")
    await db.query("select set_config('request.jwt.claim.role','service_role',false)")
    const delayedMatch = await db.query('select * from public.get_live_match_follows_for_delivery($1)', [matchId])
    assert.equal(delayedMatch.rows.length, 1)
    await db.query('delete from auth.sessions where id=$1', [sessionId])
    const signedOut = await db.query('select * from public.get_live_match_follows_for_delivery($1)', [matchId])
    assert.equal(signedOut.rows.length, 0)
    const claim = await db.query('select * from public.claim_live_match_changes(2)')
    assert.equal(claim.rows.length, 1)
    await db.query('select public.complete_live_match_change($1,false)', [claim.rows[0].change_id])
    const retry = await db.query('select attempts, completed_at, next_attempt_at > now() as delayed from private.live_match_changes where id=$1', [claim.rows[0].change_id])
    assert.deepEqual(retry.rows[0], { attempts: 1, completed_at: null, delayed: true })
    const premature = await db.query('select * from public.claim_live_match_changes(2)')
    assert.equal(premature.rows.length, 0)
    await db.query('select public.complete_live_match_change($1,true)', [claim.rows[0].change_id])
    const second = await db.query('select * from public.claim_live_match_changes(2)')
    assert.equal(second.rows.length, 0)

    await db.exec(`
      create table public.fan_connections(id uuid primary key);
      alter table private.live_match_follows alter column activity_token drop not null,
        add column start_token text, add column fan_connection_id uuid;
    `)
    await db.exec(queueMigration)
    const oldMatchId = '44444444-4444-4444-8444-444444444444'
    await db.query("insert into public.match_days(id,team_id,status,concluded_at) values ($1,$1,'full_time',now() - interval '9 hours')", [oldMatchId])
    const oldChange = await db.query("insert into private.live_match_changes(match_day_id,changed_at) values ($1,now() - interval '9 hours') returning id", [oldMatchId])
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [sessionId, userId])
    const remoteFollowId = '55555555-5555-4555-8555-555555555555'
    await db.query(`
      insert into private.live_match_follows(id,user_id,session_id,match_day_id,app_role,platform,start_token)
      values ($1,$2,$3,$4,'coach','ios',$5)
    `, [remoteFollowId, userId, sessionId, matchId, token])
    await db.query("update public.match_days set home_score=2 where id=$1", [matchId])
    await db.query("update public.match_days set status='full_time', concluded_at=now() where id=$1", [matchId])
    const finalChange = await db.query('select max(id) as id from private.live_match_changes')
    const current = await db.query('select * from public.claim_live_match_changes(20)')
    assert.deepEqual(current.rows, [{ change_id: finalChange.rows[0].id, match_day_id: matchId }])
    assert.equal((await db.query('select * from public.claim_live_match_changes(20)')).rows.length, 0)
    await db.query('select public.complete_live_match_change($1,false)', [current.rows[0].change_id])
    assert.equal((await db.query('select * from public.claim_live_match_changes(20)')).rows.length, 0)
    await db.query('update private.live_match_changes set next_attempt_at=now() where id=$1', [current.rows[0].change_id])
    assert.deepEqual((await db.query('select * from public.claim_live_match_changes(20)')).rows, current.rows)
    await db.query('select public.complete_live_match_change($1,true)', [current.rows[0].change_id])
    const pending = await db.query('select id from private.live_match_changes where completed_at is null')
    assert.deepEqual(pending.rows, oldChange.rows)

    const attach = () => db.query('select public.attach_live_match_activity($1,$2) as attached', [remoteFollowId, 'cd'.repeat(32)])
    await db.query("select set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub',$1,false)", [oldMatchId])
    assert.equal((await attach()).rows[0].attached, false)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId])
    assert.equal((await attach()).rows[0].attached, true)
    assert.equal((await attach()).rows[0].attached, true)
    await db.query("select set_config('request.jwt.claim.role','service_role',false)")
    const handoff = await db.query('select * from public.claim_live_match_changes(20)')
    assert.deepEqual(handoff.rows.map(row => row.match_day_id), [matchId])
    const handoffCount = await db.query('select count(*)::int as total from private.live_match_changes where id > $1', [finalChange.rows[0].id])
    assert.equal(handoffCount.rows[0].total, 1)
  } finally { await db.close() }
})
