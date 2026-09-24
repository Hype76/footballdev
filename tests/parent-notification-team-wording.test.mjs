import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const [{ getResourcePayload, getTrainingAvailabilityPayload }, { supabaseAdmin }] = await Promise.all([
  import('../netlify/functions/send-parent-mobile-push.js'),
  import('../netlify/functions/lib/_supabase.js'),
])

function queryResult(data) {
  let query
  query = new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject)
      return () => query
    },
  })
  return query
}

test('parent resource and training alerts name the sending team or club', async (t) => {
  const originalFrom = supabaseAdmin.from
  t.after(() => { supabaseAdmin.from = originalFrom })

  for (const teamId of ['team-1', null]) {
    const rows = {
      resource_library_parent_notifications: { id: 'notice-1', club_id: 'club-1', team_id: teamId, resource_id: 'resource-1', parent_link_id: 'link-1' },
      resource_library_items: { id: 'resource-1', club_id: 'club-1', team_id: teamId, title: 'Training guide', archived_at: null },
      training_availability_request_players: { id: 'player-request-1', request_id: 'request-1', club_id: 'club-1', team_id: teamId, calendar_event_id: 'event-1', parent_link_id: 'link-1', recipient_type: 'parent', status: 'pending', response_deadline_at: '2099-01-01T00:00:00Z', token_revoked_at: null },
      training_availability_requests: { id: 'request-1', status: 'active', occurrence_starts_at: '2099-01-02T00:00:00Z' },
      calendar_events: { id: 'event-1', title: 'Training', starts_at: '2099-01-02T00:00:00Z', cancelled_at: null },
    }
    supabaseAdmin.from = (table) => {
      assert.ok(Object.hasOwn(rows, table), `Unexpected table: ${table}`)
      return queryResult(rows[table])
    }

    const resource = await getResourcePayload({ id: 'notice-1', profile: { clubId: 'club-1' } })
    const training = await getTrainingAvailabilityPayload({ id: 'player-request-1', profile: { clubId: 'club-1' } })
    const sender = teamId ? 'team' : 'club'

    assert.equal(resource.minimalBody, `Your ${sender} has shared a new resource.`)
    assert.equal(training.minimalBody, `Your ${sender} needs an attendance response for an upcoming training session.`)
    assert.equal(resource.teamId, teamId)
    assert.equal(training.teamId, teamId)
  }
})
