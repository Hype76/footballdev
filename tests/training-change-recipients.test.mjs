import test from 'node:test'
import assert from 'node:assert/strict'
import { getTrainingChangeParentLinkIds } from '../netlify/functions/lib/_training-change-recipients.js'

function fakeDb(tables) {
  return { from(name) {
    let rows = tables[name]
    const query = {
      select() { return query },
      eq(key, value) { rows = rows.filter(row => row[key] === value); return query },
      in(key, values) { rows = rows.filter(row => values.includes(row[key])); return query },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
    }
    return query
  } }
}

test('training cancellation recipients respect contact, team, timing and revocation', async () => {
  const base = { club_id: 'club', team_id: 'team' }
  const request = { ...base, id: 'r', calendar_event_id: 'event', status: 'sent', occurrence_starts_at: '2027-01-02T18:00:00Z' }
  const row = { ...base, request_id: 'r', player_id: 'player', parent_link_id: 'valid', recipient_type: 'parent', status: 'sent', token_revoked_at: null, response_deadline_at: null }
  const link = { ...base, id: 'valid', player_id: 'player', email: 'valid@example.test', status: 'active' }
  const tables = { training_availability_requests: [request], training_availability_request_players: [row], parent_player_links: [link, { ...link, id: 'other', email: 'other@example.test' }, { ...link, id: 'wrong-team', team_id: 'other' }, { ...link, id: 'inactive', status: 'revoked' }] }
  const run = () => getTrainingChangeParentLinkIds(fakeDb(tables), { clubId: 'club', teamId: 'team', eventId: 'event', now: Date.parse('2027-01-01T00:00:00Z') })
  assert.deepEqual(await run(), ['valid'])
  row.status = 'responded'
  assert.deepEqual(await run(), ['valid'])
  row.parent_link_id = null
  row.recipient_email = ' VALID@example.test '
  assert.deepEqual(await run(), ['valid'])
  for (const [field, denied, restored] of [['token_revoked_at', '2026-12-01T00:00:00Z', null], ['status', 'cancelled', 'responded'], ['recipient_type', 'player', 'parent'], ['response_deadline_at', '2026-12-31T00:00:00Z', null]]) {
    row[field] = denied
    assert.deepEqual(await run(), [], field)
    row[field] = restored
  }
  request.status = 'cancelled'
  assert.deepEqual(await run(), [])
  request.status = 'sent'
  request.occurrence_starts_at = '2026-12-31T18:00:00Z'
  assert.deepEqual(await run(), [])
})
