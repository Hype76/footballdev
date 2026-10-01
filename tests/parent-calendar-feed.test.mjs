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

const unfolded = body => body.replace(/\r\n /g, '')

test('confirmed fixtures have London kickoff and a non-zero end, with stable identity on edits', () => {
  const fixture = { id: 'fixture', date: '2026-10-17', time: '10:00:00', title: 'Team v Opponent', event_type: 'match_day', response: 'available', updated_at: '2026-10-01T11:00:00Z' }
  const first = unfolded(buildAcceptedCalendarFeed([fixture], 'link'))
  assert.match(first, /DTSTART;TZID=Europe\/London:20261017T100000\r\nDTEND;TZID=Europe\/London:20261017T120000/)
  assert.match(first, /LAST-MODIFIED:20261001T110000Z/)
  assert.doesNotMatch(first, /DTSTART;VALUE=DATE/)
  const moved = unfolded(buildAcceptedCalendarFeed([{ ...fixture, date: '2026-11-17', time: '18:30', duration_minutes: 90 }], 'link'))
  assert.match(moved, /DTSTART;TZID=Europe\/London:20261117T183000\r\nDTEND;TZID=Europe\/London:20261117T200000/)
  assert.equal(first.match(/UID:([^\r]+)/)[1], moved.match(/UID:([^\r]+)/)[1])
})

test('missing kickoff is labelled Time TBC, rather than a fictional midnight fixture', () => {
  const body = buildAcceptedCalendarFeed([{ id: 'tbc', date: '2026-10-17', time: '', event_type: 'match_day', title: 'Time unknown', response: 'available' }], 'link')
  assert.match(body, /DTSTART;VALUE=DATE:20261017\r\nDTEND;VALUE=DATE:20261018/)
  assert.match(body, /SUMMARY:Time unknown \(Time TBC\)/)
  assert.doesNotMatch(body, /20261017T000000/)
})

test('UTC training preserves both supplied instants; local fixture end crosses midnight', () => {
  const body = buildAcceptedCalendarFeed([
    { id: 'training', starts_at: '2026-10-01T17:45:00Z', ends_at: '2026-10-01T19:00:00Z', response: 'available' },
    { id: 'late', date: '2026-10-31', time: '23:15', response: 'available' },
  ], 'link')
  assert.match(body, /DTSTART:20261001T174500Z\r\nDTEND:20261001T190000Z/)
  assert.match(body, /DTSTART;TZID=Europe\/London:20261031T231500\r\nDTEND;TZID=Europe\/London:20261101T011500/)
})

test('accepted cancelled, postponed and deleted items are excluded even if a loader returns them', () => {
  const event = { date: '2026-10-17', time: '10:00', response: 'available' }
  const body = buildAcceptedCalendarFeed([
    { ...event, id: 'cancelled', status: 'cancelled' },
    { ...event, id: 'postponed', status: 'postponed' },
    { ...event, id: 'removed', deleted_at: '2026-10-01T00:00:00Z' },
    { ...event, id: 'cancelled-at', cancelled_at: '2026-10-01T00:00:00Z' },
    { ...event, id: 'active', status: 'scheduled' },
  ], 'link')
  assert.equal((body.match(/BEGIN:VEVENT/g) || []).length, 1)
  assert.match(body, /UID:link-active/)
})

test('long UTF-8 calendar text and identities fold safely to 75 octets', () => {
  const title = 'Training '.repeat(15) + 'caf\u00e9'
  const id = 'a'.repeat(36)
  const body = buildAcceptedCalendarFeed([{ id, date: '2026-10-17', time: '10:00', title, response: 'available' }], 'b'.repeat(36))
  for (const line of body.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line)
  assert.match(unfolded(body), new RegExp(`UID:${'b'.repeat(36)}-${id}@footballplayer.online`))
  assert.ok(unfolded(body).includes(`SUMMARY:${title}`))
})

test('malformed dates and times cannot create malformed calendar events', () => {
  const body = buildAcceptedCalendarFeed([
    { id: 'time-as-date', date: '10:00', time: '10:00', response: 'available' },
    { id: 'time-as-timestamp', starts_at: '10:00', response: 'available' },
    { id: 'impossible-date', date: '2026-02-31', time: '10:00', response: 'available' },
    { id: 'impossible-time', date: '2026-10-17', time: '25:00', response: 'available' },
  ], 'link')
  assert.doesNotMatch(body, /BEGIN:VEVENT/)
})

test('feed handler reflects changed and cancelled attendance on subsequent reads', async () => {
  const records = { parent_calendar_feed_tokens: { auth_user_id: 'user', parent_link_id: 'link' }, parent_player_links: { id: 'link', player_id: 'player', club_id: 'club', team_id: 'team' }, players: { id: 'player', team_id: 'team' }, clubs: { id: 'club', name: 'Test club' } }
  const createClient = () => ({ from: table => {
    const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: async () => ({ data: records[table], error: null }) }
    return query
  } })
  let status = 'scheduled'
  const loadAttendance = async () => [{ id: 'fixture', date: '2026-10-17', time: '10:00', response: 'available', status }]
  const event = { httpMethod: 'GET', queryStringParameters: { token: 'a'.repeat(64) } }
  const first = await handleParentCalendarFeed(event, { createClient, loadAttendance })
  assert.match(first.body, /DTSTART;TZID=Europe\/London:20261017T100000/)
  assert.equal(first.headers['Cache-Control'], 'private, no-store')
  status = 'cancelled'
  const second = await handleParentCalendarFeed(event, { createClient, loadAttendance })
  assert.equal(second.statusCode, 200)
  assert.doesNotMatch(second.body, /BEGIN:VEVENT/)
})
