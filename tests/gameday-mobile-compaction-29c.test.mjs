import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const workspaceUrl = new URL('../src/lib/matchday-workspace.js', import.meta.url)

test('29C keeps the mobile operations order explicit and transport last', async () => {
  const workspace = await readFile(workspaceUrl, 'utf8')

  const rolePosition = workspace.indexOf("id: 'roles'")
  const squadPosition = workspace.indexOf("id: 'squad'")
  const overviewPosition = workspace.indexOf("id: 'overview'")
  const timelinePosition = workspace.indexOf("id: 'timeline'")
  const transportPosition = workspace.indexOf("id: 'transport'")

  assert.ok(rolePosition >= 0)
  assert.ok(rolePosition < squadPosition)
  assert.ok(squadPosition < overviewPosition)
  assert.ok(overviewPosition < timelinePosition)
  assert.ok(timelinePosition < transportPosition)
  assert.match(workspace, /return MATCH_DAY_WORKSPACE_SECTIONS[\s\S]*\? value : 'roles'/)
})

test('29C availability groups are compact, mutually assigned, accessible, and session-persistent', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /const \[availabilityDisclosureState, setAvailabilityDisclosureState\] = useState/)
  assert.match(page, /availabilityDisclosureState\.matchId === match\.id/)
  assert.match(page, /const groupsByKey = new Map/)
  assert.match(page, /groupsByKey\.get\(groupKey\)\?\.rows\.push\(row\)/)
  assert.match(page, /No response/)
  assert.match(page, /label: 'Available'/)
  assert.match(page, /role="region"[\s\S]*aria-label="Player availability and squad decisions"/)
  assert.match(page, /min-h-11/)
  assert.match(page, /focus-visible:ring-2/)
  assert.doesNotMatch(page, /game-day-availability-section[\s\S]{0,500}max-h-/)
})

test('29C preserves scorer selection, squad decisions, transport detail, and all match controls', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /onVolunteerSelection\(match, row, role\.key, !isSelected\)/)
  assert.match(page, /onSquadDecisionChange\(match, row, option\.value\)/)
  assert.match(page, /<TransportRiskPanel rows=\{transportRiskRows\} summary=\{transportRiskSummary\} \/>/)
  assert.match(page, /<TransportCoordinationPanel summary=\{transportCoordination\} \/>/)
  assert.match(page, /onScoreSave=\{handleScoreSave\}/)
  assert.match(page, /onStatusChange=\{handleStatusChange\}/)
  assert.match(page, /onCorrectGoal=\{handleCorrectGoal\}/)
  assert.match(page, /onUndoEvent=\{handleUndoEvent\}/)
})
