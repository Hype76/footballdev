import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { createPlatformClubResult } = await import('../netlify/functions/platform-create-club.js')

const originalEnv = {
  BRANCH: process.env.BRANCH,
  CONTEXT: process.env.CONTEXT,
  NETLIFY_DEV: process.env.NETLIFY_DEV,
  NODE_ENV: process.env.NODE_ENV,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
}

function setEnv(nextEnv) {
  for (const key of Object.keys(originalEnv)) {
    if (Object.hasOwn(nextEnv, key)) {
      process.env[key] = nextEnv[key]
    } else if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
}

function createEvent(body = {}, headers = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer token-123',
      host: 'footballplayer.online',
      'x-forwarded-proto': 'https',
      ...headers,
    },
    body: JSON.stringify({
      name: 'Disposable Club FC',
      ownerEmail: 'owner@example.test',
      contactEmail: '',
      planKey: 'small_club',
      billingMode: 'paid',
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
  authUser = { id: 'admin-1', email: 'platform@example.test' },
  profile = {
    id: 'admin-1',
    email: 'platform@example.test',
    username: 'Platform Admin',
    name: 'Platform Admin',
    role: 'super_admin',
    role_label: 'Super Admin',
    role_rank: 100,
  },
  clubError = null,
  inviteError = null,
  roleSeedError = null,
} = {}) {
  const calls = []
  const club = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Disposable Club FC',
    contact_email: 'owner@example.test',
    contact_phone: '',
    plan_key: 'small_club',
    plan_status: 'past_due',
    is_plan_comped: false,
    status: 'active',
    created_at: '2026-06-24T09:00:00.000Z',
  }
  const invite = {
    id: '22222222-2222-4222-8222-222222222222',
    invite_token: '33333333-3333-4333-8333-333333333333',
  }

  class Query {
    constructor(table) {
      this.table = table
      this.action = ''
    }

    insert(payload) {
      this.action = 'insert'
      calls.push({ table: this.table, action: 'insert', payload })
      return this
    }

    update(payload) {
      this.action = 'update'
      calls.push({ table: this.table, action: 'update', payload })
      return this
    }

    select(columns) {
      calls.push({ table: this.table, action: this.action || 'select', columns })
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

    eq(column, value) {
      calls.push({ table: this.table, action: this.action || 'eq', column, value })
      return this
    }

    maybeSingle() {
      if (this.table === 'users') {
        return Promise.resolve({ data: profile, error: null })
      }

      return Promise.resolve({ data: null, error: null })
    }

    single() {
      if (this.table === 'clubs') {
        return Promise.resolve(clubError ? { data: null, error: clubError } : { data: club, error: null })
      }

      if (this.table === 'club_owner_invites') {
        return Promise.resolve(inviteError ? { data: null, error: inviteError } : { data: invite, error: null })
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
        getUser: async () => (
          authUser
            ? { data: { user: authUser }, error: null }
            : { data: { user: null }, error: new Error('Invalid token') }
        ),
      },
      from: (table) => new Query(table),
      rpc: async (name, payload) => {
        calls.push({ action: 'rpc', name, payload })
        return { data: null, error: roleSeedError }
      },
    },
  }
}

test('createPlatformClubResult sends production owner invites and reports accepted delivery', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })
  const mock = createMockSupabase()
  const emailCalls = []
  const response = await createPlatformClubResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
    sendOwnerInviteEmailImpl: async (payload) => {
      emailCalls.push(payload)
      return { data: { id: 'email-1' } }
    },
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.invite.sent, true)
  assert.equal(parsed.body.invite.emailFailed, false)
  assert.equal(parsed.body.invite.deliveryStatus, 'accepted')
  assert.equal(parsed.body.invite.deliveryPolicy, 'production')
  assert.equal(emailCalls.length, 1)
  assert.equal(mock.calls.some((call) => call.table === 'club_owner_invites' && call.action === 'update'), true)
})

test('createPlatformClubResult skips email on staging and labels the invite correctly', async () => {
  setEnv({
    BRANCH: 'staging',
    CONTEXT: 'branch-deploy',
    NODE_ENV: 'production',
    RESEND_API_KEY: '',
  })
  const mock = createMockSupabase()
  const emailCalls = []
  const response = await createPlatformClubResult(createEvent({}, { host: 'football-os-staging.netlify.app' }), {
    supabaseAdmin: mock.supabaseAdmin,
    sendOwnerInviteEmailImpl: async (payload) => {
      emailCalls.push(payload)
      return { data: { id: 'email-1' } }
    },
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.invite.sent, false)
  assert.equal(parsed.body.invite.emailFailed, false)
  assert.equal(parsed.body.invite.deliveryStatus, 'skipped')
  assert.equal(parsed.body.invite.deliveryPolicy, 'staging')
  assert.match(parsed.body.invite.deliveryMessage, /staging environment policy/)
  assert.equal(emailCalls.length, 0)
})

test('createPlatformClubResult skips email on deploy preview, local development, and test policy', async () => {
  const cases = [
    {
      env: { CONTEXT: 'deploy-preview', NODE_ENV: 'production', RESEND_API_KEY: 'resend-fixture-key' },
      expectedPolicy: 'deploy_preview',
    },
    {
      env: { CONTEXT: '', NETLIFY_DEV: 'true', NODE_ENV: 'development', RESEND_API_KEY: 'resend-fixture-key' },
      expectedPolicy: 'local',
    },
    {
      env: { CONTEXT: '', NODE_ENV: 'test', RESEND_API_KEY: 'resend-fixture-key' },
      expectedPolicy: 'test',
    },
  ]

  for (const nextCase of cases) {
    setEnv(nextCase.env)
    const mock = createMockSupabase()
    const emailCalls = []
    const response = await createPlatformClubResult(createEvent(), {
      supabaseAdmin: mock.supabaseAdmin,
      sendOwnerInviteEmailImpl: async (payload) => {
        emailCalls.push(payload)
        return { data: { id: 'email-1' } }
      },
    })
    const parsed = parseResponse(response)

    assert.equal(parsed.statusCode, 200)
    assert.equal(parsed.body.invite.sent, false)
    assert.equal(parsed.body.invite.deliveryStatus, 'skipped')
    assert.equal(parsed.body.invite.deliveryPolicy, nextCase.expectedPolicy)
    assert.equal(emailCalls.length, 0)
  }
})

test('createPlatformClubResult does not let browser data skip production email delivery', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })
  const mock = createMockSupabase()
  const emailCalls = []
  const response = await createPlatformClubResult(createEvent({
    isStaging: true,
    deliveryPolicy: 'skip',
  }, {
    host: 'football-os-staging.netlify.app',
  }), {
    supabaseAdmin: mock.supabaseAdmin,
    sendOwnerInviteEmailImpl: async (payload) => {
      emailCalls.push(payload)
      return { data: { id: 'email-1' } }
    },
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.invite.sent, true)
  assert.equal(parsed.body.invite.deliveryStatus, 'accepted')
  assert.equal(parsed.body.invite.deliveryPolicy, 'production')
  assert.equal(emailCalls.length, 1)
})

test('createPlatformClubResult fails before creating records when production email is not configured', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: '',
  })
  const mock = createMockSupabase()
  const response = await createPlatformClubResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 500)
  assert.equal(parsed.body.code, 'email_environment_error')
  assert.equal(mock.calls.some((call) => call.table === 'clubs' && call.action === 'insert'), false)
  assert.equal(mock.calls.some((call) => call.table === 'club_owner_invites' && call.action === 'insert'), false)
})

test('createPlatformClubResult preserves manual invite link when email provider rejects the send', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })
  const mock = createMockSupabase()
  const response = await createPlatformClubResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
    sendOwnerInviteEmailImpl: async () => {
      throw Object.assign(new Error('Domain is not verified'), { statusCode: 403, code: 'provider_rejected' })
    },
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.invite.sent, false)
  assert.equal(parsed.body.invite.emailFailed, true)
  assert.equal(parsed.body.invite.deliveryStatus, 'failed')
  assert.match(parsed.body.invite.url, /\/club-invite\//)
  assert.match(parsed.body.warning, /could not be sent/)
})

test('createPlatformClubResult represents provider timeouts as failed delivery with a manual link', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })
  const mock = createMockSupabase()
  const response = await createPlatformClubResult(createEvent(), {
    supabaseAdmin: mock.supabaseAdmin,
    sendOwnerInviteEmailImpl: async () => {
      throw Object.assign(new Error('Provider timed out'), { statusCode: 504, code: 'provider_timeout' })
    },
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.invite.sent, false)
  assert.equal(parsed.body.invite.emailFailed, true)
  assert.equal(parsed.body.invite.deliveryStatus, 'failed')
  assert.match(parsed.body.invite.url, /\/club-invite\//)
  assert.match(parsed.body.warning, /could not be sent/)
})

test('createPlatformClubResult rejects missing required form data before creating records', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })
  const mock = createMockSupabase()
  const response = await createPlatformClubResult(createEvent({
    name: '',
  }), {
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 400)
  assert.equal(parsed.body.message, 'Club name is required.')
  assert.equal(mock.calls.some((call) => call.table === 'clubs'), false)
})
