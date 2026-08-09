import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { getWorkspaceOwnerInviteResult } = await import('../netlify/functions/get-club-owner-invite.js')
const { createWorkspaceOwnerAccountResult } = await import('../netlify/functions/create-club-owner-account.js')

const CLUB_ID = '11111111-1111-4111-8111-111111111111'
const TEAM_ID = '22222222-2222-4222-8222-222222222222'
const AUTH_USER_ID = '33333333-3333-4333-8333-333333333333'

function createInvite(planKey = 'single_team', overrides = {}) {
  const isTeam = planKey === 'single_team' || planKey === 'individual'
  const isIndividual = planKey === 'individual'

  return {
    id: '44444444-4444-4444-8444-444444444444',
    club_id: CLUB_ID,
    team_id: isTeam ? TEAM_ID : null,
    invited_email: 'owner@example.test',
    billing_mode: planKey === 'individual' ? 'unpaid' : 'paid',
    plan_key: planKey,
    invite_scope: isIndividual ? 'individual' : isTeam ? 'team' : 'club',
    intended_role_key: isTeam ? 'head_manager' : 'admin',
    intended_role_label: isIndividual ? 'Coach Owner' : isTeam ? 'Team Admin' : 'Club Admin',
    intended_role_rank: isTeam ? 70 : 90,
    status: 'pending',
    expires_at: '2099-01-01T00:00:00.000Z',
    accepted_at: null,
    accepted_user_id: null,
    revoked_at: null,
    replaced_at: null,
    clubs: { name: 'FP TEST Workspace', plan_key: planKey, logo_url: '', contact_email: 'owner@example.test' },
    teams: isTeam ? { id: TEAM_ID, club_id: CLUB_ID, name: 'FP TEST Team' } : null,
    ...overrides,
  }
}

function createMockSupabase(invite, { existingUsers = [], bearerUser = null } = {}) {
  const calls = []

  class Query {
    constructor(table) {
      this.table = table
    }

    select(columns) {
      calls.push({ table: this.table, action: 'select', columns })
      return this
    }

    eq(column, value) {
      calls.push({ table: this.table, action: 'eq', column, value })
      return this
    }

    maybeSingle() {
      if (this.table === 'club_owner_invites') {
        return Promise.resolve({ data: invite, error: null })
      }

      return Promise.resolve({ data: null, error: null })
    }
  }

  return {
    calls,
    client: {
      from: (table) => new Query(table),
      rpc: async (name, payload) => {
        calls.push({ action: 'rpc', name, payload })
        return { data: { completed: true, idempotent: false }, error: null }
      },
      auth: {
        getUser: async () => ({ data: { user: bearerUser }, error: bearerUser ? null : new Error('No session') }),
        admin: {
          listUsers: async () => ({ data: { users: existingUsers }, error: null }),
          createUser: async (payload) => {
            calls.push({ action: 'createUser', payload })
            return { data: { user: { id: AUTH_USER_ID, email: payload.email } }, error: null }
          },
          deleteUser: async (id) => {
            calls.push({ action: 'deleteUser', id })
            return { error: null }
          },
        },
      },
    },
  }
}

function event(body, headers = {}) {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }
}

function parse(response) {
  return { statusCode: response.statusCode, headers: response.headers, body: JSON.parse(response.body) }
}

test('valid Team and Club invites resolve distinct server-authoritative wording and roles', async () => {
  for (const fixture of [
    { invite: createInvite('single_team'), scope: 'team', role: 'Team Admin', title: 'Create team admin access' },
    { invite: createInvite('small_club'), scope: 'club', role: 'Club Admin', title: 'Create club admin access' },
  ]) {
    const mock = createMockSupabase(fixture.invite)
    const result = parse(await getWorkspaceOwnerInviteResult(event({ token: 'fixture-token' }), { supabaseAdmin: mock.client }))

    assert.equal(result.statusCode, 200)
    assert.equal(result.headers['Cache-Control'], 'no-store')
    assert.equal(result.headers['Referrer-Policy'], 'no-referrer')
    assert.equal(result.body.invite.scope, fixture.scope)
    assert.equal(result.body.invite.roleLabel, fixture.role)
    assert.equal(result.body.invite.setupTitle, fixture.title)
  }
})

test('missing, unknown, used and expired owner invites fail closed with scope-correct errors', async () => {
  const missing = createMockSupabase(null)
  const missingResult = parse(await getWorkspaceOwnerInviteResult(event({ token: '' }), { supabaseAdmin: missing.client }))
  assert.equal(missingResult.statusCode, 400)

  const unknown = createMockSupabase(null)
  const unknownResult = parse(await getWorkspaceOwnerInviteResult(event({ token: 'malformed-or-unknown' }), { supabaseAdmin: unknown.client }))
  assert.equal(unknownResult.statusCode, 404)
  assert.equal(unknownResult.body.message, 'Workspace invite could not be opened.')

  const used = createMockSupabase(createInvite('single_team', { status: 'accepted', accepted_at: '2026-08-01T00:00:00.000Z' }))
  const usedResult = parse(await getWorkspaceOwnerInviteResult(event({ token: 'used' }), { supabaseAdmin: used.client }))
  assert.equal(usedResult.statusCode, 409)
  assert.equal(usedResult.body.message, 'Team invite is no longer available.')

  const expired = createMockSupabase(createInvite('small_club', { expires_at: '2020-01-01T00:00:00.000Z' }))
  const expiredResult = parse(await getWorkspaceOwnerInviteResult(event({ token: 'expired' }), { supabaseAdmin: expired.client }))
  assert.equal(expiredResult.statusCode, 410)
  assert.equal(expiredResult.body.message, 'Club invite is no longer available.')
})

test('plan, role, Team and Club target tampering is rejected before account creation', async () => {
  const fixtures = [
    createInvite('single_team', { intended_role_label: 'Club Admin' }),
    createInvite('single_team', { team_id: '55555555-5555-4555-8555-555555555555' }),
    createInvite('single_team', { clubs: { name: 'FP TEST', plan_key: 'small_club' } }),
    createInvite('single_team', { teams: { id: TEAM_ID, club_id: '66666666-6666-4666-8666-666666666666', name: 'Other' } }),
  ]

  for (const invite of fixtures) {
    const getMock = createMockSupabase(invite)
    const getResult = parse(await getWorkspaceOwnerInviteResult(event({ token: 'tampered' }), { supabaseAdmin: getMock.client }))
    assert.equal(getResult.statusCode, 404)

    const acceptMock = createMockSupabase(invite)
    const acceptResult = parse(await createWorkspaceOwnerAccountResult(event({
      token: 'tampered',
      password: 'StrongPassword123!',
    }), { supabaseAdmin: acceptMock.client }))
    assert.equal(acceptResult.statusCode, 403)
    assert.equal(acceptMock.calls.some((call) => call.action === 'createUser'), false)
  }
})

test('Team invite acceptance creates Team Admin metadata and redirects to paid billing', async () => {
  const mock = createMockSupabase(createInvite('single_team'))
  const result = parse(await createWorkspaceOwnerAccountResult(event({
    token: 'valid-team-token',
    password: 'StrongPassword123!',
  }), { supabaseAdmin: mock.client }))
  const createUserCall = mock.calls.find((call) => call.action === 'createUser')

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.scope, 'team')
  assert.equal(result.body.roleLabel, 'Team Admin')
  assert.equal(result.body.redirectPath, '/billing')
  assert.equal(createUserCall.payload.user_metadata.account_type, 'team_admin')
  assert.equal(mock.calls.some((call) => call.name === 'accept_workspace_owner_invite_v3'), true)
})

test('an existing recipient account must prove the exact invited identity', async () => {
  const existingUser = { id: AUTH_USER_ID, email: 'owner@example.test' }
  const wrongBearer = { id: '77777777-7777-4777-8777-777777777777', email: 'other@example.test' }
  const mock = createMockSupabase(createInvite('single_team'), {
    existingUsers: [existingUser],
    bearerUser: wrongBearer,
  })
  const result = parse(await createWorkspaceOwnerAccountResult(event(
    { token: 'recipient-check', password: 'StrongPassword123!' },
    { authorization: 'Bearer wrong-user' },
  ), { supabaseAdmin: mock.client }))

  assert.equal(result.statusCode, 409)
  assert.equal(result.body.code, 'existing_account_authentication_required')
  assert.equal(mock.calls.some((call) => call.name === 'accept_workspace_owner_invite_v3'), false)
})
