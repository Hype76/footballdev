import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const source = await readFile('apps/coach-mobile/src/CoachPhase31EScreens.js', 'utf8')
const declarations = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
const components = ['formatCoachChatDateTime', 'phaseStyles', 'Button', 'ChatDomain'].map(name => {
  const declaration = declarations.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(declaration, name)
  return source.slice(declaration.start, declaration.end)
}).join('\n')
const entry = `
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { ClubFeatureWave } from './apps/mobile-core/src/ClubFeatureWave.js'
import { createCoachTheme } from './apps/coach-mobile/src/coachThemeCore.js'
import { formatParentProductDateTime } from './apps/mobile-core/src/parentDateTimeCore.js'
import { buildCoachChatRoomSections, getCoachChatRoomDisplay, getCoachChatModalTopInset } from './apps/mobile-core/src/coachPhase31ECore.js'
import { getMobileChatMessagesFingerprint } from './apps/mobile-core/src/mobileChatCore.js'
const config = { isProduction: true }
const SafeAreaView = View
const useSafeAreaInsets = () => ({ top: 44 })
const getCoachFriendlyError = error => error.message
const readMobileResource = (_user, _key, load) => load()
const getCoachParentChatUnread = async () => [{ id: 'closed-room', kind: 'parent', unreadCount: 1 }]
const getCoachChatMessages = async () => window.historyRows
const sendCoachChatMessage = async (_user, room, body) => {
  window.sent.push({ room: room.id, body })
  window.historyRows = [...window.historyRows, { id: 'sent', senderId: 'coach', senderName: 'Demo Coach', body, createdAt: '2026-11-17T10:00:00Z' }]
  return window.historyRows
}
const markCoachChatRead = async (_user, room) => { window.marked.push(room.id) }
const subscribeToCoachChatRoom = () => () => {}
const invalidateMobileResource = () => {}
const saveCoachOfflineResources = async () => {}
const readCoachOfflineResources = async () => ({ resources: {} })
const createCoachOfflineResourceSaver = () => async () => {}
const peekMobileResource = () => []
const load = async () => {}
const reloadHome = async () => {}
const user = { id: 'coach', activeCoachContextId: 'team' }
const context = { id: 'team' }
const data = {
  staff: [{ id: 'coach-room', title: 'Coach Chat', kind: 'staff', canPost: true }],
  parent: [
    { id: 'team-room', title: 'Demo Team Team Chat', kind: 'parent', type: 'team', teamName: 'Demo Team', unreadCount: 1, latestMessage: 'Hello', canPost: true },
    { id: 'parent-room', title: 'Chat with Coaches', kind: 'parent', type: 'parent_staff', teamName: 'Demo Team', playerName: 'Demo Player', latestMessage: 'Practice', canPost: true },
  ],
}
window.marked = []
window.sent = []
window.historyRows = [{ id: 'first', senderId: 'coach', senderName: 'Demo Coach', body: 'First message', createdAt: '2026-11-16T18:00:00Z' }]
COMPONENTS
function App() {
  const [mode, setMode] = useState('light')
  const [clubAccent, setAccent] = useState('#174d91')
  const [stale, setStale] = useState(false)
  const [notice, setNotice] = useState('')
  Object.assign(window, { setMode, setAccent, setStale })
  const palette = createCoachTheme({ context: { clubAccent }, mode }).tokens
  return <View style={{ minHeight: '100vh', backgroundColor: palette.background, padding: 12 }}>
    <ChatDomain user={user} context={context} data={data} load={load} reloadHome={reloadHome} palette={palette}
      styles={phaseStyles(palette)} stale={stale} placeholderColor={palette.textSecondary} notice={notice} setNotice={setNotice} />
  </View>
}
createRoot(document.getElementById('root')).render(<App />)
`.replace('COMPONENTS', components)
const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'jsx' },
  bundle: true,
  write: false,
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl', '.ttf': 'dataurl' },
  platform: 'browser',
  conditions: ['browser'],
  mainFields: ['browser', 'module', 'main'],
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  nodePaths: [modules],
  alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' },
})
const out = 'output/playwright/coach-chat-communities'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style><div id="root"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByText('3 community conversations.', { exact: true }).waitFor()
  const markAll = page.getByRole('button', { name: 'Mark all as read' })
  for (const [mode, width, accent] of [['light', 390, '#174d91'], ['dark', 320, '#9c3262']]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(({ mode, accent }) => { window.setMode(mode); window.setAccent(accent) }, { mode, accent })
    const expectedColour = accent.slice(1).match(/../g).map(part => parseInt(part, 16)).join(', ')
    await page.waitForFunction(expected => [...document.querySelectorAll('[role="button"]')].some(element =>
      element.getAttribute('aria-label') === 'Mark all as read' && getComputedStyle(element).backgroundColor === `rgb(${expected})`), expectedColour)
    await assertRenderedTextContrast(page, `Coach communities ${mode}`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${out}/communities-${mode}.png` })
  }
  await markAll.click()
  assert.deepEqual(await page.evaluate(() => window.marked), ['team-room', 'closed-room'])
  await page.getByRole('button', { name: /Demo Player.*Chat with Coaches/ }).click()
  await page.getByText('First message', { exact: true }).waitFor()
  const message = page.getByRole('textbox', { name: 'Chat message' })
  await message.fill('Synthetic reply')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByText('Synthetic reply', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.sent), [{ room: 'parent-room', body: 'Synthetic reply' }])
  await page.screenshot({ path: `${out}/open-thread.png` })
  await page.getByRole('button', { name: 'Back to conversations' }).click()
  await page.getByText('3 community conversations.', { exact: true }).waitFor()
  await page.evaluate(() => window.setStale(true))
  await page.waitForFunction(() => document.querySelector('[aria-label="Mark all as read"]')?.getAttribute('aria-disabled') === 'true')
  assert.equal(await markAll.isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log('PASS: Coach communities, club palette switch, phone widths and contrast, mark read, open, send and back with synthetic messages.')
} finally {
  await browser.close()
}
