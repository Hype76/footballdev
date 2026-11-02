import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

const state = { allowed: true, validLink: true, assigned: false, rpcCalls: [], emails: [], alerts: [] }
const match = { id: 'match', club_id: 'club', team_id: 'team', opponent: 'Opposition', status: 'scheduled', clubs: { name: 'Club' }, teams: { name: 'Team' } }
const player = { id: 'player', player_name: 'Player', team_id: 'team', club_id: 'club', status: 'active' }
const link = { id: 'link', club_id: 'club', team_id: 'team', player_id: 'player', auth_user_id: 'parent', email: 'parent@example.test', status: 'active', players: player }
const profile = { id: 'coach', club_id: 'club', role: 'coach', role_rank: 20, email: 'coach@example.test', name: 'Coach' }
function query(table) {
  let operation = ''
  const q = {
    select() { return this }, eq() { return this }, is() { return this }, in() { return this }, not() { return this },
    insert(value) { operation = 'insert'; if (table === 'scheduled_email_queue') state.emails.push(value); return this },
    maybeSingle() { return Promise.resolve({ data: table === 'match_days' ? match : table === 'parent_player_links' ? (state.validLink ? link : null) : table === 'match_day_role_assignments' && state.assigned ? { id: 'assignment', match_day_id: 'match', role: 'scorer', parent_link_id: 'link', auth_user_id: 'parent', parent_player_links: link } : null, error: null }) },
    single() { return Promise.resolve({ data: { id: 'email' }, error: null }) },
    then(resolve) { return Promise.resolve({ data: operation === 'insert' ? null : [], error: null }).then(resolve) },
  }
  return q
}
const admin = { from: query, async rpc(name, args) { state.rpcCalls.push({ name, args }); if (name === 'assign_match_day_parent_directly') { state.assigned = true; return { data: { requestId: 'request', previousAssignment: null }, error: null } } throw new Error(`Unexpected admin RPC ${name}`) } }
const userClient = { auth: { getUser: async () => ({ data: { user: { id: 'coach' } }, error: null }) }, from: query, rpc: async () => ({ data: state.allowed, error: null }) }
mock.module('../netlify/functions/lib/_supabase.js', { namedExports: { createPublicSupabaseClient: () => userClient, createSupabaseAdminClient: () => admin } })
mock.module('../netlify/functions/lib/_authority-profile.js', { namedExports: { loadActiveAuthorityProfile: async () => profile } })
mock.module('../netlify/functions/lib/_billing-access.js', { namedExports: { assertWorkspaceBillingAction: async () => {} } })
mock.module('../netlify/functions/send-match-day-push.js', { namedExports: { handler: async (event) => { state.alerts.push(JSON.parse(event.body)); return { statusCode: 200, body: JSON.stringify({ success: true, mobileInbox: true, mobileSent: 1 }) } } } })
mock.module('../src/lib/email-branding.js', { namedExports: { buildEmailLogoMarkup: () => '', buildEventMapLinksMarkup: () => '', resolveReachableEmailLogo: async () => ({ source: '', url: '' }) } })
const { handler } = await import('../netlify/functions/select-match-day-volunteer.js')
const event = { httpMethod: 'POST', headers: { authorization: 'Bearer test', host: 'example.test' }, body: JSON.stringify({ matchDayId: 'match', role: 'scorer', selected: true, directParentLinkId: 'link' }) }
function reset() { Object.assign(state, { allowed: true, validLink: true, assigned: false, rpcCalls: [], emails: [], alerts: [] }) }

test('direct handler saves the selected parent and queues the existing email and scorer alert', async () => {
  reset()
  const response = await handler(event)
  const body = JSON.parse(response.body)
  assert.equal(response.statusCode, 200, body.message)
  assert.equal(body.parentLinkId, 'link')
  assert.equal(body.assignment.id, 'assignment')
  assert.equal(body.warning, '')
  assert.equal(state.rpcCalls.length, 1)
  assert.equal(state.rpcCalls[0].name, 'assign_match_day_parent_directly')
  assert.equal(state.rpcCalls[0].args.parent_link_id_value, 'link')
  assert.equal(state.emails[0].to_email, 'parent@example.test')
  assert.deepEqual(state.alerts[0], { matchDayId: 'match', parentLinkId: 'link', type: 'scorer_selected' })
})

test('direct handler denies a coach without team authority before any assignment or notification', async () => {
  reset(); state.allowed = false
  const result = await handler(event)
  assert.equal(result.statusCode, 403)
  assert.equal(state.rpcCalls.length, 0)
  assert.equal(state.emails.length, 0)
  assert.equal(state.alerts.length, 0)
})

test('direct handler rejects an invalid parent link before any assignment or notification', async () => {
  reset(); state.validLink = false
  const result = await handler(event)
  assert.equal(result.statusCode, 403)
  assert.equal(state.rpcCalls.length, 0)
  assert.equal(state.emails.length, 0)
  assert.equal(state.alerts.length, 0)
})
