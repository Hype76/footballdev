import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { activeTvSponsors, canViewClubMatchdayTv, clubTvDate, clubTvSlugStatus, clubTvViewerUrl, newTvGoals, readTvPreferences, toClubTvMatch, TV_SPONSOR_BUCKET, TV_SPONSOR_MAX_BYTES, tvMatchSides, tvMatchStatus, tvPitchNumber, validTvDate, tvDateAfter, tvPeriodWindow } from '../src/lib/club-matchday-tv.js'
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
const fixtureNow = () => new Date('2026-10-21T09:00:00Z')
function handler(options = {}) { return createClubMatchdayTvHandler({ authenticate: async () => profile, client: clientFor(), logger: { error() {} }, now: fixtureNow, ...options }) }

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
  assert.equal(toClubTvMatch(fixture({ status: 'cancelled' }), clubId), null)
  assert.equal(toClubTvMatch(fixture({ match_day_events: [{ ...row.match_day_events[0], event_status: 'corrected' }] }), clubId).events.length, 1)
})

test('TV uses compact live, full-time and kickoff labels and London match dates', () => {
  const display = toClubTvMatch(fixture(), clubId)
  assert.deepEqual(tvMatchSides(display), { home: 'Visitors', away: 'U12 Blue', clubHome: false })
  for (const status of ['live', 'half_time', 'second_half', 'extra_time', 'penalties']) {
    assert.deepEqual(tvMatchStatus({ ...display, status }), { label: 'LIVE', kind: 'live' })
  }
  assert.equal(tvMatchStatus({ ...display, timerStatus: 'hydration' }).label, 'LIVE')
  assert.equal(tvMatchStatus({ ...display, concluded: true }).label, 'FULL TIME')
  assert.equal(tvMatchStatus({ ...display, status: 'scheduled', kickoff: '10:30' }).label, 'KO 10:30')
  assert.equal(tvMatchStatus({ ...display, status: 'scheduled', kickoffTbc: true }).label, 'KO TBC')
  assert.equal(tvMatchStatus({ ...display, status: 'cancelled' }).kind, 'inactive')
  assert.equal(tvMatchStatus({ ...display, status: 'postponed' }).kind, 'inactive')
  assert.equal(clubTvDate(new Date('2026-07-01T23:30:00Z')), '2026-07-02')
  assert.equal(validTvDate('2026-02-30'), false)
  assert.equal(validTvDate('2028-02-29'), true)
})

test('completed results use the club perspective and confirmed shootout winner', () => {
  const result = (patch) => tvMatchStatus(toClubTvMatch(fixture({ status: 'full_time', ...patch }), clubId)).result
  assert.equal(result({}), 'win')
  assert.equal(result({ home_away: 'home' }), 'loss')
  assert.equal(result({ home_score: 16, away_score: 3 }), 'loss')
  assert.equal(result({ home_away: 'home', home_score: 16, away_score: 3 }), 'win')
  assert.equal(result({ home_score: 2, away_score: 2 }), 'draw')
  assert.equal(result({ home_score: 2, away_score: 2, shootout_winner: 'away' }), 'win')
  assert.equal(result({ home_score: 2, away_score: 2, shootout_winner: 'home' }), 'loss')
})

test('home pitch displays only a recorded pitch number', () => {
  assert.equal(tvPitchNumber('Pitch 4'), '4')
  assert.equal(tvPitchNumber('Cambourne Sports Centre, Pitch No. 3b, 45 High Street'), '3B')
  assert.equal(tvPitchNumber(' 12a '), '12A')
  assert.equal(tvPitchNumber('45 High Street, CB23 6FY'), '')
  assert.equal(tvPitchNumber('Cambourne Fitness and Sports Centre'), '')
  assert.equal(tvPitchNumber(undefined), '')
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

test('cancelled fixtures are excluded and do not prevent the next seven days fallback', async () => {
  const client = clientFor((call) => call.filters.some(([operator]) => operator === 'gte')
    ? [fixture({ id: 'cancelled-next', status: 'cancelled', match_date: '2026-10-24' }), fixture({ id: 'scheduled-next', status: 'scheduled', match_date: '2026-10-25' })]
    : [fixture({ id: 'cancelled-today', status: 'cancelled' })])
  const payload = JSON.parse((await handler({ client })(request())).body)
  assert.equal(payload.window.kind, 'week')
  assert.deepEqual(payload.matches.map(({ id }) => id), ['scheduled-next'])
})

test('explicit periods use bounded calendar dates and retain club and privacy scope', async () => {
  const examples = [
    ['2026-10-21', 'weekend', '2026-10-24', '2026-10-25'],
    ['2026-10-25', 'weekend', '2026-10-24', '2026-10-25'],
    ['2026-12-31', 'week', '2026-12-28', '2027-01-03'],
    ['2028-02-12', 'month', '2028-02-01', '2028-02-29'],
  ]
  for (const [date, period, startDate, endDate] of examples) {
    const client = clientFor([fixture({ match_date: startDate }), fixture({ id: 'foreign', club_id: otherClub, match_date: startDate })])
    const response = await handler({ client, now: () => new Date(`${startDate}T12:00:00Z`) })(request({ clubId, date, period }))
    assert.equal(response.statusCode, 200)
    const payload = JSON.parse(response.body)
    assert.deepEqual(payload.window, { kind: period, startDate, endDate })
    assert.equal(payload.matches.length, 1)
    assert.deepEqual(client.calls.find(({ table }) => table === 'match_days').filters, [['club_id', clubId], ['gte', 'match_date', startDate], ['lte', 'match_date', endDate], ['deleted_at', null]])
    assert.doesNotMatch(response.body, /PRIVATE|foreign/)
  }
  assert.equal(tvPeriodWindow('9999-12-31', 'weekend'), null)
  assert.equal(tvPeriodWindow('2026-10-21', 'year'), null)
  const emptyClient = clientFor([])
  const empty = JSON.parse((await handler({ client: emptyClient })(request({ clubId, date: '2026-10-21', period: 'month' }))).body)
  assert.equal(empty.window.kind, 'month')
  assert.equal(emptyClient.calls.filter(({ table }) => table === 'match_days').length, 1)
})

test('past dates and the elapsed portion of a period are excluded from every display feed', async () => {
  const today = '2026-10-21'
  const clock = () => new Date('2026-10-20T23:30:00Z')
  for (const [date, period, startDate, endDate] of [
    ['2026-10-17', 'day', today, today],
    ['2026-10-19', 'week', today, '2026-10-25'],
    ['2026-10-21', 'month', today, '2026-10-31'],
  ]) {
    const client = clientFor([fixture({ match_date: startDate })])
    const result = await handler({ client, now: clock })(request({ clubId, date, period }))
    assert.equal(result.statusCode, 200)
    const payload = JSON.parse(result.body)
    assert.deepEqual(payload.window, { kind: period, startDate, endDate })
    const query = client.calls.find(({ table }) => table === 'match_days')
    assert.deepEqual(query.filters.slice(1, -1), startDate === endDate
      ? [['match_date', today]] : [['gte', 'match_date', today], ['lte', 'match_date', endDate]])
  }

  const sunday = handler({ now: () => new Date('2026-10-25T10:00:00Z'), client: clientFor([fixture({ match_date: '2026-10-25' })]) })
  const result = JSON.parse((await sunday(request({ clubId, date: '2026-10-25', period: 'weekend' }))).body)
  assert.deepEqual(result.window, { kind: 'weekend', startDate: '2026-10-25', endDate: '2026-10-25' })
})

test('foreign club requests, unauthenticated callers, expired plans and invalid requests never query matches', async () => {
  const client = clientFor([fixture()])
  assert.equal((await handler({ client })(request({ clubId: otherClub, date: '2026-10-21' }))).statusCode, 403)
  assert.equal((await handler({ client, authenticate: async () => { throw Object.assign(new Error('Login'), { statusCode: 401 }) } })(request())).statusCode, 401)
  assert.equal((await handler({ client, assertFeature: () => { throw Object.assign(new Error('Plan'), { statusCode: 403 }) } })(request())).statusCode, 403)
  for (const body of [null, [], {}, { clubId, date: '2026-02-30' }, { clubId, date: '2026-10-21', period: 'year' }, { clubId, action: 'export' }]) assert.equal((await handler({ client })(request(body))).statusCode, 400)
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

test('sponsor dates include both boundaries and exclude disabled or invalid schedules', () => {
  const ads = [{ id: 'always' }, { id: 'today', startDate: '2026-10-21', endDate: '2026-10-21' }, { id: 'future', startDate: '2026-10-22' }, { id: 'past', endDate: '2026-10-20' }, { id: 'disabled', enabled: false }, { id: 'invalid', endDate: 'bad' }, { id: 'reversed', startDate: '2026-10-22', endDate: '2026-10-20' }]
  assert.deepEqual(activeTvSponsors(ads, '2026-10-21').map(ad => ad.id), ['always', 'today'])
  assert.deepEqual(activeTvSponsors(ads, '2026-10-22').map(ad => ad.id), ['always', 'future'])
  assert.deepEqual(activeTvSponsors(ads, 'not-a-date'), [])
})

test('browser preferences reject executable image types and corrupt storage', () => {
  const original = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: () => JSON.stringify({ map: 'data:image/svg+xml,<svg/>', bigGoal: false }) }
    assert.equal(readTvPreferences('test').map, '')
    assert.equal(readTvPreferences('test').bigGoal, false)
    assert.equal(readTvPreferences('test').appearance, 'light')
    assert.equal(readTvPreferences('test').showPitchsideOrdering, false)
    globalThis.localStorage = { getItem: () => JSON.stringify({ appearance: 'dark', showPitchsideOrdering: true, sponsorAds: [{ image: 'data:image/svg+xml,<svg/>', name: 'Unsafe' }] }) }
    assert.equal(readTvPreferences('test').appearance, 'dark')
    assert.equal(readTvPreferences('test').showPitchsideOrdering, true)
    assert.deepEqual(readTvPreferences('test').sponsorAds, [])
    globalThis.localStorage = { getItem: () => '{broken' }
    assert.equal(readTvPreferences('test').bigGoal, true)
    assert.equal(readTvPreferences('test').appearance, 'light')
    assert.equal(readTvPreferences('test').showPitchsideOrdering, false)
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

const cedarfield = '11111111-1111-4111-8111-111111111111'
const oakfield = '22222222-2222-4222-8222-222222222222'
const v2Shape = 'abcdefghijklmnopqrstuq'
const artwork = 'data:image/webp;base64,YXJ0'
const preferences = {
  accessMode: 'admin', appearance: 'dark', bigGoal: false, showMap: true, weatherPostcode: 'CB23 6FY', map: artwork,
  sponsorAds: [{ image: artwork, name: 'Fictional Sponsor', enabled: true, startDate: '2026-11-12', endDate: '2026-11-12' }],
  sponsorSeconds: 15, showPitchsideOrdering: true,
}

test('private Matchday TV settings and aliases are saved atomically by authorized Club Admins', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.clubs (id uuid primary key);
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (bucket_id text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert on storage.objects to anon, authenticated;
    create policy existing_storage_access on storage.objects to anon, authenticated using (true) with check (true);
    grant select, update on public.clubs to service_role;
    insert into public.clubs values ('${cedarfield}'), ('${oakfield}');
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261112090042_v1_club_matchday_tv_settings.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/20261113112824_v1_club_matchday_tv_sponsor_artwork.sql', import.meta.url), 'utf8'))
  assert.deepEqual((await db.query('select public, file_size_limit::int, allowed_mime_types from storage.buckets where id = $1', [TV_SPONSOR_BUCKET])).rows, [{
    public: false, file_size_limit: TV_SPONSOR_MAX_BYTES, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'],
  }])
  await db.exec("insert into storage.objects values ('club-matchday-tv-sponsors'), ('existing-bucket')")

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.exec('select * from public.club_matchday_tv_links'), { code: '42501' })
    await assert.rejects(db.exec('select * from public.club_matchday_tv_settings'), { code: '42501' })
    await assert.rejects(db.query('select public.save_club_matchday_tv_settings($1, null, $2, 0)', [cedarfield, {}]), { code: '42501' })
    assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows, [{ bucket_id: 'existing-bucket' }])
    await assert.rejects(db.query('insert into storage.objects values ($1)', [TV_SPONSOR_BUCKET]), { code: '42501' })
  }
  await db.exec('set role service_role')

  const clubPlan = { status: 'active', plan_key: 'pilot', plan_status: 'active', is_plan_comped: true }
  const storedArtwork = new Map()
  const client = {
    storage: {
      from(bucket) {
        assert.equal(bucket, TV_SPONSOR_BUCKET)
        return {
          createSignedUploadUrl: async () => ({ data: { token: 'fictional-upload' } }),
          info: async (path) => ({ data: storedArtwork.get(path) }),
          createSignedUrl: async (path, lifetime) => ({ data: { signedUrl: `https://fixture.example/${path}?lifetime=${lifetime}` } }),
        }
      },
    },
    from(table) {
      if (table === 'match_days') return clientFor([fixture({ venue_name: 'Pitch 7, club venue details' })]).from(table)
      if (table === 'clubs') {
        const query = clientFor().from(table)
        query.maybeSingle = () => ({ data: { id: cedarfield, ...clubPlan }, error: null })
        return query
      }
      const filters = []
      let columns
      return {
        select(value) { columns = value.replace(/(\w+):(\w+)->>(\w+)/g, "$2->>'$3' as $1"); return this },
        eq(column, value) { filters.push({ column, value }); return this },
        async maybeSingle() {
          const where = filters.map(({ column }, index) => `${column} = $${index + 1}`).join(' and ')
          const result = await db.query(`select ${columns} from public.${table} where ${where}`, filters.map(({ value }) => value))
          return { data: result.rows[0] ?? null, error: null }
        },
      }
    },
    async rpc(name, args) {
      assert.equal(name, 'save_club_matchday_tv_settings')
      try {
        const result = await db.query('select public.save_club_matchday_tv_settings($1, $2, $3, $4) as revision',
          [args.p_club_id, args.p_slug, args.p_preferences, args.p_revision])
        return { data: result.rows[0].revision, error: null }
      } catch (error) { return { data: null, error } }
    },
  }
  let receivedPostcode
  const endpoint = createClubMatchdayTvHandler({
    authenticate: async ({ headers }) => {
      if (!headers.actor) throw Object.assign(new Error('Login required'), { statusCode: 401 })
      return { role: headers.role || 'admin', clubId: headers.actor, planKey: 'club', accountStatus: 'active', clubStatus: 'active', planStatus: 'active' }
    },
    assertFeature: async () => {},
    weather: async postcode => { receivedPostcode = postcode; return { temperature: 12 } },
    client,
    now: fixtureNow,
    logger: { error() {} },
  })
  async function request(actor, body, role) {
    const response = await endpoint({ httpMethod: 'POST', headers: { actor, role }, body: JSON.stringify(body) })
    assert.equal(response.headers['Cache-Control'], 'private, no-store, max-age=0')
    return { status: response.statusCode, ...JSON.parse(response.body) }
  }
  const save = (clubId, slug, revision = 0, next = preferences) => request(clubId, { action: 'save', clubId, slug, preferences: next, revision })
  const availability = (clubId, slug) => request(clubId, { action: 'availability', clubId, slug })
  const view = (actor, slug, role) => request(actor, { action: 'view', slug }, role)
  const settings = (clubId) => request(clubId, { action: 'settings', clubId }).then(result => result.settings)

  assert.deepEqual(await settings(cedarfield), { slug: null, preferences: null, revision: 0 })
  assert.equal((await availability(cedarfield, 'SeTTings')).availability, 'reserved')
  assert.equal((await availability(cedarfield, v2Shape.toUpperCase())).availability, 'reserved')
  assert.equal((await availability(cedarfield, 'AB12C')).availability, 'invalid')
  assert.equal((await save(cedarfield, 'Assets')).status, 400)
  assert.equal((await save(cedarfield, v2Shape)).status, 400)
  assert.equal((await availability(cedarfield, 'CEDAR-FC')).availability, 'available')
  assert.equal((await availability(oakfield, 'cedar-fc')).availability, 'available')
  assert.equal((await save(cedarfield, 'CEDAR-FC')).status, 200)
  const duplicate = await save(oakfield, 'cedar-fc')
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.availability, 'taken')
  assert.equal((await settings(oakfield)).revision, 0)
  assert.equal((await availability(oakfield, 'CEDAR-FC')).availability, 'taken')
  assert.equal((await view(undefined, 'cedar-fc')).status, 401)
  assert.equal((await view(oakfield, 'cedar-fc')).status, 403)
  assert.equal((await view(cedarfield, 'cedar-fc', 'coach')).status, 403)
  const ownView = await view(cedarfield, 'CeDaR-FC')
  assert.equal(ownView.status, 200)
  assert.equal(ownView.club.id, cedarfield)
  assert.deepEqual(ownView.settings, { slug: 'cedar-fc', preferences, revision: 1 })
  assert.equal((await request(oakfield, { clubId: cedarfield, action: 'settings' })).status, 403)
  assert.equal((await save(cedarfield, 'other-ending', 0)).status, 409)
  assert.equal((await availability(oakfield, 'other-ending')).availability, 'available')
  assert.equal((await save(cedarfield, 'cedarfield', 1, { ...preferences, appearance: 'light' })).status, 200)
  assert.equal((await view(cedarfield, 'cedar-fc')).settings.preferences.appearance, 'light')
  assert.equal((await view(cedarfield, 'cedarfield')).settings.revision, 2)
  assert.equal((await availability(oakfield, 'cedar-fc')).availability, 'taken')
  const lookup = (slug, httpMethod = 'HEAD') => endpoint({ httpMethod, queryStringParameters: { displayPath: slug } })
  for (const httpMethod of ['HEAD', 'GET']) {
    const found = await lookup('CEDAR-FC', httpMethod)
    assert.equal(found.statusCode, 204)
    assert.equal(found.body, '')
    assert.equal((await lookup('unclaimed', httpMethod)).statusCode, 404)
  }
  assert.equal((await endpoint({ httpMethod: 'GET' })).statusCode, 405)
  const anonymousFeed = () => request(undefined, { slug: 'cedar-fc', date: '2026-10-21' })
  assert.equal((await anonymousFeed()).status, 401)
  assert.equal((await save(cedarfield, null, 2, { ...preferences, accessMode: 'public' })).status, 200)
  const publicView = await view(undefined, 'cedar-fc')
  assert.equal(publicView.status, 200)
  assert.equal(publicView.settings.preferences.accessMode, 'public')
  assert.equal(publicView.weatherConfigured, true)
  assert.equal(Object.hasOwn(publicView.settings.preferences, 'weatherPostcode'), false)
  assert.equal((await request(undefined, { action: 'settings', clubId: cedarfield })).status, 401)
  assert.equal((await save(undefined, 'cedar-fc', 3, preferences)).status, 400)
  assert.equal((await request(undefined, { action: 'save', clubId: cedarfield, slug: 'cedar-fc', revision: 3, preferences })).status, 401)
  assert.equal((await request(undefined, { clubId: oakfield, slug: 'cedar-fc', date: '2026-10-21' })).status, 403)
  const feed = await anonymousFeed()
  assert.equal(feed.status, 200)
  assert.equal(feed.matches[0].venue, '7')
  assert.doesNotMatch(JSON.stringify(feed), /club venue details|PRIVATE PLAYER/)
  assert.equal((await request(undefined, { action: 'weather', slug: 'cedar-fc', postcode: 'SW1A 1AA' })).status, 200)
  assert.equal(receivedPostcode, 'CB236FY')
  clubPlan.status = 'suspended'
  assert.equal((await anonymousFeed()).status, 403)
  Object.assign(clubPlan, { status: 'active', plan_status: 'past_due', is_plan_comped: false, billing_arrangement: 'immediate' })
  assert.equal((await view(undefined, 'cedar-fc')).status, 403)
  assert.equal((await anonymousFeed()).status, 403)
  clubPlan.plan_status = 'active'
  assert.equal((await anonymousFeed()).status, 200)
  assert.equal((await save(cedarfield, null, 3, preferences)).status, 200)
  assert.equal((await view(undefined, 'cedar-fc')).status, 401)
  assert.equal((await anonymousFeed()).status, 401)
  assert.equal((await lookup('CEDAR-FC')).statusCode, 204)

  const upload = (actor, bytes, mimeType = 'image/png') => request(actor, { clubId: cedarfield, action: 'sponsorUpload', bytes, mimeType })
  assert.equal((await upload(undefined, TV_SPONSOR_MAX_BYTES)).status, 401)
  assert.equal((await upload(oakfield, TV_SPONSOR_MAX_BYTES)).status, 403)
  assert.equal((await upload(cedarfield, TV_SPONSOR_MAX_BYTES + 1)).status, 400)
  assert.equal((await upload(cedarfield, 1, 'image/svg+xml')).status, 400)
  const uploadResult = await upload(cedarfield, TV_SPONSOR_MAX_BYTES)
  assert.equal(uploadResult.status, 200)
  const { path } = uploadResult.upload
  assert.ok(path.startsWith(`${cedarfield}/`))
  assert.ok(path.endsWith('.png'))
  const newAd = { imagePath: path, name: 'Cedarfield Sponsor', enabled: true, startDate: '', endDate: '' }
  const artwork = (actor, imagePath = path) => request(actor, { slug: 'cedar-fc', action: 'sponsorArtwork', imagePath })
  assert.equal((await artwork(cedarfield)).status, 404)
  assert.equal((await save(cedarfield, null, 4, { ...preferences, sponsorAds: [newAd] })).status, 400)
  storedArtwork.set(path, { size: TV_SPONSOR_MAX_BYTES, contentType: 'image/png' })
  assert.equal((await save(cedarfield, null, 4, { ...preferences, sponsorAds: [{ ...newAd, imagePath: path.replace(cedarfield, oakfield) }] })).status, 400)
  assert.equal((await save(cedarfield, null, 4, { ...preferences, sponsorAds: [newAd] })).status, 200)
  assert.equal((await artwork(undefined)).status, 401)
  assert.equal((await artwork(oakfield)).status, 403)
  assert.equal((await artwork(cedarfield)).imageUrl, `https://fixture.example/${path}?lifetime=300`)
  assert.equal((await save(cedarfield, null, 5, { ...preferences, accessMode: 'public', sponsorAds: [newAd] })).status, 200)
  assert.equal((await artwork(undefined)).imageUrl, `https://fixture.example/${path}?lifetime=300`)
  assert.equal((await artwork(undefined, path.replace(cedarfield, oakfield))).status, 404)
  assert.equal((await save(cedarfield, null, 6, { ...preferences, accessMode: 'public', sponsorAds: [{ ...newAd, enabled: false }] })).status, 200)
  assert.equal((await artwork(undefined)).status, 404)
  assert.deepEqual((await view(undefined, 'cedar-fc')).settings.preferences.sponsorAds, [])
  const legacyAd = { ...newAd, imagePath: undefined, image: 'data:image/png;base64,AA==' }
  const unpublishedAds = [{ ...newAd, startDate: '2099-01-01' }, { ...legacyAd, enabled: false }, { ...legacyAd, startDate: '2099-01-01' }]
  assert.equal((await save(cedarfield, null, 7, { ...preferences, accessMode: 'public', sponsorAds: unpublishedAds })).status, 200)
  assert.equal((await artwork(undefined)).status, 404)
  assert.deepEqual((await view(undefined, 'cedar-fc')).settings.preferences.sponsorAds, [])
  assert.equal((await request(cedarfield, { clubId: cedarfield, action: 'settings' })).settings.preferences.sponsorAds.length, 3)

  await assert.rejects(db.query('select public.save_club_matchday_tv_settings($1, $2, $3, 0)', [oakfield, 'broken-prefs', []]), { code: '23514' })
  assert.equal((await availability(oakfield, 'broken-prefs')).availability, 'available')
  for (const invalidSlug of ['UPPER', 'admin', v2Shape]) {
    await assert.rejects(db.query('select public.save_club_matchday_tv_settings($1, $2, $3, 0)', [oakfield, invalidSlug, preferences]), { code: '23514' })
  }
  await db.exec('reset role')
  await db.query('delete from public.clubs where id = $1', [cedarfield])
  assert.equal((await availability(oakfield, 'cedar-fc')).availability, 'taken')
  assert.equal((await save(oakfield, 'cedar-fc')).availability, 'taken')
  assert.deepEqual((await db.query('select count(*)::int as count from public.club_matchday_tv_settings')).rows, [{ count: 0 }])
})

test('viewer URL generation keeps the V2 token space and supports only the V1 app and approved domain options', () => {
  assert.equal(clubTvSlugStatus(v2Shape), 'reserved')
  const current = 'https://footballplayer.online'
  assert.equal(clubTvViewerUrl('cedar-fc', current, 'https://fpmd.online'), 'https://fpmd.online/cedar-fc')
  assert.equal(clubTvViewerUrl('cedar-fc', current, 'https://v1.fpmd.online'), 'https://v1.fpmd.online/cedar-fc')
  assert.equal(clubTvViewerUrl('cedar-fc', current, 'https://example.com'), 'https://footballplayer.online/club-matchday-tv/view/cedar-fc')
})

test('only the V1 embed response may be framed by fpmd.online', async () => {
  const { default: frame } = await import('../netlify/edge-functions/club-matchday-tv-frame.js')
  const policy = "default-src 'self'; frame-ancestors 'none'; connect-src 'self'"
  const upstream = () => new Response('<html>Viewer</html>', { headers: {
    'Content-Type': 'text/html', 'Content-Security-Policy': policy, 'X-Frame-Options': 'DENY',
  } })
  const request = new Request('https://v1.fpmd.online/club-matchday-tv/embed/cedar-fc')
  const allowed = await frame(request, { next: upstream })
  assert.equal(allowed.headers.get('Content-Security-Policy'), "default-src 'self'; frame-ancestors https://fpmd.online; connect-src 'self'")
  assert.equal(allowed.headers.get('X-Frame-Options'), null)
  assert.equal(allowed.headers.get('Cache-Control'), 'no-store')
  assert.equal(await allowed.text(), '<html>Viewer</html>')
  assert.equal(await frame(new Request('https://footballplayer.online/club-matchday-tv/embed/cedar-fc'), {
    next() { assert.fail('The V1 web app should never receive frame headers') },
  }), undefined)
  const failed = await frame(request, { next: () => new Response('Unavailable', { status: 503, headers: { 'X-Frame-Options': 'DENY' } }) })
  assert.equal(failed.headers.get('X-Frame-Options'), 'DENY')
})
