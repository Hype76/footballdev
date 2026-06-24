import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const teamManagementPageUrl = new URL('../src/pages/TeamManagementPage.jsx', import.meta.url)
const onboardingProviderUrl = new URL('../src/components/onboarding/OnboardingProvider.jsx', import.meta.url)
const topbarUrl = new URL('../src/components/layout/Topbar.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const manageTeamFunctionUrl = new URL('../netlify/functions/manage-team.js', import.meta.url)

function getFunctionSection(source, marker, nextMarker = '\n  const ') {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${marker} not found`)

  const next = source.indexOf(nextMarker, start + marker.length)
  return source.slice(start, next === -1 ? undefined : next)
}

function getBranchSection(source, marker) {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${marker} not found`)

  const nextBranch = source.indexOf("      } else if (actionType === '", start + marker.length)
  return source.slice(start, nextBranch === -1 ? undefined : nextBranch)
}

test('team management create keeps club admin context and theme after adding a team', async () => {
  const source = await readFile(teamManagementPageUrl, 'utf8')
  const createSection = getFunctionSection(source, '  const handleCreateTeam = async (event) => {', '\n  const handleCoachFormChange')

  assert.match(createSection, /const createdTeam = await createTeam/)
  assert.match(createSection, /setTeams\(\(current\) => \{/)
  assert.match(createSection, /await refreshTeamSelection\?\.\(\)/)
  assert.doesNotMatch(createSection, /selectTeam\?\.\(createdTeam\.id\)/)
  assert.doesNotMatch(createSection, /setSelectedTeamId\(createdTeam\.id\)/)
  assert.doesNotMatch(createSection, /updateCurrentUserDetails/)
  assert.doesNotMatch(createSection, /activeTeamId:\s*createdTeam\.id/)
  assert.doesNotMatch(createSection, /activeTeamName:\s*createdTeam\.name/)
  assert.doesNotMatch(createSection, /themeAccent:\s*createdTeam\.themeAccent/)
  assert.doesNotMatch(createSection, /themeButtonStyle:\s*createdTeam\.themeButtonStyle/)
})

test('onboarding manage teams action refreshes teams without selecting the new team', async () => {
  const source = await readFile(onboardingProviderUrl, 'utf8')
  const manageTeamsSection = getBranchSection(source, "      } else if (actionType === 'manage-teams') {")

  assert.match(manageTeamsSection, /await createTeam\(\{ user, name: teamName \}\)/)
  assert.match(manageTeamsSection, /await refreshTeamSelection\?\.\(\)/)
  assert.doesNotMatch(manageTeamsSection, /selectTeam\?\./)
  assert.doesNotMatch(manageTeamsSection, /updateCurrentUserDetails/)
  assert.doesNotMatch(manageTeamsSection, /activeTeamId:\s*createdTeam\.id/)
  assert.doesNotMatch(manageTeamsSection, /themeAccent:\s*createdTeam\.themeAccent/)
})

test('manual team switching remains available through explicit team selectors', async () => {
  const topbarSource = await readFile(topbarUrl, 'utf8')
  const layoutSource = await readFile(layoutUrl, 'utf8')

  assert.match(topbarSource, /await selectTeam\(teamId\)/)
  assert.match(layoutSource, /await selectTeam\(teamId\)/)
})

test('team management remains club admin guarded server side', async () => {
  const source = await readFile(manageTeamFunctionUrl, 'utf8')

  assert.match(source, /const profile = await getAuthenticatedPlanProfile\(event, \{ clubId \}\)/)
  assert.match(source, /assertClubAdmin\(profile\)/)
})
