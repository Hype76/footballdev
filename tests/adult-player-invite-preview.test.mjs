import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { buildAdultPlayerInviteEmail } from '../netlify/functions/lib/_adult-player-invite-email.js'

const migration = await readFile('supabase/migrations/20261118100920_adult_player_invite_preview.sql', 'utf8')
const token = '00000000-0000-4000-8000-000000000001'
test('preview is service only, scoped to the exact token, read only and follows redemption validity', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create schema app_private; create role anon; create role authenticated; create role service_role;
      create table public.clubs(id uuid primary key,name text); create table public.teams(id uuid primary key,club_id uuid,name text);
      create table public.players(id uuid primary key,club_id uuid,team_id uuid,email text);
      create table app_private.adult_player_setup_invites(token uuid,player_id uuid,team_id uuid,email text,expires_at timestamptz,accepted_at timestamptz);
      create function app_private.adult_player_setup_email(p public.players) returns text language sql as 'select p.email';
      insert into clubs values ('00000000-0000-4000-8000-000000000002','Club');
      insert into teams values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','Team');
      insert into players values ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','secret@example.test');
      insert into app_private.adult_player_setup_invites values ('${token}','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','secret@example.test',now()+interval '1 day',null);`)
    await db.exec(migration)
    const preview = async () => (await db.query('select public.preview_adult_player_setup_invite($1) as value', [token])).rows[0].value
    const before = (await db.query('select * from app_private.adult_player_setup_invites')).rows
    const pending = await preview()
    assert.equal(pending.state, 'pending'); assert.equal(pending.clubName, 'Club'); assert.equal(pending.teamName, 'Team')
    assert.equal(JSON.stringify(pending).includes('secret@example.test'), false)
    assert.deepEqual((await db.query('select * from app_private.adult_player_setup_invites')).rows, before)
    assert.equal((await db.query("select has_function_privilege('anon','public.preview_adult_player_setup_invite(uuid)','execute') as allowed")).rows[0].allowed, false)
    assert.equal((await db.query("select has_function_privilege('authenticated','public.preview_adult_player_setup_invite(uuid)','execute') as allowed")).rows[0].allowed, false)
    assert.equal((await db.query("select has_function_privilege('service_role','public.preview_adult_player_setup_invite(uuid)','execute') as allowed")).rows[0].allowed, true)
    assert.equal((await db.query("select public.preview_adult_player_setup_invite('00000000-0000-4000-8000-000000000099') as value")).rows[0].value.state, 'invalid')
    await db.exec("update app_private.adult_player_setup_invites set team_id='00000000-0000-4000-8000-000000000099'")
    assert.equal((await preview()).state, 'invalid')
    await db.exec("update app_private.adult_player_setup_invites set team_id='00000000-0000-4000-8000-000000000003'")
    await db.exec("update app_private.adult_player_setup_invites set expires_at=now()-interval '1 day'")
    assert.equal((await preview()).state, 'invalid')
    await db.exec('update app_private.adult_player_setup_invites set accepted_at=now()')
    assert.equal((await preview()).state, 'accepted')
    await db.exec("update public.players set email='changed@example.test'")
    assert.equal((await preview()).state, 'invalid')
  } finally { await db.close() }
})

test('adult invitation email escapes names and contains a copyable link and accessible action', () => {
  const email = buildAdultPlayerInviteEmail({ clubName: 'Club <script>', teamName: 'Team & Co', logoUrl: '', link: `https://footballplayer.online/player-invite#invite=${token}` })
  assert.match(email.html, /Club &lt;script&gt;/); assert.match(email.html, /Team &amp; Co/)
  assert.match(email.html, /Set up Player access/); assert.match(email.html, /copy and paste/)
  assert.ok(email.text.includes(token))
})

test('public preview returns only approved display fields', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://fixture.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only-service-key'
  const { createAdultPlayerSetupHandler } = await import('../netlify/functions/adult-player-setup.js')
  let state = 'pending'
  const handler = createAdultPlayerSetupHandler({ client: { rpc: async () => ({ data: { state, clubId: 'club', teamId: 'team', clubName: 'Club', teamName: 'Team', email: 'private@example.test' } }) },
    loadBranding: async () => ({ logoUrl: 'https://example.test/logo.png' }) })
  const request = () => handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'preview', token }) })
  assert.deepEqual(JSON.parse((await request()).body), { success: true, state: 'pending', clubName: 'Club', teamName: 'Team', logoUrl: 'https://example.test/logo.png', accent: '' })
  state = 'accepted'; assert.equal(JSON.parse((await request()).body).state, 'accepted')
  state = 'invalid'; assert.equal((await request()).statusCode, 410)
})
