import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { manageWorkspaceTeamTransferResult } = await import('../netlify/functions/manage-workspace-team-transfer.js')

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'
const TEAM_ID = '33333333-3333-4333-8333-333333333333'
const SOURCE_ID = '44444444-4444-4444-8444-444444444444'
const DESTINATION_ID = '55555555-5555-4555-8555-555555555555'

function createMock({ authUser = { id: ADMIN_ID, email: 'platform@example.test' }, rpcError = null } = {}) {
  const calls = []

  class Query {
    constructor(table) {
      this.table = table
      this.filters = {}
    }

    select(columns) {
      calls.push({ table: this.table, action: 'select', columns })
      return this
    }

    eq(column, value) {
      this.filters[column] = value
      return this
    }

    maybeSingle() {
      if (this.table === 'users') {
        return Promise.resolve({
          data: {
            id: ADMIN_ID,
            email: 'platform@example.test',
            name: 'Platform Admin',
            username: 'Platform Admin',
            role: 'super_admin',
            role_label: 'Super Admin',
            role_rank: 100,
            club_id: null,
            status: 'active',
          },
          error: null,
        })
      }

      if (this.table === 'platform_admins') {
        return Promise.resolve({ data: { id: ADMIN_ID, status: 'active' }, error: null })
      }

      if (this.table === 'teams') {
        return Promise.resolve({ data: { id: TEAM_ID, name: 'FP TEST Team' }, error: null })
      }

      if (this.table === 'clubs') {
        const id = this.filters.id
        return Promise.resolve({
          data: { id, name: id === SOURCE_ID ? 'FP TEST Source' : 'FP TEST Destination' },
          error: null,
        })
      }

      return Promise.resolve({ data: null, error: null })
    }
  }

  return {
    calls,
    client: {
      auth: {
        getUser: async () => authUser
          ? { data: { user: authUser }, error: null }
          : { data: { user: null }, error: new Error('Invalid token') },
      },
      from: (table) => new Query(table),
      rpc: async (name, payload) => {
        calls.push({ action: 'rpc', name, payload })
        return rpcError
          ? { data: null, error: rpcError }
          : {
              data: {
                id: REQUEST_ID,
                teamId: TEAM_ID,
                sourceClubId: SOURCE_ID,
                destinationClubId: DESTINATION_ID,
                status: 'pending',
                sourceApproved: false,
                destinationApproved: false,
                completed: false,
              },
              error: null,
            }
      },
    },
  }
}

function event(body, token = 'valid-token') {
  return {
    httpMethod: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  }
}

function parse(response) {
  return { statusCode: response.statusCode, body: JSON.parse(response.body) }
}

test('Platform Admin creates a controlled request with actor identity fixed by the server', async () => {
  const mock = createMock()
  const response = parse(await manageWorkspaceTeamTransferResult(event({
    action: 'create',
    actorId: '66666666-6666-4666-8666-666666666666',
    teamId: TEAM_ID,
    destinationClubId: DESTINATION_ID,
  }), { supabaseAdmin: mock.client }))
  const rpcCall = mock.calls.find((call) => call.action === 'rpc')

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.transfer.teamName, 'FP TEST Team')
  assert.equal(response.body.transfer.sourceWorkspaceName, 'FP TEST Source')
  assert.equal(response.body.transfer.destinationClubName, 'FP TEST Destination')
  assert.equal(rpcCall.name, 'manage_workspace_team_transfer')
  assert.equal(rpcCall.payload.p_actor_id, ADMIN_ID)
  assert.equal(rpcCall.payload.p_team_id, TEAM_ID)
})

test('controlled transfer endpoint rejects unauthenticated and malformed requests before RPC', async () => {
  const unauthenticated = createMock({ authUser: null })
  const authResult = parse(await manageWorkspaceTeamTransferResult(event({
    action: 'view',
    requestId: REQUEST_ID,
  }), { supabaseAdmin: unauthenticated.client }))
  assert.equal(authResult.statusCode, 401)
  assert.equal(unauthenticated.calls.some((call) => call.action === 'rpc'), false)

  const malformed = createMock()
  const malformedResult = parse(await manageWorkspaceTeamTransferResult(event({
    action: 'create',
    teamId: 'not-a-uuid',
    destinationClubId: DESTINATION_ID,
  }), { supabaseAdmin: malformed.client }))
  assert.equal(malformedResult.statusCode, 400)
  assert.equal(malformed.calls.some((call) => call.action === 'rpc'), false)
})

test('controlled transfer endpoint exposes safe review and preservation blockers', async () => {
  for (const fixture of [
    {
      error: { code: '55000', message: 'workspace_team_transfer_source_billing_review_required' },
      code: 'source_billing_review_required',
    },
    {
      error: { code: '55000', message: 'workspace_team_transfer_source_user_review_required' },
      code: 'source_user_review_required',
    },
    {
      error: { code: '40001', message: 'workspace_team_transfer_preservation_check_failed' },
      code: 'preservation_check_failed',
    },
    {
      error: { code: '42501', message: 'workspace_team_transfer_not_permitted' },
      code: 'not_permitted',
    },
  ]) {
    const mock = createMock({ rpcError: fixture.error })
    const response = parse(await manageWorkspaceTeamTransferResult(event({
      action: 'complete',
      requestId: REQUEST_ID,
    }), { supabaseAdmin: mock.client }))

    assert.equal(response.body.code, fixture.code)
    assert.equal(response.statusCode, fixture.code === 'not_permitted' ? 403 : 409)
  }
})
