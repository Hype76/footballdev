import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { normalizeCoachMatchAvailability, readCoachMatchAvailability } from '../apps/mobile-core/src/coachAvailabilityData.js'
import { canRespondToCoachInviteOnBehalf, getCoachAvailabilityMatches, normalizeCoachInvite, collapseCoachInvitesByPlayer, summarizeCoachInvites } from '../apps/mobile-core/src/coachPhase31ECore.js'

const user = { clubId: 'club', activeTeamId: 'team' }

test('prepared staff responses retain club scope and reject changed or inactive invitations', () => {
  const actor = { ...user, id: 'coach', roleRank: 30 }
  for (const kind of ['match', 'training']) {
    const invite = normalizeCoachInvite({ id: 'invite', club_id: 'club', team_id: 'team', player_id: 'player', status: 'awaiting' }, kind)
    assert.equal(invite.clubId, 'club')
    assert.equal(canRespondToCoachInviteOnBehalf(actor, invite), true)
    for (const changes of [{ clubId: 'other' }, { teamId: 'other' }, { cancelled: true }, { stale: true }, { kind: 'calendar' }]) {
      assert.equal(canRespondToCoachInviteOnBehalf(actor, { ...invite, ...changes }), false)
    }
    assert.equal(canRespondToCoachInviteOnBehalf({ ...actor, roleRank: 10 }, invite), false)
    assert.equal(canRespondToCoachInviteOnBehalf({ ...actor, id: '' }, invite), false)
  }
})
const fixture = (id, overrides = {}) => ({ id, teamId: 'team', status: 'scheduled', matchDate: '2099-09-19', ...overrides })

const dataSource = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
const focusedBody = dataSource.slice(dataSource.indexOf('export async function getCoachMatchInvites('), dataSource.indexOf('export async function getCoachInvitesAndAvailability(')).replace('export ', '')
function focusedLoader(client, prepare = async choices => choices.map(() => null)) {
  return new Function('supabase', 'assertCoachOperationalRead', 'assertTeamEntity', 'readCoachMatchAvailability', 'normalizeCoachMatchAvailability', 'normalize', 'normalizeCoachInvite', 'prepareAttendanceChoices', `${focusedBody};return getCoachMatchInvites`)(
    client, candidate => assert.equal(candidate.activeTeamId, user.activeTeamId),
    (candidate, match) => { if (match.teamId !== candidate.activeTeamId) throw Error('Wrong Team') },
    readCoachMatchAvailability, normalizeCoachMatchAvailability, value => String(value || '').trim(), normalizeCoachInvite, prepare,
  )
}
function database(tables, failTable = '') {
  const reads = []
  return { reads, from(table) {
    const filters = []
    const query = {
      select() { return query },
      eq(key, value) { filters.push(row => row[key] === value); return query },
      in(key, values) { filters.push(row => values.includes(row[key])); return query },
      order(key, options) { if (table.startsWith('match_day_')) { assert.equal(key, 'id'); assert.equal(options.ascending, true) } return query },
      async range(start, end) {
        reads.push({ table, start, end })
        if (table === failTable && start > 0) return { error: new Error('Second page unavailable') }
        return { data: (tables[table] || []).filter(row => filters.every(filter => filter(row))).sort((a, b) => a.id.localeCompare(b.id)).slice(start, end + 1) }
      },
      limit(count) { return Promise.resolve({ data: (tables[table] || []).filter(row => filters.every(filter => filter(row))).slice(0, count) }) },
    }
    return query
  } }
}
function largeDataset() {
  const requests = [], responses = []
  const matches = Array.from({ length: 20 }, (_, i) => fixture(`match-${i}`))
  for (const match of matches) for (let player = 0; player < 17; player++) {
    const common = { club_id: 'club', team_id: 'team', match_day_id: match.id, player_id: `player-${player}` }
    requests.push({ ...common, id: `${match.id}-${player}-a`, status: 'sent', match_days: { opponent: match.id, match_date: match.matchDate } })
    if (player < 12) requests.push({ ...requests.at(-1), id: `${match.id}-${player}-b` })
    if (player < 15) responses.push({ ...common, id: `${match.id}-${player}`, status: player < 14 ? 'available' : 'unavailable' })
  }
  // Unrelated records must never consume the visible fixtures' page budget.
  requests.push(...Array.from({ length: 489 }, (_, i) => ({ ...requests[0], id: `history-${i}`, match_day_id: 'history' })))
  requests.push({ ...requests[0], id: 'foreign-team', team_id: 'other' }, { ...requests[0], id: 'foreign-club', club_id: 'other' })
  return { matches, tables: { match_day_availability_requests: requests, match_day_player_availability: responses } }
}

test('fixture reads include all 580 invitations and 300 responses, scoped to the visible club and team', async () => {
  const { matches, tables } = largeDataset(), client = database(tables)
  const result = await readCoachMatchAvailability(client, user, matches)
  assert.equal(result.matchResult.data.length, 580)
  assert.equal(result.matchAvailabilityResult.data.length, 300)
  assert.deepEqual(client.reads.filter(r => r.table === 'match_day_availability_requests').map(r => r.start), [0, 250, 500])
  assert.deepEqual(client.reads.filter(r => r.table === 'match_day_player_availability').map(r => r.start), [0, 250])
})

test('Training attendance is published before player enrichment and offline preparation finish', async () => {
  const client = database({ training_coach_attendance: [{ id: 'attendance', club_id: 'club', team_id: 'team',
    coach_user_id: 'coach', coach_name: 'Coach', status: 'available', occurrence_starts_at: '2099-09-19T10:00:00Z' }] })
  let releasePlayers, releasePreparation, publish
  const players = new Promise(resolve => { releasePlayers = resolve })
  const ready = new Promise(resolve => { publish = resolve })
  const body = dataSource.slice(dataSource.indexOf('export async function getCoachInvitesAndAvailability('), dataSource.indexOf('export async function setCoachInviteAvailabilityOnBehalf(')).replace('export ', '')
  const load = new Function('supabase', 'assertCoachOperationalRead', 'getCoachMatchDayList', 'readCoachMatchAvailability', 'normalizeCoachMatchAvailability', 'getCoachPlayerList', 'normalize', 'normalizeCoachInvite', 'prepareAttendanceChoices', `${body}; return getCoachInvitesAndAvailability`)(client, () => {}, async () => [], readCoachMatchAvailability, normalizeCoachMatchAvailability, () => players, value => String(value || '').trim(), normalizeCoachInvite, () => new Promise(resolve => { releasePreparation = resolve }))
  let finished = false
  const pending = load(user, { onAvailabilityReady: publish }).then(value => { finished = true; return value })
  const snapshot = await ready
  assert.equal(snapshot.trainingCoaches[0].status, 'available')
  assert.equal(finished, false)
  releasePlayers([{ id: 'player' }])
  releasePreparation([null])
  assert.equal((await pending).players[0].id, 'player')
})

test('actual Coach loader counts each player once and merges responses from later pages', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('export async function getCoachInvitesAndAvailability('), source.indexOf('export async function setCoachInviteAvailabilityOnBehalf(')).replace('export ', '')
  const { matches, tables } = largeDataset(), client = database(tables)
  const load = new Function('supabase', 'assertCoachOperationalRead', 'getCoachMatchDayList', 'readCoachMatchAvailability', 'normalizeCoachMatchAvailability', 'getCoachPlayerList', 'normalize', 'normalizeCoachInvite', 'prepareAttendanceChoices', `${body}; return getCoachInvitesAndAvailability`)(client, () => {}, async () => matches, readCoachMatchAvailability, normalizeCoachMatchAvailability, async () => [], value => String(value || '').trim(), normalizeCoachInvite, async choices => choices.map(() => null))
  const result = await load(user)
  for (const match of matches) {
    const players = collapseCoachInvitesByPlayer(result.match.filter(row => row.eventId === match.id))
    assert.equal(players.length, 17)
    const counts = summarizeCoachInvites(players)
    assert.equal(counts.available, 14, match.id)
    assert.equal(counts.unavailable, 1, match.id)
    assert.equal(counts.awaiting, 2, match.id)
  }
})

for (const table of ['match_day_availability_requests', 'match_day_player_availability']) test(`failed later ${table} page rejects instead of showing partial totals`, async () => {
  const { matches, tables } = largeDataset()
  await assert.rejects(readCoachMatchAvailability(database(tables, table), user, matches), /Second page unavailable/)
})

test('the shared fixture selection preserves upcoming, active-team, open, first-20 scope', async () => {
  const matches = [fixture('past', { matchDate: '2020-01-01' }), fixture('foreign', { teamId: 'other' }), fixture('closed', { status: 'completed' }), ...Array.from({ length: 22 }, (_, i) => fixture(String(i), { matchDate: `2099-09-${String(i + 1).padStart(2, '0')}`, status: i === 0 ? 'scorer_request' : 'scheduled' }))].reverse()
  assert.deepEqual(getCoachAvailabilityMatches(matches, 'team').map(row => row.id), Array.from({ length: 20 }, (_, i) => String(i)))
  const client = database({})
  assert.deepEqual(await readCoachMatchAvailability(client, user, []), { matchResult: { data: [] }, matchAvailabilityResult: { data: [] } })
  assert.equal(client.reads.length, 0)
})

test('selected fixture reads all 17 invited players independently of other invitation sources', async () => {
  const { matches, tables } = largeDataset(), client = database(tables)
  const result = await focusedLoader(client)(user, matches[0])
  assert.equal(collapseCoachInvitesByPlayer(result).length, 17)
  assert.ok(result.every(row => row.eventId === matches[0].id))
  assert.deepEqual([...new Set(client.reads.map(read => read.table))].sort(), ['match_day_availability_requests', 'match_day_player_availability'])
  await assert.rejects(focusedLoader(client)(user, fixture('foreign', { teamId: 'other' })), /Wrong Team/)
})

test('complete roster becomes available before a slow offline-command preparation', async () => {
  const { matches, tables } = largeDataset()
  let finishPreparation, publish
  const ready = new Promise(resolve => { publish = resolve })
  const load = focusedLoader(database(tables), () => new Promise(resolve => { finishPreparation = resolve }))
  const pending = load(user, matches[0], { onReady: publish })
  const rows = await ready
  assert.equal(collapseCoachInvitesByPlayer(rows).length, 17)
  finishPreparation(rows.map(() => ({ route: 'coach_player_match' })))
  assert.equal((await pending).length, rows.length)
})

test('failed later selected-fixture page never publishes a partial roster', async () => {
  const match = fixture('large-match')
  const common = { club_id: 'club', team_id: 'team', match_day_id: match.id, status: 'available' }
  const requests = Array.from({ length: 270 }, (_, i) => ({ ...common, id: String(i).padStart(3, '0'), player_id: 'p-'+i }))
  for (const table of ['match_day_availability_requests', 'match_day_player_availability']) {
    let published = false
    const client = database({ match_day_availability_requests: requests, match_day_player_availability: requests }, table)
    await assert.rejects(focusedLoader(client)(user, match, { onReady: () => { published = true } }), /Second page unavailable/)
    assert.equal(published, false)
  }
})


test('list publishes the same 13 available, 1 awaiting and 3 unavailable before slow sources finish', async () => {
  const match = fixture('fixture')
  const requests = Array.from({ length: 17 }, (_, index) => ({
    id: `request-${index}`, club_id: 'club', team_id: 'team', match_day_id: match.id,
    player_id: `player-${index}`, status: 'sent', sent_at: '2099-09-01',
    match_days: { opponent: 'Opponent', match_date: match.matchDate },
  }))
  const responses = requests.slice(0, 16).map((row, index) => ({ ...row, status: index < 13 ? 'available' : 'unavailable' }))
  const client = database({ match_day_availability_requests: requests, match_day_player_availability: responses })
  let releasePlayers, publish
  const players = new Promise(resolve => { releasePlayers = resolve })
  const ready = new Promise(resolve => { publish = resolve })
  const body = dataSource.slice(dataSource.indexOf('export async function getCoachInvitesAndAvailability('), dataSource.indexOf('export async function setCoachInviteAvailabilityOnBehalf(')).replace('export ', '')
  const load = new Function('supabase', 'assertCoachOperationalRead', 'getCoachMatchDayList', 'readCoachMatchAvailability', 'normalizeCoachMatchAvailability', 'getCoachPlayerList', 'normalize', 'normalizeCoachInvite', 'prepareAttendanceChoices', `${body}; return getCoachInvitesAndAvailability`)(client, () => {}, async () => [match], readCoachMatchAvailability, normalizeCoachMatchAvailability, () => players, value => String(value || '').trim(), normalizeCoachInvite, async choices => choices.map(() => null))
  let finished = false
  const pending = load(user, { onMatchReady: publish }).then(value => { finished = true; return value })
  const snapshot = await ready
  assert.equal(finished, false, 'Match counts publish while player enrichment is still pending')
  const summary = summarizeCoachInvites(collapseCoachInvitesByPlayer(snapshot.match))
  assert.equal(summary.available, 13)
  assert.equal(summary.awaiting, 1)
  assert.equal(summary.unavailable, 3)
  const opened = await focusedLoader(client)(user, match)
  assert.deepEqual(summary, summarizeCoachInvites(collapseCoachInvitesByPlayer(opened)))
  releasePlayers([])
  const complete = await pending
  assert.deepEqual(summarizeCoachInvites(collapseCoachInvitesByPlayer(complete.match)), summary)
})
