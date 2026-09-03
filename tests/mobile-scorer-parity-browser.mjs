import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const parent = await readFile('apps/parent-mobile/src/ParentPortalScreens.js', 'utf8')
const coach = await readFile('apps/coach-mobile/src/CoachMatchDayScreen.js', 'utf8')
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const modules = path.join(process.cwd(), 'apps/parent-mobile/node_modules')
const shared = `
  import React, { useState, useMemo, useEffect } from 'react'
  import { createRoot } from 'react-dom/client'
  import { View, Text, Pressable, ScrollView, StyleSheet, Platform, TextInput, Switch, Modal, KeyboardAvoidingView } from 'react-native'
  import { getGoalScorerSide, setGoalOwnGoal, oppositeMatchSide } from './src/lib/matchday-goal-credit.js'
  import { captureMatchEventTime, formatMatchAddedTimeClock, getMatchEventTime, getMatchClockDescription } from './src/lib/matchday-event-time.js'
  import { getMatchDayLifecycleState, getParentScorerTimerActions } from './src/lib/matchday-lifecycle.js'
  import { getCoachMatchDayPresentation, getCoachMatchDaySelectedPlayers, getCoachMatchDayOpponentPlayers, captureCoachMatchDayAction, createCoachMatchDayEventForm, validateCoachMatchDayEventForm, pickCoachMatchDayLinkedPlayer, updateCoachMatchDayLinkedPlayer, filterCoachMatchDayPlayerChoices } from './apps/mobile-core/src/coachMatchDayCore.js'
  const isAvailableAsync = async () => false
  const activateKeepAwakeAsync = async () => {}
  const deactivateKeepAwake = async () => {}
  const normalize = (value) => String(value ?? '').trim()
  const normalizeText = normalize
  const label = (value) => normalize(value).replaceAll('_', ' ')
  const labelize = label
  const errorMessage = (error) => error.message
  const players = [{ id: 'alex', playerName: 'Alex', shirtNumber: '9', teamId: 'team' }, { id: 'clyde', playerName: 'Clyde Bates', shirtNumber: '4', teamId: 'team' }]
  const match = { id: 'test-match', teamId: 'team', teamName: 'FP TEST Team', opponent: 'Visitors', homeAway: 'away', homeScore: 0, awayScore: 0, matchDurationMinutes: 10, clockMode: 'fixed', currentMatchPhase: 'second_half', status: 'second_half', timerStatus: 'running', timerStartedAt: '2026-09-03T12:00:00Z', timerElapsedSeconds: 340, events: [], squadDecisions: players.map((player) => ({ playerId: player.id, status: 'selected' })) }
  Date.now = () => Date.parse('2026-09-03T12:00:00Z')
  window.calls = []
  const root = createRoot(document.getElementById('root'))
`
const parentCode = `${shared}
  import { createParentMobileTheme, DEFAULT_PARENT_MOBILE_THEME } from './apps/mobile-core/src/parentThemeCore.js'
  import { SCORER_EVENT_LABELS, validateScorerMatchEvent } from './src/lib/matchday-scorer-event.js'
  import { captureParentScorerAction } from './apps/parent-mobile/src/parentScorerCore.js'
  const Crypto = { randomUUID: () => '70000000-0000-4000-8000-000000000001' }
  ${section(parent, 'function colorsFor(', 'function invitationResponsePresentation(')}
  ${section(parent, 'function GoalPlayerPicker(', 'export function MatchdayScreen(')}
  function Preview({ mode }) {
    const tokens = createParentMobileTheme({ mode }).tokens
    const { colors, styles } = usePortalStyles(tokens)
    return <View style={{ backgroundColor: colors.background, padding: 16, minHeight: 900 }}><ScorerControls activeActionId="" match={match} players={players} styles={styles} placeholderColor={colors.muted} onAction={async (action, value) => { window.calls.push({ action, value }); return true }} /></View>
  }
  window.renderPreview = (mode) => root.render(<Preview key={mode} mode={mode} />)
`
const coachCode = `${shared}
  import { createCoachTheme } from './apps/coach-mobile/src/coachThemeCore.js'
  const MaterialIcons = () => null
  const getMobileIconName = () => ''
  const MATCH_DAY_EVENT_TITLES = { goal: 'Add goal', yellow_card: 'Yellow card', red_card: 'Red card', substitution: 'Substitution' }
  const LiveTimeline = () => null
  ${section(coach, 'function createStyles(', 'function MatchList(')}
  ${section(coach, 'function LivePanel(', 'function TimelinePanel(')}
  function Preview({ mode }) {
    const [eventForm, onEventForm] = useState(() => createCoachMatchDayEventForm('goal', match))
    const [scoreDraft, setScoreDraft] = useState({ home: '0', away: '0' })
    const palette = createCoachTheme({ mode }).tokens
    const styles = createStyles(palette)
    return <View style={{ backgroundColor: palette.background, padding: 16, minHeight: 900 }}><LivePanel match={match} players={players} actions={{ canRecordEvents: true, timerActions: getParentScorerTimerActions(match) }} eventForm={eventForm} onEventForm={onEventForm} scoreDraft={scoreDraft} setScoreDraft={setScoreDraft} styles={styles} onTimer={async () => {}} onPrepare={() => {}} onScore={async () => { window.calls.push({ action: 'event', value: validateCoachMatchDayEventForm(eventForm) }); return true }} /></View>
  }
  window.renderPreview = (mode) => root.render(<Preview key={mode} mode={mode} />)
`
await mkdir('output/playwright/mobile-scorer', { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const [app, code] of [['parent', parentCode], ['coach', coachCode]]) {
    const result = await build({ stdin: { resolveDir: process.cwd(), contents: code, loader: 'jsx' }, write: false, bundle: true, jsx: 'automatic', loader: { '.js': 'jsx' }, alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' } })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><div id="root"></div></body></html>')
    await page.addScriptTag({ content: result.outputFiles[0].text })
    for (const mode of ['light', 'dark']) {
      await page.evaluate((mode) => window.renderPreview(mode), mode)
      await page.getByRole('button', { name: 'Goal', exact: true }).click()
      if (app === 'parent') {
        await page.getByRole('button', { name: 'Choose scorer', exact: true }).click()
        await page.getByRole('button', { name: 'Clyde Bates | Shirt 4', exact: true }).click()
        await page.getByRole('button', { name: 'Clyde Bates | Shirt 4', exact: true }).click()
        assert.equal(await page.getByRole('button', { name: 'Clyde Bates | Shirt 4', exact: true }).last().evaluate((element) => getComputedStyle(element).borderTopWidth), '2px')
        await page.getByRole('button', { name: 'Clyde Bates | Shirt 4', exact: true }).last().click()
      } else {
        await page.getByRole('button', { name: 'Show Scorer choices', exact: true }).click()
        await page.getByRole('button', { name: 'Clyde Bates Shirt 4', exact: true }).click()
        assert.equal(await page.getByLabel('Scorer', { exact: true }).inputValue(), 'Clyde Bates')
        assert.equal(await page.getByRole('button', { name: 'Clyde Bates Shirt 4', exact: true }).count(), 0)
      }
      await page.getByRole('switch', { name: 'Own goal', exact: true }).click()
      await page.getByText(/opponent receives the goal|goal counts for the opponent/).waitFor()
      await page.screenshot({ path: `output/playwright/mobile-scorer/${app}-${mode}-own-goal.png` })
      await page.getByRole('button', { name: 'Record goal', exact: true }).click()
      let saved = await page.evaluate(() => window.calls.at(-1).value)
      assert.equal(saved.teamSide, 'opponent')
      assert.equal(saved.scorerName, 'Clyde Bates')
      assert.equal(saved.isOwnGoal, true)
      assert.equal(Number(saved.minute), 6)
      for (const [type, name] of [['yellow_card', app === 'parent' ? 'Yellow card' : 'Yellow'], ['red_card', app === 'parent' ? 'Red card' : 'Red'], ['substitution', app === 'parent' ? 'Substitution' : 'Sub']]) {
        await page.getByRole('button', { name, exact: true }).click()
        const field = type === 'substitution' ? 'Player off' : 'Player'
        await page.getByRole('button', { name: app === 'parent' ? `Choose ${field.toLowerCase()}` : `Show ${field} choices`, exact: true }).click()
        await page.getByRole('button', { name: app === 'parent' ? 'Clyde Bates | Shirt 4' : 'Clyde Bates Shirt 4', exact: true }).click()
        if (type === 'substitution') {
          await page.getByRole('button', { name: app === 'parent' ? 'Choose player on' : 'Show Player on choices', exact: true }).click()
          await page.getByRole('button', { name: app === 'parent' ? 'Alex | Shirt 9' : 'Alex Shirt 9', exact: true }).click()
        }
        await page.getByRole('button', { name: `Record ${type.replaceAll('_', ' ')}`, exact: true }).click()
        saved = await page.evaluate(() => window.calls.at(-1).value)
        assert.equal(saved.eventType, type)
        assert.equal(saved.playerName, 'Clyde Bates')
        assert.equal(Number(saved.minute), 6)
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS Parent and Coach rendered controls: own-goal credit, player selection feedback, cards, substitutions and captured time in light/dark themes')
} finally { await browser.close() }
