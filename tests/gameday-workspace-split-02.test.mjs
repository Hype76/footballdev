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
    'overview',
    'squad',
    'roles',
    'timeline',
  ])
  assert.equal(normalizeMatchDayWorkspaceSection('roles'), 'roles')
  assert.equal(normalizeMatchDayWorkspaceSection('unknown'), 'overview')
  assert.equal(normalizeMatchDayWorkspaceSection(), 'overview')
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

test('Game Day mobile replaces the list and desktop uses a bounded split view', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /selectedMatch \? 'hidden xl:block' : ''/)
  assert.match(page, />\s*Back to fixtures\s*</)
  assert.match(page, /xl:grid xl:grid-cols-\[20rem_minmax\(0,1fr\)\]/)
  assert.match(page, /xl:max-h-\[calc\(100vh-9rem\)\] xl:overflow-y-auto/)
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
  assert.match(tabs, /role="tablist"/)
  assert.match(tabs, /aria-selected=\{isActive\}/)
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
