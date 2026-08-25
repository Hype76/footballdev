import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { deletePlatformUserResult } = await import('../netlify/functions/platform-delete-user.js')

const adminId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'

function createEvent(body = {}) {
  return {
    httpMethod: 'DELETE',
    headers: { authorization: 'Bearer test-token' },
    body: JSON.stringify({
      targetUserId: targetId,
      password: 'FixturePass123!',
      deletionScope: 'platform_account',
      ...body,
    }),
  }
}

function parseResponse(response) {
  return { statusCode: response.statusCode, body: JSON.parse(response.body) }
}

function createMock({ role = 'super_admin', passwordError = null, targetUser = null } = {}) {
  const calls = []
  const adminProfile = {
    id: adminId,
    email: 'admin@example.test',
    username: 'admin',
    name: 'Platform Admin',
    role,
    role_label: role === 'super_admin' ? 'Super Admin' : 'Coach',
    role_rank: role === 'super_admin' ? 100 : 20,
    club_id: null,
    status: 'active',
  }
  const selectedTarget = targetUser === null ? {
    id: targetId,
    email: 'eliz@example.test',
    username: 'eliz',
    name: 'Eliz Brauer',
    role: 'admin',
    role_label: 'Club Admin',
    club_id: '33333333-3333-4333-8333-333333333333',
  } : targetUser

  class Query {
    constructor(table) {
      this.table = table
      this.action = 'select'
      this.filters = []
      this.payload = null
    }

    select(columns) {
      calls.push({ table: this.table, action: 'select', columns })
      return this
    }

    delete() {
      this.action = 'delete'
      calls.push({ table: this.table, action: 'delete' })
      return this
    }

    insert(payload) {
      this.action = 'insert'
      this.payload = payload
      calls.push({ table: this.table, action: 'insert', payload })
      return Promise.resolve({ data: payload, error: null })
    }

    eq(column, value) {
      this.filters.push([column, value])
      calls.push({ table: this.table, action: this.action, column, value })
      return this
    }

    ilike(column, value) {
      this.filters.push([column, value])
      calls.push({ table: this.table, action: this.action, column, value, operator: 'ilike' })
      return this
    }

    maybeSingle() {
      const id = this.filters.find(([column]) => column === 'id')?.[1]
      if (this.table === 'users') {
        return Promise.resolve({ data: id === adminId ? adminProfile : selectedTarget, error: null })
      }
      if (this.table === 'platform_admins') {
        return Promise.resolve({ data: role === 'super_admin' ? { id: adminId } : null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }

    then(resolve, reject) {
      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    }
  }

  return {
    calls,
    supabaseAdmin: {
      auth: {
        getUser: async () => ({ data: { user: { id: adminId, email: 'admin@example.test' } }, error: null }),
        admin: {
          deleteUser: async (id, softDelete) => {
            calls.push({ service: 'auth', action: 'deleteUser', id, softDelete })
            return { data: {}, error: null }
          },
        },
      },
      from: (table) => new Query(table),
    },
    supabasePublic: {
      auth: {
        signInWithPassword: async (payload) => {
          calls.push({ service: 'auth', action: 'signInWithPassword', payload })
          return { data: passwordError ? null : { user: { id: adminId } }, error: passwordError }
        },
      },
    },
  }
}

test('Platform user delete runs through server authority and removes active access before soft-deleting sign-in', async () => {
  const mock = createMock()
  const response = parseResponse(await deletePlatformUserResult(createEvent(), mock))

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.success, true)
  assert.equal(response.body.user.id, targetId)
  assert.deepEqual(
    mock.calls.find((call) => call.action === 'deleteUser'),
    { service: 'auth', action: 'deleteUser', id: targetId, softDelete: true },
  )
  for (const table of [
    'team_staff',
    'user_club_memberships',
    'parent_player_links',
    'parent_push_subscriptions',
    'parent_mobile_push_installations',
    'coach_mobile_push_installations',
    'users',
  ]) {
    assert.equal(mock.calls.some((call) => call.table === table && call.action === 'delete'), true, table)
  }
  assert.equal(mock.calls.some((call) => call.table === 'audit_logs' && call.action === 'insert'), true)
  assert.equal(
    mock.calls.some((call) => call.table === 'parent_player_links' && call.operator === 'ilike' && call.value === 'eliz@example.test'),
    true,
  )
  const audit = mock.calls.find((call) => call.table === 'audit_logs' && call.action === 'insert')?.payload
  assert.equal(audit.actor_role, undefined)
  assert.equal(audit.actor_role_label, 'Super Admin')
  assert.equal(audit.event_category, 'security')
  assert.equal(audit.source, 'netlify_function')
})

test('Platform user delete fails closed unless the dedicated platform-wide scope is explicit', async () => {
  const mock = createMock()
  const response = parseResponse(await deletePlatformUserResult(createEvent({ deletionScope: '' }), mock))

  assert.equal(response.statusCode, 400)
  assert.equal(response.body.code, 'platform_scope_required')
  assert.equal(mock.calls.some((call) => call.action === 'delete'), false)
  assert.equal(mock.calls.some((call) => call.action === 'deleteUser'), false)
})

test('Platform user delete rejects wrong password and non-platform authority before mutation', async () => {
  const wrongPassword = createMock({ passwordError: new Error('Invalid login credentials') })
  const passwordResponse = parseResponse(await deletePlatformUserResult(createEvent(), wrongPassword))
  assert.equal(passwordResponse.statusCode, 401)
  assert.equal(passwordResponse.body.code, 'invalid_password')
  assert.equal(wrongPassword.calls.some((call) => call.action === 'delete'), false)

  const coach = createMock({ role: 'coach' })
  const coachResponse = parseResponse(await deletePlatformUserResult(createEvent(), coach))
  assert.equal(coachResponse.statusCode, 403)
  assert.equal(coachResponse.body.code, 'forbidden')
  assert.equal(coach.calls.some((call) => call.action === 'delete'), false)
})

test('Platform user delete rejects missing targets and protected Platform Admin accounts', async () => {
  const missing = createMock({ targetUser: false })
  const missingResponse = parseResponse(await deletePlatformUserResult(createEvent(), missing))
  assert.equal(missingResponse.statusCode, 404)
  assert.equal(missingResponse.body.code, 'user_not_found')

  const protectedUser = createMock({
    targetUser: {
      id: targetId,
      email: 'other-admin@example.test',
      name: 'Other Admin',
      role: 'super_admin',
      role_label: 'Super Admin',
      club_id: null,
    },
  })
  const protectedResponse = parseResponse(await deletePlatformUserResult(createEvent(), protectedUser))
  assert.equal(protectedResponse.statusCode, 409)
  assert.equal(protectedResponse.body.code, 'platform_admin_delete_required')
  assert.equal(protectedUser.calls.some((call) => call.action === 'delete'), false)
})

test('Platform admin browser action uses the protected server user-delete route', () => {
  const actionsSource = readFileSync('src/lib/domain/platform-admin-actions.js', 'utf8')
  const pageSource = readFileSync('src/pages/PlatformAdminPage.jsx', 'utf8')
  const accountSource = readFileSync('src/components/platform/PlatformAccountManagementSection.jsx', 'utf8')

  assert.match(actionsSource, /fetch\('\/\.netlify\/functions\/platform-delete-user'/)
  assert.match(actionsSource, /password: String\(password \?\? ''\)/)
  assert.doesNotMatch(actionsSource, /from\('users'\)\s*[\s\S]{0,240}\.delete\(\)/)
  assert.match(pageSource, /setClubRecordView\('archived'\)/)
  assert.match(pageSource, /Archive and continue/)
  assert.match(accountSource, /Archive Club to continue deletion/)
  assert.match(accountSource, /permanently delete it with password confirmation/)

  const clubUsersStart = accountSource.indexOf('function ClubUsersList')
  const clubUsersEnd = accountSource.indexOf('function RoleChangeControl')
  const clubUsersSource = accountSource.slice(clubUsersStart, clubUsersEnd)
  assert.match(clubUsersSource, /Use Club access below/)
  assert.doesNotMatch(clubUsersSource, /onAccountAction\(club, member, 'delete'\)/)
  assert.doesNotMatch(clubUsersSource, />\s*Delete\s*</)
  assert.doesNotMatch(pageSource, /deletePlatformUser|updatePlatformUserStatus/)
})
