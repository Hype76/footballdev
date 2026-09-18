import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const modules = path.join(rootDir, 'apps/coach-mobile/node_modules')
const outputDir = path.join(rootDir, 'outputs/coach-formation-fullscreen-workspace')
await mkdir(outputDir, { recursive: true })
const materialIconGlyphs = JSON.parse(await readFile(path.join(modules, '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json'), 'utf8'))
const materialIconFont = await readFile(path.join(modules, '@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf'))

const entry = `
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { Pressable, Text, View } from 'react-native'
  import { CoachFormationBoard } from './apps/coach-mobile/src/CoachFormationBoard.js'
  import { CoachFormationWorkspace } from './apps/coach-mobile/src/CoachFormationWorkspace.js'

  const palettes = {
    light: { accent: '#057a55', accentText: '#065f46', background: '#f5f8f6', border: '#d7e5dc', danger: '#b42318', selected: '#dcfce7', selectedForeground: '#052e16', surface: '#ffffff', surfaceRaised: '#edf4ef', textMuted: '#66766d', textPrimary: '#101828', textSecondary: '#4b5f55', warning: '#b54708' },
    dark: { accent: '#c7ff32', accentText: '#c7ff32', background: '#0b1110', border: '#466052', danger: '#fda29b', selected: '#233a1c', selectedForeground: '#f6fbf8', surface: '#14201c', surfaceRaised: '#192823', textMuted: '#9fb1a7', textPrimary: '#f6fbf8', textSecondary: '#d7e3dc', warning: '#fec84b' },
  }
  window.__workspaceTest = { backCount: 0, localDraftCalls: 0, navPresses: 0 }

  function App() {
    const [dark, setDark] = React.useState(false)
    const [visible, setVisible] = React.useState(true)
    const palette = dark ? palettes.dark : palettes.light
    const handleBack = React.useCallback(() => { window.__workspaceTest.backCount += 1; setVisible(false) }, [])
    window.__workspaceTest.setDark = setDark
    window.__workspaceTest.reopen = () => setVisible(true)
    return <View style={{ backgroundColor: palette.background, flex: 1, minHeight: '100vh' }}>
      <View testID="standard-coach-chrome">
        <Text>Standard Coach header</Text>
        <Pressable accessibilityLabel="Standard primary navigation" accessibilityRole="button" onPress={() => { window.__workspaceTest.navPresses += 1 }}><Text>Home Calendar Players Match Day More</Text></Pressable>
        <Pressable accessibilityLabel="Standard quick action" accessibilityRole="button" onPress={() => { window.__workspaceTest.navPresses += 1 }}><Text>Quick action</Text></Pressable>
      </View>
      {!visible ? <Text accessibilityRole="header">Returned to prior Match Day panel</Text> : null}
      {visible ? <CoachFormationWorkspace onBack={handleBack} palette={palette}>
        {({ onMarkerGestureEnd, onMarkerGestureStart, registerBackHandler }) => <CoachFormationBoard
          context={{ id: 'context-1', authorityId: 'authority-1', authoritySource: 'team_staff', clubId: 'club-1', teamId: 'team-1', role: 'coach', roleRank: 30, hasActivePlanAccess: true }}
          match={{ id: 'match-1', opponent: 'Visitors', teamName: 'Team' }}
          matches={[]}
          onBack={handleBack}
          onMarkerGestureEnd={onMarkerGestureEnd}
          onMarkerGestureStart={onMarkerGestureStart}
          palette={palette}
          players={Array.from({ length: 13 }, (_, index) => ({ id: 'player-' + (index + 1), playerName: 'Player ' + (index + 1), shirtNumber: index + 1 }))}
          registerBackHandler={registerBackHandler}
          stale={false}
          user={{ id: 'coach-1', clubId: 'club-1', activeTeamId: 'team-1', role: 'coach', roleRank: 30, hasActivePlanAccess: true }}
        />}
      </CoachFormationWorkspace> : null}
    </View>
  }

  createRoot(document.getElementById('root')).render(<App />)
`

const dataMock = `
  const slots = [
    ['goalkeeper', 'goalkeeper', 'Goalkeeper', 'GK', 50, 88],
    ['defender-1', 'defender', 'Left Back', 'LB', 15, 70],
    ['defender-2', 'defender', 'Centre Back', 'CB', 38, 70],
    ['defender-3', 'defender', 'Centre Back', 'CB', 62, 70],
    ['defender-4', 'defender', 'Right Back', 'RB', 85, 70],
    ['midfielder-1', 'midfielder', 'Left Midfield', 'LM', 15, 44],
    ['midfielder-2', 'midfielder', 'Centre Midfield', 'CM', 38, 44],
    ['midfielder-3', 'midfielder', 'Centre Midfield', 'CM', 62, 44],
    ['midfielder-4', 'midfielder', 'Right Midfield', 'RM', 85, 44],
    ['forward-1', 'forward', 'Forward', 'FWD', 35, 18],
    ['forward-2', 'forward', 'Forward', 'FWD', 65, 18],
  ].map(([id, group, label, shortLabel, x, y]) => ({ id, group, label, shortLabel, x, y }))
  const placements = slots.slice(0, 10).map((slot, index) => ({ playerId: 'player-' + (index + 1), displayName: 'Player ' + (index + 1), shirtNumber: index + 1, slotId: slot.id, positionGroup: slot.group, x: slot.x / 100, y: slot.y / 100 }))
  const bench = [12, 13].map(number => ({ playerId: 'player-' + number, displayName: 'Player ' + number, shirtNumber: number }))
  const board = { id: 'board-1', title: 'Match shape', linkedMatchDayId: 'match-1', createdByProfileId: 'coach-1', currentVersionId: 'board-v1', currentVersionNumber: 1, currentVersion: { id: 'board-v1', versionNumber: 1, gameFormat: '11v11', formationPresetKey: '11v11-4-4-2', presetRegistryVersion: 1, placements, bench } }
  export const getCoachFormationPresets = async () => [{ key: '11v11-4-4-2', gameFormat: '11v11', displayName: '4-4-2', slots }]
  export const getCoachFormationBoards = async () => [board]
  export const getCoachFormationPublications = async () => []
  export const getCoachFormationResourcePublications = async () => []
  export const saveCoachMatchFormationBoard = async () => board
  export const linkCoachFormationBoard = async () => board
  export const publishCoachFormationBoard = async () => ({})
  export const publishCoachFormationResource = async () => ({})
  export const withdrawCoachFormationBoard = async () => ({})
`

const offlineMock = `
  export const readCoachOfflineResources = async () => ({ resources: { formation: { pendingSave: null, localDrafts: {} } } })
  export const saveCoachOfflineResources = async () => ({})
  export const saveCoachFormationLocalDraft = async (user, context, key, entry) => {
    window.__workspaceTest.localDraftCalls += 1
    window.__workspaceTest.lastLocalDraft = entry
    return {}
  }
`

const mocks = [
  [/coachFormationBoardData$/, dataMock],
  [/^\.\/offline$/, offlineMock],
  [/^@expo\/vector-icons\/MaterialIcons$/, `import React from 'react'; import { Text } from 'react-native'; const glyphs = ${JSON.stringify(materialIconGlyphs)}; export default function MaterialIcons({ color, name, size = 24, style }) { return <Text aria-hidden="true" style={[{ color, fontFamily: 'MaterialIcons', fontSize: size }, style]}>{String.fromCodePoint(glyphs[name] || glyphs.help)}</Text> }`],
  [/^@react-native-async-storage\/async-storage$/, 'export default { getItem: async () => null, setItem: async () => {} }'],
  [/^react-native-safe-area-context$/, "import React from 'react'; import { View } from 'react-native'; export const SafeAreaProvider = ({children}) => <View style={{flex:1}}>{children}</View>; export const useSafeAreaInsets = () => ({ top: 47, right: 0, bottom: 34, left: 0 }); export function SafeAreaView({ style, ...props }) { return <View {...props} style={[style, { paddingTop: 47, paddingBottom: 34 }]} /> }"],
  [/BrandLoader$/, 'export const BrandLoader = () => null'],
  [/coachFriendlyErrors$/, 'export const getCoachFriendlyError = error => error.message'],
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
    name: 'formation-workspace-mocks',
    setup(builder) {
      for (const [index, [filter]] of mocks.entries()) builder.onResolve({ filter }, () => ({ path: String(index), namespace: 'mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[Number(args.path)][1], loader: 'jsx', resolveDir: rootDir }))
    },
  }],
})

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style></head><body><div id="root"></div></body></html>')
  await page.addStyleTag({ content: `@font-face { font-family: MaterialIcons; src: url(data:font/ttf;base64,${materialIconFont.toString('base64')}) }` })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })

  const workspace = page.getByTestId('coach-formation-workspace')
  const workspaceCanvas = page.getByTestId('coach-formation-workspace-canvas')
  await workspace.waitFor()
  await workspaceCanvas.waitFor()
  await page.getByLabel('Formation pitch', { exact: true }).waitFor()
  assert.equal(await page.getByText('Match shape', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Back from Formation Board', exact: true }).count(), 0)
  const pitchBox = await page.getByLabel('Formation pitch', { exact: true }).boundingBox()
  assert.ok(pitchBox.width >= 375, 'Pitch uses available screen width')
  await page.waitForFunction(() => {
    const header = document.querySelector('[data-testid="standard-coach-chrome"]')
    const rect = header?.getBoundingClientRect()
    if (!rect) return false
    return !header.contains(document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2)))
  })
  const workspaceBox = await workspace.boundingBox()
  assert.ok(workspaceBox)
  assert.equal(Math.round(workspaceBox.width), 393)
  assert.equal(Math.round(workspaceBox.height), 852)
  assert.equal(await page.evaluate(() => {
    const header = document.querySelector('[data-testid="standard-coach-chrome"]')
    const rect = header.getBoundingClientRect()
    return header.contains(document.elementFromPoint(rect.left + (rect.width / 2), rect.top + (rect.height / 2)))
  }), false)
  await assert.rejects(page.getByRole('button', { name: 'Standard primary navigation' }).click({ timeout: 800 }))
  assert.equal(await page.evaluate(() => window.__workspaceTest.navPresses), 0)

  const boardTools = page.getByLabel('Formation Board tools', { exact: true })
  for (const label of ['Formation', 'Players', 'Save']) {
    await boardTools.getByRole('button').filter({ hasText: label }).click()
    const dialogName = `${label === 'Save' ? 'share' : label.toLowerCase()} options`
    await page.getByRole('dialog', { name: dialogName, exact: true }).waitFor()
    if (label === 'Formation') {
      await page.getByLabel('Formation pitch', { exact: true }).click({ position: { x: 8, y: 8 } })
      assert.equal(await page.getByRole('dialog', { name: 'Choose Player', exact: true }).count(), 0, 'Modal backdrop isolates the pitch')
    }
    await page.getByRole('button', { name: 'Close options', exact: true }).click()
    await page.getByRole('dialog', { name: dialogName, exact: true }).waitFor({ state: 'detached' })
    await page.waitForTimeout(350)
  }
  const emptySlot = page.locator('[aria-label^="Add Player at "]').first()
  assert.ok(await emptySlot.count())
  await emptySlot.click()
  await page.getByRole('dialog', { name: 'Choose Player', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close Player picker', exact: true }).click()
  await page.getByRole('dialog', { name: 'Choose Player', exact: true }).waitFor({ state: 'detached' })
  await page.waitForTimeout(350)
  await emptySlot.click()
  await page.getByRole('button', { name: /#11 Player 11.*Add/ }).click()
  await page.getByRole('dialog', { name: 'Choose Player', exact: true }).waitFor({ state: 'detached' })
  await page.waitForTimeout(350)

  const marker = page.getByLabel(/Player 1, shirt 1/)
  const originalPosition = await marker.evaluate(element => ({ left: element.style.left, top: element.style.top }))
  const markerBox = await marker.boundingBox()
  assert.ok(markerBox)
  const gestureX = markerBox.x + markerBox.width / 2
  const gestureY = markerBox.y + markerBox.height / 2
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: gestureX, y: gestureY }] })
  await page.waitForTimeout(450)
  for (let step = 1; step <= 5; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: gestureX + (step * 6), y: gestureY - (step * 4) }] })
  }
  await page.waitForFunction(() => document.querySelector('[data-testid="coach-formation-workspace-canvas"]')?.dataset.markerGestureActive === 'true')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForFunction(() => document.querySelector('[data-testid="coach-formation-workspace-canvas"]')?.dataset.markerGestureActive === 'false')
  const movedMarkerBox = await marker.boundingBox()
  assert.ok(movedMarkerBox && Math.abs(movedMarkerBox.x - markerBox.x) > 4)
  await page.getByRole('button', { name: 'Undo last player move', exact: true }).click()
  const restoredPosition = await marker.evaluate(element => ({ left: element.style.left, top: element.style.top }))
  assert.deepEqual(restoredPosition, originalPosition, 'Undo restores the original player position')
  await page.getByRole('button', { name: /Expand substitutes/ }).click()
  await page.getByRole('button', { name: 'Player 12, shirt 12, substitute', exact: true }).click()
  await page.getByText('Player 12 selected. Tap a starter to swap.', { exact: true }).waitFor()

  await page.getByRole('button', { name: /Collapse substitutes/ }).click()
  const preHoldMarkerBox = await marker.boundingBox()
  const preHoldPosition = await marker.evaluate(element => ({ left: element.style.left, top: element.style.top }))
  const preHoldX = preHoldMarkerBox.x + preHoldMarkerBox.width / 2
  const preHoldY = preHoldMarkerBox.y + preHoldMarkerBox.height / 2
  assert.equal(await marker.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), { x: preHoldX, y: preHoldY }), true, 'Swipe starts on the exposed pitch shirt')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: preHoldX, y: preHoldY }] })
  for (let step = 1; step <= 5; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 2, x: preHoldX + step * 6, y: preHoldY - step * 8 }] })
    await page.waitForTimeout(20)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(400)
  assert.deepEqual(await marker.evaluate(element => ({ left: element.style.left, top: element.style.top })), preHoldPosition, 'Pre-hold pitch swipe must not move the player')
  assert.equal(await page.getByRole('dialog', { name: 'Choose Player', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Undo last player move', exact: true }).count(), 0)
  await page.getByRole('button', { name: /Expand substitutes/ }).click()
  await page.getByText('Player 12 selected. Tap a starter to swap.', { exact: true }).waitFor()

  const swipeBox = await page.getByRole('button', { name: 'Player 12, shirt 12, substitute', exact: true }).boundingBox()
  const sx = swipeBox.x + swipeBox.width / 2
  const sy = swipeBox.y + swipeBox.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 3, x: sx, y: sy }] })
  for (let step = 1; step <= 6; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 3, x: sx + step * 18, y: sy }] })
    await page.waitForTimeout(20)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(400)
  assert.deepEqual(await marker.evaluate(element => ({ left: element.style.left, top: element.style.top })), restoredPosition, 'Swiping a substitute must not move the pitch player')
  assert.equal(await page.getByRole('dialog', { name: 'Choose Player', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Undo last player move', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Player 12, shirt 12, substitute', exact: true }).count(), 1, 'Scrolling cannot swap the selected substitute')
  await page.getByText('Player 12 selected. Tap a starter to swap.', { exact: true }).waitFor()
  const backBox = await page.getByRole('button', { name: 'Close Formation Board', exact: true }).boundingBox()
  const toolsBox = await page.getByLabel('Formation Board tools', { exact: true }).boundingBox()
  assert.ok(backBox && backBox.y >= 47)
  assert.ok(toolsBox && toolsBox.y + toolsBox.height <= 852 - 34)

  await page.screenshot({ path: path.join(outputDir, 'coach-formation-workspace-light-393x852.png') })
  await page.evaluate(() => window.__workspaceTest.setDark(true))
  await page.setViewportSize({ width: 320, height: 568 })
  const compactBack = await page.getByRole('button', { name: 'Close Formation Board', exact: true }).boundingBox()
  const compactCanvas = await workspaceCanvas.boundingBox()
  assert.ok(compactBack && compactBack.y >= 47 && compactBack.y + compactBack.height <= 568 - 34)
  assert.ok(compactCanvas && compactCanvas.y >= 47 && compactCanvas.y + compactCanvas.height <= 568 - 34)
  await page.screenshot({ path: path.join(outputDir, 'coach-formation-workspace-dark-320x568.png') })
  await page.setViewportSize({ width: 852, height: 393 })
  const landscapeBack = await page.getByRole('button', { name: 'Close Formation Board', exact: true }).boundingBox()
  const landscapeCanvas = await workspaceCanvas.boundingBox()
  assert.ok(landscapeBack && landscapeBack.y >= 47 && landscapeBack.y + landscapeBack.height <= 393 - 34)
  assert.ok(landscapeCanvas && landscapeCanvas.y >= 47 && landscapeCanvas.y + landscapeCanvas.height <= 393 - 34)
  await page.screenshot({ path: path.join(outputDir, 'coach-formation-workspace-dark-landscape-852x393.png') })

  await page.getByRole('button', { name: 'Close Formation Board', exact: true }).click()
  await page.getByRole('heading', { name: 'Returned to prior Match Day panel', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__workspaceTest.backCount), 1)
  assert.ok(await page.evaluate(() => window.__workspaceTest.localDraftCalls >= 1))
  assert.deepEqual(errors, [])
  console.log('PASS: full-screen Formation workspace uses a fixed safe-area canvas, preserves touch safety, opens every tool, and returns safely')
} finally {
  await browser.close()
}
