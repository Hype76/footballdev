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
  PRODUCTION_URL: process.env.PRODUCTION_URL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  URL: process.env.URL,
  VITE_APP_URL: process.env.VITE_APP_URL,
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
    club_id: null,
    status: 'active',
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
    expiresAt: '2026-07-03T09:00:00.000Z',
  }

  class Query {
    constructor(table) {
      this.table = table
      this.action = ''
      this.payload = null
    }

    insert(payload) {
      this.action = 'insert'
      this.payload = payload
      calls.push({ table: this.table, action: 'insert', payload })
      return this
    }

    update(payload) {
      this.action = 'update'
      this.payload = payload
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

      if (this.table === 'platform_admins') {
        return Promise.resolve({ data: profile?.role === 'super_admin' ? { id: profile.id, status: 'active' } : null, error: null })
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

        if (name === 'create_club_owner_invite_v2') {
          return inviteError ? { data: null, error: inviteError } : { data: invite, error: null }
        }

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
  assert.equal(parsed.body.invite.deliveryAttempted, true)
  assert.equal(parsed.body.invite.deliveryStatus, 'accepted')
  assert.equal(parsed.body.invite.deliveryPolicy, 'production')
  assert.equal(parsed.body.invite.deliveryReason, 'production_delivery_accepted')
  assert.equal(parsed.body.invite.deliveryMessage, 'Invite email accepted for delivery.')
  assert.equal(emailCalls.length, 1)
  assert.equal(mock.calls.some((call) => call.table === 'club_owner_invites' && call.action === 'update'), true)
})

test('createPlatformClubResult rejects missing or non-admin platform identity before creating records', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })

  const unauthenticatedMock = createMockSupabase({ authUser: null })
  await assert.rejects(
    () => createPlatformClubResult(createEvent(), {
      supabaseAdmin: unauthenticatedMock.supabaseAdmin,
    }),
    (error) => {
      assert.equal(error.statusCode, 401)
      assert.equal(error.code, 'unauthenticated')
      assert.equal(unauthenticatedMock.calls.some((call) => call.table === 'clubs' && call.action === 'insert'), false)
      return true
    },
  )

  const forbiddenMock = createMockSupabase({
    profile: { id: 'coach-1', email: 'coach@example.test', role: 'coach' },
  })
  await assert.rejects(
    () => createPlatformClubResult(createEvent(), {
      supabaseAdmin: forbiddenMock.supabaseAdmin,
    }),
    (error) => {
      assert.equal(error.statusCode, 403)
      assert.equal(error.code, 'forbidden')
      assert.equal(forbiddenMock.calls.some((call) => call.table === 'clubs' && call.action === 'insert'), false)
      return true
    },
  )
})

test('createPlatformClubResult treats production host as production when Netlify context is missing', async () => {
  setEnv({
    CONTEXT: '',
    NODE_ENV: '',
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
  assert.equal(parsed.body.invite.sent, true)
  assert.equal(parsed.body.invite.deliveryStatus, 'accepted')
  assert.equal(parsed.body.invite.deliveryPolicy, 'production')
  assert.equal(emailCalls.length, 1)
})

test('createPlatformClubResult blocks retired staging club creation', async () => {
  setEnv({
    BRANCH: 'staging',
    CONTEXT: 'branch-deploy',
    NODE_ENV: 'production',
    RESEND_API_KEY: '',
  })
  const mock = createMockSupabase()
  const emailCalls = []

  await assert.rejects(
    () => createPlatformClubResult(createEvent({}, { host: 'football-os-staging.netlify.app' }), {
      supabaseAdmin: mock.supabaseAdmin,
      sendOwnerInviteEmailImpl: async (payload) => {
        emailCalls.push(payload)
        return { data: { id: 'email-1' } }
      },
    }),
    /V1 staging club creation is retired/,
  )

  assert.equal(emailCalls.length, 0)
})

test('createPlatformClubResult blocks retired deploy preview club creation', async () => {
  setEnv({
    CONTEXT: 'deploy-preview',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })
  const mock = createMockSupabase()
  const emailCalls = []

  await assert.rejects(
    () => createPlatformClubResult(createEvent({}, { host: 'deploy-preview-123--footballplayer-online.netlify.app' }), {
      supabaseAdmin: mock.supabaseAdmin,
      sendOwnerInviteEmailImpl: async (payload) => {
        emailCalls.push(payload)
        return { data: { id: 'email-1' } }
      },
    }),
    /V1 deploy previews are retired/,
  )

  assert.equal(emailCalls.length, 0)
})

test('createPlatformClubResult skips email on local development and test policy', async () => {
  const cases = [
    {
      env: { CONTEXT: '', NETLIFY_DEV: 'true', NODE_ENV: 'development', RESEND_API_KEY: 'resend-fixture-key' },
      headers: { host: 'localhost:8888', 'x-forwarded-proto': 'http' },
      expectedPolicy: 'local',
      expectedReason: 'local_development_policy',
    },
    {
      env: { CONTEXT: '', NODE_ENV: 'test', RESEND_API_KEY: 'resend-fixture-key' },
      headers: { host: 'fixture.test' },
      expectedPolicy: 'test',
      expectedReason: 'test_policy',
    },
  ]

  for (const nextCase of cases) {
    setEnv(nextCase.env)
    const mock = createMockSupabase()
    const emailCalls = []
    const response = await createPlatformClubResult(createEvent({}, nextCase.headers), {
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
    assert.equal(parsed.body.invite.deliveryReason, nextCase.expectedReason)
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

test('createPlatformClubResult does not let browser data force local delivery to send', async () => {
  setEnv({
    CONTEXT: '',
    NETLIFY_DEV: 'true',
    NODE_ENV: 'development',
    RESEND_API_KEY: 'resend-fixture-key',
  })
  const mock = createMockSupabase()
  const emailCalls = []
  const response = await createPlatformClubResult(createEvent({
    forceEmailDelivery: true,
    deliveryPolicy: 'send',
  }, {
    host: 'localhost:8888',
    'x-forwarded-proto': 'http',
  }), {
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
  assert.equal(parsed.body.invite.deliveryPolicy, 'local')
  assert.equal(parsed.body.invite.deliveryReason, 'local_development_policy')
  assert.equal(emailCalls.length, 0)
})

test('createPlatformClubResult reports configuration error and keeps invite link when production email is not configured', async () => {
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

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.invite.sent, false)
  assert.equal(parsed.body.invite.emailFailed, true)
  assert.equal(parsed.body.invite.deliveryAttempted, false)
  assert.equal(parsed.body.invite.deliveryStatus, 'configuration_error')
  assert.equal(parsed.body.invite.deliveryPolicy, 'production')
  assert.equal(parsed.body.invite.deliveryReason, 'missing_email_configuration')
  assert.match(parsed.body.invite.deliveryMessage, /production email is not configured/)
  assert.match(parsed.body.invite.url, /\/club-invite#token=/)
  assert.match(parsed.body.warning, /production email is not configured/)
  assert.equal(mock.calls.some((call) => call.table === 'clubs' && call.action === 'insert'), true)
  assert.equal(mock.calls.some((call) => call.name === 'create_club_owner_invite_v2'), true)
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
  assert.equal(parsed.body.invite.deliveryAttempted, true)
  assert.equal(parsed.body.invite.deliveryStatus, 'failed')
  assert.equal(parsed.body.invite.deliveryReason, 'provider_rejected')
  assert.match(parsed.body.invite.url, /\/club-invite#token=/)
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
  assert.equal(parsed.body.invite.deliveryAttempted, true)
  assert.equal(parsed.body.invite.deliveryStatus, 'failed')
  assert.equal(parsed.body.invite.deliveryReason, 'provider_timeout')
  assert.match(parsed.body.invite.url, /\/club-invite#token=/)
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

test('createPlatformClubResult keeps Pilot internal and comped', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })

  const paidPilotMock = createMockSupabase()
  const paidPilotResponse = await createPlatformClubResult(createEvent({
    planKey: 'pilot',
    billingMode: 'paid',
  }), {
    supabaseAdmin: paidPilotMock.supabaseAdmin,
  })
  const parsedPaidPilot = parseResponse(paidPilotResponse)

  assert.equal(parsedPaidPilot.statusCode, 400)
  assert.match(parsedPaidPilot.body.message, /Pilot workspaces must use unpaid billing access/)
  assert.equal(paidPilotMock.calls.some((call) => call.table === 'clubs' && call.action === 'insert'), false)

  const unpaidPilotMock = createMockSupabase()
  const unpaidPilotResponse = await createPlatformClubResult(createEvent({
    planKey: 'pilot',
    billingMode: 'unpaid',
  }), {
    sendOwnerInviteEmailImpl: async () => ({ data: { id: 'email-1' } }),
    supabaseAdmin: unpaidPilotMock.supabaseAdmin,
  })
  const parsedUnpaidPilot = parseResponse(unpaidPilotResponse)
  const clubInsert = unpaidPilotMock.calls.find((call) => call.table === 'clubs' && call.action === 'insert')

  assert.equal(parsedUnpaidPilot.statusCode, 200)
  assert.equal(clubInsert.payload.plan_key, 'pilot')
  assert.equal(clubInsert.payload.plan_status, 'active')
  assert.equal(clubInsert.payload.is_plan_comped, true)
})

test('createPlatformClubResult preserves the club when owner invite insert fails', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })
  const mock = createMockSupabase({
    inviteError: {
      code: 'PGRST205',
      message: "Could not find the table 'public.club_owner_invites' in the schema cache",
    },
  })

  await assert.rejects(
    () => createPlatformClubResult(createEvent(), {
      supabaseAdmin: mock.supabaseAdmin,
    }),
    (error) => {
      assert.equal(error.stage, 'owner_invite_insert')
      assert.equal(error.partialState.clubCreated, true)
      assert.equal(error.partialState.inviteCreated, false)
      assert.match(error.publicMessage, /Club was created/)
      return true
    },
  )
})

test('createPlatformClubResult ignores stale cached stats and uses authoritative form inputs', async () => {
  setEnv({
    CONTEXT: 'production',
    NODE_ENV: 'production',
    RESEND_API_KEY: 'resend-fixture-key',
  })
  const mock = createMockSupabase()
  const response = await createPlatformClubResult(createEvent({
    name: 'Fresh Club FC',
    stats: { clubs: [null, {}] },
  }), {
    sendOwnerInviteEmailImpl: async () => ({ data: { id: 'email-1' } }),
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(mock.calls.find((call) => call.table === 'clubs')?.payload.name, 'Fresh Club FC')
})
