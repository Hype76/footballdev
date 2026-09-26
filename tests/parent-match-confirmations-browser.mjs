import assert from 'node:assert/strict'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const parent = await readFile('apps/parent-mobile/src/ParentPortalScreens.js', 'utf8')
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const modules = path.join(process.cwd(), 'apps/parent-mobile/node_modules')
const shared = `
  import React, { useState, useMemo, useEffect } from 'react'
  import { createRoot } from 'react-dom/client'
  import { View, Text, Pressable, ScrollView, StyleSheet, Platform, TextInput, Switch, Modal, KeyboardAvoidingView } from 'react-native'
  import { getGoalScorerSide, setGoalOwnGoal, oppositeMatchSide } from './src/lib/matchday-goal-credit.js'
  import { captureMatchEventTime, formatMatchAddedTimeClock, getMatchEventTime, getMatchClockDescription } from './src/lib/matchday-event-time.js'
  import { canCorrectMatchDayScore, canRecordParentScorerEvent, getMatchDayLifecycleState, getParentScorerTimerActions } from './src/lib/matchday-lifecycle.js'
  import { isContinuousMatchClock, normalizeMatchDurationMinutes } from './src/lib/matchday-model.js'
  import { getCoachMatchDayPresentation, getCoachMatchDaySelectedPlayers, getCoachMatchDayOpponentPlayers, captureCoachMatchDayAction, createCoachMatchDayEventForm, validateCoachMatchDayEventForm, pickCoachMatchDayLinkedPlayer, updateCoachMatchDayLinkedPlayer, filterCoachMatchDayPlayerChoices } from './apps/mobile-core/src/coachMatchDayCore.js'
  const isAvailableAsync = async () => false
  const activateKeepAwakeAsync = async () => {}
  const deactivateKeepAwake = async () => {}
  const MaterialIcons = () => null
  const normalize = (value) => String(value ?? '').trim()
  const normalizeText = normalize
  const label = (value) => normalize(value).replaceAll('_', ' ')
  const labelize = label
  const errorMessage = (error) => error.message
  const players = [{ id: 'alex', playerName: 'Alex', shirtNumber: '9', teamId: 'team' }, { id: 'clyde', playerName: 'Clyde Bates', shirtNumber: '4', teamId: 'team' }]
  let match = { id: 'test-match', teamId: 'team', teamName: 'FP TEST Team', opponent: 'Visitors', homeAway: 'away', homeScore: 0, awayScore: 0, matchDurationMinutes: 10, clockMode: 'fixed', currentMatchPhase: 'second_half', status: 'second_half', timerStatus: 'running', timerStartedAt: '2026-09-03T12:00:00Z', timerElapsedSeconds: 340, events: [], squadDecisions: players.map((player) => ({ playerId: player.id, status: 'selected' })) }
  const initialMatch = match
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
  function Preview({ mode, accent }) {
    const tokens = createParentMobileTheme({ mode, selectedLink: { themeAccent: accent } }).tokens
    const { colors, styles } = usePortalStyles(tokens)
    return <View style={{ backgroundColor: colors.background, padding: 16, minHeight: 900 }}><ScorerControls activeActionId="" isOffline={match.isOffline === true} match={match} players={players} styles={styles} placeholderColor={colors.muted} onAction={async (action, value) => { window.calls.push({ action, value }); return true }} /></View>
  }
  window.renderPreview = (mode, accent, state) => { match = { ...initialMatch, ...state }; root.render(<Preview key={mode + accent + match.status} mode={mode} accent={accent} />) }
`

const browser = await chromium.launch({ headless: true })
try {
  const result = await build({ stdin: { resolveDir: process.cwd(), contents: parentCode, loader: 'jsx' }, write: false, bundle: true, jsx: 'automatic', loader: { '.js': 'jsx' }, alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' } })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  for (const mode of ['light', 'dark']) {
    for (const [status, phase, button, confirm, expected] of [
      ['scheduled', 'pre_match', 'Start match', 'Confirm start', 'start'],
      ['second_half', 'second_half', 'Full time', 'Confirm finish', 'timer'],
    ]) {
      await page.evaluate(({mode,status,phase}) => { window.calls=[]; window.renderPreview(mode,'#1b437e',{status,currentMatchPhase:phase,timerStatus:status==='scheduled'?'not_started':status==='full_time'?'full_time':'running'}) }, {mode,status,phase})
      await page.getByRole('button', {name:button,exact:true}).click()
      assert.equal(await page.evaluate(() => window.calls.length),0)
      await page.getByRole('button', {name:'Cancel',exact:true}).click()
      assert.equal(await page.evaluate(() => window.calls.length),0)
      await page.getByRole('button', {name:button,exact:true}).click()
      await assertRenderedTextContrast(page, `${mode} ${status} confirmation`)
      await page.getByRole('button', {name:confirm,exact:true}).click()
      assert.equal(await page.evaluate(() => window.calls.length),1)
      assert.equal(await page.evaluate(() => window.calls[0].action),expected)
    }
    await page.evaluate(mode => { window.calls = []; window.renderPreview(mode, '#1b437e', { status: 'scheduled', currentMatchPhase: 'pre_match', timerStatus: 'not_started', timerStartedAt: '', phaseStartedAt: '', timerElapsedSeconds: 0, isOffline: true }) }, mode)
    await page.getByText('Offline. Game Day actions save on this phone and sync when connected.').waitFor()
    await page.getByRole('button', { name: 'Start match', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm start', exact: true }).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1)?.action), 'start')
    await page.evaluate(mode => window.renderPreview(mode,'#1b437e',{status:'full_time',currentMatchPhase:'full_time',timerStatus:'full_time'}), mode)
    await page.getByRole('button',{name:'Send to Coach to conclude',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Conclude match',exact:true}).count(),0)
    await page.getByRole('button',{name:'Correct score',exact:true}).click()
    await page.getByLabel('Away score').fill('1')
    await page.getByRole('button',{name:'Save score correction',exact:true}).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).action),'score')
    assert.equal(await page.evaluate(() => window.calls.at(-1).value.awayScore),'1')
    await page.evaluate(mode => window.renderPreview(mode,'#1b437e',{status:'full_time',currentMatchPhase:'full_time',timerStatus:'full_time',awayScore:2,events:[{id:'first-goal',eventType:'goal',teamSide:'opponent',scorerName:'FP TEST',minute:40},{id:'second-goal',eventType:'goal',teamSide:'opponent',scorerName:'FP TEST',minute:40}]}), mode)
    await page.getByRole('button',{name:'Correct goal',exact:true}).click()
    await page.getByRole('button',{name:"40' FP TEST (goal 2)",exact:true}).click()
    await page.getByRole('button',{name:'Remove goal',exact:true}).click()
    await page.getByRole('button',{name:'Confirm removal',exact:true}).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).action),'void-goal')
    assert.equal(await page.evaluate(() => window.calls.at(-1).value.event.id),'second-goal')
    await page.getByRole('button',{name:'Send to Coach to conclude',exact:true}).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).action),'request-review')
    await page.evaluate(mode => { window.calls=[]; window.renderPreview(mode,'#1b437e',{status:'second_half',currentMatchPhase:'second_half',timerStatus:'running',events:[{id:'existing-goal',eventType:'goal',teamSide:'club',scorerName:'Alex',minute:6}]} ) }, mode)
    await page.getByRole('button',{name:'Goal',exact:true}).click()
    await page.getByRole('button',{name:'Choose scorer',exact:true}).click()
    await page.getByRole('button',{name:'Alex | Shirt 9',exact:true}).click()
    await page.getByRole('button',{name:'Record goal',exact:true}).click()
    assert.equal(await page.evaluate(() => window.calls.length),0)
    await page.getByText('A goal for this scorer at this minute already exists. Check the details before recording another.').waitFor()
    await page.getByRole('button',{name:'Record another goal',exact:true}).click()
    assert.equal(await page.evaluate(() => window.calls.at(-1).action),'goal')
  }

  const app = await readFile('apps/parent-mobile/App.js', 'utf8')
  const hook = section(app, '  const [notice, setNotice]', '  const [notificationState,')
  const noticeCode = `import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client'; const initialNotice = null;
    function Preview(){ ${hook} window.setNotice=setNotice; return <div>{notice?.message || 'clear'}</div> }
    createRoot(document.getElementById('root')).render(<Preview/>);`
  const noticeBundle = await build({stdin:{resolveDir:process.cwd(),contents:noticeCode,loader:'jsx'},write:false,bundle:true,jsx:'automatic',alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},define:{'process.env.NODE_ENV':'"production"'}})
  const noticePage = await browser.newPage()
  await noticePage.setContent('<div id="root"></div>')
  await noticePage.addScriptTag({content:noticeBundle.outputFiles[0].text})
  await noticePage.getByText('clear',{exact:true}).waitFor()
  await noticePage.evaluate(()=>window.setNotice({tone:'success',message:'Invitation saved'}))
  await noticePage.getByText('Invitation saved',{exact:true}).waitFor()
  await noticePage.getByText('clear',{exact:true}).waitFor({timeout:3000})
  await noticePage.evaluate(()=>window.setNotice({tone:'error',message:'Could not save'}))
  await noticePage.waitForTimeout(2200)
  assert.equal(await noticePage.getByText('Could not save',{exact:true}).count(),1)
  assert.deepEqual(errors,[])
  console.log('Parent start/finish confirmations, Coach-only conclusion and handoff passed in both themes')
} finally { await browser.close() }
