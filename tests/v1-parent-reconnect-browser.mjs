import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const source = (await readFile('apps/parent-mobile/App.js', 'utf8')).replaceAll('\r\n', '\n')
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from)
  return source.slice(from, to)
}
const code = `
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { isParentDefinitelyOffline } from './apps/parent-mobile/src/parentExperience.js'
const AppState = { currentState: 'active' }
const listeners = new Set()
const NetInfo = { addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
window.calls = []
let finishSync
const syncParentOfflineCommands = async (user) => {
  window.calls.push(['sync', user.id])
  await new Promise(resolve => { finishSync = resolve })
  return { attentionItems: [], needsAttention: 0, state: 'completed', waiting: 0 }
}
function App() {
  const [isOffline, setIsOffline] = useState(true)
  const [selectedMobileUser, setUser] = useState({ id: 'account-a' })
  const [selectedLink, setLink] = useState({ id: 'child-a' })
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncSummary, setSyncSummary] = useState(null)
  const loadParentData = useCallback(async () => { window.calls.push(['load', selectedMobileUser.id, selectedLink.id]) }, [selectedMobileUser, selectedLink])
  ${section('  const parentSyncScopeRef', '  const refreshParentMatchDay')}
  ${section('  const recoveryCallbacksRef', '  useEffect(() => {\n    const authorityScope').trim()}
  window.controls = {
    emit: (state) => listeners.forEach(fn => fn(state)),
    finish: () => finishSync?.(),
    recover: () => recoverParentConnection(),
    background: () => { AppState.currentState = 'background' },
    resume: () => { AppState.currentState = 'active'; void recoverParentConnection() },
    select: (account, child) => { setUser({id:account}); setLink({id:child}) },
    state: () => ({isOffline, isSyncing, syncSummary, listeners: listeners.size}),
  }
  return <div>{isOffline ? 'offline' : 'online'}</div>
}
const root = createRoot(document.getElementById('root'))
window.unmount = () => root.unmount()
root.render(<App />)
`
// Match Windows and Unix source line endings before slicing.
const normalizedCode = code.replaceAll('\r\n', '\n')
const result = await build({ stdin: { contents: normalizedCode, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife' })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/*', route => route.abort())
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.waitForFunction(() => window.controls?.state().listeners === 1)
  await page.evaluate(() => window.controls.emit({isConnected:true,isInternetReachable:false}))
  assert.equal(await page.evaluate(() => window.controls.state().isOffline), true)
  assert.equal(await page.evaluate(() => window.calls.length), 0)
  await page.evaluate(() => window.controls.emit({isConnected:true,isInternetReachable:null}))
  await page.waitForFunction(() => window.calls.length === 1)
  await page.evaluate(() => { window.controls.recover(); window.controls.recover() })
  assert.equal(await page.evaluate(() => window.calls.length), 1)
  await page.evaluate(() => window.controls.finish())
  await page.waitForFunction(() => window.calls.some(call => call[0] === 'load'))
  assert.deepEqual(await page.evaluate(() => window.calls), [['sync','account-a'],['load','account-a','child-a']])
  await page.evaluate(() => { window.calls = []; window.controls.emit({isConnected:false}) })
  await page.waitForFunction(() => window.controls.state().isOffline)
  await page.evaluate(() => window.controls.emit({isConnected:true,isInternetReachable:true}))
  await page.waitForFunction(() => window.calls.length === 1)
  await page.evaluate(() => window.controls.select('account-b','child-b'))
  await page.waitForTimeout(30)
  await page.evaluate(() => window.controls.finish())
  await page.waitForTimeout(30)
  assert.deepEqual(await page.evaluate(() => window.calls), [['sync','account-a']])
  await page.evaluate(() => { window.calls = []; window.controls.background(); window.controls.recover() })
  assert.equal(await page.evaluate(() => window.calls.length), 0)
  await page.evaluate(() => window.controls.resume())
  await page.waitForFunction(() => window.calls.length === 1)
  await page.evaluate(() => window.controls.emit({isConnected:false}))
  await page.waitForFunction(() => window.controls.state().isOffline)
  await page.evaluate(() => window.controls.emit({isConnected:true,isInternetReachable:true}))
  await page.waitForFunction(() => !window.controls.state().isOffline)
  assert.equal(await page.evaluate(() => window.calls.length), 1)
  await page.evaluate(() => window.controls.finish())
  await page.waitForFunction(() => window.calls.length === 2)
  assert.deepEqual(await page.evaluate(() => window.calls), [['sync','account-b'],['load','account-b','child-b']])
  assert.equal(await page.evaluate(() => window.controls.state().listeners), 1)
  await page.evaluate(() => window.unmount())
  assert.equal(await page.evaluate(() => window.controls.state().listeners), 0)
  console.log('PASS actual Parent recovery hooks: no internet, unknown reachability, reconnect, concurrent triggers, account/child change, background/resume, connection flapping and listener cleanup')
} finally { await browser.close() }
