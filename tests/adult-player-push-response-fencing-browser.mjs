import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const source = await readFile('apps/parent-mobile/App.js', 'utf8')
const start = source.indexOf('  useEffect(() => {\n    const request = lastNotificationResponse?.notification?.request\n    if (adultLink) {')
const end = source.indexOf("    if (request?.content?.data?.app === 'player')", start)
assert.ok(start >= 0 && end > start)
const effect = source.slice(start, end) + '    return undefined\n  }, [lastNotificationResponse, adultLink, user, playerNotificationRetry])'
const entry = `
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { adultPlayerNotificationScope, openAdultPlayerNotification, resolveAdultPlayerNotificationOpen } from './apps/parent-mobile/src/adultPlayerNotificationsCore.js'
const normalizeText = value => String(value || '')
const loadCurrentParentNotificationData = load => load()
const link = { id: 'link', clubId: 'club', teamId: 'team' }
function View({ response, account }) {
 const lastNotificationResponse = response, adultLink = link, user = { id: account }
 const currentAccountRef = useRef(account); currentAccountRef.current = account
 const playerPushScopeRef = useRef(''); playerPushScopeRef.current = adultPlayerNotificationScope(account, adultLink)
 const latestNotificationResponseRef = useRef(response); latestNotificationResponseRef.current = response
 const notificationResponseIdRef = useRef(''), notificationResponseHistoryRef = useRef(new Set()), notificationResponseProcessingRef = useRef('')
 const notificationResponseHistoryReady = true, playerNotificationRetry = 0
 const consumeLastNotificationResponse = (id, options) => window.consumed.push({ id, options })
 const applyParentNotificationDestination = target => window.navigated.push(target)
 const loadParentData = () => new Promise(resolve => { window.loads.push(resolve) })
 ${effect}
 return <div>Player view</div>
}
function App() {
 const [response, setResponse] = useState(null), [visible, setVisible] = useState(true), [account, setAccount] = useState('user')
 window.setResponse = setResponse; window.setVisible = setVisible; window.setAccount = setAccount
 return visible ? <View response={response} account={account} /> : <div>Parent view</div>
}
createRoot(document.getElementById('root')).render(<App />)
`
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic' })
const browser = await chromium.launch({ headless: true })
try {
 const page = await browser.newPage()
 await page.setContent('<div id="root"></div>')
 await page.evaluate(() => { window.loads = []; window.consumed = []; window.navigated = [] })
 await page.addScriptTag({ content: bundle.outputFiles[0].text })
 const response = (id, changes = {}) => ({ notification: { request: { identifier: id, content: { data: { app: 'player', userId: 'user', adultLinkId: 'link', clubId: 'club', teamId: 'team', route: 'chat', roomId: 'room', ...changes } } } } })
 const result = { failed: 0, items: { chatRooms: [{ id: 'room' }] } }
 await page.evaluate(value => window.setResponse(value), response('old'))
 await page.waitForFunction(() => window.loads.length === 1)
 await page.evaluate(value => window.setResponse(value), response('new', { app: 'parent' }))
 await page.evaluate(value => window.loads[0](value), result)
 await page.waitForTimeout(50)
 assert.deepEqual(await page.evaluate(() => [window.navigated, window.consumed]), [[], []])
 await page.evaluate(value => window.setResponse(value), response('first-player'))
 await page.waitForFunction(() => window.loads.length === 2)
 await page.evaluate(value => window.setResponse(value), response('second-player'))
 await page.waitForFunction(() => window.loads.length === 3)
 await page.evaluate(value => window.loads[1](value), result)
 await page.waitForTimeout(50)
 assert.deepEqual(await page.evaluate(() => [window.navigated, window.consumed]), [[], []])
 await page.evaluate(value => window.loads[2](value), result)
 await page.waitForFunction(() => window.consumed.length === 1)
 assert.deepEqual(await page.evaluate(() => window.consumed), [{ id: 'second-player', options: { clearResponse: false } }])
 await page.evaluate(() => { window.navigated = []; window.consumed = [] })
 await page.evaluate(value => window.setResponse(value), response('unmount'))
 await page.waitForFunction(() => window.loads.length === 4)
 await page.evaluate(() => window.setVisible(false))
 await page.getByText('Parent view').waitFor()
 await page.evaluate(value => window.loads[3](value), result)
 await page.waitForTimeout(50)
 assert.deepEqual(await page.evaluate(() => [window.navigated, window.consumed]), [[], []])
 await page.evaluate(() => { window.setResponse(null); window.setVisible(true) })
 await page.evaluate(value => window.setResponse(value), response('account'))
 await page.waitForFunction(() => window.loads.length === 5)
 await page.evaluate(() => window.setAccount('other'))
 await page.evaluate(value => window.loads[4](value), result)
 await page.waitForTimeout(50)
 assert.deepEqual(await page.evaluate(() => [window.navigated, window.consumed]), [[], []])
 await page.evaluate(() => { window.setAccount('user'); window.setResponse(null) })
 await page.evaluate(value => window.setResponse(value), response('valid'))
 await page.waitForFunction(() => window.loads.length === 6)
 await page.evaluate(value => window.loads[5](value), result)
 await page.waitForFunction(() => window.consumed.length === 1)
 assert.deepEqual(await page.evaluate(() => window.consumed), [{ id: 'valid', options: { clearResponse: false } }])
 assert.equal((await page.evaluate(() => window.navigated)).length, 1)
 console.log('PASS actual Player response effect fences overlapping responses, unmount and account changes')
} finally { await browser.close() }
