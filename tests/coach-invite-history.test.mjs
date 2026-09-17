import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../netlify/functions/get-coach-invite-history.js', import.meta.url), 'utf8')
const mobileSource = await readFile(new URL('../apps/mobile-core/src/coachInviteHistoryData.js', import.meta.url), 'utf8')
const executable = (text) => text.replace(/^import .*\r?\n/gm, '').replace(/export /g, '')
const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  club: '22222222-2222-4222-8222-222222222222',
  team: '33333333-3333-4333-8333-333333333333',
  event: '44444444-4444-4444-8444-444444444444',
  player: '55555555-5555-4555-8555-555555555555',
}
const profile = { id: ids.actor, clubId: ids.club, role: 'coach', roleRank: 30 }
const request = { eventId: ids.event, playerId: ids.player, kind: 'training', occurrenceDate: '2026-09-17' }
const getValue = (row, column) => column.includes('->>') ? row[column.split('->>')[0]]?.[column.split('->>')[1]] : row[column]
function includesObject(actual, expected) {
  return Object.entries(expected).every(([key, value]) => value && typeof value === 'object'
    ? includesObject(actual?.[key] || {}, value) : actual?.[key] === value)
}

// Evaluates the actual query predicates against synthetic rows. No network or auth provider is used.
function fixture(overrides = {}, failedTable = '') {
  const tables = {
    calendar_events: [{ id: ids.event, club_id: ids.club, team_id: ids.team }],
    match_days: [{ id: ids.event, club_id: ids.club, team_id: ids.team }],
    team_staff: [{ team_id: ids.team, user_id: ids.actor }],
    players: [{ id: ids.player, club_id: ids.club, team_id: ids.team }],
    email_logs: [], audit_logs: [], ...overrides,
  }
  const calls = []
  return { calls, tables, from(table) {
    calls.push(table)
    const filters = []
    let start = 0, end = Infinity
    const builder = {
      select() { return builder },
      eq(column, value) { filters.push(row => getValue(row, column) === value); return builder },
      contains(column, value) { filters.push(row => includesObject(row[column], value)); return builder },
      or(value) {
        assert.equal(value, 'provider_accepted_at.not.is.null,and(provider_message_id.not.is.null,delivery_state.in.(provider_accepted,delivered))')
        filters.push(row => row.provider_accepted_at != null || (row.provider_message_id != null && ['provider_accepted', 'delivered'].includes(row.delivery_state)))
        return builder
      },
      order(column) { assert.equal(column, 'id'); return builder },
      range(from, to) { start = from; end = to; return builder },
      async single() { const result = await builder; return { ...result, data: result.data?.length === 1 ? result.data[0] : null } },
      async maybeSingle() { return builder.single() },
      then(resolve, reject) {
        const data = (tables[table] || []).filter(row => filters.every(filter => filter(row)))
          .sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(start, end + 1)
        return Promise.resolve({ data, error: table === failedTable ? new Error('Synthetic query failure') : null }).then(resolve, reject)
      },
    }
    return builder
  } }
}
function load(db, authenticate = async () => profile) {
  return new Function('getAuthenticatedPlanProfile', 'supabaseAdmin', `${executable(source)}; return { readCoachInviteHistory, handler }`)(authenticate, db)
}
function email(id, overrides = {}) {
  return { id, provider_message_id: `provider-${id}`, provider_accepted_at: '2026-09-15T09:00:00Z',
    payload: { clubId: ids.club, trainingInvitation: { eventId: ids.event, playerId: ids.player, occurrenceDate: request.occurrenceDate } }, ...overrides }
}
function resend(id, overrides = {}) {
  return { id, club_id: ids.club, entity_id: ids.event, action: 'event_player_invitation_resend', created_at: '2026-09-15T09:00:00Z',
    metadata: { playerId: ids.player, sourceType: 'calendar', occurrenceDate: request.occurrenceDate, recipientCount: 2 }, ...overrides }
}

test('history counts confirmed messages and logical resend commands without disclosing recipients or tokens', async () => {
  const db = fixture({ email_logs: [email('1'), email('2', { provider_message_id: 'provider-1' }),
    email('3', { provider_accepted_at: null, delivery_state: 'queued' }),
    email('4', { provider_accepted_at: null, delivery_state: 'delivered' })],
  audit_logs: [resend('1'), resend('2', { metadata: { ...resend('1').metadata, idempotencyKey: 'command-1' } }),
    resend('3', { metadata: { ...resend('1').metadata, idempotencyKey: 'command-1' } })] })
  const history = await load(db).readCoachInviteHistory({ db, profile, ...request })
  assert.equal(history.emailSends, 2)
  assert.equal(history.resendRequests, 2)
  assert.deepEqual(history.recentEmailSends, ['2026-09-15T09:00:00Z'])
  assert.deepEqual(Object.keys(history).sort(), ['emailSends', 'firstEmailSentAt', 'recentEmailSends', 'recentResendRequests', 'resendRequests'])
  assert.doesNotMatch(JSON.stringify(history), /provider-|payload|playerId|clubId/)
})

test('history isolates club, player, source kind and training occurrence', async () => {
  const base = email('valid')
  const rows = [base, email('other-club', { payload: { ...base.payload, clubId: 'other' } })]
  for (const field of ['eventId', 'playerId', 'occurrenceDate']) rows.push(email(field, { payload: {
    ...base.payload, trainingInvitation: { ...base.payload.trainingInvitation, [field]: 'other' },
  } }))
  rows.push(email('match', { payload: { clubId: ids.club, matchDayAvailability: { matchDayId: ids.event, playerId: ids.player } } }))
  const otherAudit = resend('other', { metadata: { ...resend('1').metadata, occurrenceDate: '2026-09-24' } })
  const db = fixture({ email_logs: rows, audit_logs: [resend('valid'), otherAudit] })
  assert.equal((await load(db).readCoachInviteHistory({ db, profile, ...request })).emailSends, 1)
  assert.equal((await load(db).readCoachInviteHistory({ db, profile, ...request })).resendRequests, 1)
  assert.equal((await load(db).readCoachInviteHistory({ db, profile, ...request, kind: 'match' })).emailSends, 1)
})

test('pagination counts more than 200 records and only returns the ten latest timestamps', async () => {
  const emails = Array.from({ length: 401 }, (_, index) => email(String(index).padStart(4, '0'), {
    provider_accepted_at: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
  }))
  const audits = Array.from({ length: 201 }, (_, index) => resend(String(index).padStart(4, '0')))
  const db = fixture({ email_logs: emails, audit_logs: audits })
  const history = await load(db).readCoachInviteHistory({ db, profile, ...request })
  assert.equal(history.firstEmailSentAt, emails[0].provider_accepted_at)
  assert.equal(history.emailSends, 401)
  assert.equal(history.resendRequests, 201)
  assert.equal(history.recentEmailSends.length, 10)
  assert.equal(history.recentResendRequests.length, 10)
  assert.equal(history.recentEmailSends[0], emails[400].provider_accepted_at)
  assert.equal(db.calls.filter(table => table === 'email_logs').length, 3)
  assert.equal(db.calls.filter(table => table === 'audit_logs').length, 2)
})

test('invalid role ranks, portal roles and missing identity fail closed before reading data', async () => {
  for (const denied of [null, { ...profile, id: '' }, { ...profile, roleRank: undefined }, { ...profile, roleRank: 'invalid' },
    { ...profile, roleRank: 10 }, ...['parent_portal', 'adult_player', 'super_admin'].map(role => ({ ...profile, role, roleRank: 100 }))]) {
    const db = fixture()
    await assert.rejects(load(db).readCoachInviteHistory({ db, profile: denied, ...request }), { statusCode: 403 })
    assert.deepEqual(db.calls, [])
  }
})

test('cross-club events, nonmember teams and players from another team cannot expose history', async () => {
  for (const overrides of [
    { calendar_events: [{ id: ids.event, club_id: 'other', team_id: ids.team }] },
    { team_staff: [] },
    { players: [{ id: ids.player, club_id: ids.club, team_id: 'other' }] },
  ]) {
    const db = fixture(overrides)
    await assert.rejects(load(db).readCoachInviteHistory({ db, profile, ...request }), { statusCode: 403 })
    assert.ok(!db.calls.includes('email_logs'))
  }
})

test('club admin may read their own club without team membership but cannot cross clubs', async () => {
  const admin = { ...profile, role: 'admin', roleRank: 100 }
  const db = fixture({ team_staff: [] })
  assert.equal((await load(db).readCoachInviteHistory({ db, profile: admin, ...request })).emailSends, 0)
  const denied = fixture({ calendar_events: [{ id: ids.event, club_id: 'other', team_id: ids.team }] })
  await assert.rejects(load(denied).readCoachInviteHistory({ db: denied, profile: admin, ...request }), { statusCode: 403 })
})

test('invalid dates and malformed identifiers cannot become broad history queries', async () => {
  for (const change of [{ eventId: '' }, { playerId: 'invalid' }, { kind: 'all' },
    ...['2026-02-30', '2026-99-17', '2026-9-17', '', null].map(occurrenceDate => ({ occurrenceDate }))]) {
    const db = fixture()
    await assert.rejects(load(db).readCoachInviteHistory({ db, profile, ...request, ...change }), { statusCode: 400 })
    assert.deepEqual(db.calls, [])
  }
})

test('database errors fail the request instead of displaying a partial or zero count', async () => {
  for (const table of ['email_logs', 'audit_logs']) {
    const db = fixture({}, table)
    await assert.rejects(load(db).readCoachInviteHistory({ db, profile, ...request }), /Synthetic query failure/)
    const response = await load(db).handler({ httpMethod: 'POST', body: JSON.stringify(request) })
    assert.equal(response.statusCode, 500)
    assert.doesNotMatch(response.body, /Synthetic query failure/)
  }
})

test('HTTP handler enforces authentication, method, JSON shape and no-store responses', async () => {
  const db = fixture()
  assert.equal((await load(db).handler({ httpMethod: 'GET' })).statusCode, 405)
  const denied = load(db, async () => { throw Object.assign(new Error('Login is required.'), { statusCode: 401 }) })
  assert.equal((await denied.handler({ httpMethod: 'POST', body: JSON.stringify(request) })).statusCode, 401)
  for (const body of ['{broken', 'null', '[]']) assert.equal((await load(db).handler({ httpMethod: 'POST', body })).statusCode, 400)
  const response = await load(db).handler({ httpMethod: 'POST', body: JSON.stringify(request) })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['Cache-Control'], 'no-store')
})

function loadMobile({ token = 'synthetic-token', response = { ok: true, result: { success: true, history: { emailSends: 1, resendRequests: 0, recentEmailSends: [], recentResendRequests: [] } } } } = {}) {
  const calls = []
  const getHistory = new Function('assertCoachOperationalRead', 'getAccessToken', 'getMobileRuntimeConfig', 'fetchJsonWithTimeout', 'joinApiPath',
    `${executable(mobileSource)}; return getCoachInviteHistory`)(
    user => { assert.equal(user.activeTeamId, ids.team) }, async () => token, () => ({ apiBaseUrl: 'https://synthetic.test' }),
    async (...args) => { calls.push(args); return response }, (base, path) => `${base}/${path}`,
  )
  return { getHistory, calls }
}

test('mobile history uses authenticated POST and rejects another active team without a request', async () => {
  const mobile = loadMobile()
  const user = { ...profile, activeTeamId: ids.team }
  assert.equal((await mobile.getHistory(user, { ...request, teamId: ids.team })).emailSends, 1)
  const [url, options] = mobile.calls[0]
  assert.equal(url, 'https://synthetic.test/.netlify/functions/get-coach-invite-history')
  assert.equal(options.headers.Authorization, 'Bearer synthetic-token')
  assert.deepEqual(JSON.parse(options.body), request)
  await assert.rejects(mobile.getHistory(user, { ...request, teamId: 'other' }), /active team/)
  await assert.rejects(mobile.getHistory(user, null), /Choose an invitation/)
  assert.equal(mobile.calls.length, 1)
})

test('mobile history fails safely on missing session and invalid responses', async () => {
  const user = { ...profile, activeTeamId: ids.team }
  const signedOut = loadMobile({ token: '' })
  await assert.rejects(signedOut.getHistory(user, request), /Sign in again/)
  assert.equal(signedOut.calls.length, 0)
  for (const response of [{ ok: true, result: null }, { ok: false, result: { message: 'Try again.' } }, { ok: true, result: { success: true, history: {} } }]) {
    await assert.rejects(loadMobile({ response }).getHistory(user, request), /Invite history could not be loaded|Try again/)
  }
})
