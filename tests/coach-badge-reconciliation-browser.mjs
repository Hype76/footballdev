import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const modules = path.resolve('apps/coach-mobile/node_modules')
const result = await build({
  stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { useCoachAppBadge } from './apps/mobile-core/src/useCoachAppBadge.js';
    function Preview(props) { useCoachAppBadge(props); return <div>Badge preview</div> }
    const root = createRoot(document.getElementById('root'));
    window.renderBadge = (count, route = 'home') => root.render(<Preview homeState={{unreadChat:count}} activeRoute={route} contextId="fp-test"/>);
    window.unmountBadge = () => root.unmount();
  ` },
  bundle: true, write: false, jsx: 'automatic', platform: 'browser',
  alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'device-adapters', setup(api) {
    api.onResolve({ filter: /^(react-native|expo-notifications|@react-native-async-storage\/async-storage)$/ }, args => ({ path: args.path, namespace: 'device' }))
    api.onLoad({ filter: /.*/, namespace: 'device' }, args => ({ contents: args.path === 'react-native'
      ? 'export const AppState={addEventListener:(name,fn)=>{window.resume=fn;return {remove:()=>window.resume=null}}};'
      : args.path === 'expo-notifications'
        ? 'export const setBadgeCountAsync=async count=>{window.badge=count;window.writes.push(count)};export const addNotificationReceivedListener=fn=>{window.received=fn;return {remove:()=>window.received=null}};'
        : 'export default {getItem:async()=>window.badgeEnabled?"enabled":"disabled"};' }))
  } }],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<div id="root"></div>')
  await page.evaluate(() => { window.badge = 1; window.writes = []; window.badgeEnabled = true })
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.evaluate(() => window.renderBadge(0))
  await page.waitForFunction(() => window.badge === 0 && window.received)
  // A background push changes only the OS badge, while the canonical count remains zero.
  await page.evaluate(() => { window.badge = 1; window.resume('active') })
  await page.waitForFunction(() => window.badge === 0)
  await page.evaluate(() => { window.badge = 1; window.received({request:{content:{data:{app:'coach',type:'availability'}}}}) })
  await page.waitForFunction(() => window.badge === 0)
  await page.evaluate(() => { window.badge = 1; window.renderBadge(0, 'notifications') })
  await page.waitForFunction(() => window.badge === 0)
  await page.evaluate(() => { window.badge = 1; window.renderBadge(0, 'notifications') })
  await page.waitForFunction(() => window.badge === 0)
  await page.evaluate(() => window.renderBadge(3))
  await page.waitForFunction(() => window.badge === 3)
  await page.evaluate(() => { window.badge = 1; window.resume('active') })
  await page.waitForFunction(() => window.badge === 3)
  await page.evaluate(() => { window.badgeEnabled = false; window.received({}) })
  await page.waitForFunction(() => window.badge === 0)
  await page.evaluate(() => window.unmountBadge())
  await page.waitForFunction(() => !window.resume && !window.received)
  assert.deepEqual(errors, [])
  const parentSources = await Promise.all(['apps/parent-mobile/App.js', 'apps/parent-mobile/src/FanContent.js', 'apps/parent-mobile/src/ParentPortalScreens.js'].map(file => readFile(file, 'utf8')))
  for (const source of parentSources) assert.doesNotMatch(source, /Apple Calendar|shareCalendarEvent|calendarExport/)
  assert.match(parentSources[2], /Google Calendar/)
  console.log('PASS: stale OS badges clear on resume, push, navigation and unchanged-count refresh; real unread chats remain, disabled preference respected, listeners cleaned up; Apple actions removed and Google retained.')
} finally { await browser.close() }
