import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { deletePlatformTeamResult } = await import('../netlify/functions/platform-delete-team.js')
const deleteTeamFunctionSource = readFileSync('netlify/functions/platform-delete-team.js', 'utf8')
const deleteTeamMigrationSource = readFileSync('supabase/migrations/20260624105819_platform_delete_team_transaction.sql', 'utf8')
const playerNameIndexMigrationSource = readFileSync(
  'supabase/migrations/20260624111815_allow_team_delete_with_unassigned_duplicate_player_names.sql',
  'utf8',
)

const clubId = '11111111-1111-4111-8111-111111111111'
const teamId = '22222222-2222-4222-8222-222222222222'
const otherClubId = '33333333-3333-4333-8333-333333333333'

function createEvent(body = {}, headers = {}) {
  return {
    httpMethod: 'DELETE',
    headers: {
      authorization: 'Bearer token-123',
      ...headers,
    },
    body: JSON.stringify({
      teamId,
      clubId,
      password: '  FixturePass123!  ',
      ...body,
    }),
  }
}

function parseResponse(response) {
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body),
  }
}

function createMockSupabase({
  authUser = { id: 'admin-1', email: 'admin@example.test' },
  profile = {
    id: 'admin-1',
    email: 'admin@example.test',
    name: 'Platform Admin',
    role: 'super_admin',
    role_label: 'Super Admin',
    role_rank: 100,
  },
  team = {
    id: teamId,
    name: 'Disposable Team',
    club_id: clubId,
  },
  deleteError = null,
  teamError = null,
  auditError = null,
  passwordError = null,
  passwordThrows = null,
  rpcData = [{ deleted: true, team_id: teamId, club_id: clubId, team_name: 'Disposable Team' }],
} = {}) {
  const calls = []

  class Query {
    constructor(table) {
      this.table = table
      this.action = 'select'
    }

    select(columns) {
      calls.push({ table: this.table, action: 'select', columns })
      return this
    }

    or(expression) {
      calls.push({ table: this.table, action: 'or', expression })
      return this
    }

    limit(value) {
      calls.push({ table: this.table, action: 'limit', value })
      return this
    }

    delete() {
      this.action = 'delete'
      calls.push({ table: this.table, action: 'delete' })
      return this
    }

    insert(payload) {
      calls.push({ table: this.table, action: 'insert', payload })
      return Promise.resolve({ data: payload, error: auditError })
    }

    eq(column, value) {
      calls.push({ table: this.table, action: this.action, column, value })
      return this
    }

    maybeSingle() {
      if (this.table === 'users') {
        return Promise.resolve({ data: profile, error: null })
      }

      if (this.table === 'teams') {
        return Promise.resolve({ data: team, error: teamError })
      }

      return Promise.resolve({ data: null, error: null })
    }

    then(resolve, reject) {
      if (this.table === 'teams' && this.action === 'delete') {
        return Promise.resolve({ data: null, error: deleteError }).then(resolve, reject)
      }

      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    }
  }

  return {
    calls,
    supabasePublic: {
      auth: {
        signInWithPassword: async (payload) => {
          calls.push({ service: 'auth', action: 'signInWithPassword', payload })
          if (passwordThrows) {
            throw passwordThrows
          }

          return { data: passwordError ? null : { user: authUser, session: { access_token: 'not-returned' } }, error: passwordError }
        },
      },
    },
    supabaseAdmin: {
      auth: {
        getUser: async () => (
          authUser
            ? { data: { user: authUser }, error: null }
            : { data: { user: null }, error: new Error('Invalid token') }
        ),
      },
      rpc: async (functionName, payload) => {
        calls.push({ service: 'rpc', action: functionName, payload })
        return { data: rpcData, error: deleteError }
      },
      from: (table) => new Query(table),
    },
  }
}

async function captureConsoleError(callback) {
  const originalConsoleError = console.error
  const entries = []
  console.error = (...args) => {
    entries.push(args)
  }

  try {
    const result = await callback()
    return { result, entries }
  } finally {
    console.error = originalConsoleError
  }
}

test('deletePlatformTeamResult returns 405 for unsupported methods', async () => {
  const mock = createMockSupabase()
  const response = await deletePlatformTeamResult({
    ...createEvent(),
    httpMethod: 'GET',
  }, {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 405)
  assert.equal(parsed.body.code, 'method_not_allowed')
  assert.equal(mock.calls.length, 0)
})

test('deletePlatformTeamResult deletes a disposable team through the transaction RPC', async () => {
  const mock = createMockSupabase()
  const response = await deletePlatformTeamResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  })
  const parsed = parseResponse(response)
  const rpcCall = mock.calls.find((call) => call.service === 'rpc' && call.action === 'delete_platform_team_transaction')

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.team.id, teamId)
  assert.deepEqual(rpcCall?.payload, {
    p_team_id: teamId,
    p_club_id: clubId,
    p_actor_id: 'admin-1',
    p_actor_email: 'admin@example.test',
    p_actor_name: 'Platform Admin',
    p_actor_role: 'super_admin',
    p_actor_role_label: 'Super Admin',
    p_actor_role_rank: 100,
  })
  assert.equal(mock.calls.some((call) => call.table === 'teams' && call.action === 'delete'), false)
  assert.equal(mock.calls.some((call) => call.table === 'audit_logs' && call.action === 'insert'), false)
  assert.deepEqual(
    mock.calls.find((call) => call.service === 'auth')?.payload,
    { email: 'admin@example.test', password: '  FixturePass123!  ' },
  )
  assert.equal(JSON.stringify(rpcCall?.payload).includes('FixturePass123'), false)
})

test('deletePlatformTeamResult rejects missing and invalid identifiers before delete', async () => {
  for (const body of [
    { teamId: '', clubId },
    { teamId: 'not-a-uuid', clubId },
    { teamId, clubId: '' },
    { teamId, clubId: 'not-a-uuid' },
  ]) {
    const mock = createMockSupabase()
    const response = await deletePlatformTeamResult(createEvent(body), {
      supabaseAdmin: mock.supabaseAdmin,
      supabasePublic: mock.supabasePublic,
    })
    const parsed = parseResponse(response)

    assert.equal(parsed.statusCode, 400)
    assert.equal(mock.calls.some((call) => call.table === 'teams' && call.action === 'delete'), false)
    assert.equal(mock.calls.some((call) => call.table === 'audit_logs' && call.action === 'insert'), false)
  }
})

test('deletePlatformTeamResult rejects missing password before auth, delete, or audit', async () => {
  const mock = createMockSupabase()
  const response = await deletePlatformTeamResult(createEvent({ password: '' }), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 400)
  assert.equal(parsed.body.code, 'missing_password')
  assert.equal(mock.calls.some((call) => call.service === 'auth'), false)
  assert.equal(mock.calls.some((call) => call.table === 'teams' && call.action === 'delete'), false)
  assert.equal(mock.calls.some((call) => call.table === 'audit_logs' && call.action === 'insert'), false)
})

test('deletePlatformTeamResult rejects auth, role, password, not found, and club mismatch before delete', async () => {
  const cases = [
    { options: { authUser: null }, statusCode: 401, code: 'unauthenticated' },
    { options: { profile: { id: 'coach-1', email: 'coach@example.test', role: 'coach' } }, statusCode: 403, code: 'forbidden' },
    { options: { passwordError: new Error('Invalid login credentials') }, statusCode: 401, code: 'invalid_password' },
    { options: { team: null }, statusCode: 404, code: 'team_not_found' },
    { options: { team: { id: teamId, name: 'Other Team', club_id: otherClubId } }, statusCode: 409, code: 'team_club_mismatch' },
  ]

  for (const nextCase of cases) {
    const mock = createMockSupabase(nextCase.options)
    const response = await deletePlatformTeamResult(createEvent(), {
      supabaseAdmin: mock.supabaseAdmin,
      supabasePublic: mock.supabasePublic,
    })
    const parsed = parseResponse(response)

    assert.equal(parsed.statusCode, nextCase.statusCode)
    assert.equal(parsed.body.code, nextCase.code)
    assert.equal(mock.calls.some((call) => call.table === 'teams' && call.action === 'delete'), false)
    assert.equal(mock.calls.some((call) => call.table === 'audit_logs' && call.action === 'insert'), false)
  }
})

test('deletePlatformTeamResult maps thrown password auth errors to controlled invalid_password', async () => {
  const mock = createMockSupabase({
    passwordThrows: Object.assign(new Error('Invalid login credentials'), {
      name: 'AuthApiError',
      status: 400,
      code: 'invalid_credentials',
    }),
  })
  const response = await deletePlatformTeamResult(createEvent({ password: 'WrongFixturePassword!' }), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 401)
  assert.equal(parsed.body.code, 'invalid_password')
  assert.equal(parsed.body.message, 'That password was not accepted.')
  assert.equal(mock.calls.some((call) => call.table === 'teams' && call.action === 'delete'), false)
  assert.equal(mock.calls.some((call) => call.table === 'audit_logs' && call.action === 'insert'), false)
})

test('deletePlatformTeamResult does not log passwords on failed password checks', async () => {
  const password = 'WrongFixturePassword!'
  const mock = createMockSupabase({
    passwordThrows: Object.assign(new Error(`Invalid login credentials for ${password}`), {
      name: 'AuthApiError',
      status: 400,
      code: 'invalid_credentials',
    }),
  })
  const { result: response, entries } = await captureConsoleError(() => deletePlatformTeamResult(createEvent({ password }), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  }))
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 401)
  assert.equal(parsed.body.code, 'invalid_password')
  assert.equal(JSON.stringify(entries).includes(password), false)
})

test('deletePlatformTeamResult reports conflicts and avoids success audit on failed delete', async () => {
  const mock = createMockSupabase({
    deleteError: Object.assign(new Error('Foreign key violation'), { code: '23503' }),
  })
  const response = await deletePlatformTeamResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 409)
  assert.equal(parsed.body.code, 'deletion_conflict')
  assert.equal(mock.calls.some((call) => call.table === 'audit_logs' && call.action === 'insert'), false)
})

test('deletePlatformTeamResult maps player null-team unique conflicts to deletion_conflict', async () => {
  const mock = createMockSupabase({
    deleteError: Object.assign(new Error('duplicate key value violates unique constraint "players_club_team_section_player_name_key"'), {
      code: '23505',
      details: 'Key (club_id, team_id, section, player_name) already exists.',
      constraint: 'players_club_team_section_player_name_key',
    }),
  })
  const response = await deletePlatformTeamResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 409)
  assert.equal(parsed.body.code, 'deletion_conflict')
  assert.equal(parsed.body.message, 'This team cannot be deleted because player records would conflict after the team link is cleared.')
})

test('deletePlatformTeamResult maps audit transaction failures to audit_failed without claiming success', async () => {
  const mock = createMockSupabase({
    deleteError: Object.assign(new Error('audit_failed'), { code: 'P0001', details: '23502: audit insert rejected' }),
  })
  const response = await deletePlatformTeamResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 500)
  assert.equal(parsed.body.code, 'audit_failed')
  assert.equal(parsed.body.message, 'The team could not be deleted because the audit log could not be written.')
})

test('deletePlatformTeamResult maps unexpected internal throws to server_error', async () => {
  const mock = createMockSupabase({
    teamError: new Error('Unexpected database failure'),
  })
  const response = await deletePlatformTeamResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 500)
  assert.equal(parsed.body.code, 'server_error')
  assert.equal(parsed.body.message, 'The server could not complete this action. Please contact support with reference FPO-V1-TEAMDELETE-SERVERERR-007.')
  assert.equal(mock.calls.some((call) => call.table === 'audit_logs' && call.action === 'insert'), false)
})

test('deletePlatformTeamResult never trusts a client supplied role', async () => {
  const mock = createMockSupabase({
    profile: { id: 'coach-1', email: 'coach@example.test', role: 'coach' },
  })
  const response = await deletePlatformTeamResult(createEvent({ role: 'super_admin' }), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 403)
  assert.equal(parsed.body.code, 'forbidden')
  assert.equal(mock.calls.some((call) => call.table === 'teams' && call.action === 'delete'), false)
})

test('deletePlatformTeamResult records safe diagnostics without logging passwords or bearer tokens', async () => {
  const password = 'WrongFixturePassword!'
  const token = 'secret-token-fixture'
  const mock = createMockSupabase({
    deleteError: Object.assign(new Error('Unexpected transaction failure'), {
      code: 'PGRST999',
      details: 'fixture detail',
      hint: 'fixture hint',
    }),
  })
  const { result: response, entries } = await captureConsoleError(() => deletePlatformTeamResult(createEvent({ password }, {
    authorization: `Bearer ${token}`,
  }), {
    supabaseAdmin: mock.supabaseAdmin,
    supabasePublic: mock.supabasePublic,
  }))
  const parsed = parseResponse(response)
  const logged = JSON.stringify(entries)

  assert.equal(parsed.statusCode, 500)
  assert.equal(parsed.body.code, 'server_error')
  assert.match(logged, /FPO-V1-TEAMDELETE-SERVERERR-007/)
  assert.match(logged, /team_delete_transaction/)
  assert.match(logged, /fixture detail/)
  assert.equal(logged.includes(password), false)
  assert.equal(logged.includes(token), false)
})

test('deletePlatformTeamResult uses the transactional RPC and migration audit insert matches production columns', () => {
  assert.match(deleteTeamFunctionSource, /rpc\('delete_platform_team_transaction'/)
  assert.doesNotMatch(deleteTeamFunctionSource, /\.from\('teams'\)\s*[\s\S]*?\.delete\(\)/)
  assert.match(deleteTeamMigrationSource, /insert into public\.audit_logs \(/)
  assert.doesNotMatch(deleteTeamMigrationSource, /^\s+actor_role,\s*$/m)
  assert.match(deleteTeamMigrationSource, /'actorRole'/)
  assert.match(deleteTeamMigrationSource, /grant execute on function public\.delete_platform_team_transaction/)
  assert.match(playerNameIndexMigrationSource, /drop index if exists public\.players_club_team_section_player_name_key/)
  assert.match(playerNameIndexMigrationSource, /create unique index players_club_team_section_player_name_key/)
  assert.doesNotMatch(playerNameIndexMigrationSource, /NULLS NOT DISTINCT/i)
})
