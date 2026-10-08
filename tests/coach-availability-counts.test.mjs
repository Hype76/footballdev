import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { readCoachMatchAvailability } from '../apps/mobile-core/src/coachAvailabilityData.js'
import { getCoachAvailabilityMatches, normalizeCoachInvite, collapseCoachInvitesByPlayer, summarizeCoachInvites } from '../apps/mobile-core/src/coachPhase31ECore.js'

const user = { clubId: 'club', activeTeamId: 'team' }
const fixture = (id, overrides = {}) => ({ id, teamId: 'team', status: 'scheduled', matchDate: '2099-09-19', ...overrides })

const dataSource = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
const focusedBody = dataSource.slice(dataSource.indexOf('export async function getCoachMatchInvites('), dataSource.indexOf('export async function getCoachInvitesAndAvailability(')).replace('export ', '')
function focusedLoader(client, prepare = async choices => choices.map(() => null)) {
  return new Function('supabase', 'assertCoachOperationalRead', 'assertTeamEntity', 'readCoachMatchAvailability', 'normalize', 'normalizeCoachInvite', 'prepareAttendanceChoices', `${focusedBody};return getCoachMatchInvites`)(
    client, candidate => assert.equal(candidate.activeTeamId, user.activeTeamId),
    (candidate, match) => { if (match.teamId !== candidate.activeTeamId) throw Error('Wrong Team') },
    readCoachMatchAvailability, value => String(value || '').trim(), normalizeCoachInvite, prepare,
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
      limit() { return Promise.resolve({ data: [] }) },
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

test('actual Coach loader counts each player once and merges responses from later pages', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('export async function getCoachInvitesAndAvailability('), source.indexOf('export async function setCoachInviteAvailabilityOnBehalf(')).replace('export ', '')
  const { matches, tables } = largeDataset(), client = database(tables)
  const load = new Function('supabase', 'assertCoachOperationalRead', 'getCoachMatchDayList', 'readCoachMatchAvailability', 'getCoachPlayerList', 'normalize', 'normalizeCoachInvite', 'prepareAttendanceChoices', `${body}; return getCoachInvitesAndAvailability`)(client, () => {}, async () => matches, readCoachMatchAvailability, async () => [], value => String(value || '').trim(), normalizeCoachInvite, async choices => choices.map(() => null))
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
