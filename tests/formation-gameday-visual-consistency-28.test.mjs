import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const formationPageUrl = new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const fixtureNavigationCardUrl = new URL('../src/components/match-day/FixtureNavigationCard.jsx', import.meta.url)
const matchDayTabsUrl = new URL('../src/components/match-day/MatchDayWorkspaceTabs.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const indexCssUrl = new URL('../src/index.css', import.meta.url)

test('Formation Board inspector uses the shared V1 surface and action hierarchy', async () => {
  const source = await readFile(formationPageUrl, 'utf8')

  assert.match(source, /data-testid="formation-board-player-inspector"/)
  assert.match(source, /bg-\[var\(--panel-alt\)\][\s\S]*text-\[var\(--text-primary\)\]/)
  assert.match(source, /data-player-state=\{selectedBoardPlayerState\}/)
  assert.match(source, />Player state</)
  assert.match(source, />Board action</)
  assert.match(source, /className=\{`\$\{dangerButtonClass\} w-full`\}>Remove from board/)
  assert.doesNotMatch(source, /rounded-lg border border-amber-300 bg-amber-50/)
})

test('Formation Board keeps one bounded responsive inspector scroll area and restores focus after state changes', async () => {
  const source = await readFile(formationPageUrl, 'utf8')

  assert.match(source, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(18rem,21rem\)\]/)
  assert.match(source, /lg:max-h-\[calc\(100dvh-2rem\)\]/)
  assert.match(source, /lg:overflow-y-auto/)
  assert.match(source, /max-h-\[82dvh\][\s\S]*overscroll-contain/)
  assert.doesNotMatch(source, /max-h-72 space-y-2 overflow-y-auto/)
  assert.match(source, /runPlayerStateAction[\s\S]*requestAnimationFrame\(\(\) => \(selectedPlayerPanelRef\.current \|\| searchInputRef\.current\)\?\.focus\(\)\)/)
  assert.match(source, /Remove Player from this board\?[\s\S]*Remove from board[\s\S]*requestAnimationFrame\(\(\) => pitchRef\.current\?\.focus\(\)\)/)
})

test('Game Day landing uses shared V1 tokens without its former isolated theme', async () => {
  const [page, css] = await Promise.all([
    readFile(matchDayPageUrl, 'utf8'),
    readFile(indexCssUrl, 'utf8'),
  ])

  assert.match(page, /id="game-day-title"/)
  assert.match(page, /user\.clubName \|\| 'Football Player'/)
  assert.match(page, /gameDayDateLabel/)
  assert.match(page, /border-\[var\(--border-color\)\] bg-\[var\(--panel-bg\)\]/)
  assert.match(page, /bg-\[var\(--button-primary\)\]/)
  assert.match(page, /MatchMetric label="Live"/)
  assert.match(page, /MatchMetric label="Requests"/)
  assert.match(page, /MatchMetric label="Upcoming"/)
  assert.match(page, /MatchMetric label="Goals"/)
  assert.doesNotMatch(page, /matchday-control-/)
  assert.doesNotMatch(page, /bg-\[#86efac\]/)
  assert.doesNotMatch(page, /matchDaySummary/)
  assert.doesNotMatch(css, /\.matchday-control-panel/)
})

test('Game Day fixture cards, tabs, and quick-action clearance share the platform hierarchy', async () => {
  const [page, card, tabs, layout] = await Promise.all([
    readFile(matchDayPageUrl, 'utf8'),
    readFile(fixtureNavigationCardUrl, 'utf8'),
    readFile(matchDayTabsUrl, 'utf8'),
    readFile(layoutUrl, 'utf8'),
  ])

  assert.match(page, /pb-\[calc\(7rem\+env\(safe-area-inset-bottom\)\)\] md:pr-16 xl:pr-20/)
  assert.match(layout, /if \(location\.pathname !== '\/match-day'\)/)
  assert.match(layout, /window\.setTimeout\(\(\) => \{[\s\S]*const nextPosition = getDefaultQuickActionPosition\(\)/)
  assert.match(page, /role="group" aria-label="Fixture list view"/)
  assert.match(page, /aria-pressed=\{activeFixtureMode === option\.value\}/)
  assert.match(page, /id="game-day-needs-attention"/)
  assert.match(card, /bg-\[var\(--panel-bg\)\]/)
  assert.match(card, /bg-\[var\(--panel-alt\)\]/)
  assert.match(card, /bg-\[var\(--button-primary\)\]/)
  assert.doesNotMatch(card, /bg-white|bg-\[#047857\]|bg-\[#ecfdf5\]/)
  assert.match(tabs, /bg-\[var\(--panel-alt\)\]/)
  assert.match(tabs, /bg-\[var\(--button-primary\)\]/)
  assert.match(tabs, /focus-visible:ring-2/)
})
