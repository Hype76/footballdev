import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildLegacyStaffMembershipFromProfile,
  canSwitchParentToStaff,
  getActiveStaffMemberships,
  isActiveStaffAccount,
  isActiveStaffMembership,
} from '../src/lib/staff-workspace-access.js'
import { areUsersEquivalent } from '../src/lib/auth-session-utils.js'

const authUrl = new URL('../src/lib/auth.js', import.meta.url)
const coreUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const fixtureAuthUrl = new URL('../src/lib/auth-access-browser-fixtures.js', import.meta.url)
const shellUrl = new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const sessionBridgeUrl = new URL('../src/lib/workspace-session-bridge.jsx', import.meta.url)

const activeProfile = {
  id: 'staff-user',
  status: 'active',
}

const activeMembership = {
  clubId: 'club-one',
  clubStatus: 'active',
  role: 'coach',
  roleRank: 30,
}

test('active coach membership allows the parent to staff switch', () => {
  assert.equal(canSwitchParentToStaff({ profile: activeProfile, memberships: [activeMembership] }), true)
})

test('active club admin membership allows the parent to staff switch', () => {
  assert.equal(canSwitchParentToStaff({
    profile: activeProfile,
    memberships: [{ ...activeMembership, role: 'admin', roleRank: 80 }],
  }), true)
})

test('active team staff membership supports production snake case fields', () => {
  assert.equal(canSwitchParentToStaff({
    profile: { id: 'staff-user', status: 'active' },
    memberships: [{
      club_id: 'club-one',
      club_status: 'active',
      role: 'head_manager',
      role_rank: 70,
      team_id: 'team-one',
      team_status: 'active',
    }],
  }), true)
})

test('club-wide staff does not require a selected team', () => {
  assert.equal(canSwitchParentToStaff({
    profile: activeProfile,
    memberships: [{ ...activeMembership, role: 'admin', roleRank: 90, teamId: '' }],
  }), true)
})

test('one valid membership allows access when other memberships fail closed', () => {
  assert.equal(canSwitchParentToStaff({
    profile: activeProfile,
    memberships: [
      { ...activeMembership, membershipStatus: 'removed' },
      { ...activeMembership, clubId: 'club-two', role: 'head_manager', roleRank: 70 },
    ],
  }), true)
})

test('legacy staff profile can be converted only with an active authoritative club', () => {
  const membership = buildLegacyStaffMembershipFromProfile({
    club: { id: 'club-one', status: 'active' },
    profile: { club_id: 'club-one', role: 'coach', role_rank: null },
  })

  assert.equal(canSwitchParentToStaff({ profile: activeProfile, memberships: [membership] }), true)
  assert.equal(isActiveStaffMembership(buildLegacyStaffMembershipFromProfile({
    club: { id: 'club-one', status: 'suspended' },
    profile: { club_id: 'club-one', role: 'coach', role_rank: null },
  })), false)
})

test('parent-only account fails closed without a staff membership', () => {
  assert.equal(canSwitchParentToStaff({ profile: activeProfile, memberships: [] }), false)
})

test('missing staff profile fails closed', () => {
  assert.equal(canSwitchParentToStaff({ memberships: [activeMembership] }), false)
})

test('suspended staff account fails closed', () => {
  assert.equal(canSwitchParentToStaff({
    profile: { ...activeProfile, status: 'suspended' },
    memberships: [activeMembership],
  }), false)
})

test('inactive staff account fails closed', () => {
  assert.equal(canSwitchParentToStaff({
    profile: { ...activeProfile, status: 'inactive' },
    memberships: [activeMembership],
  }), false)
})

test('removed staff account fails closed', () => {
  assert.equal(canSwitchParentToStaff({
    profile: { ...activeProfile, status: 'removed' },
    memberships: [activeMembership],
  }), false)
})

test('account with missing status fails closed', () => {
  assert.equal(isActiveStaffAccount({ id: 'staff-user' }), false)
})

test('suspended club membership fails closed', () => {
  assert.equal(isActiveStaffMembership({ ...activeMembership, clubStatus: 'suspended' }), false)
})

test('inactive club membership fails closed', () => {
  assert.equal(isActiveStaffMembership({ ...activeMembership, clubStatus: 'inactive' }), false)
})

test('membership without a club fails closed', () => {
  assert.equal(isActiveStaffMembership({ ...activeMembership, clubId: '' }), false)
})

test('parent-ranked membership fails closed', () => {
  assert.equal(isActiveStaffMembership({ ...activeMembership, role: 'parent_portal', roleRank: 0 }), false)
})

test('removed membership is excluded while another active membership remains available', () => {
  const memberships = getActiveStaffMemberships([
    { ...activeMembership, clubStatus: 'removed' },
    { ...activeMembership, clubId: 'club-two' },
  ])

  assert.deepEqual(memberships.map((membership) => membership.clubId), ['club-two'])
})

test('removed suspended expired unknown and inactive-team memberships fail closed', () => {
  const invalidMemberships = [
    { ...activeMembership, membershipStatus: 'removed' },
    { ...activeMembership, suspendedAt: '2026-07-13T00:00:00Z' },
    { ...activeMembership, expiresAt: '2026-07-12T00:00:00Z' },
    { ...activeMembership, role: 'unknown_staff_role', roleRank: 90 },
    { ...activeMembership, teamId: 'team-one', teamStatus: 'inactive' },
  ]

  assert.equal(invalidMemberships.every((membership) => !isActiveStaffMembership(membership)), true)
})

test('eligibility option changes are not hidden by stale user equivalence', () => {
  const parentProfile = {
    id: 'parent-staff-user',
    email: 'fixture@example.test',
    accessModeOptions: [],
  }
  const resolvedProfile = {
    ...parentProfile,
    accessModeOptions: [{ id: 'team', label: 'Team / Coach' }],
  }

  assert.equal(areUsersEquivalent(parentProfile, resolvedProfile), false)
})

test('parent shell exposes the requested switch only from authoritative team options', async () => {
  const [source, parentPortalSource] = await Promise.all([
    readFile(shellUrl, 'utf8'),
    readFile(parentPortalPageUrl, 'utf8'),
  ])

  assert.match(source, /resolvedAccessModeOptions\.some\(\(option\) => option\?\.id === 'team'\)/)
  assert.match(source, /Switch to Staff Platform/)
  assert.match(source, /aria-label="Parent account actions"/)
  assert.match(source, /Checking staff access\.\.\./)
  assert.match(source, /await selectAccessMode\('team', \{ deferCommit: true \}\)/)
  assert.match(source, /switchToMainAppWorkspace\(\{ session, targetPath: TEAM_WORKSPACE_HOME_PATH \}\)/)
  assert.match(parentPortalSource, /<ParentPortalAccountActions/)
  assert.match(parentPortalSource, /showAccountActions=\{false\}/)
})

test('cross-host switching transfers the existing session without URL tokens', async () => {
  const source = await readFile(sessionBridgeUrl, 'utf8')

  assert.match(source, /supabase\.auth\.setSession/)
  assert.match(source, /event\.origin !== mainOrigin/)
  assert.match(source, /isTrustedParentOrigin\(document\.referrer\)/)
  assert.doesNotMatch(source, /searchParams.*access_token|searchParams.*refresh_token|targetUrl.*access_token|targetUrl.*refresh_token/)
})

test('runtime switch revalidates existing staff access before changing mode', async () => {
  const [authSource, coreSource] = await Promise.all([
    readFile(authUrl, 'utf8'),
    readFile(coreUrl, 'utf8'),
  ])

  assert.match(authSource, /requireExistingStaffAccess: isParentToStaffSwitch/)
  assert.match(authSource, /if \(options\.deferCommit === true\)/)
  assert.match(coreSource, /if \(selectedAccessMode === 'team' && requireExistingStaffAccess\)/)
  assert.match(coreSource, /loadAuthoritativeStaffMemberships/)
  assert.doesNotMatch(coreSource, /buildLegacyStaffMembershipFromProfile/)
  assert.match(coreSource, /loadedAuthoritativeStaffMemberships = memberships/)
  assert.match(coreSource, /canSwitchParentToStaff\(\{ profile: data, memberships \}\)/)
  assert.match(authSource, /Staff access is no longer active/)
})

test('staff context remains stored while switching into and out of the parent portal', async () => {
  const [authSource, fixtureSource] = await Promise.all([
    readFile(authUrl, 'utf8'),
    readFile(fixtureAuthUrl, 'utf8'),
  ])

  assert.match(authSource, /const selectedClubId = window\.sessionStorage\.getItem\(SELECTED_CLUB_STORAGE_KEY\)/)
  assert.match(authSource, /nextAccessMode !== 'parent' && !isParentToStaffSwitch/)
  assert.doesNotMatch(fixtureSource, /if \(normalizedMode !== 'team'\) \{[\s\S]*removeItem\(FIXTURE_SELECTED_TEAM_KEY\)/)
})

test('focused implementation files contain no em dash characters', async () => {
  const paths = [authUrl, coreUrl, fixtureAuthUrl, shellUrl, parentPortalPageUrl, sessionBridgeUrl, new URL('../src/lib/staff-workspace-access.js', import.meta.url)]
  const sources = await Promise.all(paths.map((path) => readFile(path, 'utf8')))

  assert.equal(sources.some((source) => source.includes('\u2014')), false, fileURLToPath(shellUrl))
})
