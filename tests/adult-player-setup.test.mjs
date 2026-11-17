import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { getAdultPlayerSetupEmail, isAdultPlayerBirthDate } from '../src/lib/adult-player-setup.js'
import { getPlayerParentInviteContacts } from '../src/lib/parent-portal-invite-actions.js'

const sql = await readFile(new URL('../supabase/migrations/20261113114647_adult_player_setup_invites.sql', import.meta.url), 'utf8')
const statusSql = await readFile(new URL('../supabase/migrations/20261116123543_adult_player_link_status.sql', import.meta.url), 'utf8')
const resendSql = await readFile(new URL('../supabase/migrations/20261117100252_v1_adult_player_invitation_resend.sql', import.meta.url), 'utf8')
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
        language sql as 'select $1 = ''${actor}'' and $2 = ''${club}'' and $3 in (''${team}'', ''${newTeam}'') and $4 in (20,50)';
      revoke all on function app_private.actor_can_manage_team_resource(uuid,uuid,uuid,integer) from public;
      insert into public.clubs values ('${club}');
      insert into public.teams values ('${team}','${club}','active'), ('${newTeam}','${club}','active');
      insert into public.players values ('${player}','${club}','${team}','active',null,'self','1996-11-13',
        '[{"type":"self","email":"player@example.test"}]');
      insert into auth.users values ('${account}','player@example.test',now(),null), ('${other}','different@example.test',now(),null);
    `)
    await db.exec(foundation)
    await db.exec(sql)
    await db.exec(statusSql)
    await db.exec(resendSql)
    await db.exec('set role service_role')
    const reserve = async (id = actor) => (await db.query('select public.reserve_adult_player_setup_invite($1,$2) as result', [id, player])).rows[0].result
    const redeem = async (token, id = null) => (await db.query('select public.redeem_adult_player_setup_invite($1,$2) as result', [token, id])).rows[0].result
    const linkStatus = async (id = actor) => (await db.query('select public.get_adult_player_link_status($1,$2) as result', [id, player])).rows[0].result
    const resend = async (expectedTeam = team, id = actor) => (await db.query(
      'select public.reserve_adult_player_setup_resend($1,$2,$3) as result', [id, player, expectedTeam],
    )).rows[0].result
    const targets = async (id = actor, targetTeam = team) => (await db.query(
      'select public.list_adult_player_setup_resend_targets($1,$2) as result', [id, targetTeam],
    )).rows[0].result

    assert.deepEqual(await reserve(other), { state: 'denied' })
    assert.deepEqual(await linkStatus(other), { state: 'denied' })
    assert.deepEqual(await linkStatus(), { state: 'not_invited' })
    assert.deepEqual(await targets(other), { state: 'denied' })
    assert.deepEqual(await targets(actor, newTeam), { state: 'ready', player_ids: [] })
    assert.deepEqual(await targets(), { state: 'ready', player_ids: [player] })
    assert.deepEqual(await resend(newTeam), { state: 'denied' })
    const first = await reserve()
    assert.equal(first.state, 'pending')
    assert.deepEqual(await reserve(), first)
    await db.query('select public.confirm_adult_player_setup_email($1)', [first.token])
    const firstStatus = await linkStatus()
    assert.equal(firstStatus.state, 'awaiting_acceptance')
    assert.equal(firstStatus.invite_digest, createHash('sha256').update(first.token).digest('hex'))
    assert.ok(Number.isFinite(Date.parse(firstStatus.sent_at)))
    assert.deepEqual(await resend(), { state: 'recently_sent' })
    assert.deepEqual(await targets(), { state: 'ready', player_ids: [] })
    await db.exec('reset role')
    await db.query('update app_private.adult_player_setup_invites set expires_at = now() - interval \'1 second\' where player_id = $1', [player])
    await db.exec('set role service_role')
    assert.deepEqual(await linkStatus(), { state: 'expired' })
    await db.exec('reset role')
    await db.query('update app_private.adult_player_setup_invites set expires_at = now() + interval \'1 day\' where player_id = $1', [player])
    await db.exec('set role service_role')
    assert.equal((await reserve()).state, 'sent')
    assert.deepEqual(await redeem(first.token, other), { state: 'wrong_account' })
    await db.exec('reset role')
    await db.query("update app_private.adult_player_setup_invites set sent_at = now() - interval '6 minutes' where player_id = $1", [player])
    await db.exec('set role service_role')
    const resent = await resend()
    assert.equal(resent.state, 'pending')
    assert.notEqual(resent.token, first.token)
    assert.deepEqual(await resend(), resent)
    assert.deepEqual(await redeem(first.token), { state: 'invalid' })

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
    assert.deepEqual(await linkStatus(), { state: 'parent_linked' })
    await db.exec('reset role')
    await db.exec('delete from public.parent_player_links')
    await db.exec('set role service_role')
    assert.deepEqual(await redeem(current.token, account), { state: 'accepted' })
    assert.deepEqual(await linkStatus(), { state: 'linked' })
    assert.deepEqual(await redeem(current.token, account), { state: 'accepted' })
    assert.deepEqual(await reserve(), { state: 'linked' })
    assert.deepEqual(await resend(), { state: 'linked' })
    assert.deepEqual(await targets(), { state: 'ready', player_ids: [] })
    await db.exec('reset role')
    await db.exec('begin')
    await db.query('delete from public.adult_player_account_links where player_id = $1', [player])
    await db.exec('set local role service_role')
    assert.deepEqual(await linkStatus(), { state: 'previous_invite_used' })
    assert.deepEqual(await redeem(current.token, account), { state: 'invalid' })
    await db.exec('rollback')
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
    assert.deepEqual(await linkStatus(), { state: 'ineligible' })
    await db.exec('reset role; set role authenticated')
    await assert.rejects(reserve(), /permission denied/)
    await assert.rejects(linkStatus(), /permission denied/)
    await assert.rejects(resend(), /permission denied/)
    await assert.rejects(targets(), /permission denied/)
    await assert.rejects(redeem(current.token, account), /permission denied/)
    await assert.rejects(db.query('select * from app_private.adult_player_setup_invites'), /permission denied/)
  } finally {
    await db.close()
  }
})

test('status checks staff authority and never sends or exposes invitation details', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://fixture.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only-service-key'
  const { createAdultPlayerSetupHandler } = await import('../netlify/functions/adult-player-setup.js')
  let state = 'linked'
  let digest = 'a'.repeat(64)
  let delivered = 0
  const deliveryKeys = []
  const handler = createAdultPlayerSetupHandler({
    client: {
      from: table => ({ select: () => ({ eq: (_column, key) => {
        if (table === 'email_delivery_jobs') deliveryKeys.push(key)
        return { maybeSingle: async () => ({ data: table === 'email_delivery_jobs' ? (key.endsWith('a'.repeat(64)) ? { provider_status: 'bounced', provider_message_id: 'provider-1' } : key.endsWith('c'.repeat(64)) ? { provider_status: 'failed', provider_message_id: null } : null) : { id: player, club_id: club, team_id: team } }) }
      } }) }),
      rpc: async (name, args) => {
        assert.equal(name, 'get_adult_player_link_status')
        assert.deepEqual(args, { actor_id: actor, target_player_id: player })
        return { data: { state, ...(state === 'awaiting_acceptance' ? { invite_digest: digest } : {}) } }
      },
    },
    getActor: async () => ({ id: actor, email: 'coach@example.test' }),
    getProfile: async () => ({ clubId: club, roleRank: 30, role: 'coach' }),
    assertFeature: () => {},
    deliver: async () => { delivered += 1 },
  })
  const check = () => handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'status', playerId: player }) })
  const result = await check()
  assert.equal(result.statusCode, 200)
  assert.deepEqual(JSON.parse(result.body), { success: true, state: 'linked' })
  state = 'awaiting_acceptance'
  assert.deepEqual(JSON.parse((await check()).body), { success: true, state: 'delivery_failed' })
  assert.deepEqual(deliveryKeys, [`adult_player_setup_invite:player:${player}:${'a'.repeat(64)}`])
  digest = 'b'.repeat(64)
  assert.deepEqual(JSON.parse((await check()).body), { success: true, state: 'delivery_unknown' })
  assert.equal(deliveryKeys[1], `adult_player_setup_invite:player:${player}:${'b'.repeat(64)}`)
  digest = 'c'.repeat(64)
  assert.deepEqual(JSON.parse((await check()).body), { success: true, state: 'delivery_unknown' })
  state = 'denied'
  assert.equal((await check()).statusCode, 403)
  assert.equal(delivered, 0)
})

test('an existing invited account gets a recoverable sign-in response', async () => {
  const { createAdultPlayerSetupHandler } = await import('../netlify/functions/adult-player-setup.js')
  const handler = createAdultPlayerSetupHandler({ client: {
    rpc: async () => ({ data: { state: 'pending', email: 'player@example.test' } }),
    auth: { admin: { createUser: async () => ({ error: { code: 'email_exists' } }) } },
  } })
  const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'create', token: other, email: 'player@example.test', password: 'LongEnough123!' }) })
  assert.equal(result.statusCode, 409)
  assert.equal(JSON.parse(result.body).state, 'account_exists')
})

test('legacy Player delivery is scoped and must match the current invitation time', async () => {
  const { createAdultPlayerSetupHandler } = await import('../netlify/functions/adult-player-setup.js')
  const sentAt = '2026-11-14T21:24:27.291Z'
  let acceptedAt = '2026-11-14T21:24:27.000Z'
  let providerStatus = 'delivered'
  const handler = createAdultPlayerSetupHandler({
    client: {
      from(table) {
        const filters = new Map()
        const query = {
          select() { return query },
          eq(column, value) { filters.set(column, value); return query },
          async maybeSingle() {
            if (table === 'players') return { data: { id: player, club_id: club, team_id: team } }
            if (filters.get('logical_key') !== `adult_player_setup_invite:player:${player}`) return { data: null }
            assert.equal(filters.get('club_id'), club)
            assert.equal(filters.get('team_id'), team)
            return { data: { provider_status: providerStatus, provider_message_id: 'fixture-id', provider_accepted_at: acceptedAt } }
          },
        }
        return query
      },
      rpc: async () => ({ data: { state: 'awaiting_acceptance', invite_digest: 'b'.repeat(64), sent_at: sentAt } }),
    },
    getActor: async () => ({ id: actor, email: 'coach@example.test' }),
    getProfile: async () => ({ clubId: club, roleRank: 30, role: 'coach' }),
    assertFeature: () => {},
    deliver: () => assert.fail('Reading delivery must never send'),
  })
  const check = async (reportDelivered = true) => JSON.parse((await handler({
    httpMethod: 'POST', body: JSON.stringify({ action: 'status', playerId: player, reportDelivered }),
  })).body)
  assert.deepEqual(await check(), { success: true, state: 'delivered' })
  assert.deepEqual(await check(false), { success: true, state: 'awaiting_acceptance' })
  providerStatus = 'bounced'
  assert.deepEqual(await check(), { success: true, state: 'delivery_failed' })
  acceptedAt = '2026-11-14T20:24:27Z'
  assert.deepEqual(await check(), { success: true, state: 'delivery_unknown' })
})

test('staff delivery uses the reserved recipient and repeats the same provider idempotency key after a failure', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://fixture.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only-service-key'
  const { createAdultPlayerSetupHandler } = await import('../netlify/functions/adult-player-setup.js')
  const deliveries = []
  let sent = false
  let state = 'pending'
  let providerStatus = 'delivered'
  const handler = createAdultPlayerSetupHandler({
    client: {
      from: table => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: table === 'email_delivery_jobs' ? { provider_status: providerStatus, provider_message_id: 'provider-1' } : { id: player, club_id: club, team_id: team } }) }),
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
      deliveries.push({ payload, key: options.idempotencyKey, telemetryKey: options.context.deliveryTelemetry.logicalKey })
      if (deliveries.length === 1) throw new Error('temporary failure')
    },
  })
  const send = () => handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'send', playerId: player, email: 'wrong@example.test' }) })
  assert.equal((await send()).statusCode, 503)
  assert.equal(sent, false)
  assert.equal((await send()).statusCode, 200)
  assert.equal(sent, true)
  assert.deepEqual(deliveries[0], deliveries[1])
  assert.equal(deliveries[0].telemetryKey, `adult_player_setup_invite:player:${player}:${createHash('sha256').update(other).digest('hex')}`)
  assert.deepEqual(deliveries[0].payload.to, ['player@example.test'])
  assert.equal(deliveries[0].payload.emailAppRole, 'none')
  assert.equal((await send()).statusCode, 200)
  assert.equal(deliveries.length, 2)
  providerStatus = 'bounced'
  const bounced = await send()
  assert.equal(bounced.statusCode, 409)
  assert.match(JSON.parse(bounced.body).message, /could not be delivered/)
  assert.equal(deliveries.length, 2)
  providerStatus = 'suppressed'
  assert.equal((await send()).statusCode, 409)
  assert.equal(deliveries.length, 2)
  sent = false
  state = 'denied'
  assert.equal((await send()).statusCode, 403)
  assert.equal(deliveries.length, 2)
})

test('team resend preview sends nothing, and resends recheck team scope and linked status', async () => {
  const { createAdultPlayerSetupHandler } = await import('../netlify/functions/adult-player-setup.js')
  let rank = 70
  let state = 'pending'
  const calls = []
  const deliveries = []
  const handler = createAdultPlayerSetupHandler({
    client: {
      from: table => ({ select: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: table === 'teams'
          ? { id: team, club_id: club } : { id: player, club_id: club, team_id: team } }),
      }) }) }),
      rpc: async (name, args) => {
        calls.push({ name, args })
        if (name === 'list_adult_player_setup_resend_targets') return { data: { state: 'ready', player_ids: [player] } }
        if (name === 'reserve_adult_player_setup_resend') return { data: { state, email: 'player@example.test', token: other } }
        return {}
      },
    },
    getActor: async () => ({ id: actor, email: 'coach@example.test' }),
    getProfile: async () => ({ clubId: club, roleRank: rank, role: 'head_manager' }),
    assertFeature: () => {},
    deliver: async (payload) => { deliveries.push(payload.to) },
  })
  const request = async (body) => handler({ httpMethod: 'POST', body: JSON.stringify(body) })
  const preview = () => request({ action: 'team-resend-preview', teamId: team })
  const resend = teamId => request({ action: 'resend', playerId: player, teamId, email: 'wrong@example.test' })
  rank = 30
  assert.equal((await preview()).statusCode, 403)
  rank = 70
  assert.deepEqual(JSON.parse((await preview()).body), { success: true, playerIds: [player] })
  assert.equal((await resend(newTeam)).statusCode, 403)
  assert.equal(calls.length, 1)
  assert.deepEqual(deliveries, [])
  assert.equal((await resend(team)).statusCode, 200)
  assert.equal(calls[1].args.expected_team_id, team)
  assert.deepEqual(deliveries, [['player@example.test']])
  state = 'linked'
  assert.deepEqual(JSON.parse((await resend(team)).body), { success: true, state: 'linked' })
  assert.equal(deliveries.length, 1)
})
