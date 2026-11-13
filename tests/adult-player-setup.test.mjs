import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { getAdultPlayerSetupEmail, isAdultPlayerBirthDate } from '../src/lib/adult-player-setup.js'
import { getPlayerParentInviteContacts } from '../src/lib/parent-portal-invite-actions.js'

const sql = await readFile(new URL('../supabase/migrations/20261113114647_adult_player_setup_invites.sql', import.meta.url), 'utf8')
const foundation = (await readFile(new URL('../supabase/migrations/20260730110000_adult_player_account_foundation.sql', import.meta.url), 'utf8')).split('create or replace function public.get_own_adult_player_account_state')[0]
const actor = '00000000-0000-4000-8000-000000000001'
const player = '00000000-0000-4000-8000-000000000002'
const club = '00000000-0000-4000-8000-000000000003'
const team = '00000000-0000-4000-8000-000000000004'
const account = '00000000-0000-4000-8000-000000000005'
const other = '00000000-0000-4000-8000-000000000006'
const newTeam = '00000000-0000-4000-8000-000000000007'

test('adult setup validates the birthday and routes player and parent contacts independently', () => {
  const self = { type: 'self', email: ' Player@Example.Test ' }
  const parent = { type: 'parent', email: 'parent@example.test' }
  assert.equal(getAdultPlayerSetupEmail({ contactType: 'self', parentContacts: [self, parent] }), 'player@example.test')
  assert.equal(getAdultPlayerSetupEmail({ contactType: 'self', parentContacts: [parent] }), '')
  assert.deepEqual(getPlayerParentInviteContacts({ contactType: 'self', parentContacts: [parent] }), [])
  assert.deepEqual(getPlayerParentInviteContacts({ contactType: 'both', parentContacts: [self, parent, parent] }), [parent])
  const now = new Date(2026, 10, 13)
  assert.equal(isAdultPlayerBirthDate('2008-11-13', now), true)
  assert.equal(isAdultPlayerBirthDate('2008-11-14', now), false)
  assert.equal(isAdultPlayerBirthDate('2008-02-30', now), false)
})

test('adult invitation is private, scoped, invalidates changed emails and only links a verified matching account', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema auth;
      create schema app_private;
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      grant usage on schema app_private to service_role;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table public.clubs(id uuid primary key, status text default 'active', archived_at timestamptz);
      create table public.teams(id uuid primary key, club_id uuid, status text);
      create table public.players(id uuid primary key, club_id uuid, team_id uuid, status text, archived_at timestamptz,
        contact_type text, date_of_birth date, parent_contacts jsonb);
      create table public.users(id uuid primary key);
      create table public.user_club_memberships(auth_user_id uuid);
      create table public.parent_player_links(auth_user_id uuid, player_id uuid, status text);
      create function app_private.actor_can_manage_team_resource(uuid,uuid,uuid,integer) returns boolean
        language sql as 'select $1 = ''${actor}'' and $2 = ''${club}'' and $3 in (''${team}'', ''${newTeam}'') and $4 = 20';
      revoke all on function app_private.actor_can_manage_team_resource(uuid,uuid,uuid,integer) from public;
      insert into public.clubs values ('${club}');
      insert into public.teams values ('${team}','${club}','active'), ('${newTeam}','${club}','active');
      insert into public.players values ('${player}','${club}','${team}','active',null,'self','1996-11-13',
        '[{"type":"self","email":"player@example.test"}]');
      insert into auth.users values ('${account}','player@example.test',now(),null), ('${other}','different@example.test',now(),null);
    `)
    await db.exec(foundation)
    await db.exec(sql)
    await db.exec('set role service_role')
    const reserve = async (id = actor) => (await db.query('select public.reserve_adult_player_setup_invite($1,$2) as result', [id, player])).rows[0].result
    const redeem = async (token, id = null) => (await db.query('select public.redeem_adult_player_setup_invite($1,$2) as result', [token, id])).rows[0].result

    assert.deepEqual(await reserve(other), { state: 'denied' })
    const first = await reserve()
    assert.equal(first.state, 'pending')
    assert.deepEqual(await reserve(), first)
    await db.query('select public.confirm_adult_player_setup_email($1)', [first.token])
    assert.equal((await reserve()).state, 'sent')
    assert.deepEqual(await redeem(first.token, other), { state: 'wrong_account' })

    await db.exec('reset role')
    await db.query(`update public.players set parent_contacts = '[{"type":"self","email":"new@example.test"}]' where id = $1`, [player])
    await db.exec('set role service_role')
    assert.deepEqual(await redeem(first.token), { state: 'invalid' })
    await db.exec('reset role')
    await db.query(`update public.players set parent_contacts = '[{"type":"self","email":"player@example.test"}]' where id = $1`, [player])
    await db.exec('set role service_role')
    const current = await reserve()
    assert.notEqual(current.token, first.token)
    await db.exec('reset role')
    await db.query(`insert into public.parent_player_links values ($1,$2,'active')`, [other, player])
    await db.exec('set role service_role')
    assert.deepEqual(await redeem(current.token, account), { state: 'parent_linked' })
    await db.exec('reset role')
    await db.exec('delete from public.parent_player_links')
    await db.exec('set role service_role')
    assert.deepEqual(await redeem(current.token, account), { state: 'accepted' })
    assert.deepEqual(await redeem(current.token, account), { state: 'accepted' })
    assert.deepEqual(await reserve(), { state: 'linked' })
    await db.exec('reset role')
    await db.query(`update public.players set parent_contacts = '[{"type":"self","email":"different@example.test"}]' where id = $1`, [player])
    assert.equal((await db.query('select status from public.adult_player_account_links where user_id = $1', [account])).rows[0].status, 'revoked')
    await db.exec('set role service_role')
    assert.deepEqual(await redeem(current.token, account), { state: 'invalid' })
    const replacement = await reserve()
    assert.equal(replacement.email, 'different@example.test')
    assert.deepEqual(await redeem(replacement.token, other), { state: 'accepted' })
    await db.exec('reset role')
    await db.query('update public.players set team_id = $1 where id = $2', [newTeam, player])
    assert.equal((await db.query('select status from public.adult_player_account_links where user_id = $1', [other])).rows[0].status, 'revoked')
    await db.exec('set role service_role')
    assert.deepEqual(await redeem(replacement.token, other), { state: 'invalid' })
    const moved = await reserve()
    assert.deepEqual(await redeem(moved.token, other), { state: 'accepted' })
    await db.exec('reset role')
    await db.query('update public.players set date_of_birth = null where id = $1', [player])
    assert.equal((await db.query("select count(*)::int as count from public.adult_player_account_links where status = 'active'")).rows[0].count, 0)
    await db.exec('set role service_role')
    assert.deepEqual(await reserve(), { state: 'ineligible' })
    await db.exec('reset role; set role authenticated')
    await assert.rejects(reserve(), /permission denied/)
    await assert.rejects(redeem(current.token, account), /permission denied/)
    await assert.rejects(db.query('select * from app_private.adult_player_setup_invites'), /permission denied/)
  } finally {
    await db.close()
  }
})

test('staff delivery uses the reserved recipient and repeats the same provider idempotency key after a failure', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://fixture.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only-service-key'
  const { createAdultPlayerSetupHandler } = await import('../netlify/functions/adult-player-setup.js')
  const deliveries = []
  let sent = false
  let state = 'pending'
  const handler = createAdultPlayerSetupHandler({
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: player, club_id: club, team_id: team } }) }),
        }),
      }),
      rpc: async (name) => {
        if (name === 'confirm_adult_player_setup_email') {
          sent = true
          return {}
        }
        return { data: { state: sent ? 'sent' : state, email: 'player@example.test', token: other } }
      },
    },
    getActor: async () => ({ id: actor, email: 'coach@example.test' }),
    getProfile: async () => ({ clubId: club, roleRank: 30, role: 'coach' }),
    assertFeature: (_profile, feature) => assert.equal(feature, 'players'),
    deliver: async (payload, options) => {
      deliveries.push({ payload, key: options.idempotencyKey })
      if (deliveries.length === 1) throw new Error('temporary failure')
    },
  })
  const send = () => handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'send', playerId: player, email: 'wrong@example.test' }) })
  assert.equal((await send()).statusCode, 503)
  assert.equal(sent, false)
  assert.equal((await send()).statusCode, 200)
  assert.equal(sent, true)
  assert.deepEqual(deliveries[0], deliveries[1])
  assert.deepEqual(deliveries[0].payload.to, ['player@example.test'])
  assert.equal(deliveries[0].payload.emailAppRole, 'none')
  assert.equal((await send()).statusCode, 200)
  assert.equal(deliveries.length, 2)
  sent = false
  state = 'denied'
  assert.equal((await send()).statusCode, 403)
  assert.equal(deliveries.length, 2)
})
