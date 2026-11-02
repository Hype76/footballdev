import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('session cancellation RPC only returns invited sessions for the active authenticated parent link', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function public.current_user_can_access_parent_link(uuid, uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.user_status', true), 'active') = 'active' and coalesce(current_setting('test.player_status', true), 'active') <> 'archived' and coalesce(current_setting('test.plan_enabled', true), 'true') = 'true' $$;
      create table parent_player_links (id uuid, auth_user_id uuid, status text, club_id uuid, player_id uuid);
      create table calendar_event_invites (parent_link_id uuid, player_id uuid, club_id uuid, team_id uuid, invite_status text, assessment_session_id uuid);
      create table assessment_sessions (id uuid, club_id uuid, team_id uuid, title text, session_type text, session_date date, arrival_time time, start_time time, end_time time, location text, notes text, team text, status text, updated_at timestamptz);
    `)
    await db.exec((await readFile(new URL('../supabase/migrations/20261102083200_event_cancellation_reasons.sql', import.meta.url), 'utf8')).split('-- section: session')[1].split('-- section: match')[0])
    const link = '00000000-0000-0000-0000-000000000001'
    const user = '00000000-0000-0000-0000-000000000002'
    const club = '00000000-0000-0000-0000-000000000003'
    const player = '00000000-0000-0000-0000-000000000004'
    const team = '00000000-0000-0000-0000-000000000005'
    const session = '00000000-0000-0000-0000-000000000006'
    await db.query('insert into parent_player_links values ($1,$2,\'active\',$3,$4)', [link, user, club, player])
    await db.query("insert into assessment_sessions (id,club_id,team_id,title,session_type,session_date,status,cancellation_reason) values ($1,$2,$3,'Training','training','2026-11-03','cancelled','Pitch closed')", [session, club, team])
    await db.query("insert into calendar_event_invites values ($1,$2,$3,$4,'active',$5)", [link, player, club, team, session])
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
    const query = () => db.query('select * from get_parent_portal_invited_sessions($1)', [link])
    assert.equal((await query()).rows[0].cancellation_reason, 'Pitch closed')
    for (const [key, denied, allowed] of [['test.user_status', 'suspended', 'active'], ['test.player_status', 'archived', 'active'], ['test.plan_enabled', 'false', 'true']]) {
      await db.query("select set_config($1, $2, false)", [key, denied])
      assert.equal((await query()).rows.length, 0, denied)
      await db.query("select set_config($1, $2, false)", [key, allowed])
    }
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", ['00000000-0000-0000-0000-000000000099'])
    assert.equal((await query()).rows.length, 0)
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
    await db.exec("update calendar_event_invites set invite_status = 'cancelled'")
    assert.equal((await query()).rows.length, 0)
    await db.exec("update calendar_event_invites set invite_status = 'active'; update parent_player_links set status = 'revoked'")
    assert.equal((await query()).rows.length, 0)
    await db.exec("update parent_player_links set status = 'active'; update calendar_event_invites set team_id = '00000000-0000-0000-0000-000000000098'")
    assert.equal((await query()).rows.length, 0)
  } finally { await db.close() }
})
