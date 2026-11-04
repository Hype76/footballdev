import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const base = readFileSync(new URL('../supabase/migrations/20261103082500_live_match_follows.sql', import.meta.url), 'utf8')
const remote = readFileSync(new URL('../supabase/migrations/20261104132129_live_activity_remote_start.sql', import.meta.url), 'utf8')
const user = '11111111-1111-4111-8111-111111111111'
const session = '33333333-3333-4333-8333-333333333333'
const match = '22222222-2222-4222-8222-222222222222'
const team = '44444444-4444-4444-8444-444444444444'
const club = '55555555-5555-4555-8555-555555555555'

test('an eligible installed iPhone is prepared at kick-off, updates attach, and stop blocks restart', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id), not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id', current_setting('request.jwt.claim.session_id', true)) $$;
      create table public.parent_player_links(id uuid primary key, auth_user_id uuid, club_id uuid, status text, link_type text);
      create table public.players(id uuid primary key, team_id uuid);
      create table public.fan_connections(id uuid primary key, auth_user_id uuid, parent_link_id uuid, player_id uuid,
        club_id uuid, invited_by uuid, status text, notifications_enabled boolean, permissions jsonb);
      create schema app_private;
      create function app_private.fan_scope_active(uuid,uuid,uuid,uuid) returns boolean language sql stable as $$ select true $$;
      create function app_private.fan_account_active(uuid,uuid) returns boolean language sql stable as $$ select true $$;
      create table public.match_days(id uuid primary key, team_id uuid, club_id uuid, home_away text, status text,
        home_score integer, away_score integer, timer_status text, timer_started_at timestamptz,
        timer_elapsed_seconds integer, current_match_phase text, home_shootout_score integer,
        away_shootout_score integer, concluded_at timestamptz, deleted_at timestamptz,
        previous_hidden_at timestamptz);
      create function public.can_read_match_day(uuid) returns boolean language sql stable as $$ select true $$;
      create function public.current_user_role() returns text language sql stable as $$ select 'coach'::text $$;
      create function public.get_parent_portal_match_days(uuid) returns table(id uuid) language sql stable as $$ select null::uuid where false $$;
    `)
    await db.exec(base)
    await db.exec(remote)
    await db.query('insert into auth.users(id) values ($1)', [user])
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [session, user])
    await db.query("insert into public.match_days(id,team_id,club_id,home_away,status,home_score,away_score) values ($1,$2,$3,'home','scheduled',0,0)", [match, team, club])
    await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.session_id',$2,false), set_config('request.jwt.claim.role','authenticated',false)", [user, session])
    const startToken = 'ab'.repeat(32)
    const registered = await db.query("select public.register_live_activity_start_subscription('coach','team',$1,$2) as ok", [team, startToken])
    assert.equal(registered.rows[0].ok, true)
    await db.query("update public.match_days set status='live',timer_status='running' where id=$1", [match])
    assert.equal((await db.query('select count(*)::int as total from private.live_match_changes')).rows[0].total, 1)
    await db.query("select set_config('request.jwt.claim.role','service_role',false)")
    assert.equal((await db.query('select public.claim_registered_live_match_starts($1) as count', [match])).rows[0].count, 1)
    const follows = await db.query('select * from public.get_live_match_follows_for_delivery($1)', [match])
    assert.equal(follows.rows.length, 1)
    assert.equal(follows.rows[0].start_token, startToken)
    assert.equal(follows.rows[0].activity_token, null)
    assert.equal(follows.rows[0].access_allowed, true)
    const followId = follows.rows[0].follow_id
    assert.equal((await db.query('select public.reserve_live_match_remote_start($1,$2,$3) as ok',
      [followId, startToken, 'ab'.repeat(32)])).rows[0].ok, true)
    assert.equal((await db.query('select public.reserve_live_match_remote_start($1,$2,$3) as ok',
      [followId, startToken, 'ef'.repeat(32)])).rows[0].ok, false)
    assert.equal((await db.query('select public.reject_live_match_remote_start($1,$2,true) as ok',
      [followId, startToken])).rows[0].ok, true)
    assert.equal((await db.query('select public.reserve_live_match_remote_start($1,$2,$3) as ok',
      [followId, startToken, 'ab'.repeat(32)])).rows[0].ok, true)
    assert.equal((await db.query('select remote_start_rejected_at from private.live_match_follows where id=$1',
      [followId])).rows[0].remote_start_rejected_at, null)
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
    await db.query("select public.register_live_activity_start_subscription('coach','team',$1,$2)",
      [team, 'ef'.repeat(32)])
    await db.query("select set_config('request.jwt.claim.role','service_role',false)")
    await db.query('select public.claim_registered_live_match_starts($1)', [match])
    assert.equal((await db.query('select start_token from private.live_match_follows where id=$1',
      [followId])).rows[0].start_token, startToken)
    await db.query('select public.mark_live_match_remote_started($1,$2)', [followId, startToken])
    assert.equal((await db.query('select public.attach_live_match_activity_from_push($1,$2,$3) as ok',
      [followId, 'ef'.repeat(32), 'cd'.repeat(32)])).rows[0].ok, false)
    assert.equal((await db.query('select public.attach_live_match_activity_from_push($1,$2,$3) as ok',
      [followId, 'ab'.repeat(32), 'cd'.repeat(32)])).rows[0].ok, true)
    assert.equal((await db.query('select public.attach_live_match_activity_from_push($1,$2,$3) as ok',
      [followId, 'ab'.repeat(32), 'dd'.repeat(32)])).rows[0].ok, true)
    assert.equal((await db.query('select activity_token from private.live_match_follows where id=$1',
      [followId])).rows[0].activity_token, 'dd'.repeat(32))
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
    assert.equal((await db.query('select public.attach_live_match_activity($1,$2) as ok', [followId, 'cd'.repeat(32)])).rows[0].ok, true)
    assert.equal((await db.query('select public.stop_following_live_match($1) as ok', [followId])).rows[0].ok, true)
    await db.query("select set_config('request.jwt.claim.role','service_role',false)")
    assert.equal((await db.query('select public.claim_registered_live_match_starts($1) as count', [match])).rows[0].count, 0)
    assert.equal((await db.query('select count(*)::int as total from private.live_match_follows')).rows[0].total, 0)
    const player = '77777777-7777-4777-8777-777777777777'
    const fan = '88888888-8888-4888-8888-888888888888'
    await db.query('insert into public.players(id,team_id) values ($1,$2)', [player, team])
    await db.query("insert into public.fan_connections(id,auth_user_id,player_id,club_id,invited_by,status,notifications_enabled,permissions) values ($1,$2,$3,$4,$2,'active',true,$5::jsonb)",
      [fan, user, player, club, JSON.stringify({ game_day: true })])
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
    await db.query("select public.register_live_activity_start_subscription('parent','fan_connection',$1,$2)", [fan, 'ef'.repeat(32)])
    await db.query("select set_config('request.jwt.claim.role','service_role',false)")
    assert.equal((await db.query('select public.claim_registered_live_match_starts($1) as count', [match])).rows[0].count, 1)
    const fanFollow = (await db.query('select * from public.get_live_match_follows_for_delivery($1)', [match])).rows[0]
    assert.equal((await db.query('select fan_connection_id from private.live_match_follows where id=$1', [fanFollow.follow_id])).rows[0].fan_connection_id, fan)
    assert.equal(fanFollow.access_allowed, true)
    await db.query('update public.fan_connections set notifications_enabled=false where id=$1', [fan])
    const revoked = (await db.query('select * from public.get_live_match_follows_for_delivery($1)', [match])).rows[0]
    assert.equal(revoked.access_allowed, false)
    await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
    assert.equal((await db.query('select public.attach_live_match_activity($1,$2) as ok', [fanFollow.follow_id, 'aa'.repeat(32)])).rows[0].ok, false)
  } finally { await db.close() }
})
