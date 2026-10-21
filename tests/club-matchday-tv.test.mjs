import assert from 'node:assert/strict'
import test from 'node:test'
import { canViewClubMatchdayTv, clubTvDate, newTvGoals, readTvPreferences, toClubTvMatch, tvMatchSides, tvMatchStatus, validTvDate, tvDateAfter } from '../src/lib/club-matchday-tv.js'
import { isClubTvLocked, setClubTvLocked } from '../src/lib/club-tv-lock.js'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key'
const { createClubMatchdayTvHandler, assertClubTvAuthority, CLUB_TV_MATCH_SELECT } = await import('../netlify/functions/club-matchday-tv.js')
const clubId = '11111111-1111-4111-8111-111111111111', otherClub = '22222222-2222-4222-8222-222222222222'
const profile = { role: 'admin', roleRank: 80, clubId, planKey: 'club', planStatus: 'active', isPlanComped: true, accountStatus: 'active', clubStatus: 'active' }
const fixture = (overrides = {}) => ({ id: 'match-1', club_id: clubId, team_id: 'team-1', teams: { id: 'team-1', club_id: clubId, name: 'U12 Blue' }, opponent: 'Visitors', home_away: 'away', match_date: '2026-10-21', status: 'live', home_score: 1, away_score: 2, timer_status: 'running', timer_elapsed_seconds: 1200, timer_started_at: '2026-10-21T10:00:00Z', match_day_events: [{ id: 'goal-1', event_type: 'goal', team_side: 'club', minute: 12, scorer_shirt_number: '9', scorer_name: 'PRIVATE PLAYER', assist_name: 'PRIVATE ASSIST', notes: 'PRIVATE NOTES' }], ...overrides })
function clientFor(rows = [], failure = null) {
  const calls = []
  return { calls, from(table) {
    const call = { table, filters: [], orders: [] }; calls.push(call)
    const chain = {
      select(value) { call.select = value; return chain },
      eq(...value) { call.filters.push(value); return chain },
      gte(...value) { call.filters.push(['gte', ...value]); return chain },
      lte(...value) { call.filters.push(['lte', ...value]); return chain },
      is(...value) { call.filters.push(value); return chain },
      order(...value) { call.orders.push(value); return chain },
      single() { return { data: { id: clubId, name: 'Our Club', theme_accent: '#1255aa' }, error: failure } },
      range(start, end) { call.range = [start, end]; return { data: (typeof rows === 'function' ? rows(call) : rows).slice(start, end + 1), error: failure } },
    }
    return chain
  } }
}
const request = (body = { clubId, date: '2026-10-21' }) => ({ httpMethod: 'POST', body: JSON.stringify(body), headers: {} })
function handler(options = {}) { return createClubMatchdayTvHandler({ authenticate: async () => profile, client: clientFor(), logger: { error() {} }, ...options }) }

test('TV access accepts active Club Admins and denies all other workspaces and roles', () => {
  assert.equal(canViewClubMatchdayTv(profile), true)
  for (const patch of [{ role: 'coach', roleRank: 90 }, { role: 'parent_portal' }, { role: 'super_admin' }, { planKey: 'team' }, { planStatus: 'cancelled', isPlanComped: false }]) assert.equal(canViewClubMatchdayTv({ ...profile, ...patch }), false)
  assert.doesNotThrow(() => assertClubTvAuthority(profile, clubId))
  for (const patch of [{ clubId: otherClub }, { role: 'coach' }, { role: 'super_admin' }, { accountStatus: 'suspended' }, { clubStatus: 'suspended' }, { clubArchivedAt: '2026-10-01' }, { testerAccessExpired: true }, { planKey: 'team' }]) assert.throws(() => assertClubTvAuthority({ ...profile, ...patch }, clubId), { statusCode: 403 })
})

test('DTO discards player identities, invalid shirts, voided events, shootout events and foreign/deleted records', () => {
  const row = fixture()
  row.match_day_events.push(
    { id: 'red', event_type: 'red_card', team_side: 'opponent', minute: 15, scorer_shirt_number: 'PRIVATE PLAYER' },
    { id: 'void', event_type: 'goal', team_side: 'club', event_status: 'voided' },
    { id: 'pen', event_type: 'goal', team_side: 'club', match_phase: 'penalties' },
    { id: 'sub', event_type: 'substitution', team_side: 'club' },
  )
  const display = toClubTvMatch(row, clubId)
  assert.deepEqual(display.events.map(({ id, shirt }) => ({ id, shirt })), [{ id: 'goal-1', shirt: '9' }, { id: 'red', shirt: '' }])
  assert.doesNotMatch(JSON.stringify(display), /PRIVATE|scorer_name|assist_name|notes/)
  assert.doesNotMatch(CLUB_TV_MATCH_SELECT, /scorer_name|assist_name|initials|notes|players|\*/)
  assert.equal(toClubTvMatch(fixture({ club_id: otherClub }), clubId), null)
  assert.equal(toClubTvMatch(fixture({ teams: { club_id: otherClub, name: 'Foreign team' } }), clubId), null)
  assert.equal(toClubTvMatch(fixture({ deleted_at: '2026-10-01' }), clubId), null)
  assert.equal(toClubTvMatch(fixture({ match_day_events: [{ ...row.match_day_events[0], event_status: 'corrected' }] }), clubId).events.length, 1)
})

test('away scores, running clock, breaks, full time and London match dates remain correct', () => {
  const display = toClubTvMatch(fixture(), clubId)
  assert.deepEqual(tvMatchSides(display), { home: 'Visitors', away: 'U12 Blue', clubHome: false })
  assert.equal(tvMatchStatus(display, Date.parse('2026-10-21T10:05:00Z')).label, '25′ LIVE')
  assert.equal(tvMatchStatus({ ...display, status: 'half_time' }).label, 'HALF TIME')
  assert.equal(tvMatchStatus({ ...display, concluded: true }).kind, 'finished')
  assert.equal(tvMatchStatus({ ...display, status: 'scheduled', kickoffTbc: true }).label, 'KO TBC')
  assert.equal(clubTvDate(new Date('2026-07-01T23:30:00Z')), '2026-07-02')
  assert.equal(validTvDate('2026-02-30'), false)
  assert.equal(validTvDate('2028-02-29'), true)
})

test('initial loads and score corrections do not trigger goal celebrations', () => {
  const old = toClubTvMatch(fixture(), clubId)
  const next = { ...old, awayScore: 3, events: [...old.events, { id: 'new', type: 'goal', side: 'club', shirt: '10' }] }
  assert.deepEqual(newTvGoals(null, [next]), [])
  assert.equal(newTvGoals([old], [next]).length, 1)
  assert.deepEqual(newTvGoals([next], [old]), [])
  assert.deepEqual(newTvGoals([next], [next]), [])
})

test('score feed authenticates requested club then queries only its date and active matches, with pagination', async () => {
  const client = clientFor(Array.from({ length: 251 }, (_, i) => fixture({ id: `match-${i}` })))
  let authScope
  const response = await handler({ client, authenticate: async (_event, scope) => { authScope = scope; return profile } })(request())
  assert.equal(response.statusCode, 200)
  assert.equal(JSON.parse(response.body).matches.length, 251)
  assert.deepEqual(authScope, { clubId })
  assert.match(response.headers['Cache-Control'], /no-store/)
  const queries = client.calls.filter(({ table }) => table === 'match_days')
  assert.equal(queries.length, 2)
  for (const query of queries) assert.deepEqual(query.filters, [['club_id', clubId], ['match_date', '2026-10-21'], ['deleted_at', null]])
  assert.deepEqual(queries[1].range, [250, 499])
  assert.doesNotMatch(response.body, /PRIVATE/)
})

test('empty matchdays fall back to the next seven days with the same club and privacy scope', async () => {
  const client = clientFor((call) => call.filters.some(([operator]) => operator === 'gte')
    ? [fixture({ match_date: '2026-10-24' }), fixture({ id: 'foreign', club_id: otherClub, match_date: '2026-10-25' })] : [])
  const response = await handler({ client })(request())
  assert.equal(response.statusCode, 200)
  const payload = JSON.parse(response.body)
  assert.equal(payload.date, '2026-10-21')
  assert.deepEqual(payload.window, { kind: 'week', startDate: '2026-10-22', endDate: '2026-10-28' })
  assert.deepEqual(payload.matches.map(({ matchDate }) => matchDate), ['2026-10-24'])
  const queries = client.calls.filter(({ table }) => table === 'match_days')
  assert.equal(queries.length, 2)
  assert.deepEqual(queries[1].filters, [['club_id', clubId], ['gte', 'match_date', '2026-10-22'], ['lte', 'match_date', '2026-10-28'], ['deleted_at', null]])
  assert.deepEqual(queries[1].orders.map(([field]) => field), ['match_date', 'kickoff_time', 'id'])
  assert.doesNotMatch(response.body, /PRIVATE|foreign/)
  const empty = JSON.parse((await handler()(request())).body)
  assert.equal(empty.window.kind, 'week')
  assert.deepEqual(empty.matches, [])
  assert.equal(tvDateAfter('2026-12-29', 7), '2027-01-05')
  assert.equal(tvDateAfter('2028-02-28', 1), '2028-02-29')
  assert.equal(tvDateAfter('9999-12-31', 7), null)
})

test('foreign club requests, unauthenticated callers, expired plans and invalid requests never query matches', async () => {
  const client = clientFor([fixture()])
  assert.equal((await handler({ client })(request({ clubId: otherClub, date: '2026-10-21' }))).statusCode, 403)
  assert.equal((await handler({ client, authenticate: async () => { throw Object.assign(new Error('Login'), { statusCode: 401 }) } })(request())).statusCode, 401)
  assert.equal((await handler({ client, assertFeature: () => { throw Object.assign(new Error('Plan'), { statusCode: 403 }) } })(request())).statusCode, 403)
  for (const body of [null, [], {}, { clubId, date: '2026-02-30' }, { clubId, action: 'export' }]) assert.equal((await handler({ client })(request(body))).statusCode, 400)
  assert.equal((await handler({ client })({ httpMethod: 'GET' })).statusCode, 405)
  assert.equal(client.calls.length, 0)
})

test('database failure is explicit and cannot leak SQL or personal data', async () => {
  const response = await handler({ client: clientFor([], { message: 'PRIVATE SQL' }) })(request())
  assert.equal(response.statusCode, 503)
  assert.doesNotMatch(response.body, /PRIVATE/)
})

test('weather is gated by the same club authority and accepts only ground postcodes', async () => {
  let requested
  const weather = async (postcode) => { requested = postcode; return { temperature: 12 } }
  const endpoint = handler({ weather })
  assert.equal((await endpoint(request({ clubId: otherClub, action: 'weather', postcode: 'CB23 6FY' }))).statusCode, 403)
  assert.equal((await endpoint(request({ clubId, action: 'weather', postcode: 'https://example.com' }))).statusCode, 400)
  const result = await endpoint(request({ clubId, action: 'weather', postcode: 'CB23 6FY' }))
  assert.equal(result.statusCode, 200)
  assert.equal(requested, 'CB236FY')
})

test('browser preferences reject executable image types and corrupt storage', () => {
  const original = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: () => JSON.stringify({ map: 'data:image/svg+xml,<svg/>', bigGoal: false }) }
    assert.equal(readTvPreferences('test').map, '')
    assert.equal(readTvPreferences('test').bigGoal, false)
    assert.equal(readTvPreferences('test').appearance, 'light')
    globalThis.localStorage = { getItem: () => JSON.stringify({ appearance: 'dark' }) }
    assert.equal(readTvPreferences('test').appearance, 'dark')
    globalThis.localStorage = { getItem: () => '{broken' }
    assert.equal(readTvPreferences('test').bigGoal, true)
    assert.equal(readTvPreferences('test').appearance, 'light')
  } finally { globalThis.localStorage = original }
})

test('unlock verifies the same admin using a temporary session, revokes it and returns no credentials', async () => {
  let verified, signedOut, passwordFailure = false, otherUser = false
  const endpoint = handler({
    authenticate: async () => ({ ...profile, authEmail: 'admin@example.test', authUserId: 'admin-user' }),
    passwordClient: () => ({ auth: {
      async signInWithPassword(value) { verified = { ...value }; return passwordFailure ? { error: { code: 'invalid_credentials' } } : { data: { user: { id: otherUser ? 'foreign-user' : 'admin-user' }, session: { access_token: 'PRIVATE TOKEN' } } } },
      async signOut(value) { signedOut = value },
    } }),
  })
  const response = await endpoint(request({ clubId, action: 'unlock', password: 'Fixture only password' }))
  assert.equal(response.statusCode, 200)
  assert.deepEqual(verified, { email: 'admin@example.test', password: 'Fixture only password' })
  assert.deepEqual(signedOut, { scope: 'local' })
  assert.deepEqual(JSON.parse(response.body), { club: { id: clubId }, unlocked: true })
  assert.match(response.headers['Cache-Control'], /no-store/)
  assert.doesNotMatch(response.body, /password|TOKEN|access_token|refresh_token/)
  passwordFailure = true
  assert.equal((await endpoint(request({ clubId, action: 'unlock', password: 'wrong' }))).statusCode, 401)
  passwordFailure = false; otherUser = true
  assert.equal((await endpoint(request({ clubId, action: 'unlock', password: 'other' }))).statusCode, 401)
  assert.equal((await endpoint(request({ clubId, action: 'unlock', password: '' }))).statusCode, 400)
})

test('display lock storage holds only an account-scoped flag', () => {
  const original = globalThis.sessionStorage, values = new Map()
  try {
    globalThis.sessionStorage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
    const user = { id: 'user-a', clubId }
    setClubTvLocked(user, true)
    assert.equal(isClubTvLocked(user), true)
    assert.equal(isClubTvLocked({ id: 'user-b', clubId }), false)
    assert.equal(isClubTvLocked({ id: 'user-a', clubId: otherClub }), false)
    assert.deepEqual([...values.values()], ['locked'])
    setClubTvLocked(user, false)
    assert.equal(isClubTvLocked(user), false)
  } finally { globalThis.sessionStorage = original }
})
