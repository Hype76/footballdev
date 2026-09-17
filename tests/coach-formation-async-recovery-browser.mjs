import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

if (!process.env.FORMATION_ASYNC_SCENARIO) {
  for (const scenario of ['race', 'retry', 'retry-no-storage', 'readonly']) {
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

  const palette = new Proxy({}, { get: () => '#123456' })
  const scenario = ${JSON.stringify(process.env.FORMATION_ASYNC_SCENARIO || 'race')}
  window.__formationTest = {
    mode: scenario,
    boardCalls: 0,
    boardResolvers: {},
    createCalls: 0,
    saveCalls: 0,
    refreshFailed: false,
    serverBoard: null,
  }

  const matches = {
    a: { id: 'match-a', teamName: 'Team A', opponent: 'Opponent A', matchDate: '2099-09-20' },
    b: { id: 'match-b', teamName: 'Team B', opponent: 'Opponent B', matchDate: '2099-09-21' },
  }

  function App() {
    const [matchId, setMatchId] = React.useState('a')
    const match = matches[matchId]
    return <View>
      {scenario === 'race' ? <button type="button" onClick={() => setMatchId('b')}>Switch to match B</button> : null}
      <CoachFormationBoard
        context={{ id: 'club-context', clubId: 'club-1', teamId: 'team-1', role: 'coach' }}
        match={scenario === 'race' ? match : null}
        matches={[]}
        palette={palette}
        players={[{ id: 'player-1', playerName: 'Player One', shirtNumber: 1 }]}
        user={{ id: 'coach-1', clubId: 'club-1', activeTeamId: 'team-1', roleRank: scenario === 'readonly' ? 20 : 30, hasActivePlanAccess: true }}
      />
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

  export const getCoachFormationPresets = async () => [{
    key: '11v11-4-4-2', gameFormat: '11v11', displayName: '4-4-2', slots,
  }]
  export const getCoachFormationPublications = async () => []
  export const getCoachFormationResourcePublications = async () => []
  export const linkCoachFormationBoard = async (user, currentBoard, matchId) => ({ ...currentBoard, linkedMatchDayId: matchId })
  export const publishCoachFormationBoard = async () => ({})
  export const publishCoachFormationResource = async () => ({})
  export const withdrawCoachFormationBoard = async () => ({})

  export const getCoachFormationBoards = async () => {
    const state = globalThis.__formationTest
    if (state.mode === 'race') {
      const call = ++state.boardCalls
      return new Promise(resolve => { state.boardResolvers[call] = resolve })
    }
    const call = ++state.boardCalls
    if (call === 2 && !state.refreshFailed) {
      state.refreshFailed = true
      throw new Error('refresh failed')
    }
    return state.serverBoard ? [state.serverBoard] : []
  }

  export const createCoachFormationBoard = async (user, match, draft, title) => {
    const state = globalThis.__formationTest
    state.createCalls += 1
    state.serverBoard = board('board-created', title || 'Created board')
    return state.serverBoard
  }

  export const saveCoachFormationBoard = async (user, currentBoard, draft, title) => {
    const state = globalThis.__formationTest
    state.saveCalls += 1
    state.serverBoard = {
      ...currentBoard,
      title: title || currentBoard.title,
      currentVersionId: 'board-created-v2',
      currentVersionNumber: 2,
      currentVersion: version('board-created-v2', 2, draft),
    }
    return state.serverBoard
  }
`

const offlineMock = `
  let stored = { resources: { formation: { pendingSave: null, localDrafts: {} } } }
  export const readCoachOfflineResources = async () => stored
  export const saveCoachOfflineResources = async (user, context, resources) => {
    if (window.__formationTest.mode === 'retry-no-storage') throw new Error('Device storage unavailable')
    stored = { resources: { ...stored.resources, ...resources } }
    return stored
  }
  export const saveCoachFormationLocalDraft = async (user, context, key, entry) => {
    if (window.__formationTest.mode === 'retry-no-storage') throw new Error('Device storage unavailable')
    const formation = stored.resources.formation || { pendingSave: null, localDrafts: {} }
    const localDrafts = { ...(formation.localDrafts || {}) }
    if (entry) localDrafts[key] = entry
    else delete localDrafts[key]
    stored = { resources: { ...stored.resources, formation: { ...formation, localDrafts } } }
    return stored
  }
`

const mocks = [
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

  if ((process.env.FORMATION_ASYNC_SCENARIO || 'race') === 'race') {
    await page.getByRole('button', { name: 'Switch to match B', exact: true }).click()
    await page.waitForFunction(() => window.__formationTest.boardCalls >= 2)
    await page.evaluate(() => window.__formationTest.boardResolvers[2]([{
      id: 'board-b', title: 'Board B', linkedMatchDayId: 'match-b', createdByProfileId: 'coach-1',
      currentVersionId: 'board-b-v1', currentVersionNumber: 1,
      currentVersion: { id: 'board-b-v1', versionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', placements: [], bench: [] },
    }]))
    await page.getByText('Board B', { exact: true }).waitFor()
    await page.evaluate(() => window.__formationTest.boardResolvers[1]([{
      id: 'board-a', title: 'Board A', linkedMatchDayId: 'match-a', createdByProfileId: 'coach-1',
      currentVersionId: 'board-a-v1', currentVersionNumber: 1,
      currentVersion: { id: 'board-a-v1', versionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', placements: [], bench: [] },
    }]))
    await page.waitForTimeout(80)
    assert.equal(await page.getByText('Board A', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Board B', { exact: true }).count(), 1)
    console.log('PASS: stale fixture load cannot overwrite the active match board')
  } else if (process.env.FORMATION_ASYNC_SCENARIO === 'readonly') {
    await page.getByText('Viewing only', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Add Player at Goalkeeper', exact: true }).isEnabled(), false)
    assert.equal(await page.getByRole('button', { name: 'Players', exact: true }).isEnabled(), false)
    assert.equal(await page.getByRole('button', { name: 'Formation', exact: true }).isEnabled(), false)
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Save Formation Board', exact: true }).isEnabled(), false)
    assert.equal(await page.evaluate(() => window.__formationTest.createCalls + window.__formationTest.saveCalls), 0)
    console.log('PASS: read-only staff can view the board but cannot edit or save')
  } else {
    await page.getByLabel('Formation pitch', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Confirm formation', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Add Player at Goalkeeper', exact: true }).click()
    await page.getByRole('button', { name: /#1 Player One.*Add/ }).click()
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    await page.getByRole('button', { name: 'Save Formation Board', exact: true }).click()
    await page.getByText(process.env.FORMATION_ASYNC_SCENARIO === 'retry-no-storage' ? /could not be saved on this device or confirmed online/ : /saved safely on this device/).waitFor()
    await page.getByRole('button', { name: 'Retry save', exact: true }).click()
    await page.waitForFunction(() => window.__formationTest.saveCalls === 1)
    assert.equal(await page.evaluate(() => window.__formationTest.createCalls), 1)
    assert.equal(await page.evaluate(() => window.__formationTest.saveCalls), 1)
    await page.getByText(/Formation Board saved to the team/).waitFor()
    console.log(`PASS: create success followed by refresh failure retries the existing board (${process.env.FORMATION_ASYNC_SCENARIO})`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
