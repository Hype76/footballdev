import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

process.env.VITE_SUPABASE_URL = 'https://signup-deletion.example.test'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'fixture-public-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-key'
process.env.VITE_PAYMENTS_DISABLED = 'false'

const { supabaseAdmin } = await import('../netlify/functions/lib/_supabase.js')
const { handler } = await import('../netlify/functions/ensure-signup-club-profile.js')
const actor = { id: '10000000-0000-4000-8000-000000000001', email: 'deleted@example.test', email_confirmed_at: '2026-10-01T00:00:00Z',
  user_metadata: { club_name: 'Deleted Fixture', signup_plan_key: 'matchday', account_type: 'coach' } }

async function invoke({ revoked = true, lookupError = null, body = {}, membership = null, invite = null, paymentsDisabled = false } = {}) {
  const original = { from: supabaseAdmin.from, rpc: supabaseAdmin.rpc, getUser: supabaseAdmin.auth.getUser, payments: process.env.VITE_PAYMENTS_DISABLED }
  const writes = [], rpcs = []
  const club = { id: '20000000-0000-4000-8000-000000000001', name: 'Fresh Fixture', plan_key: 'matchday', status: 'active' }
  let profile = null
  supabaseAdmin.auth.getUser = async () => ({ data: { user: actor }, error: null })
  supabaseAdmin.rpc = async (name, payload) => {
    rpcs.push({ name, payload })
    return name === 'has_deleted_workspace_access' ? { data: revoked, error: lookupError } : { data: 5, error: null }
  }
  supabaseAdmin.from = table => {
    let action = 'select', payload
    const query = {
      select: () => query, eq: () => query, or: () => query, order: () => query,
      limit: () => query, is: () => query, ilike: () => query, in: () => query,
      insert: value => { action = 'insert'; payload = value; return query },
      update: value => { action = 'update'; payload = value; return query },
      upsert: value => { action = 'upsert'; payload = value; return query },
      single: () => query, maybeSingle: () => query,
      then(resolve, reject) {
        try {
          if (action !== 'select') writes.push({ table, action, payload })
          let data = null
          if (table === 'users') {
            if (action === 'upsert') profile = { ...payload }
            data = profile
          } else if (table === 'clubs') data = action === 'insert' ? { ...club, ...payload } : club
          else if (table === 'user_club_memberships') data = action === 'upsert' ? { ...payload, id: 'joined-membership', clubs: invite?.clubs } : membership
          else if (table === 'club_user_invites') data = invite
          else if (table === 'teams') data = action === 'insert' ? { ...payload, id: 'team-fixture' } : []
          resolve({ data, error: null })
        } catch (error) { reject(error) }
      },
    }
    return query
  }
  process.env.VITE_PAYMENTS_DISABLED = String(paymentsDisabled)
  try {
    const response = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer fixture-token' }, body: JSON.stringify(body) })
    return { response, result: JSON.parse(response.body), writes, rpcs }
  } finally {
    supabaseAdmin.from = original.from
    supabaseAdmin.rpc = original.rpc
    supabaseAdmin.auth.getUser = original.getUser
    process.env.VITE_PAYMENTS_DISABLED = original.payments
  }
}

test('deleted workspace cannot be recreated from old signup metadata or forced test signup', async () => {
  for (const options of [{}, { paymentsDisabled: true, body: { signupIntent: true, forceNewClub: true, clubName: 'Replacement', planKey: 'matchday' } }]) {
    const { response, result, writes } = await invoke(options)
    assert.equal(response.statusCode, 403)
    assert.equal(result.code, 'workspace_access_removed')
    assert.equal(writes.length, 0, 'revocation must be checked before any club, profile, team or billing write')
  }
})

test('revocation lookup errors fail closed before any provisioning writes', async () => {
  const { response, writes } = await invoke({ lookupError: new Error('Revocation lookup unavailable') })
  assert.equal(response.statusCode, 500)
  assert.equal(writes.length, 0)
  const invalidResponse = await invoke({ revoked: null })
  assert.equal(invalidResponse.response.statusCode, 403)
  assert.equal(invalidResponse.writes.length, 0)
})

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema app_private;
    grant usage on schema app_private to anon, authenticated;
    create table public.clubs (id uuid primary key);
    create table public.users (id uuid primary key, club_id uuid references public.clubs(id) on delete set null, role text not null default 'coach');
    insert into public.clubs values ('20000000-0000-4000-8000-000000000001');
    insert into public.users (id, club_id) values ('${actor.id}', '20000000-0000-4000-8000-000000000001');
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261015072209_deleted_workspace_signup_guard.sql', import.meta.url), 'utf8'))
  return db
}

test('the actual platform users/clubs deletion sequence retains revocation with the production SET NULL foreign key', async () => {
  const db = await database()
  try {
    const other = '10000000-0000-4000-8000-000000000002'
    const platformAdmin = '10000000-0000-4000-8000-000000000003'
    await db.exec(`insert into public.users (id, club_id, role) values
      ('${other}', null, 'coach'),
      ('${platformAdmin}', '20000000-0000-4000-8000-000000000001', 'super_admin');`)
    const deletion = await readFile(new URL('../supabase/migrations/20260825162500_platform_club_delete_dependency_repair.sql', import.meta.url), 'utf8')
    const deletionTail = deletion.slice(deletion.indexOf('  update public.users'), deletion.lastIndexOf('\nend;'))
    assert.match(deletionTail, /delete from public\.users[\s\S]*delete from public\.clubs/)
    // Execute the actual existing admin RPC tail, including its retained admin profile.
    await db.exec(`do $$ declare target_club_id uuid := '20000000-0000-4000-8000-000000000001'; begin ${deletionTail} end; $$; set role service_role;`)
    assert.deepEqual((await db.query(`select public.has_deleted_workspace_access('${actor.id}') as revoked,
      public.has_deleted_workspace_access('${other}') as other_revoked`)).rows, [{ revoked: true, other_revoked: false }])
    await db.exec('reset role')
    assert.equal((await db.query(`select count(*)::int as count from public.users where id='${other}'`)).rows[0].count, 1)
    assert.equal((await db.query(`select club_id from public.users where id='${platformAdmin}'`)).rows[0].club_id, null)
    assert.equal((await db.query(`select public.has_deleted_workspace_access('${platformAdmin}') as revoked`)).rows[0].revoked, false)
    assert.equal((await db.query('select count(*)::int as count from public.clubs')).rows[0].count, 0)
  } finally { await db.close() }
})

test('a failed or rolled-back deletion does not leave a false revocation', async () => {
  const db = await database()
  try {
    await db.exec(`begin; delete from public.users where id='${actor.id}'; rollback;`)
    assert.equal((await db.query(`select public.has_deleted_workspace_access('${actor.id}') as revoked`)).rows[0].revoked, false)
    assert.equal((await db.query('select count(*)::int as count from public.users')).rows[0].count, 1)
  } finally { await db.close() }
})

test('revocation records and lookup cannot be read, forged or cleared by browser roles', async () => {
  const db = await database()
  try {
    await db.exec(`delete from public.users where id='${actor.id}'`)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      for (const query of [
        `select public.has_deleted_workspace_access('${actor.id}')`,
        'select * from app_private.deleted_workspace_access',
        'delete from app_private.deleted_workspace_access',
        `insert into app_private.deleted_workspace_access values ('${actor.id}', '20000000-0000-4000-8000-000000000002', now())`,
      ]) await assert.rejects(db.query(query), error => error.code === '42501')
      await db.exec('reset role')
    }
    assert.equal((await db.query('select count(*)::int as count from app_private.deleted_workspace_access')).rows[0].count, 1)
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='app_private.deleted_workspace_access'::regclass")).rows[0].relrowsecurity, true)
  } finally { await db.close() }
})

test('a fresh confirmed signup still creates its workspace, owner and initial team', async () => {
  const { response, result, writes } = await invoke({ revoked: false })
  assert.equal(response.statusCode, 200)
  assert.equal(result.profile.id, actor.id)
  assert.equal(result.club.initial_team_id, 'team-fixture')
  assert.ok(writes.some(write => write.table === 'clubs' && write.action === 'insert'))
  assert.ok(writes.some(write => write.table === 'teams' && write.action === 'insert'))
})

test('another existing membership remains accessible after a workspace deletion', async () => {
  const membership = { id: 'membership-fixture', club_id: 'other-club', role: 'coach', role_label: 'Coach', role_rank: 30,
    clubs: { id: 'other-club', name: 'Other Club', status: 'active' } }
  const { response, result, writes, rpcs } = await invoke({ membership })
  assert.equal(response.statusCode, 200)
  assert.equal(result.profile.club_id, 'other-club')
  assert.equal(writes.filter(write => write.table === 'clubs' || write.table === 'teams').length, 0)
  assert.equal(rpcs.filter(rpc => rpc.name === 'has_deleted_workspace_access').length, 0)
})

test('an explicit invitation can restore access without recreating a deleted workspace', async () => {
  const invite = { id: 'invite-fixture', club_id: 'invited-club', email: actor.email, role_key: 'coach', role_label: 'Coach', role_rank: 30,
    clubs: { id: 'invited-club', name: 'Inviting Club', status: 'active' } }
  const { response, result, writes, rpcs } = await invoke({ invite })
  assert.equal(response.statusCode, 200)
  assert.equal(result.profile.club_id, 'invited-club')
  assert.equal(result.club.id, 'invited-club')
  assert.ok(writes.some(write => write.table === 'club_user_invites' && write.payload.accepted_at))
  assert.equal(writes.filter(write => write.table === 'clubs' || write.table === 'teams').length, 0)
  assert.equal(rpcs.filter(rpc => rpc.name === 'has_deleted_workspace_access').length, 0)
})

test('deleted-access message is authoritative to existing Coach binaries and clears stale cache', async () => {
  const { result } = await invoke()
  const source = await readFile(new URL('../apps/mobile-core/src/auth.js', import.meta.url), 'utf8')
  const definition = source.slice(source.indexOf('function isAuthoritativeProfileFailure('), source.indexOf('\nasync function disableBiometricsForApp'))
  const classify = new Function(`${definition}; return isAuthoritativeProfileFailure`)()
  // Existing mobileAccountRequest forwards only the message, without HTTP status or code.
  assert.equal(classify(new Error(result.message)), true)
  assert.match(source, /if \(cachedProfile && !isAuthoritativeProfileFailure\(error\)\)/)
  assert.match(source, /offlineProfileStore\.clear\(\)/)
})
