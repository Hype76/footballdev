import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const authUrl = new URL('../src/lib/auth.js', import.meta.url)
const topbarUrl = new URL('../src/components/layout/Topbar.jsx', import.meta.url)

test('verified platform admin access opens platform admin before club selection', async () => {
  const source = await readFile(authUrl, 'utf8')
  const start = source.indexOf('const syncAuthenticatedSession = async')
  assert.notEqual(start, -1)
  const end = source.indexOf('const bootstrapAuth = async', start)
  assert.notEqual(end, -1)
  const section = source.slice(start, end)

  const platformOpenIndex = section.indexOf("if (hasPlatformAccess && selectedAccessMode !== 'parent' && (selectedAccessMode !== 'team' || !selectedAccessModeIsExplicit))")
  const clubSelectionIndex = section.indexOf('if (profile?.requiresClubSelection)')

  assert.notEqual(platformOpenIndex, -1)
  assert.notEqual(clubSelectionIndex, -1)
  assert.ok(platformOpenIndex < clubSelectionIndex)
  assert.doesNotMatch(section, /selectedAccessMode === 'platform_admin' && hasPlatformAccess/)
  assert.match(section, /selectedAccessModeIsExplicit/)
  assert.match(source, /const SELECTED_ACCESS_MODE_EXPLICIT_KEY = 'selected-access-mode-explicit'/)
})

test('team mode must be explicit before it can override platform admin bootstrap', async () => {
  const source = await readFile(authUrl, 'utf8')
  const selectAccessStart = source.indexOf('const selectAccessMode = async (accessMode) => {')
  assert.notEqual(selectAccessStart, -1)
  const selectAccessEnd = source.indexOf('const selectTeam = async (teamId) => {', selectAccessStart)
  assert.notEqual(selectAccessEnd, -1)
  const selectAccessSection = source.slice(selectAccessStart, selectAccessEnd)
  const selectClubStart = source.indexOf('const selectClub = async (clubId) => {')
  assert.notEqual(selectClubStart, -1)
  const selectClubEnd = source.indexOf('const selectAccessMode = async (accessMode) => {', selectClubStart)
  assert.notEqual(selectClubEnd, -1)
  const selectClubSection = source.slice(selectClubStart, selectClubEnd)
  const signedOutStart = source.indexOf('const applySignedOutState = () => {')
  assert.notEqual(signedOutStart, -1)
  const signedOutEnd = source.indexOf('const syncAuthenticatedSession = async', signedOutStart)
  assert.notEqual(signedOutEnd, -1)
  const signedOutSection = source.slice(signedOutStart, signedOutEnd)

  assert.match(selectAccessSection, /window\.sessionStorage\.setItem\(SELECTED_ACCESS_MODE_STORAGE_KEY, nextAccessMode\)/)
  assert.match(selectAccessSection, /window\.sessionStorage\.setItem\(SELECTED_ACCESS_MODE_EXPLICIT_KEY, 'true'\)/)
  assert.match(selectClubSection, /window\.sessionStorage\.setItem\(SELECTED_ACCESS_MODE_STORAGE_KEY, 'team'\)/)
  assert.match(selectClubSection, /window\.sessionStorage\.setItem\(SELECTED_ACCESS_MODE_EXPLICIT_KEY, 'true'\)/)
  assert.match(signedOutSection, /window\.sessionStorage\.removeItem\(SELECTED_ACCESS_MODE_EXPLICIT_KEY\)/)
})

test('topbar does not display platform admin as the selected access view for coach context', async () => {
  const source = await readFile(topbarUrl, 'utf8')

  assert.match(source, /const shouldShowCurrentTeamAccessOption =/)
  assert.match(source, /!isPlatformAdminView && !isParentPortalView && \(hasPlatformAdminAccess \|\| hasTeamAccessOption\) && !displayUser\?\.activeTeamId/)
  assert.match(source, /shouldShowCurrentTeamAccessOption \? '__team_access__' : ''/)
  assert.match(source, /<option value="__team_access__">Team access<\/option>/)
  assert.match(source, /if \(teamId === '__team_access__'\) \{\s*try \{\s*setIsSwitchingTeam\(true\)\s*await selectAccessMode\('team'\)\s*navigate\('\/coach'\)/)
})
