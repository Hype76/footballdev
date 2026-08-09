import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const [{ handler }, { supabaseAdmin }] = await Promise.all([
  import('../netlify/functions/send-parent-mobile-push.js'),
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

test('parent message delivery stays successful when the optional mobile table is unavailable', async (t) => {
  const originalFrom = supabaseAdmin.from
  const originalGetUser = supabaseAdmin.auth.getUser
  const originalWarn = console.warn
  const originalError = console.error
  const warnings = []
  const errors = []

  t.after(() => {
    supabaseAdmin.from = originalFrom
    supabaseAdmin.auth.getUser = originalGetUser
    console.warn = originalWarn
    console.error = originalError
  })

  supabaseAdmin.auth.getUser = async () => ({
    data: { user: { id: 'staff-1', email: 'staff@example.com' } },
    error: null,
  })
  supabaseAdmin.from = (table) => {
    if (table === 'users') {
      return queryResult({
        data: {
          id: 'staff-1',
          email: 'staff@example.com',
          role: 'coach',
          role_rank: 30,
          club_id: 'club-1',
          status: 'active',
        },
        error: null,
      })
    }

    if (table === 'user_club_memberships') {
      return queryResult({
        data: {
          auth_user_id: 'staff-1',
          role: 'coach',
          role_rank: 30,
          club_id: 'club-1',
        },
        error: null,
      })
    }

    if (table === 'clubs') {
      return queryResult({ data: { id: 'club-1', is_plan_comped: true, plan_key: 'single_team', plan_status: 'active', status: 'active' }, error: null })
    }

    if (table === 'billing_access_state_events') {
      return queryResult({ data: null, error: null })
    }

    if (table === 'communication_logs') {
      return queryResult({
        data: {
          id: 'message-1',
          club_id: 'club-1',
          player_id: 'player-1',
          user_name: 'Coach',
          metadata: {
            playerName: 'FP TEST Player',
            subject: 'Development update',
          },
          created_at: '2026-07-29T12:00:00.000Z',
        },
        error: null,
      })
    }

    if (table === 'parent_player_links') {
      return queryResult({
        data: [{
          id: 'link-1',
          auth_user_id: 'parent-1',
          club_id: 'club-1',
          team_id: 'team-1',
        }],
        error: null,
      })
    }

    if (table === 'parent_mobile_push_installations') {
      return queryResult({
        data: null,
        error: {
          code: 'PGRST205',
          message: "Could not find the table 'public.parent_mobile_push_installations' in the schema cache",
        },
      })
    }

    throw new Error(`Unexpected table: ${table}`)
  }
  console.warn = (...args) => warnings.push(args.join(' '))
  console.error = (...args) => errors.push(args)

  const response = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: JSON.stringify({
      id: 'message-1',
      type: 'parent_message',
    }),
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(responseBody(response), {
    failed: 0,
    parentLinks: 1,
    sent: 0,
    success: true,
  })
  assert.match(warnings.join('\n'), /Mobile push devices table is not available/)
  assert.equal(errors.length, 0)
})
