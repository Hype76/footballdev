import assert from 'node:assert/strict'
import { test } from 'node:test'
import webpush from 'web-push'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const [{ handler }, { supabaseAdmin }] = await Promise.all([
  import('../netlify/functions/send-match-day-push.js'),
  import('../netlify/functions/lib/_supabase.js'),
])

function queryResult(result) {
  let query
  query = new Proxy({}, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve, reject) => Promise.resolve(result).then(resolve, reject)
      }

      return () => query
    },
  })
  return query
}

function responseBody(response) {
  return JSON.parse(response.body)
}

test('Match Day push keeps web delivery when the optional mobile table is unavailable', async (t) => {
  const originalFrom = supabaseAdmin.from
  const originalGetUser = supabaseAdmin.auth.getUser
  const originalSendNotification = webpush.sendNotification
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  const originalError = console.error
  const vapidKeys = webpush.generateVAPIDKeys()

  process.env.VITE_WEB_PUSH_PUBLIC_KEY = vapidKeys.publicKey
  process.env.WEB_PUSH_PRIVATE_KEY = vapidKeys.privateKey
  process.env.WEB_PUSH_SUBJECT = 'mailto:test@example.com'

  t.after(() => {
    supabaseAdmin.from = originalFrom
    supabaseAdmin.auth.getUser = originalGetUser
    webpush.sendNotification = originalSendNotification
    globalThis.fetch = originalFetch
    console.warn = originalWarn
    console.error = originalError
    delete process.env.VITE_WEB_PUSH_PUBLIC_KEY
    delete process.env.WEB_PUSH_PRIVATE_KEY
    delete process.env.WEB_PUSH_SUBJECT
  })

  async function runScenario(mobileResult) {
    const tables = []
    const warnings = []
    const errors = []
    const webPushes = []

    supabaseAdmin.auth.getUser = async () => ({
      data: { user: { id: 'staff-1', email: 'staff@example.com' } },
      error: null,
    })
    supabaseAdmin.from = (table) => {
      tables.push(table)

      if (table === 'users') {
        return queryResult({
          data: { id: 'staff-1', email: 'staff@example.com', role: 'coach', role_rank: 30, club_id: 'club-1', status: 'active' },
          error: null,
        })
      }

      if (table === 'user_club_memberships') {
        return queryResult({
          data: { auth_user_id: 'staff-1', role: 'coach', role_rank: 30, club_id: 'club-1' },
          error: null,
        })
      }

      if (table === 'clubs') {
        return queryResult({ data: { id: 'club-1', status: 'active' }, error: null })
      }

      if (table === 'match_days') {
        return queryResult({
          data: {
            id: 'match-1',
            club_id: 'club-1',
            team_id: 'team-1',
            opponent: 'Test United',
            home_score: 1,
            away_score: 0,
            teams: { name: 'Test FC' },
          },
          error: null,
        })
      }

      if (table === 'parent_push_subscriptions') {
        return queryResult({
          data: [{ id: 'web-1', endpoint: 'https://push.example.test/1', p256dh: 'p256dh', auth: 'auth' }],
          error: null,
        })
      }

      if (table === 'mobile_push_devices') {
        return queryResult(mobileResult)
      }

      if (table === 'notification_events') {
        return queryResult({ data: null, error: null })
      }

      throw new Error(`Unexpected table: ${table}`)
    }
    webpush.sendNotification = async (...args) => {
      webPushes.push(args)
    }
    globalThis.fetch = async () => {
      throw new Error('A real mobile push must not be sent during this test.')
    }
    console.warn = (...args) => warnings.push(args.join(' '))
    console.error = (...args) => errors.push(args)

    const response = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: JSON.stringify({ matchDayId: 'match-1', type: 'update' }),
    })

    return { response, tables, warnings, errors, webPushes }
  }

  await t.test('PGRST205 skips native lookup and continues web push delivery', async () => {
    const result = await runScenario({
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.mobile_push_devices' in the schema cache" },
    })

    assert.equal(result.response.statusCode, 200)
    assert.equal(responseBody(result.response).sent, 1)
    assert.equal(result.webPushes.length, 1)
    assert.match(result.warnings.join('\n'), /Mobile push devices table is not available/)
  })

  await t.test('existing PostgreSQL missing-table fallback still works', async () => {
    const result = await runScenario({
      data: null,
      error: { code: '42P01', message: 'relation "mobile_push_devices" does not exist' },
    })

    assert.equal(result.response.statusCode, 200)
    assert.equal(responseBody(result.response).sent, 1)
    assert.equal(result.webPushes.length, 1)
  })

  await t.test('successful mobile lookup keeps the existing native path', async () => {
    const result = await runScenario({
      data: [{
        id: 'mobile-1',
        auth_user_id: 'parent-1',
        device_token: 'non-expo-test-token',
        parent_link_id: 'link-1',
      }],
      error: null,
    })

    assert.equal(result.response.statusCode, 200)
    assert.equal(responseBody(result.response).sent, 1)
    assert.equal(result.webPushes.length, 1)
    assert.ok(result.tables.includes('notification_events'))
  })

  await t.test('unexpected database errors still fail before any push is sent', async () => {
    const result = await runScenario({
      data: null,
      error: { code: '42501', message: 'permission denied for table mobile_push_devices' },
    })

    assert.equal(result.response.statusCode, 500)
    assert.match(responseBody(result.response).message, /permission denied/)
    assert.equal(result.webPushes.length, 0)
    assert.equal(result.warnings.length, 0)
    assert.equal(result.errors.length, 1)
  })
})
