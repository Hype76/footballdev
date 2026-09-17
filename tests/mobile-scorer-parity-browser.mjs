import assert from 'node:assert/strict'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

async function assertControllerTypography(page, width) {
  const readTypography = () => page.evaluate(() => ['scorer-clock', 'scorer-score'].map((id) => {
    const element = document.querySelector(`[data-testid="${id}"]`)
    if (!element) return { id, missing: true }
    const style = getComputedStyle(element)
    const bounds = element.getBoundingClientRect()
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try { return [...sheet.cssRules].filter((rule) => rule.selectorText && element.matches(rule.selectorText)).map((rule) => rule.cssText) } catch { return [] }
    })
    return { id, text: element.textContent, fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily, className: element.className, inlineStyle: element.getAttribute('style'), width: bounds.width, height: bounds.height, rules }
  }))
  const initial = await readTypography()
  try {
    // React rendering and RNW stylesheet insertion must both be applied before
    // inspecting the phone layout after a viewport and theme change.
    await page.waitForFunction(() => {
      const clock = document.querySelector('[data-testid="scorer-clock"]')
      const score = document.querySelector('[data-testid="scorer-score"]')
      return clock && score && Number.parseFloat(getComputedStyle(clock).fontSize) >= 80 && Number.parseFloat(getComputedStyle(score).fontSize) >= 70
    }, null, { timeout: 5000 })
  } catch (error) {
    const settled = await readTypography()
    await page.screenshot({ path: `output/playwright/mobile-scorer/parent-controller-${width}-failure.png`, fullPage: true })
    assert.fail(`Controller clock must remain at least 80px and score at least 70px at ${width}px. ${JSON.stringify({ initial, settled })}. ${error.message}`)
  }
}

const parent = await readFile('apps/parent-mobile/src/ParentPortalScreens.js', 'utf8')
const coach = await readFile('apps/coach-mobile/src/CoachMatchDayScreen.js', 'utf8')
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const modules = path.join(process.cwd(), 'apps/parent-mobile/node_modules')
const shared = `
  import React, { useState, useMemo, useEffect } from 'react'
  import { createRoot } from 'react-dom/client'
  import { flushSync } from 'react-dom'
  import { View, Text, Pressable, ScrollView, StyleSheet, Platform, TextInput, Switch, Modal, KeyboardAvoidingView } from 'react-native'
  import { getGoalScorerSide, setGoalOwnGoal, oppositeMatchSide } from './src/lib/matchday-goal-credit.js'
  import { captureMatchEventTime, formatMatchAddedTimeClock, getMatchEventTime, getMatchClockDescription } from './src/lib/matchday-event-time.js'
  import { isContinuousMatchClock, normalizeMatchDurationMinutes } from './src/lib/matchday-model.js'
  import { getMatchDayLifecycleState, getParentScorerTimerActions } from './src/lib/matchday-lifecycle.js'
  import { getCoachMatchDayPresentation, getCoachMatchDaySelectedPlayers, getCoachMatchDayOpponentPlayers, captureCoachMatchDayAction, createCoachMatchDayEventForm, validateCoachMatchDayEventForm, pickCoachMatchDayLinkedPlayer, updateCoachMatchDayLinkedPlayer, filterCoachMatchDayPlayerChoices } from './apps/mobile-core/src/coachMatchDayCore.js'
  const isAvailableAsync = async () => true
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
  window.preMatch = () => {match.status='scheduled';match.timerStatus='not_started';match.currentMatchPhase='pre_match'}
  window.updateMatch = (patch) => Object.assign(match, patch)
  window.calls = []
  const root = createRoot(document.getElementById('root'))
`
const parentCode = `${shared}
  import { createParentMobileTheme, DEFAULT_PARENT_MOBILE_THEME } from './apps/mobile-core/src/parentThemeCore.js'
  import { SCORER_EVENT_LABELS, validateScorerMatchEvent } from './src/lib/matchday-scorer-event.js'
  import { captureParentScorerAction } from './apps/parent-mobile/src/parentScorerCore.js'
  import glyphs from './apps/parent-mobile/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json'
  const MaterialIcons = ({ color, name, size }) => <Text aria-hidden="true" style={{ color, fontFamily: 'MaterialIcons', fontSize: size }}>{String.fromCodePoint(glyphs[name])}</Text>
  const Crypto = { randomUUID: () => '70000000-0000-4000-8000-000000000001' }
  ${section(parent, 'function colorsFor(', 'function invitationResponsePresentation(')}
  ${section(parent, 'function GoalPlayerPicker(', 'export function MatchdayScreen(')}
  function Preview({ mode, accent }) {
    const tokens = createParentMobileTheme({ mode, selectedLink: { themeAccent: accent } }).tokens
    const { colors, styles } = usePortalStyles(tokens)
    return <View style={{ backgroundColor: colors.background, padding: 16, minHeight: 900 }}><ScorerControls activeActionId="" match={match} players={players} styles={styles} placeholderColor={colors.muted} onAction={async (action, value) => { window.calls.push({ action, value }); return true }} /></View>
  }
  // Finish the requested remount before Playwright can inspect the old theme.
  window.renderPreview = (mode, accent) => flushSync(() => root.render(<Preview key={mode + accent} mode={mode} accent={accent} />))
`
const coachCode = `${shared}
  import { createCoachTheme } from './apps/coach-mobile/src/coachThemeCore.js'
  const MaterialIcons = () => null
  const getMobileIconName = () => ''
  const MATCH_DAY_EVENT_TITLES = { goal: 'Add goal', yellow_card: 'Yellow card', red_card: 'Red card', substitution: 'Substitution' }
  const LiveTimeline = () => null
  ${section(coach, 'function createStyles(', 'function MatchList(')}
  ${section(coach, 'function LivePanel(', 'function TimelinePanel(')}
  function Preview({ mode, accent }) {
    const [eventForm, onEventForm] = useState(() => createCoachMatchDayEventForm('goal', match))
    const [scoreDraft, setScoreDraft] = useState({ home: '0', away: '0' })
    const palette = createCoachTheme({ mode, context: { clubAccent: accent } }).tokens
    const styles = createStyles(palette)
    return <View style={{ backgroundColor: palette.background, padding: 16, minHeight: 900 }}><LivePanel match={match} players={players} actions={{ canRecordEvents: true, timerActions: getParentScorerTimerActions(match) }} eventForm={eventForm} onEventForm={onEventForm} scoreDraft={scoreDraft} setScoreDraft={setScoreDraft} styles={styles} onTimer={async () => {}} onPrepare={() => {}} onScore={async () => { window.calls.push({ action: 'event', value: validateCoachMatchDayEventForm(eventForm) }); return true }} /></View>
  }
  // Finish the requested remount before Playwright can inspect the old theme.
  window.renderPreview = (mode, accent) => flushSync(() => root.render(<Preview key={mode + accent} mode={mode} accent={accent} />))
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
    if (app === 'parent') {
      const font = await readFile(path.join(modules, '@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf'))
      await page.addStyleTag({ content: `@font-face {font-family:MaterialIcons;src:url(data:font/ttf;base64,${font.toString('base64')})}` })
    }
    await page.addScriptTag({ content: result.outputFiles[0].text })
    for (const accent of ['#2ba7aa', '#000000', '#ffffff', '#777777', '#ffff00', '#000080']) for (const mode of ['light', 'dark']) {
      await page.evaluate(({ mode, accent }) => window.renderPreview(mode, accent), { mode, accent })
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
      await assertRenderedTextContrast(page, `${app} ${mode} ${accent} scorer`)
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
    if (app === 'parent') {
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 740 })
        await page.evaluate((width) => { window.updateMatch({ status: 'live', currentMatchPhase: 'first_half', timerElapsedSeconds: 175, homeScore: 0, awayScore: 1, matchDurationMinutes: 80 }); window.renderPreview('light', width === 320 ? '#2ba7aa' : width === 390 ? '#26999d' : '#2aa5aa') }, width)
        await page.getByText('First half (40:00)', { exact: true }).waitFor()
        assert.equal(await page.getByTestId('scorer-clock').innerText(), '2:55')
        assert.equal(await page.getByTestId('scorer-score').innerText(), '0 - 1')
        await assertControllerTypography(page, width)
        const primary = page.getByTestId('scorer-primary-actions')
        assert.deepEqual(await primary.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))), ['Goal', 'Yellow card', 'Red card', 'Substitution', 'Pause', 'Half time', 'Full time', 'Correct score'])
        await page.getByRole('switch', { name: 'Keep screen awake' }).waitFor({ state: 'visible' })
        const before = await page.getByRole('switch', { name: 'Keep screen awake' }).boundingBox()
        const primaryBox = await primary.boundingBox()
        assert.ok(before.y < primaryBox.y, 'Off keep-awake prompt precedes actions')
        await page.getByRole('switch', { name: 'Keep screen awake' }).click()
        const awake = page.getByTestId('scorer-secondary-actions').getByRole('switch', { name: 'Keep screen awake' })
        await awake.waitFor()
        assert.equal(await awake.isChecked(), true)
        const buttons = await primary.getByRole('button').all()
        const boxes = await Promise.all(buttons.map((button) => button.boundingBox()))
        for (let index = 0; index < boxes.length; index += 2) {
          assert.ok(Math.abs(boxes[index].y - boxes[index + 1].y) < 2, 'Each primary row has two actions')
          assert.ok(boxes[index].height >= 44, 'Actions remain touch-sized')
        }
        assert.ok(boxes.at(-1).y + boxes.at(-1).height < 640, 'Score, clock and all primary actions fit above phone navigation')
        await page.screenshot({ path: `output/playwright/mobile-scorer/parent-controller-${width}.png` })
        await page.getByRole('button', { name: 'Goal', exact: true }).click()
        await page.getByRole('textbox', { name: 'Scorer name', exact: true }).fill('Guest Player')
        await page.getByRole('button', { name: 'Record goal', exact: true }).click()
        assert.equal(await page.evaluate(() => window.calls.at(-1).value.scorerName), 'Other: Guest Player')
        await page.getByRole('button', { name: 'Goal', exact: true }).click()
        await page.getByRole('textbox', { name: 'Scorer name', exact: true }).fill('   ')
        await page.getByRole('button', { name: 'Record goal', exact: true }).click()
        await page.getByText('Choose a scorer or type their name.', { exact: true }).waitFor()
        await page.getByRole('button', { name: 'Close', exact: true }).click()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      }
      await page.evaluate(() => { window.updateMatch({ scorerReviewRequestedAt: '2026-09-15T18:00:00Z' }); window.renderPreview('light', '#123456') })
      await page.getByText('Sent to Coach to conclude. Your scoring access has ended.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: /Goal|Resume|Correct|Send to Coach/ }).count(), 0)
    }
    if(app==='coach'){
      await page.evaluate(()=>{window.preMatch();window.renderPreview('light','#123456')})
      await page.getByText('Live controller',{exact:true}).waitFor()
      await page.getByText('Score',{exact:true}).waitFor({state:'hidden'})
      assert.equal(await page.getByText('Score',{exact:true}).count(),0)
      assert.equal(await page.getByText('Match timer',{exact:true}).count(),0)
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS Parent and Coach rendered controls: own-goal credit, player selection feedback, cards, substitutions and captured time in light/dark themes')
} finally { await browser.close() }
