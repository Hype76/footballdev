import test from 'node:test'
import assert from 'node:assert/strict'
process.env.VITE_SUPABASE_URL ||= 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
const { sendRoleAssignmentAlert } = await import('../netlify/functions/select-match-day-volunteer.js')

function clientFor(channel) {
  const written = []
  return {
    written,
    from(table) {
      const query = {
        select() { return this }, eq() { return this }, neq() { return this }, in() { return this },
        upsert(rows) { written.push(...rows); return this },
        then(resolve) {
          const data = table === 'parent_communication_preferences' ? [{ auth_user_id: 'user', communication_channel: channel }]
            : table === 'parent_mobile_notification_events' ? [{ id: 'notice' }]
              : [{ expo_push_token: 'ExponentPushToken[test]' }]
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    },
  }
}

test('role alerts target the assigned parent and honour their app preference', async () => {
  for (const role of ['linesman', 'referee']) {
    const client = clientFor('both')
    let messages = []
    const result = await sendRoleAssignmentAlert(client, { match: { id: 'match', club_id: 'club', team_id: 'team', opponent: 'Opposition' }, parentLink: { id: 'link', auth_user_id: 'user' }, role }, async (value) => { messages = value; return { sent: 1, failed: 0 } })
    assert.equal(result.inbox, true)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].data.parentLinkId, 'link')
    assert.match(messages[0].body, new RegExp(role))
    assert.equal(client.written[0].parent_link_id, 'link')
    const muted = clientFor('email')
    let called = false
    await sendRoleAssignmentAlert(muted, { match: { id: 'match' }, parentLink: { id: 'link', auth_user_id: 'user' }, role }, async () => { called = true })
    assert.equal(called, false)
    assert.equal(muted.written.length, 0)
  }
})
