import assert from 'node:assert/strict'
import test from 'node:test'
process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key'
const { buildAcceptedCalendarFeed, handleParentCalendarFeed } = await import('../netlify/functions/parent-calendar-feed.js')

test('subscription includes accepted events only and escapes calendar text', () => {
  const body = buildAcceptedCalendarFeed([
    { id: 'one', date: '2026-09-28', time: '20:00:00Z', title: 'Training, pitch 3', response: 'available' },
    { id: 'two', date: '2026-09-29', time: '20:00:00Z', title: 'Unanswered', response: 'awaiting_response' },
    { id: 'three', date: '2026-09-30', time: '20:00:00Z', title: 'Declined', response: 'unavailable' },
  ], 'link-id')
  assert.match(body, /SUMMARY:Training\\, pitch 3/)
  assert.match(body, /UID:link-id-one@footballplayer.online/)
  assert.doesNotMatch(body, /Unanswered|Declined/)
  assert.match(body, /END:VCALENDAR\r\n$/)
})

test('calendar feed rejects missing secret and unauthenticated token creation', async () => {
  const createClient = () => ({ auth: { getUser: async () => ({ data: null, error: new Error('missing') }) } })
  const missingFeed = await handleParentCalendarFeed({ httpMethod: 'GET', queryStringParameters: {} }, { createClient })
  const missingAuth = await handleParentCalendarFeed({ httpMethod: 'POST', headers: {}, body: '{}' }, { createClient })
  assert.equal(missingFeed.statusCode, 404)
  assert.equal(missingAuth.statusCode, 401)
})

test('calendar feed accepts UUID variants but still checks the signed-in player link', async () => {
  let lookedUpLink = false
  const createClient = () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-id' } }, error: null }) },
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => { lookedUpLink = true; return { data: null, error: null } } }
      return query
    },
  })
  const versionSeven = await handleParentCalendarFeed({ httpMethod: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ parentLinkId: '019c6e27-e55b-73d1-87d8-4e01f1f75043' }) }, { createClient })
  assert.equal(versionSeven.statusCode, 403)
  assert.equal(lookedUpLink, true)
  lookedUpLink = false
  const queryFallback = await handleParentCalendarFeed({ httpMethod: 'POST', headers: { authorization: 'Bearer token' }, queryStringParameters: { parentLinkId: '019c6e27-e55b-43d1-87d8-4e01f1f75043' }, body: '{}' }, { createClient })
  assert.equal(queryFallback.statusCode, 403)
  assert.equal(lookedUpLink, true)
  const malformed = await handleParentCalendarFeed({ httpMethod: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ parentLinkId: 'not-a-uuid' }) }, { createClient })
  assert.equal(malformed.statusCode, 400)
})

test('revoked player access makes an existing subscription unavailable', async () => {
  const records = {
    parent_calendar_feed_tokens: { auth_user_id: 'user-id', parent_link_id: 'link-id' },
    parent_player_links: null,
  }
  const createClient = () => ({ from: table => {
    const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: async () => ({ data: records[table] || null, error: null }) }
    return query
  } })
  const result = await handleParentCalendarFeed({ httpMethod: 'GET', queryStringParameters: { token: 'a'.repeat(64) } }, { createClient, loadAttendance: () => { throw new Error('Revoked access must not read attendance') } })
  assert.equal(result.statusCode, 404)
})
