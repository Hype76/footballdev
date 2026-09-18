import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

if (!process.env.FORMATION_ASYNC_SCENARIO) {
  for (const scenario of ['race', 'scope', 'cache', 'cache-missing', 'stable', 'loading-back', 'back', 'back-offline', 'retry', 'retry-no-storage', 'readonly', 'panels', 'multiple', 'queue-resume', 'conflict', 'ack-refresh', 'queue-switch', 'new-board-isolation']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, FORMATION_ASYNC_SCENARIO: scenario },
      encoding: 'utf8',
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.status !== 0) process.exit(result.status || 1)
  }
  process.exit(0)
}

const rootDir = process.cwd()
const modules = path.join(rootDir, 'apps/coach-mobile/node_modules')

const entry = `
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { View, Text } from 'react-native'
  import { CoachFormationBoard } from './apps/coach-mobile/src/CoachFormationBoard.js'

  const palette = { accent: '#057a55', accentText: '#065f46', background: '#f5f8f6', border: '#d7e5dc', danger: '#b42318', selected: '#dcfce7', selectedForeground: '#052e16', surface: '#ffffff', surfaceRaised: '#edf4ef', textMuted: '#66766d', textPrimary: '#101828', textSecondary: '#4b5f55', warning: '#b54708' }
  const scenario = ${JSON.stringify(process.env.FORMATION_ASYNC_SCENARIO || 'race')}
  window.__formationTest = {
    mode: scenario,
    boardCalls: 0,
    boardResolvers: {},
    createCalls: 0,
    localDraftCalls: 0,
    lastLocalDraft: null,
    presetCalls: 0,
    saveCalls: 0,
    lastShared: false,
    lastSavedTitle: '',
    publishCalls: 0,
    lastMatchId: '',
    lastSavedBoardId: '',
    serverBoards: null,
    refreshFailed: false,
    serverBoard: null,
    lastOfflineFormation: null,
  }

  const matches = {
    a: { id: 'match-a', teamName: 'Team A', opponent: 'Opponent A', matchDate: '2099-09-20' },
    b: { id: 'match-b', teamName: 'Team B', opponent: 'Opponent B', matchDate: '2099-09-21' },
  }

  function App() {
    const [matchId, setMatchId] = React.useState('a')
    const [scopeId, setScopeId] = React.useState('a')
    const [revision, setRevision] = React.useState(0)
    const [visible, setVisible] = React.useState(true)
    const [stale, setStale] = React.useState(false)
    const backHandler = React.useRef(null)
    const match = matches[matchId]
    return <View>
      {scenario === 'race' || scenario === 'queue-switch' ? <button type="button" onClick={() => setMatchId('b')}>Switch to match B</button> : null}
      {scenario === 'queue-switch' ? <button type="button" onClick={() => setMatchId('a')}>Switch to match A</button> : null}
      {scenario === 'scope' ? <button type="button" onClick={() => setScopeId('b')}>Switch account and team</button> : null}
      {scenario === 'stable' ? <button type="button" onClick={() => setRevision(current => current + 1)}>Equivalent parent refresh {revision}</button> : null}
      {scenario === 'back' || scenario === 'back-offline' || scenario === 'loading-back' ? <button type="button" onClick={() => backHandler.current?.()}>Native workspace back</button> : null}
      {scenario === 'back-offline' ? <button type="button" onClick={() => setStale(true)}>Lose connection</button> : null}
      {scenario === 'queue-resume' || scenario === 'ack-refresh' || scenario === 'retry' ? <button type="button" onClick={() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')) }}>Resume connection</button> : null}
      {visible ? <CoachFormationBoard
        context={{ id: scopeId === 'a' ? 'club-context-a' : 'club-context-b', authorityId: scopeId === 'a' ? 'authority-a' : 'authority-b', authoritySource: 'team_staff', clubId: 'club-1', teamId: scopeId === 'a' ? 'team-1' : 'team-2', role: 'coach', roleRank: 30, hasActivePlanAccess: true }}
        match={scenario === 'race' || scenario === 'queue-switch' ? match : matches.a}
        matches={[]}
        onBack={() => { window.__formationTest.backCount = (window.__formationTest.backCount || 0) + 1; setVisible(false) }}
        palette={palette}
        players={[{ id: 'player-1', playerName: 'Player One', shirtNumber: 1 }]}
        registerBackHandler={handler => { backHandler.current = handler }}
        stale={stale}
        user={{ id: scopeId === 'a' ? 'coach-1' : 'coach-2', clubId: 'club-1', activeTeamId: scopeId === 'a' ? 'team-1' : 'team-2', role: 'coach', roleRank: scenario === 'readonly' ? 20 : 30, hasActivePlanAccess: true }}
      /> : null}
    </View>
  }

  createRoot(document.getElementById('root')).render(<App />)
`

const dataMock = `
  const slots = [
    { id: 'goalkeeper', group: 'goalkeeper', label: 'Goalkeeper', shortLabel: 'GK', x: 50, y: 88 },
    { id: 'defender-1', group: 'defender', label: 'Defender 1', shortLabel: 'D1', x: 25, y: 68 },
    { id: 'defender-2', group: 'defender', label: 'Defender 2', shortLabel: 'D2', x: 75, y: 68 },
    { id: 'midfielder-1', group: 'midfielder', label: 'Midfielder 1', shortLabel: 'M1', x: 25, y: 45 },
    { id: 'midfielder-2', group: 'midfielder', label: 'Midfielder 2', shortLabel: 'M2', x: 75, y: 45 },
    { id: 'forward-1', group: 'forward', label: 'Forward 1', shortLabel: 'F1', x: 50, y: 20 },
  ]
  const version = (id, number = 1, draft = {}) => ({
    id, versionNumber: number, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2',
    presetRegistryVersion: 1, placements: draft.placements || [], bench: draft.bench || [],
  })
  const board = (id, title, linkedMatchDayId = '') => ({
    id, title, linkedMatchDayId, createdByProfileId: 'coach-1', currentVersionId: id + '-v1',
    currentVersionNumber: 1, currentVersion: version(id + '-v1'),
  })
  const raceBoards = { a: board('board-a', 'Board A', 'match-a'), b: board('board-b', 'Board B', 'match-b') }

  export const getCoachFormationPresets = async () => {
    globalThis.__formationTest.presetCalls += 1
    return [{ key: '11v11-4-4-2', gameFormat: '11v11', displayName: '4-4-2', slots }]
  }
  export const getCoachFormationPublications = async (user, boardId) => {
    const state = globalThis.__formationTest
    if (state.mode === 'multiple' && state.lastShared && state.serverBoard?.id === boardId) return [{ board_version_id: state.serverBoard.currentVersionId, match_day_id: 'match-a' }]
    return []
  }
  export const getCoachFormationResourcePublications = async () => []
  export const linkCoachFormationBoard = async (user, currentBoard, matchId) => ({ ...currentBoard, linkedMatchDayId: matchId })
  export const publishCoachFormationBoard = async () => { globalThis.__formationTest.publishCalls += 1; return {} }
  export const publishCoachFormationResource = async () => ({})
  export const withdrawCoachFormationBoard = async () => ({})

  export const getCoachFormationBoards = async () => {
    const state = globalThis.__formationTest
    if (state.mode === 'race' || state.mode === 'scope' || state.mode === 'cache' || state.mode === 'cache-missing' || state.mode === 'loading-back') {
      const call = ++state.boardCalls
      return new Promise(resolve => { state.boardResolvers[call] = resolve })
    }
    const call = ++state.boardCalls
    if (state.mode === 'ack-refresh' && state.saveCalls > 0 && !state.refreshFailed) {
      state.refreshFailed = true
      throw new Error('Network request failed')
    }
    if (state.mode === 'ack-refresh' && state.refreshFailed) return state.serverBoard ? [state.serverBoard] : []
    if ((state.mode === 'retry' || state.mode === 'retry-no-storage') && call === 2 && !state.refreshFailed) {
      state.refreshFailed = true
      throw new Error('refresh failed')
    }
    if (state.mode === 'multiple') {
      if (!state.serverBoards) state.serverBoards = [board('board-a', 'Board A', 'match-a'), board('board-b', 'Board B', 'match-a'), board('board-c', 'Board C', 'match-b')]
      return state.serverBoards
    }
    return state.serverBoard ? [state.serverBoard] : []
  }

  export const saveCoachMatchFormationBoard = async (user, match, currentBoard, draft, title, shared) => {
    const state = globalThis.__formationTest
    state.saveCalls += 1
    state.lastSavedTitle = title
    if ((state.mode === 'queue-resume' || state.mode === 'queue-switch' || state.mode === 'new-board-isolation') && state.saveCalls === 1) throw new Error('Network request failed')
    if (state.mode === 'conflict') {
      const error = new Error('formation_board_version_conflict')
      error.code = 'formation_board_version_conflict'
      throw error
    }
    state.lastShared = Boolean(shared)
    state.lastMatchId = match?.id || ''
    state.serverBoard = {
      ...(currentBoard || board('board-created-' + state.saveCalls, title || 'Created board', match?.id || '')),
      linkedMatchDayId: match?.id || currentBoard?.linkedMatchDayId || '',
      title: title || currentBoard?.title || 'Created board',
      currentVersionId: 'board-created-v2',
      currentVersionNumber: 2,
      currentVersion: version('board-created-v2', 2, draft),
    }
    state.lastSavedBoardId = state.serverBoard.id
    if (state.mode === 'multiple') {
      const existing = Array.isArray(state.serverBoards) ? state.serverBoards : []
      const index = existing.findIndex(item => item.id === state.serverBoard.id)
      state.serverBoards = index >= 0 ? existing.map((item, itemIndex) => itemIndex === index ? state.serverBoard : item) : [...existing, state.serverBoard]
    }
    return state.serverBoard
  }
`

const offlineMock = `
  const cachedSlots = [
    { id: 'goalkeeper', group: 'goalkeeper', label: 'Goalkeeper', shortLabel: 'GK', x: 50, y: 88 },
    { id: 'defender-1', group: 'defender', label: 'Defender 1', shortLabel: 'D1', x: 25, y: 68 },
  ]
  let stored = null
  const current = () => {
    if (stored) return stored
    if (window.__formationTest.mode === 'new-board-isolation') {
      const otherMatchBoard = { id: 'other-match-board', title: 'Other match board', linkedMatchDayId: 'match-b', createdByProfileId: 'coach-1', currentVersionId: 'other-match-v1', currentVersionNumber: 1, currentVersion: { id: 'other-match-v1', versionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', placements: [], bench: [] } }
      stored = { resources: { formation: { board: otherMatchBoard, boards: [otherMatchBoard], draft: { gameFormat: '11v11', presetKey: '11v11-4-4-2', placements: [], bench: [] }, localDrafts: {}, matchDayId: 'match-b', pendingSave: null, pendingSaves: {}, presets: [{ key: '11v11-4-4-2', gameFormat: '11v11', displayName: '4-4-2', slots: cachedSlots }] } } }
    } else if (window.__formationTest.mode === 'cache' || window.__formationTest.mode === 'cache-missing') {
      const draft = { gameFormat: '11v11', presetKey: '11v11-4-4-2', placements: [{ playerId: 'cached-player', displayName: 'Cached Player', shirtNumber: 9, slotId: 'goalkeeper', positionGroup: 'goalkeeper', x: 0.5, y: 0.88 }], bench: [] }
      const board = { id: 'cached-board', title: 'Cached Board', linkedMatchDayId: 'match-a', createdByProfileId: 'coach-1', currentVersionId: 'cached-v1', currentVersionNumber: 1, currentVersion: { id: 'cached-v1', versionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', placements: draft.placements, bench: [] } }
      stored = { resources: { formation: { board, boards: [board], draft, localDrafts: {}, matchDayId: 'match-a', pendingSave: null, presets: [{ key: '11v11-4-4-2', gameFormat: '11v11', displayName: '4-4-2', slots: cachedSlots }] } } }
    } else stored = { resources: { formation: { pendingSave: null, localDrafts: {} } } }
    return stored
  }
  export const readCoachOfflineResources = async () => current()
  export const saveCoachOfflineResources = async (user, context, resources) => {
    if (window.__formationTest.mode === 'retry-no-storage') throw new Error('Device storage unavailable')
    const value = current()
    const previousFormation = value.resources.formation || {}
    const incomingFormation = resources.formation
    if (incomingFormation?.pendingSaveChanges) {
      const pendingSaves = { ...(previousFormation.pendingSaves || {}) }
      Object.entries(incomingFormation.pendingSaveChanges).forEach(([pendingKey, pendingSave]) => {
        if (pendingSave === null) delete pendingSaves[pendingKey]
        else pendingSaves[pendingKey] = pendingSave
      })
      stored = { resources: { ...value.resources, ...resources, formation: { ...incomingFormation, pendingSaveChanges: undefined, pendingSaves, localDrafts: previousFormation.localDrafts || {}, pendingSave: incomingFormation.pendingSave === undefined ? previousFormation.pendingSave : incomingFormation.pendingSave } } }
    } else {
      stored = { resources: { ...value.resources, ...resources, formation: { ...incomingFormation, pendingSaves: incomingFormation.pendingSaves === undefined ? (previousFormation.pendingSaves || {}) : incomingFormation.pendingSaves, localDrafts: previousFormation.localDrafts || {}, pendingSave: incomingFormation.pendingSave === undefined ? previousFormation.pendingSave : incomingFormation.pendingSave } } }
    }
    window.__formationTest.lastOfflineFormation = stored.resources.formation
    return stored
  }
  export const saveCoachFormationLocalDraft = async (user, context, key, entry) => {
    if (window.__formationTest.mode === 'retry-no-storage') throw new Error('Device storage unavailable')
    window.__formationTest.localDraftCalls += 1
    window.__formationTest.lastLocalDraft = entry
    const value = current()
    const formation = value.resources.formation || { pendingSave: null, localDrafts: {} }
    const localDrafts = { ...(formation.localDrafts || {}) }
    if (entry) localDrafts[key] = entry
    else delete localDrafts[key]
    stored = { resources: { ...value.resources, formation: { ...formation, localDrafts } } }
    return stored
  }
`

const mocks = [
  [/^react-native-safe-area-context$/, "import React from 'react'; import { View } from 'react-native'; export const SafeAreaProvider = ({children}) => <View style={{flex:1}}>{children}</View>; export const useSafeAreaInsets = () => ({ top: 47, right: 0, bottom: 34, left: 0 }); export const SafeAreaView = ({style,...props}) => <View {...props} style={[style,{paddingTop:47,paddingBottom:34}]} />"],
  [/coachFormationBoardData$/, dataMock],
  [/^\.\/offline$/, offlineMock],
  [/^@expo\/vector-icons\/MaterialIcons$/, `export default () => null`],
  [/^@react-native-async-storage\/async-storage$/, `export default { getItem: async () => null, setItem: async () => {} }`],
  [/BrandLoader$/, `export const BrandLoader = () => null`],
  [/coachFriendlyErrors$/, `export const getCoachFriendlyError = error => error.message`],
]

const bundle = await build({
  stdin: { contents: entry, resolveDir: rootDir, loader: 'jsx' },
  bundle: true,
  write: false,
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  alias: {
    'react-native': path.join(modules, 'react-native-web'),
    react: path.join(modules, 'react'),
    'react-dom': path.join(modules, 'react-dom'),
  },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  plugins: [{
    name: 'formation-async-mocks',
    setup(builder) {
      for (const [index, [filter]] of mocks.entries()) builder.onResolve({ filter }, () => ({ path: String(index), namespace: 'mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[Number(args.path)][1], loader: 'jsx', resolveDir: rootDir }))
    },
  }],
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })

  const readPlanTitle = async () => {
    await page.getByRole('button', { name: 'Formation Board options', exact: true }).click()
    const titleInput = page.getByLabel('Formation plan title', { exact: true })
    await titleInput.waitFor()
    const value = await titleInput.inputValue()
    await page.getByRole('button', { name: 'Close options', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0)
    return value
  }

  if ((process.env.FORMATION_ASYNC_SCENARIO || 'race') === 'race') {
    await page.getByRole('button', { name: 'Switch to match B', exact: true }).click()
    await page.waitForFunction(() => window.__formationTest.boardCalls >= 2)
    await page.evaluate(() => window.__formationTest.boardResolvers[2]([{
      id: 'board-b', title: 'Board B', linkedMatchDayId: 'match-b', createdByProfileId: 'coach-1',
      currentVersionId: 'board-b-v1', currentVersionNumber: 1,
      currentVersion: { id: 'board-b-v1', versionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', placements: [], bench: [] },
    }]))
    assert.equal(await readPlanTitle(), 'Board B')
    await page.evaluate(() => window.__formationTest.boardResolvers[1]([{
      id: 'board-a', title: 'Board A', linkedMatchDayId: 'match-a', createdByProfileId: 'coach-1',
      currentVersionId: 'board-a-v1', currentVersionNumber: 1,
      currentVersion: { id: 'board-a-v1', versionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', placements: [], bench: [] },
    }]))
    await page.waitForTimeout(80)
    assert.equal(await readPlanTitle(), 'Board B')
    console.log('PASS: stale fixture load cannot overwrite the active match board')
  } else if (process.env.FORMATION_ASYNC_SCENARIO === 'scope') {
    await page.waitForFunction(() => window.__formationTest.boardCalls === 1)
    await page.getByRole('button', { name: 'Switch account and team', exact: true }).click()
    await page.waitForFunction(() => window.__formationTest.boardCalls === 2)
    assert.equal(await page.getByText('Loading Formation Board...', { exact: true }).count(), 1)
    await page.evaluate(() => window.__formationTest.boardResolvers[2]([{
      id: 'board-b', title: 'Board B', linkedMatchDayId: 'match-a', createdByProfileId: 'coach-2',
      currentVersionId: 'board-b-v1', currentVersionNumber: 1,
      currentVersion: { id: 'board-b-v1', versionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', placements: [], bench: [] },
    }]))
    assert.equal(await readPlanTitle(), 'Board B')
    await page.evaluate(() => window.__formationTest.boardResolvers[1]([{
      id: 'board-a', title: 'Board A', linkedMatchDayId: 'match-a', createdByProfileId: 'coach-1',
      currentVersionId: 'board-a-v1', currentVersionNumber: 1,
      currentVersion: { id: 'board-a-v1', versionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', placements: [], bench: [] },
    }]))
    await page.waitForTimeout(80)
    assert.equal(await readPlanTitle(), 'Board B')
    console.log('PASS: account, Team and authority changes reload without leaking the previous scope')
  } else if (process.env.FORMATION_ASYNC_SCENARIO === 'cache' || process.env.FORMATION_ASYNC_SCENARIO === 'cache-missing') {
    await page.getByLabel('Formation pitch', { exact: true }).waitFor()
    assert.equal(await readPlanTitle(), 'Cached Board')
    await page.getByText('Cached Player', { exact: true }).waitFor()
    assert.equal(await page.getByText('Loading Formation Board...', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Formation', exact: true }).isEnabled(), false)
    await page.evaluate((missing) => window.__formationTest.boardResolvers[1](missing ? [] : [{
      id: 'cached-board', title: 'Live Board', linkedMatchDayId: 'match-a', createdByProfileId: 'coach-1',
      currentVersionId: 'cached-v2', currentVersionNumber: 2,
      currentVersion: { id: 'cached-v2', versionNumber: 2, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', placements: [{ playerId: 'live-player', displayName: 'Live Player', shirtNumber: 8, slotId: 'goalkeeper', positionGroup: 'goalkeeper', x: 0.5, y: 0.88 }], bench: [] },
    }]), process.env.FORMATION_ASYNC_SCENARIO === 'cache-missing')
    await page.getByRole('button', { name: 'Formation', exact: true }).waitFor({ state: 'visible' })
    if (process.env.FORMATION_ASYNC_SCENARIO === 'cache-missing') {
      await page.getByText('The saved board is no longer available to this account. Cached content cannot be edited or sent.', { exact: true }).waitFor()
      assert.equal(await page.getByText('Cached Player', { exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Formation', exact: true }).isEnabled(), false)
      await page.getByRole('button', { name: 'Formation Board options', exact: true }).click()
      await page.getByRole('button', { name: 'Start replacement board', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: 'Formation', exact: true }).isEnabled(), true)
      console.log('PASS: a missing live board stays blocked until the coach starts a safe replacement')
    } else {
      await page.waitForFunction(() => document.querySelector('[aria-label="Formation"]')?.getAttribute('aria-disabled') !== 'true')
      await page.getByRole('button', { name: 'Formation Board options', exact: true }).click()
      assert.equal(await page.getByLabel('Formation plan title', { exact: true }).inputValue(), 'Live Board')
      await page.getByRole('button', { name: 'Close options', exact: true }).click()
      await page.getByText('Live Player', { exact: true }).waitFor()
      assert.equal(await page.getByText('Cached Player', { exact: true }).count(), 0)
      console.log('PASS: cache renders read-only, then refreshes from the matching live board')
    }
  } else if (process.env.FORMATION_ASYNC_SCENARIO === 'stable') {
    await page.getByLabel('Formation pitch', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Add Player at Goalkeeper', exact: true }).click()
    await page.getByRole('button', { name: /#1 Player One.*Add/ }).click()
    await page.getByRole('button', { name: 'Equivalent parent refresh 0', exact: true }).click()
    await page.getByRole('button', { name: 'Equivalent parent refresh 1', exact: true }).waitFor()
    for (const label of ['Players', 'Formation', 'Save']) {
      await page.getByRole('button', { name: label, exact: true }).click()
      const dialogName = label === 'Save' ? 'share options' : `${label.toLowerCase()} options`
      await page.getByRole('dialog', { name: dialogName, exact: true }).waitFor()
      await page.getByRole('button', { name: 'Close options', exact: true }).click()
    }
    assert.equal(await page.getByLabel(/Player One, shirt 1/).count(), 1)
    assert.equal(await page.evaluate(() => window.__formationTest.boardCalls), 1)
    assert.equal(await page.evaluate(() => window.__formationTest.presetCalls), 1)
    console.log('PASS: equivalent parent rerenders and local actions keep edits without refetching')
  } else if (process.env.FORMATION_ASYNC_SCENARIO === 'loading-back') {
    await page.waitForFunction(() => window.__formationTest.boardCalls === 1)
    await page.getByText('Loading Formation Board...', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Native workspace back', exact: true }).click()
    await page.waitForFunction(() => window.__formationTest.backCount === 1)
    assert.equal(await page.getByText('Loading Formation Board...', { exact: true }).count(), 0)
    console.log('PASS: Match Day Board can leave while its first board load is pending')
  } else if (process.env.FORMATION_ASYNC_SCENARIO === 'back' || process.env.FORMATION_ASYNC_SCENARIO === 'back-offline') {
    await page.getByLabel('Formation pitch', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Add Player at Goalkeeper', exact: true }).click()
    await page.getByRole('button', { name: /#1 Player One.*Add/ }).click()
    if (process.env.FORMATION_ASYNC_SCENARIO === 'back-offline') {
      await page.getByRole('button', { name: 'Lose connection', exact: true }).click()
      assert.equal(await page.getByText('Offline draft', { exact: true }).count(), 0, 'Offline storage does not cover the pitch with a persistent banner')
    }
    await page.getByRole('button', { name: 'Native workspace back', exact: true }).click()
    await page.waitForFunction(() => window.__formationTest.backCount === 1)
    assert.equal(await page.evaluate(() => window.__formationTest.lastLocalDraft?.draft?.placements?.[0]?.playerId), 'player-1')
    assert.ok(await page.evaluate(() => window.__formationTest.localDraftCalls >= 1))
    console.log(`PASS: native workspace Back protects a rapid lineup edit before closing (${process.env.FORMATION_ASYNC_SCENARIO})`)
  } else if (process.env.FORMATION_ASYNC_SCENARIO === 'panels') {
    await page.getByLabel('Formation pitch', { exact: true }).waitFor()
    for (let repeat = 0; repeat < 2; repeat += 1) {
      for (const label of ['Players', 'Formation', 'Save']) {
        await page.getByRole('button', { name: label, exact: true }).click()
        const dialogName = label === 'Save' ? 'share options' : `${label.toLowerCase()} options`
        await page.getByRole('dialog', { name: dialogName, exact: true }).waitFor()
        await page.getByRole('button', { name: 'Close options', exact: true }).click()
        await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0)
      }
      await page.getByRole('button', { name: 'Add Player at Goalkeeper', exact: true }).click()
      await page.getByRole('dialog', { name: 'Choose Player', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Close Player picker', exact: true }).click()
      await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0)
    }
    assert.equal(await page.evaluate(() => window.__formationTest.saveCalls), 0)
    console.log('PASS: Players, Formation, Save and empty positions repeatedly open and close without writes')
  } else if (process.env.FORMATION_ASYNC_SCENARIO === 'readonly') {
    await page.getByText('Viewing only', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Add Player at Goalkeeper', exact: true }).isEnabled(), false)
    assert.equal(await page.getByRole('button', { name: 'Players', exact: true }).isEnabled(), false)
    assert.equal(await page.getByRole('button', { name: 'Formation', exact: true }).isEnabled(), false)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Save to match', exact: true }).isEnabled(), false)
    assert.equal(await page.evaluate(() => window.__formationTest.saveCalls), 0)
    console.log('PASS: read-only staff can view the board but cannot edit or save')
  } else if (process.env.FORMATION_ASYNC_SCENARIO === 'multiple') {
    await page.getByLabel('Formation pitch', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Formation Board options', exact: true }).click()
    await page.getByText('Open saved boards (2)', { exact: true }).click()
    await page.getByText('Board A', { exact: true }).waitFor()
    await page.getByText('Board B', { exact: true }).waitFor()
    assert.equal(await page.getByText('Board C', { exact: true }).count(), 0)
    await page.getByText('Board B', { exact: true }).click()
    await page.getByRole('button', { name: 'Formation Board options', exact: true }).click()
    assert.equal(await page.getByLabel('Formation plan title', { exact: true }).inputValue(), 'Board B')
    await page.getByRole('button', { name: 'Close options', exact: true }).click()
    await page.getByRole('button', { name: 'Add Player at Goalkeeper', exact: true }).click()
    await page.getByRole('button', { name: /#1 Player One.*Add/ }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByLabel('Formation plan title', { exact: true }).fill('Board B revised')
    await page.getByRole('button', { name: 'Parents and players', exact: true }).click()
    await page.getByRole('button', { name: 'Save to match', exact: true }).click()
    await page.waitForFunction(() => window.__formationTest.saveCalls > 0)
    assert.equal(await page.evaluate(() => window.__formationTest.serverBoards.find(item => item.id === 'board-b')?.title), 'Board B revised')
    assert.equal(await page.evaluate(() => window.__formationTest.lastShared), true)
    await page.getByRole('button', { name: 'Close options', exact: true }).click()
    await page.getByRole('button', { name: 'Formation Board options', exact: true }).click()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'New board', exact: true }).click()
    await page.getByLabel('Formation pitch', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Add Player at Goalkeeper', exact: true }).click()
    await page.getByRole('button', { name: /#1 Player One.*Add/ }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: 'Save to match', exact: true }).click()
    await page.getByText(/Lineup 3 saved to this match/).waitFor()
    assert.notEqual(await page.evaluate(() => window.__formationTest.lastSavedBoardId), 'board-a')
    assert.notEqual(await page.evaluate(() => window.__formationTest.lastSavedBoardId), 'board-b')
    console.log('PASS: same-match saved boards stay isolated, other-match boards remain hidden, and New board appends safely')
  } else {
    await page.getByLabel('Formation pitch', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Confirm formation', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Add Player at Goalkeeper', exact: true }).click()
    await page.getByRole('button', { name: /#1 Player One.*Add/ }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    if (process.env.FORMATION_ASYNC_SCENARIO === 'queue-resume') {
      await page.getByLabel('Formation plan title', { exact: true }).fill('Queued lineup')
      await page.getByRole('button', { name: 'Parents and players', exact: true }).click()
    }
    if (process.env.FORMATION_ASYNC_SCENARIO === 'conflict') {
      await page.getByLabel('Formation plan title', { exact: true }).fill('Conflicted lineup')
    }
    if (process.env.FORMATION_ASYNC_SCENARIO === 'queue-resume' || process.env.FORMATION_ASYNC_SCENARIO === 'conflict') {
      await page.getByRole('button', { name: 'Save to match', exact: true }).click()
      if (process.env.FORMATION_ASYNC_SCENARIO === 'queue-resume') {
        await page.getByText('Saved on this phone. It will retry when the connection returns.', { exact: true }).waitFor()
        assert.equal(await page.evaluate(() => Object.keys(window.__formationTest.lastOfflineFormation?.pendingSaves || {}).length), 1, 'Network failure stores the pending save in the keyed map')
        await page.getByRole('button', { name: 'Close options', exact: true }).click()
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await page.getByLabel('Formation plan title', { exact: true }).fill('Later unsaved title')
        await page.getByRole('button', { name: 'Coaches only', exact: true }).click()
        await page.getByRole('button', { name: 'Close options', exact: true }).click()
        await page.getByRole('button', { name: 'Resume connection', exact: true }).dblclick()
        await page.waitForFunction(() => window.__formationTest.saveCalls === 2)
        await page.waitForTimeout(120)
        assert.equal(await page.evaluate(() => window.__formationTest.lastSavedTitle), 'Queued lineup')
        assert.equal(await page.evaluate(() => window.__formationTest.lastShared), true)
        assert.equal(await page.evaluate(() => window.__formationTest.publishCalls), 0, 'Queued save must not publish automatically')
        assert.equal(await page.evaluate(() => Object.keys(window.__formationTest.lastOfflineFormation?.pendingSaves || {}).length), 0, 'Successful retry clears the queued save')
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        assert.equal(await page.getByLabel('Formation plan title', { exact: true }).inputValue(), 'Later unsaved title')
        await page.getByRole('button', { name: 'Save to match', exact: true }).click()
        await page.waitForFunction(() => window.__formationTest.saveCalls === 3)
        assert.equal(await page.evaluate(() => window.__formationTest.lastShared), false, 'Later audience edit remains coaches-only when saved manually')
        await page.getByRole('button', { name: 'Close options', exact: true }).click()
        console.log('PASS: failed save queues a snapshot, resumes once without publishing, and preserves later edits')
      } else {
        await page.getByText(/newer version/).first().waitFor()
        assert.equal(await page.getByRole('button', { name: 'Reload latest version', exact: true }).count(), 1)
        assert.equal(await page.getByRole('button', { name: 'Retry save', exact: true }).count(), 0, 'Version conflicts must not retry the save')
        assert.equal(await page.evaluate(() => window.__formationTest.saveCalls), 1)
        console.log('PASS: version conflict stays actionable without retrying the save')
      }
      assert.deepEqual(errors, [])
    } else if (process.env.FORMATION_ASYNC_SCENARIO === 'ack-refresh') {
      await page.getByRole('button', { name: 'Save to match', exact: true }).click()
      await page.waitForFunction(() => window.__formationTest.saveCalls === 1)
      await page.getByRole('button', { name: 'Close options', exact: true }).click()
      await page.getByRole('button', { name: 'Resume connection', exact: true }).dblclick()
      await page.waitForTimeout(250)
      assert.equal(await page.evaluate(() => window.__formationTest.saveCalls), 1, 'Refresh failure after acknowledgement must not issue a second RPC')
      assert.equal(await page.evaluate(() => Object.keys(window.__formationTest.lastOfflineFormation?.pendingSaves || {}).length), 0, 'Reconciled acknowledged save clears the pending map')
      console.log('PASS: acknowledged save reconciles after refresh failure without duplicating the RPC')
    } else if (process.env.FORMATION_ASYNC_SCENARIO === 'queue-switch') {
      await page.getByRole('button', { name: 'Save to match', exact: true }).click()
      await page.getByText('Saved on this phone. It will retry when the connection returns.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => Object.keys(window.__formationTest.lastOfflineFormation?.pendingSaves || {}).length), 1)
      await page.getByRole('button', { name: 'Close options', exact: true }).click()
      await page.getByRole('button', { name: 'Switch to match B', exact: true }).click()
      await page.getByLabel('Formation pitch', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Switch to match A', exact: true }).click()
      await page.getByLabel('Formation pitch', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByText('Saved on this phone. It will retry when the connection returns.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => Object.keys(window.__formationTest.lastOfflineFormation?.pendingSaves || {}).filter(key => key.startsWith('match-a:')).length), 1, 'Queued intent survives another match route')
      console.log('PASS: queued intent survives navigating to another match and returning')
    } else if (process.env.FORMATION_ASYNC_SCENARIO === 'new-board-isolation') {
      await page.getByRole('button', { name: 'Save to match', exact: true }).click()
      await page.getByText('Saved on this phone. It will retry when the connection returns.', { exact: true }).waitFor()
      const formation = await page.evaluate(() => window.__formationTest.lastOfflineFormation)
      assert.notEqual(formation?.board?.linkedMatchDayId, 'match-b', 'New-board failure must not leak another match board')
      assert.equal(formation?.pendingSave?.matchDayId, 'match-a')
      assert.equal(Object.keys(formation?.pendingSaves || {}).some(key => key.startsWith('match-a:')), true)
      console.log('PASS: new-board failure keeps offline identity scoped to the active match')
    }
    if (!['queue-resume', 'conflict', 'ack-refresh', 'queue-switch', 'new-board-isolation'].includes(process.env.FORMATION_ASYNC_SCENARIO)) {
    if (process.env.FORMATION_ASYNC_SCENARIO === 'retry') {
      await page.getByLabel('Formation plan title', { exact: true }).fill('Starting lineup')
      await page.getByRole('dialog', { name: 'share options', exact: true }).waitFor()
      await page.getByRole('dialog', { name: 'share options', exact: true }).getByText('Save to match', { exact: true }).first().waitFor()
      await page.waitForTimeout(600)
      await page.screenshot({ path: path.join(rootDir, 'outputs', 'match-formations', 'save-to-match-preview.png') })
    }
    if (process.env.FORMATION_ASYNC_SCENARIO === 'retry') await page.getByRole('button', { name: 'Parents and players', exact: true }).click()
    await page.getByRole('button', { name: 'Save to match', exact: true }).click()
    await page.waitForFunction(() => window.__formationTest.saveCalls === 1)
    await page.waitForTimeout(120)
    await page.getByRole('button', { name: 'Close options', exact: true }).click()
    if (process.env.FORMATION_ASYNC_SCENARIO === 'retry') {
      await page.getByRole('button', { name: 'Resume connection', exact: true }).dblclick()
      await page.waitForTimeout(250)
      assert.equal(await page.evaluate(() => window.__formationTest.saveCalls), 1, 'Acknowledged retry must not issue a second RPC')
      assert.equal(await page.evaluate(() => window.__formationTest.lastMatchId), 'match-a')
      assert.equal(await page.evaluate(() => window.__formationTest.lastShared), true)
    } else {
      await page.getByRole('button', { name: 'Retry save', exact: true }).click()
      await page.waitForFunction(() => window.__formationTest.saveCalls === 2)
      assert.equal(await page.evaluate(() => window.__formationTest.lastMatchId), 'match-a')
      assert.equal(await page.evaluate(() => window.__formationTest.lastShared), false)
    }
    if (process.env.FORMATION_ASYNC_SCENARIO !== 'retry-no-storage') {
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('dialog', { name: 'share options', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Close options', exact: true }).click()
    }
    console.log(`PASS: create success followed by refresh failure retries the existing board (${process.env.FORMATION_ASYNC_SCENARIO})`)
    }
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
