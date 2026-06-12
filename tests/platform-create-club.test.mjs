import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { createPlatformClubResult } = await import('../netlify/functions/platform-create-club.js')

function createEvent(body = {}, headers = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: 'Bearer token-123',
      host: 'footballplayer.online',
      'x-forwarded-proto': 'https',
      ...headers,
    },
    body: JSON.stringify(body),
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
  clubError = null,
  inviteError = null,
  profile = {
    id: 'admin-1',
    email: 'platform@example.test',
    username: 'Platform Admin',
    name: 'Platform Admin',
    role: 'super_admin',
    role_label: 'Super Admin',
    role_rank: 100,
  },
  roleSeedError = null,
} = {}) {
  const calls = []
  const club = {
    id: 'club-1',
    name: 'Test FC',
    contact_email: 'owner@example.test',
    contact_phone: '',
    plan_key: 'small_club',
    plan_status: 'past_due',
    is_plan_comped: false,
    status: 'active',
    created_at: '2026-06-12T09:00:00.000Z',
  }
  const invite = {
    id: 'invite-1',
    invite_token: 'invite-token-1',
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

    select() {
      return this
    }

    or() {
      return this
    }

    limit() {
      return this
    }

    eq() {
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

test('createPlatformClubResult creates a club, owner invite, and sends the first admin email', async () => {
  const mock = createMockSupabase()
  const emailCalls = []
  const response = await createPlatformClubResult(createEvent({
    name: 'Test FC',
    ownerEmail: 'owner@example.test',
    contactEmail: '',
    planKey: 'small_club',
    billingMode: 'paid',
  }), {
    sendOwnerInviteEmailImpl: async (payload) => {
      emailCalls.push(payload)
      return { data: { id: 'email-1' } }
    },
    stagingRequestImpl: () => false,
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.invite.sent, true)
  assert.equal(emailCalls.length, 1)
  assert.equal(mock.calls.some((call) => call.table === 'clubs' && call.action === 'insert'), true)
  assert.equal(mock.calls.some((call) => call.table === 'club_owner_invites' && call.action === 'insert'), true)
})

test('createPlatformClubResult rejects missing platform admin identity', async () => {
  const mock = createMockSupabase({ authUser: null })

  await assert.rejects(
    () => createPlatformClubResult(createEvent({
      name: 'Test FC',
      ownerEmail: 'owner@example.test',
    }), {
      supabaseAdmin: mock.supabaseAdmin,
    }),
    (error) => {
      assert.equal(error.statusCode, 401)
      assert.equal(error.message, 'Platform admin login is required.')
      return true
    },
  )
})

test('createPlatformClubResult rejects missing required form data before creating records', async () => {
  const mock = createMockSupabase()
  const response = await createPlatformClubResult(createEvent({
    name: '',
    ownerEmail: 'owner@example.test',
  }), {
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 400)
  assert.equal(parsed.body.message, 'Club name is required.')
  assert.equal(mock.calls.some((call) => call.table === 'clubs'), false)
})

test('createPlatformClubResult preserves the club when owner invite insert fails', async () => {
  const mock = createMockSupabase({
    inviteError: {
      code: 'PGRST205',
      message: "Could not find the table 'public.club_owner_invites' in the schema cache",
    },
  })

  await assert.rejects(
    () => createPlatformClubResult(createEvent({
      name: 'Test FC',
      ownerEmail: 'owner@example.test',
    }), {
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

test('createPlatformClubResult preserves invite link when email provider rejects the send', async () => {
  const mock = createMockSupabase()
  const response = await createPlatformClubResult(createEvent({
    name: 'Test FC',
    ownerEmail: 'owner@example.test',
  }), {
    sendOwnerInviteEmailImpl: async () => {
      const error = new Error('Domain is not verified')
      error.publicMessage = 'Club invite email could not be sent. Please try again in a moment.'
      error.providerStatus = 403
      throw error
    },
    stagingRequestImpl: () => false,
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(parsed.body.invite.emailFailed, true)
  assert.equal(parsed.body.invite.sent, false)
  assert.match(parsed.body.warning, /could not be sent/)
  assert.match(parsed.body.invite.url, /\/club-invite\//)
})

test('createPlatformClubResult ignores stale cached stats and uses authoritative form inputs', async () => {
  const mock = createMockSupabase()
  const response = await createPlatformClubResult(createEvent({
    name: 'Fresh Club FC',
    ownerEmail: 'owner@example.test',
    stats: { clubs: [null, {}] },
  }), {
    sendOwnerInviteEmailImpl: async () => ({ data: { id: 'email-1' } }),
    stagingRequestImpl: () => false,
    supabaseAdmin: mock.supabaseAdmin,
  })
  const parsed = parseResponse(response)

  assert.equal(parsed.statusCode, 200)
  assert.equal(parsed.body.success, true)
  assert.equal(mock.calls.find((call) => call.table === 'clubs')?.payload.name, 'Fresh Club FC')
})
