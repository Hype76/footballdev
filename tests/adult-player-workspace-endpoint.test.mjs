import assert from 'node:assert/strict'
import test from 'node:test'
process.env.VITE_SUPABASE_URL ||= 'https://synthetic.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-test-key'
const { handleAdultPlayerWorkspace } = await import('../netlify/functions/adult-player-workspace.js')
const { loadAdultPlayerCalendarExtras, enrichAdultPlayerMatches } = await import('../netlify/functions/lib/_adult-player-workspace-read.js')

function fixture() {
  const actor = { id: 'actor', email: 'player@example.test', email_confirmed_at: '2026-01-01' }
  const state = { user_id: 'actor', access_granted: true, access_mode: 'player', link_status: 'active', verified_at: '2026-01-01', link_id: 'adult-link', player_id: 'player', team_id: 'team', club_id: 'club' }
  const tables = {
    players: [{ id: 'player', club_id: 'club', team_id: 'team', status: 'active', archived_at: null, contact_type: 'self', parent_contacts: [{ type: 'self', email: actor.email }] }],
    clubs: [{ id: 'club', status: 'active', archived_at: null }],
    teams: [{ id: 'team', club_id: 'club', status: 'active', archived_at: null }], users: [],
  }
  const reads = []
  const admin = { from(table) {
    reads.push(table)
    const filters = []
    const query = { select() { return query }, eq(key, value) { filters.push(row => row[key] === value); return query }, neq(key, value) { filters.push(row => row[key] !== value); return query }, in(key, values) { filters.push(row => values.includes(row[key])); return query }, order() { return query }, limit() { return query }, is(key, value) { filters.push(row => (row[key] ?? null) === value); return query },
      maybeSingle() { return query.then(result => ({ ...result, data: result.data[0] || null })) },
      then(resolve, reject) { return Promise.resolve({ data: (tables[table] || []).filter(row => filters.every(filter => filter(row))), error: null }).then(resolve, reject) } }
    return query
  } }
  let loads = 0
  const options = { createAdmin: () => admin, createCaller: () => ({ auth: { getUser: async () => ({ data: { user: actor } }) }, rpc: async () => ({ data: [state] }) }),
    getPlan: async () => ({ planKey: 'club', planStatus: 'active' }), assertEntitlement: () => {}, featureIncluded: () => true,
    loadSchedule: async (_admin, scope) => { loads++; assert.equal(scope.parent.id, undefined); assert.equal(scope.fan.permissions, undefined); return [{ id: 'event', date: '2026-11-21' }] },
    loadMatches: async () => { loads++; return [] }, loadResources: async () => { loads++; return [] }, loadStats: async () => ({}) }
  const call = async (body = { action: 'workspace' }, headers = { authorization: 'Bearer caller-token' }) => handleAdultPlayerWorkspace({ httpMethod: 'POST', body: JSON.stringify(body), headers }, options)
  return { admin, actor, state, tables, reads, options, call, loads: () => loads }
}

test('Player profile verifies ownership but performs no workspace feature reads', async () => {
  const f = fixture(); const result = await f.call({ action: 'profile', playerId: 'another-player' })
  assert.equal(result.statusCode, 200)
  assert.equal(JSON.parse(result.body).link.playerId, 'player')
  assert.equal(f.loads(), 0)
  assert.ok(!f.reads.includes('parent_player_links'))
  assert.equal(JSON.parse(result.body).capabilities.notifications, true)
  assert.equal(JSON.parse(result.body).capabilities.communication, false)
})
test('request link mismatch cannot read resources or stats; legacy self contact aliases remain valid', async () => {
  const f = fixture()
  for (const action of ['stats', 'openResource']) assert.equal((await f.call({ action, expectedLinkId: 'another-link' })).statusCode, 403)
  f.tables.players[0].parent_contacts = [{ contactType: ' Self ', parentEmail: ' PLAYER@example.test ' }]
  assert.equal((await f.call({ action: 'profile', expectedLinkId: 'adult-link' })).statusCode, 200)
})
test('missing authentication and forged or revoked Player authority fail closed', async () => {
  const f = fixture()
  assert.equal((await f.call(undefined, {})).statusCode, 401)
  f.state.user_id = 'other-user'; assert.equal((await f.call()).statusCode, 403)
  f.state.user_id = 'actor'; f.state.link_status = 'revoked'; assert.equal((await f.call()).statusCode, 403)
  assert.equal(f.loads(), 0)
})
test('suspension, team transfer and changed self contact deny all workspace reads', async () => {
  for (const mutate of [f => f.tables.users.push({ id: 'actor', club_id: 'club', status: 'suspended' }), f => { f.tables.players[0].team_id = 'different-team' }, f => { f.tables.players[0].parent_contacts[0].email = 'changed@example.test' }]) {
    const f = fixture(); mutate(f)
    assert.equal((await f.call()).statusCode, 403)
    assert.equal(f.loads(), 0)
  }
})
test('workspace scopes reads to own Player and contains feature failures', async () => {
  const f = fixture(); f.options.loadResources = async () => { throw new Error('Unavailable') }
  const result = await f.call({ action: 'workspace', clubId: 'other-club' })
  assert.equal(result.statusCode, 200)
  const body = JSON.parse(result.body)
  assert.equal(body.link.clubId, 'club')
  assert.equal(body.calendar.length, 1)
  assert.ok(body.errors.resources)
  assert.equal(body.capabilities.scorer, false)
})
test('plan denial prevents feature queries and excluded features are never read', async () => {
  const f = fixture(); f.options.assertEntitlement = () => { throw Object.assign(new Error('Plan denied'), { statusCode: 403 }) }
  assert.equal((await f.call()).statusCode, 403); assert.equal(f.loads(), 0)
  f.options.assertEntitlement = () => {}; f.options.featureIncluded = () => false
  assert.equal((await f.call()).statusCode, 200); assert.equal(f.loads(), 0)
})
test('resource access rejects unshared resources and paths outside the current team', async () => {
  const f = fixture()
  assert.equal((await f.call({ action: 'openResource', resourceId: 'unshared' })).statusCode, 403)
  f.options.loadResources = async () => [{ id: 'resource' }]
  f.tables.resource_library_items = [{ id: 'resource', club_id: 'club', team_id: 'team', archived_at: null, storage_bucket: 'resource-library', storage_path: 'club/other-team/file.pdf' }]
  assert.equal((await f.call({ action: 'openResource', resourceId: 'resource' })).statusCode, 403)
  f.tables.resource_library_items[0].storage_path = 'club/team/../private.pdf'
  assert.equal((await f.call({ action: 'openResource', resourceId: 'resource' })).statusCode, 403)
  f.tables.resource_library_items[0].mime_type = 'application/vnd.footballplayer.formation-board+json'
  assert.equal((await f.call({ action: 'openResource', resourceId: 'resource' })).statusCode, 403)
})
test('calendar extras require a visible scheduled event and exact occurrence without exposing private resource fields', async () => {
  const f = fixture(); const eventId = '10000000-0000-4000-8000-000000000001'
  const calendar = [{ id: `${eventId}:2026-11-21` }]
  const scope = { club: { id: 'club' }, team: { id: 'team' } }
  f.tables.calendar_events = [{ id: eventId, club_id: 'club', team_id: 'team', parent_visible: true, parent_audience: 'involved_players', notes: 'Meet at gate', notes_pinned: true }]
  const link = { resource_id: 'resource', club_id: 'club', team_id: 'team', linked_type: 'calendar_event', linked_id: eventId, calendar_occurrence_date: '2026-11-21', resource_library_items: { id: 'resource', club_id: 'club', team_id: 'team', title: 'Training plan', storage_path: 'secret-path' } }
  f.tables.resource_library_links = [link, { ...link, calendar_occurrence_date: '2026-11-22' }]
  let result = await loadAdultPlayerCalendarExtras(f.admin, scope, calendar, { includeResources: true })
  assert.equal(result.calendarResources.length, 1)
  assert.equal(result.calendarResources[0].storage_path, undefined)
  assert.equal(result.calendarDetails[0].notes, 'Meet at gate')
  f.tables.calendar_events[0].parent_visible = false
  result = await loadAdultPlayerCalendarExtras(f.admin, scope, calendar, { includeResources: true })
  assert.deepEqual(result, { calendarDetails: [], calendarResources: [] })
})
test('match enrichment reads events only for previously authorized matches and preserves no scorer authority', async () => {
  const f = fixture(); const scope = { club: { id: 'club' } }
  f.tables.match_days = [{ id: 'visible', club_id: 'club', home_shootout_score: 3 }, { id: 'hidden', club_id: 'club' }]
  f.tables.match_day_events = [{ id: 'goal', match_day_id: 'visible', event_status: 'active', event_type: 'goal' }, { id: 'private-goal', match_day_id: 'hidden', event_status: 'active' }]
  f.tables.match_day_shootout_kicks = [{ id: 'kick', match_day_id: 'visible', outcome: 'scored' }]
  const result = await enrichAdultPlayerMatches(f.admin, scope, [{ id: 'visible' }])
  assert.deepEqual(result[0].events.map(event => event.id), ['goal'])
  assert.equal(result[0].shootout_events.length, 1)
  assert.equal(result[0].home_shootout_score, 3)
  assert.equal(result[0].is_scorer, false)
})
