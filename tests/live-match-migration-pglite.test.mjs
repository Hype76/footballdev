import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261103082500_live_match_follows.sql', import.meta.url), 'utf8')

test('live match migration protects followers and queues confirmed match changes', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
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
    const matchId = '22222222-2222-4222-8222-222222222222'
    await db.query('insert into auth.users(id) values ($1)', [userId])
    await db.query("insert into public.match_days(id,team_id,status,home_score,away_score) values ($1,$1,'live',0,0)", [matchId])
    await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)", [userId])
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
    const expired = await db.query('select * from public.get_live_match_follows_for_delivery($1)', [matchId])
    assert.equal(expired.rows.length, 0)
    await db.query('select public.enqueue_live_match_heartbeats()')
    const pruned = await db.query('select count(*)::int as total from private.live_match_follows')
    assert.equal(pruned.rows[0].total, 0)
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
  } finally { await db.close() }
})
