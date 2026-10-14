import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root = process.cwd(), modules = path.join(root, 'apps/parent-mobile/node_modules')
const reminderSource = await readFile('apps/mobile-core/src/NotificationSetupReminder.js', 'utf8')
assert.match(reminderSource, /<ScrollView\b[^>]*keyboardShouldPersistTaps="handled"/, 'Native reminder actions remain tappable while the login keyboard dismisses')
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{View,Text,Platform}from'react-native';
import{NotificationSetupReminder}from'./apps/mobile-core/src/NotificationSetupReminder.js';
import{createCoachTheme}from'./apps/coach-mobile/src/coachThemeCore.js';
import{createParentMobileTheme}from'./apps/mobile-core/src/parentThemeCore.js';
window.saved=new Map();window.opens=0;window.writes=[];
function App(){const[role,setRole]=useState('coach'),[mode,setMode]=useState('light'),[user,setUser]=useState('first-user'),[status,setStatus]=useState('loading'),[offline,setOffline]=useState(false),[key,setKey]=useState(0),[enabled,setEnabled]=useState(false);window.role=setRole;window.mode=setMode;window.user=setUser;window.reminderStatus=setStatus;window.offline=setOffline;window.enabled=setEnabled;window.remount=()=>setKey(k=>k+1);window.platform=value=>{Platform.OS=value};
const palette=role==='coach'?createCoachTheme({mode}).tokens:createParentMobileTheme({mode}).tokens;
return <View style={{height:780,backgroundColor:palette.background}}><Text style={{color:palette.textPrimary}}>Signed-in app, rendered preview</Text><NotificationSetupReminder key={key} appRole={role} userId={user} status={status} offline={offline} state={{enabled,registered:enabled,permissionGranted:enabled,detailLevel:enabled?'minimal':'off'}} palette={palette} onOpenSettings={()=>window.opens++}/></View>}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], nodePaths: [modules], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' }, plugins: [{ name: 'device-storage-fixture', setup(b) { b.onResolve({ filter: /^expo-secure-store$/ }, () => ({ path: 'store', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY=7;export const getItemAsync=async key=>window.saved.get(key);export const setItemAsync=async(key,value)=>{window.saved.set(key,value);window.writes.push(key)}", loader: 'js' })) } }] })
const browser = await chromium.launch({ headless: true }), out = 'output/playwright/notification-reminder'
await mkdir(out, { recursive: true })
let cases = 0
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><main id="root"></main></body>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const title = page.getByText('Turn on notifications', { exact: true })
  await page.getByText('Signed-in app, rendered preview', { exact: true }).waitFor()
  assert.equal(await title.count(), 0, 'Unknown status does not prompt')
  for (const role of ['coach', 'parent']) for (const platform of ['ios', 'android']) for (const mode of ['light', 'dark']) for (const width of [320, 390]) {
    const user = `${role}-${platform}-${mode}-${width}`
    await page.setViewportSize({ width, height: 780 })
    await page.evaluate(({ role, platform, mode, user }) => { window.role(role); window.platform(platform); window.mode(mode); window.user(user); window.reminderStatus('ready'); window.enabled(false) }, { role, platform, mode, user })
    await title.waitFor()
    await page.waitForFunction(() => document.getAnimations().every(animation => ['finished', 'idle'].includes(animation.playState)))
    assert.equal(await page.evaluate(() => window.opens), 0, 'No automatic settings navigation or permission request')
    const settings = page.getByRole('button', { name: 'Open notification settings', exact: true }), later = page.getByRole('button', { name: 'Not now', exact: true })
    for (const control of [settings, later]) {
      const rect = await control.boundingBox()
      assert.ok(rect.width >= 44 && rect.height >= 44 && rect.x >= 0 && rect.x + rect.width <= width, 'Actions fit and remain accessible')
    }
    await assertRenderedTextContrast(page, `Notification reminder ${role} ${platform} ${mode}`)
    await page.screenshot({ path: `${out}/${role}-${platform}-${mode}-${width}.png`, animations: 'disabled' })
    await later.click(); await title.waitFor({ state: 'detached' })
    await page.evaluate(() => window.remount())
    await page.waitForTimeout(30)
    assert.equal(await title.count(), 0, 'Dismissal persists across another visit')
    cases += 1
  }
  await page.evaluate(() => window.user('settings-user'))
  await title.waitFor()
  await page.getByRole('button', { name: 'Open notification settings', exact: true }).click()
  await title.waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.opens), 1)
  await page.evaluate(() => { window.reminderStatus('error'); window.user('failed-status-user') })
  await page.waitForTimeout(30); assert.equal(await title.count(), 0)
  await page.evaluate(() => { window.reminderStatus('ready'); window.offline(true) })
  await page.waitForTimeout(30); assert.equal(await title.count(), 0)
  await page.evaluate(() => { window.enabled(true); window.offline(false); window.user('already-enabled-user') })
  await page.waitForTimeout(30); assert.equal(await title.count(), 0)
  assert.deepEqual(errors, [])
  console.log(`PASS ${cases} app/platform/theme/width cases: first-login guidance, no automatic permission/settings changes, accessible actions, persistent Not now, account isolation and existing settings handoff`)
} finally { await browser.close() }
