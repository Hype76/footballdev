import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { getAppleCalendarSubscriptionUrl } from '../apps/mobile-core/src/calendarSubscriptionCore.js'
import { buildCoachCalendarOccurrenceDates } from '../apps/mobile-core/src/coachCalendarCore.js'
process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key'
const { handleCoachCalendarFeed, loadCoachFeedEvents } = await import('../netlify/functions/coach-calendar-feed.js')
const { buildAcceptedCalendarFeed, handleParentCalendarFeed } = await import('../netlify/functions/parent-calendar-feed.js')

const userId = '11111111-1111-4111-8111-111111111111'
const clubId = '22222222-2222-4222-8222-222222222222'
const teamId = '33333333-3333-4333-8333-333333333333'
const otherTeam = '44444444-4444-4444-8444-444444444444'
const parentLinkId = '55555555-5555-4555-8555-555555555555'
const contextId = `team:${teamId}`
const now = new Date('2026-10-27T12:00:00Z')

test('Apple connection opens only the exact private feed for the selected app', () => {
  for (const role of ['coach', 'parent']) {
    const origin = role === 'coach' ? 'https://footballplayer.online' : 'https://parent.footballplayer.online'
    const url = `${origin}/.netlify/functions/${role}-calendar-feed?token=${'a'.repeat(64)}`
    assert.equal(getAppleCalendarSubscriptionUrl(url, role), url.replace('https:', 'webcal:'))
    for (const invalid of [url.replace('https:', 'http:'), url.replace('footballplayer.online', 'example.com'), `${url}&redirect=https://example.com`, `${url}#bad`, url.replace('token=', 'secret=')]) {
      assert.throws(() => getAppleCalendarSubscriptionUrl(invalid, role))
    }
  }
})

function fakeClient(overrides = {}) {
  const tables = {
    users: [{ id: userId, club_id: clubId, role: 'coach', role_rank: 30, status: 'active' }],
    user_club_memberships: [{ auth_user_id: userId, club_id: clubId, role: 'coach', role_rank: 30 }],
    clubs: [{ id: clubId, status: 'active' }], teams: [{ id: teamId, club_id: clubId, status: 'active' }],
    team_staff: [{ id: 'assignment', user_id: userId, team_id: teamId, role_rank: 30 }],
    coach_calendar_feed_tokens: [{ auth_user_id: userId, context_id: contextId, club_id: clubId, team_id: teamId, token_hash: createHash('sha256').update('a'.repeat(64)).digest('hex') }],
    parent_calendar_feed_tokens: [], parent_calendar_subscription_tokens: [],
    parent_player_links: [{ id: parentLinkId, auth_user_id: userId, player_id: 'player', club_id: clubId, team_id: teamId, status: 'active' }],
    players: [{ id: 'player', club_id: clubId, team_id: teamId }],
    calendar_events: [{ id: 'training', club_id: clubId, team_id: teamId, title: 'Training', event_type: 'training',
      starts_at: '2025-01-07T18:00:00Z', ends_at: '2025-01-07T19:00:00Z', recurrence_frequency: 'weekly',
      recurrence_until: '2027-02-01', deleted_occurrence_dates: ['2026-11-03'], notes: 'Private coach notes' },
    { id: 'other', club_id: clubId, team_id: otherTeam, title: 'Other team secret', starts_at: '2026-11-01T18:00:00Z' }],
    match_days: [{ id: 'match', club_id: clubId, team_id: teamId, opponent: 'Visitors', match_date: '2026-11-01', kickoff_time: '10:00', status: 'scheduled' }],
    assessment_sessions: [], ...overrides,
  }
  const calls = []
  const client = { calls, tables, auth: {
    getUser: async () => ({ data: { user: { id: userId } } }),
    admin: { getUserById: async () => ({ data: { user: { id: userId } } }) },
  }, from: table => {
    let rows = [...(tables[table] || [])]
    let operation = '', values
    const finish = () => {
      if (operation === 'insert') {
        const row = { id: `record-${calls.length}`, ...values }
        tables[table] ||= []
        tables[table].push(row)
        rows = [row]
      } else if (operation === 'update') {
        for (const row of rows) Object.assign(row, values)
      } else if (operation === 'delete') {
        tables[table] = (tables[table] || []).filter(row => !rows.includes(row))
      }
      operation = ''
      return rows
    }
    const query = {
      select: columns => { calls.push([table, 'select', columns]); return query },
      eq: (key, value) => { calls.push([table, 'eq', key, value]); rows = rows.filter(row => row[key] === value); return query },
      is: (key, value) => { rows = rows.filter(row => (row[key] ?? null) === value); return query },
      or: filter => { calls.push([table, 'or', filter]); const id = /team_id.eq.([^,]+)/.exec(filter)?.[1]; rows = rows.filter(row => row.team_id === id || !row.team_id); return query },
      gte: (key, value) => { rows = rows.filter(row => row[key] >= value); return query },
      lte: (key, value) => { rows = rows.filter(row => row[key] <= value); return query },
      order: () => query, range: async (from, to) => ({ data: rows.slice(from, to + 1) }),
      maybeSingle: async () => ({ data: finish()[0] || null }),
      insert: value => { calls.push([table, 'insert', value]); operation = 'insert'; values = value; return query },
      update: value => { calls.push([table, 'update', value]); operation = 'update'; values = value; return query },
      upsert: value => { calls.push([table, 'upsert', value]); return query },
      delete: () => { calls.push([table, 'delete']); operation = 'delete'; return query },
      then: (resolve, reject) => Promise.resolve({ data: finish() }).then(resolve, reject),
    }
    return query
  } }
  return client
}

test('Coach feed preserves older recurring series, deleted occurrences, London time and team scope', async () => {
  const client = fakeClient()
  const events = await loadCoachFeedEvents(client, { clubId, teamId }, now)
  const feed = buildAcceptedCalendarFeed(events, contextId)
  assert.match(feed, /SUMMARY:Training/)
  assert.doesNotMatch(feed, /Other team secret|Private coach notes/)
  assert.ok(events.some(event => event.date === '2026-10-27'))
  assert.ok(!events.some(event => event.date === '2026-11-03' && event.title === 'Training'))
  assert.match(feed, /DTSTART:20261027T180000Z/)
  assert.ok(client.calls.some(call => call[0] === 'match_days' && call[1] === 'eq' && call[2] === 'team_id' && call[3] === teamId))
  assert.ok(client.calls.some(call => call[0] === 'calendar_events' && call[1] === 'or' && call[2].includes(teamId)))
})

test('rolling monthly windows preserve the original month-end anchor', () => {
  assert.deepEqual(buildCoachCalendarOccurrenceDates({ date: '2024-01-31', recurrenceFrequency: 'monthly', recurrenceUntil: '2027-12-31',
    windowStart: '2026-10-01', windowEnd: '2026-12-31' }), ['2026-10-31', '2026-11-30', '2026-12-31'])
})

test('a legacy fixture with no kickoff is all-day even when its TBC flag is false', async () => {
  const client = fakeClient()
  client.tables.match_days[0].kickoff_time = null
  client.tables.match_days[0].kickoff_time_tbc = false
  const events = await loadCoachFeedEvents(client, { clubId, teamId }, now)
  const fixture = events.find(event => event.id === 'match_day:match')
  const feed = buildAcceptedCalendarFeed([fixture], contextId)
  assert.match(feed, /DTSTART;VALUE=DATE:20261101/)
  assert.match(feed, /Time TBC/)
  assert.doesNotMatch(feed, /235900/)
})

test('a changed kickoff keeps the same UID and cancelled events disappear on refresh', async () => {
  const client = fakeClient()
  const first = await loadCoachFeedEvents(client, { clubId, teamId }, now)
  client.tables.match_days[0].kickoff_time = '11:00'
  const changed = await loadCoachFeedEvents(client, { clubId, teamId }, now)
  assert.equal(first.find(event => event.id === 'match_day:match').id, changed.find(event => event.id === 'match_day:match').id)
  assert.notEqual(first.find(event => event.id === 'match_day:match').starts_at, changed.find(event => event.id === 'match_day:match').starts_at)
  client.tables.match_days[0].status = 'cancelled'
  assert.doesNotMatch(buildAcceptedCalendarFeed(await loadCoachFeedEvents(client, { clubId, teamId }, now), contextId), /UID:.*match_day:match/)
})

test('Coach feed checks current membership on every read and blocks removed assignments and forged contexts', async () => {
  const allowed = await handleCoachCalendarFeed({ httpMethod: 'GET', queryStringParameters: { token: 'a'.repeat(64) } }, { client: fakeClient(), now })
  assert.equal(allowed.statusCode, 200)
  assert.match(allowed.body, /X-WR-CALNAME:Football Player Coach calendar/)
  for (const overrides of [{ user_club_memberships: [] }, { team_staff: [] }, { clubs: [{ id: clubId, status: 'deleted' }] }, { teams: [] }]) {
    const client = fakeClient(overrides)
    const result = await handleCoachCalendarFeed({ httpMethod: 'GET', queryStringParameters: { token: 'a'.repeat(64) } }, { client, now })
    assert.equal(result.statusCode, 403)
    assert.ok(!client.calls.some(call => call[0] === 'calendar_events'))
  }
  const forged = await handleCoachCalendarFeed({ httpMethod: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ contextId: `team:${otherTeam}` }) }, { client: fakeClient(), now })
  assert.equal(forged.statusCode, 403)
})

test('feed secrets are hashed, revocable and never stored in plaintext', async () => {
  const client = fakeClient()
  const event = { httpMethod: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ contextId }) }
  const result = await handleCoachCalendarFeed(event, { client, now })
  assert.equal(result.statusCode, 200)
  const url = JSON.parse(result.body).url
  assert.match(url, /token=[a-f0-9]{64}$/)
  const record = client.calls.find(call => call[1] === 'insert')[2]
  assert.match(record.token_hash, /^[a-f0-9]{64}$/)
  assert.ok(!JSON.stringify(record).includes(new URL(url).searchParams.get('token')))
  assert.equal((await handleCoachCalendarFeed({ ...event, httpMethod: 'DELETE', body: JSON.stringify({ contextId, previousToken: new URL(url).searchParams.get('token') }) }, { client, now })).statusCode, 200)
  assert.ok(client.calls.some(call => call[1] === 'delete'))
})

test('connecting, replacing and revoking a second phone never changes another independent subscription', async () => {
  for (const role of ['coach', 'parent']) {
    const client = fakeClient({ coach_calendar_feed_tokens: [] })
    const call = event => role === 'coach' ? handleCoachCalendarFeed(event, { client, now })
      : handleParentCalendarFeed(event, { createClient: () => client, loadAttendance: async () => [] })
    const create = async (previousToken = '') => {
      const result = await call({ httpMethod: 'POST', headers: { authorization: 'Bearer token' },
        body: JSON.stringify(role === 'coach' ? { contextId, previousToken } : { parentLinkId, subscriptionVersion: 2, previousToken }) })
      assert.equal(result.statusCode, 200, result.body)
      return new URL(JSON.parse(result.body).url).searchParams.get('token')
    }
    const read = token => call({ httpMethod: 'GET', queryStringParameters: { token } })
    const first = await create(), second = await create()
    assert.notEqual(first, second)
    assert.equal((await read(first)).statusCode, 200)
    assert.equal((await read(second)).statusCode, 200)
    const replaced = await create(first)
    assert.equal((await read(first)).statusCode, 404)
    assert.equal((await read(replaced)).statusCode, 200)
    assert.equal((await read(second)).statusCode, 200)
    assert.equal((await call({ httpMethod: 'DELETE', headers: { authorization: 'Bearer token' }, body: JSON.stringify(role === 'coach'
      ? { contextId, previousToken: replaced } : { parentLinkId, subscriptionVersion: 2, previousToken: replaced }) })).statusCode, 200)
    assert.equal((await read(replaced)).statusCode, 404)
    assert.equal((await read(second)).statusCode, 200)
  }
})

test('Coach subscription migration denies public and authenticated table access', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
      create table auth.users(id uuid primary key); create table public.clubs(id uuid primary key); create table public.teams(id uuid primary key);
      create table public.parent_player_links(id uuid primary key);`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261027140215_coach_calendar_subscriptions.sql', import.meta.url), 'utf8'))
    const result = await db.query(`select has_table_privilege('anon','public.coach_calendar_feed_tokens','select') as anon_read,
      has_table_privilege('authenticated','public.coach_calendar_feed_tokens','select') as user_read,
      has_table_privilege('service_role','public.coach_calendar_feed_tokens','select') as server_read,
      relrowsecurity from pg_class where oid='public.coach_calendar_feed_tokens'::regclass`)
    assert.deepEqual(result.rows[0], { anon_read: false, user_read: false, server_read: true, relrowsecurity: true })
    const parentPrivileges = await db.query(`select has_table_privilege('anon','public.parent_calendar_subscription_tokens','select') as anon_read,
      has_table_privilege('authenticated','public.parent_calendar_subscription_tokens','select') as user_read,
      has_table_privilege('service_role','public.parent_calendar_subscription_tokens','select') as server_read,
      relrowsecurity from pg_class where oid='public.parent_calendar_subscription_tokens'::regclass`)
    assert.deepEqual(parentPrivileges.rows[0], { anon_read: false, user_read: false, server_read: true, relrowsecurity: true })
    await db.exec(`insert into auth.users values('${userId}'); insert into public.clubs values('${clubId}');
      insert into public.teams values('${teamId}'); insert into public.parent_player_links values('${parentLinkId}');
      insert into public.coach_calendar_feed_tokens(auth_user_id,club_id,team_id,context_id,token_hash) values
      ('${userId}','${clubId}','${teamId}','${contextId}','${'a'.repeat(64)}'),
      ('${userId}','${clubId}','${teamId}','${contextId}','${'b'.repeat(64)}');
      insert into public.parent_calendar_subscription_tokens(auth_user_id,parent_link_id,token_hash) values
      ('${userId}','${parentLinkId}','${'c'.repeat(64)}'), ('${userId}','${parentLinkId}','${'d'.repeat(64)}');`)
    assert.equal((await db.query('select count(*)::int as count from public.coach_calendar_feed_tokens')).rows[0].count, 2)
    assert.equal((await db.query('select count(*)::int as count from public.parent_calendar_subscription_tokens')).rows[0].count, 2)
    await assert.rejects(db.exec(`insert into public.coach_calendar_feed_tokens(auth_user_id,club_id,context_id,token_hash)
      values('${userId}','${clubId}','team:${teamId}','bad')`))
  } finally { await db.close() }
})
