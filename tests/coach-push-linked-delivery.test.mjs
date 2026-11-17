import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync('netlify/functions/send-coach-mobile-push.js', 'utf8')
const body = source.slice(source.indexOf('async function getCoachDevices('), source.indexOf('\nasync function logNotificationEvents('))
const match = { club_id: 'linked-club', team_id: 'team' }
const user = 'coach'

function harness(overrides = {}) {
  const tables = {
    coach_mobile_push_installations: [{ installation_id: 'device', auth_user_id: user, user_profile_id: user, status: 'active', enabled: true, detail_level: 'minimal' }],
    user_club_memberships: [{ auth_user_id: user, club_id: 'linked-club', role: 'head_manager', role_rank: 70 }],
    clubs: [{ id: 'linked-club', status: 'active' }],
    teams: [{ id: 'team', club_id: 'linked-club', status: 'active', archived_at: null }],
    team_staff: [{ id: 'assignment', user_id: user, team_id: 'team', role_rank: 70 }],
    ...overrides,
  }
  const client = { from(table) {
    let rows = tables[table]
    const query = {
      select() { return query },
      eq(key, value) { rows = rows.filter(row => row[key] === value); return query },
      neq(key, value) { rows = rows.filter(row => row[key] !== value); return query },
      async maybeSingle() { return { data: rows[0] || null, error: null } },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve) },
    }
    return query
  } }
  const loadActiveAuthorityProfile = async (_client, identity) => ({ id: identity.id, club_id: 'selected-other-club', role: 'head_manager', role_rank: 70 })
  const normalizeText = value => String(value ?? '').trim()
  const getDevices = new Function('supabaseAdmin', 'loadActiveAuthorityProfile', 'normalizeText', `${body}; return getCoachDevices`)(client, loadActiveAuthorityProfile, normalizeText)
  return (recipient = '') => getDevices(match, client, recipient)
}

test('an assigned Coach receives linked-club notifications when another club is selected', async () => {
  assert.deepEqual((await harness()(user)).map(device => device.installation_id), ['device'])
  assert.deepEqual(await harness()('another-user'), [])
})

for (const [label, overrides] of [
  ['removed membership', { user_club_memberships: [] }],
  ['removed assignment', { team_staff: [] }],
  ['inactive club', { clubs: [{ id: 'linked-club', status: 'suspended' }] }],
  ['archived team', { teams: [{ id: 'team', club_id: 'linked-club', status: 'active', archived_at: '2026-01-01' }] }],
  ['disabled notifications', { coach_mobile_push_installations: [{ installation_id: 'device', auth_user_id: user, user_profile_id: user, status: 'active', enabled: false, detail_level: 'minimal' }] }],
  ['installation with mismatched owner', { coach_mobile_push_installations: [{ installation_id: 'device', auth_user_id: user, user_profile_id: 'other', status: 'active', enabled: true, detail_level: 'minimal' }] }],
]) {
  test(`linked-club delivery excludes ${label}`, async () => assert.deepEqual(await harness(overrides)(), []))
}
