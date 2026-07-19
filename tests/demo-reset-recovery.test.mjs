import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createResetDemoAccountHandler } from '../netlify/functions/reset-demo-account.js'
import { DEMO_RESET_MANIFEST } from '../netlify/functions/lib/_demo-reset-manifest.js'

const migrationUrl = new URL('../supabase/migrations/20260719092052_p0_demo_reset_atomic_recovery.sql', import.meta.url)
const loginPageUrl = new URL('../src/pages/LoginPage.jsx', import.meta.url)
const authUrl = new URL('../src/lib/auth.js', import.meta.url)

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const OPERATION_ID = '50000000-0000-4000-8000-000000000001'

function createSupabaseMock({
  authUser = { id: ACTOR_ID, email: DEMO_RESET_MANIFEST.actor.email },
  rpcResult = { data: { cached: false, lock_result: 'acquired' }, error: null },
} = {}) {
  const calls = []
  const auditRows = []
  const client = {
    auth: {
      getUser: async (token) => {
        calls.push({ action: 'getUser', token })
        return {
          data: { user: authUser },
          error: null,
        }
      },
    },
    rpc: async (name, payload) => {
      calls.push({ action: 'rpc', name, payload })
      return typeof rpcResult === 'function' ? rpcResult(payload) : rpcResult
    },
    from: (table) => ({
      insert: async (row) => {
        calls.push({ action: 'insert', table })
        auditRows.push(row)
        return { error: null }
      },
    }),
  }
  return { auditRows, calls, client }
}

function authorityProfile() {
  return {
    id: ACTOR_ID,
    email: DEMO_RESET_MANIFEST.actor.email,
    role: DEMO_RESET_MANIFEST.actor.role,
    role_rank: DEMO_RESET_MANIFEST.actor.roleRank,
    club_id: '20000000-0000-4000-8000-000000000001',
    status: 'active',
    clubs: {
      id: '20000000-0000-4000-8000-000000000001',
      name: DEMO_RESET_MANIFEST.club.name,
      status: 'active',
      plan_key: 'large_club',
      plan_status: 'active',
      is_plan_comped: true,
    },
  }
}

function request(body = { operationId: OPERATION_ID }) {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer safe-test-token' },
    body: JSON.stringify(body),
  }
}

test('handler requires the approved authenticated identity and accepts no browser scope fields', async () => {
  const mock = createSupabaseMock()
  const handler = createResetDemoAccountHandler({
    createAdminClient: () => mock.client,
    loadAuthorityProfile: async () => authorityProfile(),
  })

  const unsupported = await handler(request({ operationId: OPERATION_ID, clubId: 'attacker-scope' }))
  assert.equal(unsupported.statusCode, 400)
  assert.equal(JSON.parse(unsupported.body).code, 'UNSUPPORTED_SCOPE')
  assert.equal(mock.calls.length, 0)

  const unauthenticated = await handler({ ...request(), headers: {} })
  assert.equal(unauthenticated.statusCode, 401)
  assert.equal(JSON.parse(unauthenticated.body).code, 'AUTH_REQUIRED')

  const response = await handler(request())
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body), {
    success: true,
    operationId: OPERATION_ID,
    outcome: 'completed',
  })
  assert.deepEqual(mock.calls.find((call) => call.action === 'rpc'), {
    action: 'rpc',
    name: 'reset_demo_account_atomic',
    payload: { p_actor_id: ACTOR_ID, p_operation_id: OPERATION_ID },
  })
})

test('a concurrent database lock conflict returns a safe 409 and records only sanitised audit data', async () => {
  const rawDatabaseDetail = 'private database diagnostic detail'
  const mock = createSupabaseMock({
    rpcResult: { data: null, error: { code: '55P03', message: `DEMO_RESET_LOCKED ${rawDatabaseDetail}` } },
  })
  const handler = createResetDemoAccountHandler({
    createAdminClient: () => mock.client,
    loadAuthorityProfile: async () => authorityProfile(),
  })

  const response = await handler(request())
  const body = JSON.parse(response.body)
  assert.equal(response.statusCode, 409)
  assert.equal(body.code, 'RESET_ALREADY_RUNNING')
  assert.doesNotMatch(response.body, new RegExp(rawDatabaseDetail))
  assert.equal(mock.auditRows.length, 1)
  assert.equal(mock.auditRows[0].lock_result, 'conflict')
  assert.equal(mock.auditRows[0].safe_error_code, 'RESET_ALREADY_RUNNING')
  assert.equal(JSON.stringify(mock.auditRows[0]).includes(rawDatabaseDetail), false)
})

test('a valid session for any identity outside the exact demo allowlist is denied before the RPC', async () => {
  const mock = createSupabaseMock({
    authUser: { id: '10000000-0000-4000-8000-000000000099', email: 'other@example.test' },
  })
  const handler = createResetDemoAccountHandler({
    createAdminClient: () => mock.client,
    loadAuthorityProfile: async () => authorityProfile(),
  })

  const response = await handler(request())
  assert.equal(response.statusCode, 403)
  assert.equal(JSON.parse(response.body).code, 'DEMO_SCOPE_DENIED')
  assert.equal(mock.calls.some((call) => call.action === 'rpc'), false)
  assert.equal(mock.auditRows.length, 0)
})

test('rapid concurrent requests rely on the database conflict instead of starting parallel browser scope writes', async () => {
  let rpcCalls = 0
  let releaseFirst
  const firstPending = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const mock = createSupabaseMock({
    rpcResult: async () => {
      rpcCalls += 1
      if (rpcCalls === 1) {
        await firstPending
        return { data: { cached: false, lock_result: 'acquired' }, error: null }
      }
      return { data: null, error: { code: '55P03', message: 'DEMO_RESET_LOCKED' } }
    },
  })
  const handler = createResetDemoAccountHandler({
    createAdminClient: () => mock.client,
    loadAuthorityProfile: async () => authorityProfile(),
  })

  const first = handler(request({ operationId: '50000000-0000-4000-8000-000000000010' }))
  const second = handler(request({ operationId: '50000000-0000-4000-8000-000000000011' }))
  const third = handler(request({ operationId: '50000000-0000-4000-8000-000000000012' }))
  const [secondResponse, thirdResponse] = await Promise.all([second, third])
  releaseFirst()
  const firstResponse = await first

  assert.equal(firstResponse.statusCode, 200)
  assert.equal(secondResponse.statusCode, 409)
  assert.equal(thirdResponse.statusCode, 409)
  assert.equal(rpcCalls, 3)
  assert.equal(mock.calls.filter((call) => call.action === 'rpc').every((call) => Object.keys(call.payload).length === 2), true)
})

test('migration and client source enforce serialisation, transaction ownership, permissions, and auth-first failure handling', async () => {
  const [migration, loginPage, authSource] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(loginPageUrl, 'utf8'),
    readFile(authUrl, 'utf8'),
  ])

  assert.match(migration, /pg_try_advisory_xact_lock\(hashtextextended\('footballplayer:demo-reset:v1', 0\)\)/)
  assert.match(migration, /language plpgsql\s+security definer\s+set search_path = ''/)
  assert.match(migration, /revoke all on function public\."reset_demo_account_atomic"\(uuid, uuid\) from public/)
  assert.match(migration, /revoke all on function public\."reset_demo_account_atomic"\(uuid, uuid\) from anon/)
  assert.match(migration, /revoke all on function public\."reset_demo_account_atomic"\(uuid, uuid\) from authenticated/)
  assert.match(migration, /grant execute on function public\."reset_demo_account_atomic"\(uuid, uuid\) to service_role/)
  assert.doesNotMatch(migration, /auth\.users\s+(?:set|delete|insert|update)/i)
  assert.doesNotMatch(migration, /insert into public\.(?:scheduled_email_queue|calendar_event_notification_commands|calendar_event_notification_events|match_day_notification_events|communication_logs)/i)

  const signInIndex = loginPage.indexOf('const authData = await signInWithPassword')
  const resetIndex = loginPage.indexOf('await prepareDemoAccount')
  assert.ok(signInIndex >= 0 && resetIndex > signInIndex)
  assert.match(loginPage, /demoSubmitLockRef\.current/)
  assert.match(loginPage, /setDemoResetPending\(true\)/)
  assert.match(loginPage, /setDemoResetPending\(false\)/)
  assert.match(loginPage, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.match(loginPage, /await signOut\(\)/)
  assert.match(authSource, /const \{ data, error \} = await supabase\.auth\.signInWithPassword/)
  assert.match(authSource, /return data/)
  assert.doesNotMatch(JSON.stringify(DEMO_RESET_MANIFEST), /Demo123|password|service.role.key/i)

  const routerSource = await readFile(new URL('../src/app/router.jsx', import.meta.url), 'utf8')
  assert.match(routerSource, /isDemoResetPending\(\)/)
})

test('the old parallel multi-transaction pattern deterministically reproduces partial cleanup and duplicate team failure', async () => {
  const state = {
    teams: new Set(['U12 Tigers', 'U14 Falcons', 'U16 Lions']),
    teamStaff: 3,
    matchDays: 2,
  }

  const oldDelete = async (resource, { deadlock = false } = {}) => {
    if (resource === 'team_staff') state.teamStaff = 0
    if (resource === 'match_days') state.matchDays = 0
    if (deadlock) throw Object.assign(new Error('deadlock detected'), { code: '40P01' })
    if (resource === 'teams') state.teams.clear()
  }
  const swallow = (promise) => promise.catch(() => undefined)

  await Promise.all([
    swallow(oldDelete('team_staff')),
    swallow(oldDelete('match_days')),
    swallow(oldDelete('teams', { deadlock: true })),
  ])

  assert.throws(() => {
    for (const name of DEMO_RESET_MANIFEST.teams) {
      if (state.teams.has(name)) throw Object.assign(new Error('duplicate team'), { code: '23505' })
      state.teams.add(name)
    }
  }, /duplicate team/)
  assert.equal(state.teamStaff, 0)
  assert.equal(state.matchDays, 0)
  assert.equal(state.teams.size, 3)
})
