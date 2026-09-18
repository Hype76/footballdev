import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

if (!process.env.FORMATION_SCREEN_SCENARIO) {
  for (const scenario of ['stable', 'cache', 'scope', 'pending', 'failure', 'theme']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, FORMATION_SCREEN_SCENARIO: scenario },
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.status !== 0) process.exit(result.status || 1)
  }
  process.exit(0)
}

const rootDir = process.cwd()
const modules = path.join(rootDir, 'apps/coach-mobile/node_modules')
const scenario = process.env.FORMATION_SCREEN_SCENARIO

const entry = `
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { View } from 'react-native'
  import { CoachFormationWorkspace } from './apps/coach-mobile/src/CoachFormationWorkspace.js'
  import { CoachFormationScreen } from './apps/coach-mobile/src/CoachFormationScreen.js'

  const fallbackPalette = new Proxy({}, { get: () => '#123456' })
  window.__screenTest = { backCount: 0, boardMounts: 0, boardUnmounts: 0, resolvers: {}, resourceCalls: 0 }

  function App() {
    const [dark, setDark] = React.useState(false)
    window.__screenTest.setDark = setDark
    const palette = ${JSON.stringify(scenario)} === 'theme' ? { background: dark ? '#0b1110' : '#f5f8f6', textPrimary: dark ? '#f6fbf8' : '#101828', textSecondary: dark ? '#d7e3dc' : '#4b5f55', border: '#66766d', isDark: dark } : fallbackPalette
    const [revision, setRevision] = React.useState(0)
    const [scope, setScope] = React.useState('a')
    const [visible, setVisible] = React.useState(true)
    const closeWorkspace = React.useCallback(() => setVisible(false), [])
    const teamId = scope === 'a' ? 'team-a' : 'team-b'
    const userId = scope === 'a' ? 'coach-a' : 'coach-b'
    return <View>
      <button type="button" onClick={() => setRevision(value => value + 1)}>Equivalent refresh {revision}</button>
      <button type="button" onClick={() => setScope('b')}>Switch authority</button>
      {visible ? (${JSON.stringify(scenario)} === 'theme' ? <CoachFormationWorkspace initialPitchVisible={false} palette={palette} onBack={closeWorkspace}>
        {({ onPitchVisibilityChange, registerBackHandler }) => <CoachFormationScreen context={{ id: 'context-a', teamId }} user={{ id: userId, activeTeamId: teamId }} palette={palette} onBack={closeWorkspace} onPitchVisibilityChange={onPitchVisibilityChange} registerBackHandler={registerBackHandler} />}
      </CoachFormationWorkspace> : <CoachFormationScreen
        context={{ id: 'context-' + scope, authorityId: 'authority-' + scope, authoritySource: 'team_staff', clubId: 'club-1', teamId, role: 'coach', roleRank: 30, hasActivePlanAccess: true }}
        onBack={() => { window.__screenTest.backCount += 1; setVisible(false) }}
        palette={palette}
        user={{ id: userId, activeTeamId: teamId, clubId: 'club-1', role: 'coach', roleRank: 30, hasActivePlanAccess: true }}
      />) : <span>Formation closed</span>}
    </View>
  }

  createRoot(document.getElementById('root')).render(<App />)
`

const boardMock = `
  import React from 'react'
  export function CoachFormationBoard({ players, stale, onBack, registerBackHandler }) {
    const [edits, setEdits] = React.useState(0)
    React.useEffect(() => registerBackHandler?.(onBack), [registerBackHandler, onBack])
    React.useEffect(() => {
      window.__screenTest.boardMounts += 1
      return () => { window.__screenTest.boardUnmounts += 1 }
    }, [])
    return <div aria-label="Screen formation board">
      <span>{stale ? 'Cached screen data' : 'Live screen data'}</span>
      <span>{players[0]?.playerName || 'No player'}</span>
      <button disabled={stale} onClick={() => setEdits(value => value + 1)}>Local board edit {edits}</button>
    </div>
  }
`

const resourceMock = `
  const scenario = ${JSON.stringify(scenario)}
  const response = (user, key) => key === 'coach:match-list'
    ? [{ id: 'match-' + user.id, teamId: user.activeTeamId, teamName: 'Team', opponent: 'Opponent', matchDate: '2099-09-20', status: 'scheduled' }]
    : [{ id: 'player-' + user.id, playerName: 'Player ' + user.id }]
  export const readMobileResource = async (user, key) => {
    window.__screenTest.resourceCalls += 1
    if (scenario === 'stable' || scenario === 'theme') return response(user, key)
    if (scenario === 'failure') throw new Error('Formation resources unavailable')
    return new Promise(resolve => { window.__screenTest.resolvers[user.id + ':' + key] = () => resolve(response(user, key)) })
  }
`

const offlineMock = `
  const scenario = ${JSON.stringify(scenario)}
  export const readCoachOfflineResources = async () => scenario === 'cache' ? { resources: {
    matchDayList: [{ id: 'cached-match', teamId: 'team-a', teamName: 'Cached Team', opponent: 'Cached Opponent', matchDate: '2099-09-20', status: 'scheduled' }],
    matchDayPlayers: [{ id: 'cached-player', playerName: 'Cached Player' }],
  } } : null
  export const saveCoachOfflineResources = async () => null
`

const mocks = [
  [/^react-native-safe-area-context$/, "import React from 'react'; import { View } from 'react-native'; export const SafeAreaProvider = ({children}) => <View style={{flex:1}}>{children}</View>; export const SafeAreaView = ({style,...props}) => <View {...props} style={[style,{paddingTop:47,paddingBottom:34}]} />"],
  [/^\.\/CoachFormationBoard$/, boardMock],
  [/mobileResourceCache$/, resourceMock],
  [/^\.\/offline$/, offlineMock],
  [/coachMatchDayData$/, `export const getCoachMatchDayList = async () => []; export const normalizeCoachMatchDay = value => value`],
  [/coachPlayersData$/, `export const getCoachPlayerList = async () => []`],
  [/BrandLoader$/, `export const BrandLoader = () => null`],
  [/coachFriendlyErrors$/, `export const getCoachFriendlyError = error => error.message`],
]

const bundle = await build({
  stdin: { contents: entry, loader: 'jsx', resolveDir: rootDir },
  bundle: true,
  write: false,
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  alias: {
    react: path.join(modules, 'react'),
    'react-dom': path.join(modules, 'react-dom'),
    'react-native': path.join(modules, 'react-native-web'),
  },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  plugins: [{
    name: 'formation-screen-mocks',
    setup(builder) {
      for (const [index, [filter]] of mocks.entries()) builder.onResolve({ filter }, () => ({ namespace: 'mock', path: String(index) }))
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[Number(args.path)][1], loader: 'jsx', resolveDir: rootDir }))
    },
  }],
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<html><body><div id="root"></div></body></html>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })

  const chooseMatch = async (name) => {
    await page.getByText(name, { exact: true }).click()
  }

  if (scenario === 'theme') {
    const workspace = page.getByTestId('coach-formation-workspace')
    const background = () => workspace.evaluate(el => getComputedStyle(el).backgroundColor)
    const title = page.getByText('Choose a match', { exact: true })
    await title.waitFor()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="coach-formation-workspace"]')).backgroundColor === 'rgb(245, 248, 246)')
    assert.equal(await title.evaluate(el => getComputedStyle(el).color), 'rgb(16, 24, 40)')
    assert.equal(await page.getByText('Back', { exact: true }).evaluate(el => getComputedStyle(el).color), 'rgb(16, 24, 40)')
    await mkdir('outputs/formation-picker-theme', { recursive: true })
    await page.screenshot({ path: 'outputs/formation-picker-theme/light.png' })
    await chooseMatch('Team v Opponent')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="coach-formation-workspace"]')).backgroundColor === 'rgb(10, 108, 47)')
    await page.getByRole('button', { name: 'Close Formation Board', exact: true }).click()
    await title.waitFor()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="coach-formation-workspace"]')).backgroundColor === 'rgb(245, 248, 246)')
    assert.equal(await background(), 'rgb(245, 248, 246)')
    await page.evaluate(() => window.__screenTest.setDark(true))
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="coach-formation-workspace"]')).backgroundColor === 'rgb(11, 17, 16)')
    assert.equal(await title.evaluate(el => getComputedStyle(el).color), 'rgb(246, 251, 248)')
    await page.screenshot({ path: 'outputs/formation-picker-theme/dark.png' })
    console.log('PASS: match picker follows light/dark palette, board stays green, and Back restores picker colours')
  } else if (scenario === 'stable') {
    await chooseMatch('Team v Opponent')
    await page.getByText('Live screen data', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Local board edit 0', exact: true }).click()
    await page.getByRole('button', { name: 'Equivalent refresh 0', exact: true }).click()
    await page.getByRole('button', { name: 'Equivalent refresh 1', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Local board edit 1', exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => window.__screenTest.resourceCalls), 2)
    assert.equal(await page.evaluate(() => window.__screenTest.boardMounts), 1)
    assert.equal(await page.evaluate(() => window.__screenTest.boardUnmounts), 0)
    console.log('PASS: equivalent Screen props neither refetch nor remount the active board')
  } else if (scenario === 'cache') {
    await chooseMatch('Cached Team v Cached Opponent')
    await page.getByText('Cached screen data', { exact: true }).waitFor()
    assert.equal(await page.getByText('Cached Player', { exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Local board edit 0', exact: true }).isEnabled(), false)
    await page.evaluate(() => {
      window.__screenTest.resolvers['coach-a:coach:match-list']()
      window.__screenTest.resolvers['coach-a:coach:players']()
    })
    await chooseMatch('Team v Opponent')
    await page.getByText('Live screen data', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Local board edit 0', exact: true }).isEnabled(), true)
    console.log('PASS: Screen cache is visible and read-only while live resources are deferred')
  } else if (scenario === 'scope') {
    await page.waitForFunction(() => window.__screenTest.resourceCalls === 2)
    await page.getByRole('button', { name: 'Switch authority', exact: true }).click()
    await page.waitForFunction(() => window.__screenTest.resourceCalls === 4)
    await page.evaluate(() => {
      window.__screenTest.resolvers['coach-b:coach:match-list']()
      window.__screenTest.resolvers['coach-b:coach:players']()
    })
    await chooseMatch('Team v Opponent')
    await page.getByText('Player coach-b', { exact: true }).waitFor()
    await page.evaluate(() => {
      window.__screenTest.resolvers['coach-a:coach:match-list']()
      window.__screenTest.resolvers['coach-a:coach:players']()
    })
    await page.waitForTimeout(80)
    assert.equal(await page.getByText('Player coach-a', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Player coach-b', { exact: true }).count(), 1)
    console.log('PASS: Screen authority changes reload and stale resource results cannot leak')
  } else if (scenario === 'pending') {
    await page.getByText('Loading Formation Board...', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back from Formation Board', exact: true }).click()
    await page.getByText('Formation closed', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__screenTest.backCount), 1)
    console.log('PASS: Screen can leave while the first Formation resource load is pending')
  } else {
    await page.getByText('Formation resources unavailable', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back from Formation Board', exact: true }).click()
    await page.getByText('Formation closed', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__screenTest.backCount), 1)
    console.log('PASS: Screen can leave after the first Formation resource load fails')
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
