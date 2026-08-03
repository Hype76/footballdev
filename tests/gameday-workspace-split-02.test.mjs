import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MATCH_DAY_WORKSPACE_SECTIONS,
  normalizeMatchDayWorkspaceSection,
} from '../src/lib/matchday-workspace.js'

const pageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const navigationCardUrl = new URL('../src/components/match-day/FixtureNavigationCard.jsx', import.meta.url)
const tabsUrl = new URL('../src/components/match-day/MatchDayWorkspaceTabs.jsx', import.meta.url)

test('workspace sections normalize invalid and missing deep links safely', () => {
  assert.deepEqual(MATCH_DAY_WORKSPACE_SECTIONS.map((section) => section.id), [
    'roles',
    'squad',
    'overview',
    'timeline',
    'transport',
  ])
  assert.equal(normalizeMatchDayWorkspaceSection('roles'), 'roles')
  assert.equal(normalizeMatchDayWorkspaceSection('unknown'), 'roles')
  assert.equal(normalizeMatchDayWorkspaceSection(), 'roles')
})

test('Game Day uses compact fixture navigation and one selected detail workspace', async () => {
  const [page, navigationCard] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(navigationCardUrl, 'utf8'),
  ])

  assert.equal((page.match(/<MatchDayCard/g) || []).length, 1)
  assert.match(page, /displayedActiveMatches\.map\(renderFixtureNavigationCard\)/)
  assert.match(page, /previousMatches\.map\(renderFixtureNavigationCard\)/)
  assert.match(page, /selectedMatch \? renderSelectedMatchWorkspace\(selectedMatch\) : null/)
  assert.match(navigationCard, /data-testid="game-day-fixture-summary"/)
  assert.match(navigationCard, /aria-current=\{isSelected \? 'true' : undefined\}/)
  assert.match(navigationCard, /\{isSelected \? 'Close' : 'Manage'\}/)
})

test('Game Day mobile replaces the list and desktop uses a natural-flow responsive split view', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /selectedMatch \? 'hidden xl:block xl:basis-\[22rem\] xl:flex-grow' : ''/)
  assert.match(page, />\s*Back to fixtures\s*</)
  assert.match(page, /xl:flex xl:flex-wrap xl:items-start/)
  assert.match(page, /xl:basis-\[22rem\] xl:flex-grow/)
  assert.match(page, /xl:basis-\[32rem\] xl:flex-grow-\[2\]/)
  assert.doesNotMatch(page, /sm:grid-cols-\[minmax\(0,1fr\)_auto\] sm:items-end/)
  assert.doesNotMatch(page, /xl:max-h-\[calc\(100vh-9rem\)\] xl:overflow-y-auto/)
  assert.doesNotMatch(page, /function PitchsideCockpitPanel/)
})

test('selected fixture sections and URL state preserve direct access on refresh', async () => {
  const [page, tabs] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(tabsUrl, 'utf8'),
  ])

  assert.match(page, /searchParams\.get\('fixture'\)/)
  assert.match(page, /searchParams\.get\('section'\)/)
  assert.match(page, /nextParams\.set\('fixture', String\(match\.id\)\)/)
  assert.match(page, /nextParams\.set\('section', nextSection\)/)
  assert.match(page, /workspaceSection === 'overview'/)
  assert.match(page, /workspaceSection === 'squad'/)
  assert.match(page, /workspaceSection === 'roles'/)
  assert.match(page, /workspaceSection === 'timeline'/)
  assert.match(page, /workspaceSection === 'transport'/)
  assert.match(tabs, /role="tablist"/)
  assert.match(tabs, /aria-selected=\{isActive\}/)
})

test('mobile Game Day prioritizes scorer, compact availability groups, lift context, and transport last', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /data-testid="game-day-match-controls"/)
  assert.match(page, /data-testid="game-day-roles-section"/)
  assert.match(page, /aria-label="Scorer and Match roles"/)
  assert.match(page, /const volunteerRoleConfigs = \[[\s\S]*key: 'scorer'[\s\S]*key: 'referee'[\s\S]*key: 'linesman'/)
  assert.match(page, /function getAvailabilityDisclosureGroups/)
  assert.match(page, /aria-expanded=\{isGroupExpanded\}/)
  assert.match(page, /aria-controls=\{groupPanelId\}/)
  assert.match(page, /disabled=\{group\.rows\.length === 0\}/)
  assert.match(page, /data-testid="game-day-availability-section"/)
  assert.match(page, /Lift coordination snapshot/)
  assert.match(page, /data-testid="game-day-transport-section"/)
})

test('selected workspace retains core fixture and match operations', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /Open Game Mode/)
  assert.match(page, /Manage invited players/)
  assert.match(page, /onScoreSave=\{handleScoreSave\}/)
  assert.match(page, /onStatusChange=\{handleStatusChange\}/)
  assert.match(page, /onVolunteerSelection=\{openVolunteerSelectionPrompt\}/)
  assert.match(page, /onSquadDecisionChange=\{handleSquadDecisionChange\}/)
  assert.match(page, /onCorrectGoal=\{handleCorrectGoal\}/)
  assert.match(page, /onUndoEvent=\{handleUndoEvent\}/)
  assert.match(page, /Final Match Report/)
})
