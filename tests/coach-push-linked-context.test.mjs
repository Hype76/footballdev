import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync('netlify/functions/coach-mobile-push-installation.js', 'utf8')
const functionBody = source.slice(source.indexOf('async function loadCoachContext('), source.indexOf('\nasync function registerInstallation('))
const teamId = '11111111-1111-4111-8111-111111111111'
const clubId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const selectedClub = '44444444-4444-4444-8444-444444444444'

function harness(overrides = {}) {
  const tables = {
    teams: [{ id: teamId, club_id: clubId, status: 'active', archived_at: null }],
    clubs: [{ id: clubId, status: 'active' }],
    user_club_memberships: [{ auth_user_id: userId, club_id: clubId, role: 'head_manager', role_rank: 70 }],
    team_staff: [{ id: 'assignment', user_id: userId, team_id: teamId, role_rank: 70 }],
    ...overrides,
  }
  const supabaseAdmin = { from(table) {
    let rows = tables[table]
    const query = {
      select() { return query },
      eq(key, value) { rows = rows.filter(row => row[key] === value); return query },
      async maybeSingle() { return { data: rows[0] || null, error: null } },
    }
    return query
  } }
  const normalizeText = value => String(value ?? '').trim()
  const CONTEXT_PATTERN = /^(club|team):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
  const loadCoachProfile = async () => ({ id: userId, club_id: selectedClub, role: 'head_manager', roleRank: 70 })
  return new Function('supabaseAdmin', 'normalizeText', 'CONTEXT_PATTERN', 'loadCoachProfile', `${functionBody}; return loadCoachContext`)(supabaseAdmin, normalizeText, CONTEXT_PATTERN, loadCoachProfile)
}

test('Coach push authorizes an assigned team in a linked club independently of the selected club', async () => {
  const result = await harness()({ id: userId }, `team:${teamId}`)
  assert.equal(result.clubId, clubId)
  assert.equal(result.teamId, teamId)
  assert.equal(result.profile.role, 'head_manager')
})

for (const [label, overrides] of [
  ['removed membership', { user_club_memberships: [] }],
  ['removed assignment', { team_staff: [] }],
  ['archived team', { teams: [{ id: teamId, club_id: clubId, status: 'active', archived_at: '2026-01-01' }] }],
  ['inactive club', { clubs: [{ id: clubId, status: 'suspended' }] }],
  ['non-staff membership', { user_club_memberships: [{ auth_user_id: userId, club_id: clubId, role: 'parent_portal', role_rank: 10 }] }],
]) {
  test(`Coach push denies ${label}`, async () => {
    await assert.rejects(harness(overrides)({ id: userId }, `team:${teamId}`), { statusCode: 403 })
  })
}

test('admin access comes from the target club membership, not the selected club', async () => {
  const admin = [{ auth_user_id: userId, club_id: clubId, role: 'admin', role_rank: 90 }]
  const load = harness({ user_club_memberships: admin, team_staff: [] })
  assert.equal((await load({ id: userId }, `team:${teamId}`)).teamId, teamId)
  assert.equal((await load({ id: userId }, `club:${clubId}`)).clubId, clubId)
  await assert.rejects(harness({ team_staff: [] })({ id: userId }, `club:${clubId}`), { statusCode: 403 })
})
