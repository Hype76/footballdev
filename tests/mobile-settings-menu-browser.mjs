import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// Render the actual app functions and styles, with only native services and data replaced.
const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const out = 'output/playwright/settings-menu'
await mkdir(out, { recursive: true })
const virtual = {}
for (const app of ['parent', 'coach']) {
  const source = await readFile(`apps/${app}-mobile/App.js`, 'utf8')
  const functions = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.filter(node => node.type === 'FunctionDeclaration')
  const names = app === 'parent'
    ? ['SettingsScreen', 'ScreenIntro', 'InfoPanel', 'InfoRow', 'Badge', 'PrimaryAction', 'useParentTheme', 'createParentAppPalette', 'createParentAppStyles', 'labelize', 'formatDateTime', 'normalizeText']
    : ['SettingsScreen', 'ScreenIntro', 'Section', 'InfoRow', 'SettingRow', 'SecondaryAction', 'CoachIcon', 'useCoachTheme', 'createCoachThemeContext', 'createCoachStyles']
  const selected = names.map(name => {
    const node = functions.find(candidate => candidate.id.name === name)
    assert.ok(node, `Missing actual ${app} function ${name}`)
    return source.slice(node.start, node.end)
  }).join('\n')
  virtual[app] = `
    import React, {useState, useEffect, useContext, createContext} from 'react';
    import {View, Text, TextInput, Switch, Pressable, StyleSheet, Platform, Linking} from 'react-native';
    import MaterialIcons from '@expo/vector-icons/MaterialIcons';
    import ParentIcon from './apps/parent-mobile/src/ParentIcon.js';
    import {getMobileIconName} from './apps/mobile-core/src/mobileIconSystem.js';
    import {IconSettings, SettingsSection} from './apps/mobile-core/src/IconSettings.js';
    import {NotificationCategorySettings} from './apps/mobile-core/src/NotificationCategorySettings.js';
    import {MOBILE_SETTING_LOAD_STATES} from './apps/mobile-core/src/deviceSettingsCore.js';
    import {getParentNotificationStatusLabel} from './apps/mobile-core/src/parentNotificationsCore.js';
    import {getCoachNotificationStatusLabel} from './apps/mobile-core/src/coachNotificationsCore.js';
    import {formatParentProductDateTime} from './apps/mobile-core/src/parentDateTimeCore.js';
    import {createParentMobileTheme} from './apps/mobile-core/src/parentThemeCore.js';
    import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
    const Application={nativeApplicationVersion:'1.0.22',nativeBuildVersion:'44'}, Constants={};
    const config={isProduction:true,isUsable:true,buildProfile:'store-live'};
    const getBuildClassification=()=> 'Production build';
    const inspectCoachOfflineState=async()=>({hasDocument:true});
    const BrandLoader=()=> <Text>Loading...</Text>;
    ${app === 'coach' ? 'const formatDateTime=()=> "Today";' : ''}
    const ParentThemeContext=createContext(null), CoachThemeContext=createContext(null);
    ${selected}
    export default function Preview({mode, ...props}) {
      const theme=${app === 'parent' ? 'createParentMobileTheme({mode,selectedLink:{themeAccent:"#2ba7aa"}})' : 'createCoachTheme({mode,context:{clubAccent:"#2ba7aa"}})'};
      const value=${app === 'parent' ? '{palette:createParentAppPalette(theme.tokens),styles:createParentAppStyles(theme.tokens)}' : 'createCoachThemeContext(theme)'};
      const Provider=${app === 'parent' ? 'ParentThemeContext' : 'CoachThemeContext'}.Provider;
      return <Provider value={value}><View style={{backgroundColor:theme.tokens.background,minHeight:'100%',padding:16}}><SettingsScreen {...props}/></View></Provider>;
    }
  `
}
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {BackHandler} from 'react-native';
import Parent from 'preview:parent'; import Coach from 'preview:coach';
window.calls=[];window.reads=0;
let backHandler=null;
BackHandler.addEventListener=(event,handler)=>{backHandler=handler;return {remove(){if(backHandler===handler)backHandler=null}}};
window.hardwareBack=()=>backHandler?.()||false;
const record=name=>(...args)=>{window.calls.push({name,args});return Promise.resolve()};
function App(){
  const [app,setApp]=React.useState('parent'),[mode,setMode]=React.useState('dark'),[focus,setFocus]=React.useState(null),[overrides,setOverrides]=React.useState({});
  window.showApp=value=>{setApp(value);setOverrides({});setFocus(null)};window.setMode=setMode;
  window.openBell=()=>setFocus({id:Date.now()});window.override=setOverrides;
  const props={user:{id:'synthetic',displayName:'Alex',email:'alex@example.invalid'},context:{roleLabel:'Coach',teamName:'U17',clubName:'Demo FC'},
    appBadgeEnabled:true,biometricAvailable:true,biometricEnabled:true,biometricStateStatus:'ready',notificationStateStatus:'ready',
    cacheState:{source:'live'},syncSummary:{waiting:0,needsAttention:0},communicationPreference:{communicationChannel:'both'},
    notificationState:{enabled:true,registered:true,permissionGranted:true,preferenceEnabled:true,message:''},
    links:[{id:'child-one',playerName:'Demo Player',teamName:'U17'}],displayTheme:mode,themeMode:mode,
    notificationSettingsFocusRequest:focus,onNotificationSettingsFocus:()=>{setFocus(null);window.scrollTo(0,0)},
    onPasswordChange:record('password'),onDisplayNameChange:record('name'),onSignOut:record('signout'),
    onDisplayThemeChange:setMode,onToggleTheme:()=>setMode(mode==='dark'?'light':'dark'),
    onBiometricChange:record('biometric'),onToggleBiometrics:record('biometric'),onAppBadgeEnabledChange:record('badge'),onToggleAppBadge:record('badge'),
    onNotificationModeChange:record('push'),onCommunicationChannelChange:record('communication'),onRestoreDismissedItems:record('restore'),
    onRetryNotificationState:record('retry'),onRefreshNotificationState:record('retry'),onRetryBiometricState:record('retry'),onRefreshBiometricState:record('retry'),...overrides};
  return <div data-app={app} data-mode={mode}>{app==='parent'?<Parent key={app} mode={mode} {...props}/>:<Coach key={app} mode={mode} {...props}/>}</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic',
  loader: { '.js': 'jsx', '.ttf': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'],
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], nodePaths: [modules],
  alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' },
  plugins: [{ name: 'settings-preview', setup(builder) {
    builder.onResolve({ filter: /^preview:/ }, args => ({ path: args.path.slice(8), namespace: 'preview' }))
    builder.onLoad({ filter: /.*/, namespace: 'preview' }, args => ({ contents: virtual[args.path], loader: 'jsx', resolveDir: root }))
    builder.onResolve({ filter: /\/supabase$/ }, () => ({ path: 'supabase', namespace: 'mock' }))
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ loader: 'js', contents: `
      export const supabase={from(){window.reads++;return {select(){return this},eq(){return this},maybeSingle(){return {abortSignal:async()=>({data:null})}}}},
        rpc(name,args){return {abortSignal:async()=>{window.calls.push({name:'categories',args});return {data:{gameDay:'scores_cards',invites:true,chats:true,resources:true,[args.key_value]:args.value_json}}}}}};
    ` }))
  } }],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 740 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.route('http://localhost:9878/**', route => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>' }))
  await page.goto('http://localhost:9878')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const back = () => page.getByRole('button', { name: 'Back to Settings', exact: true }).click()
  const open = label => page.getByRole('button', { name: label, exact: true }).click()
  for (const app of ['parent', 'coach']) {
    await page.evaluate(app => window.showApp(app), app)
    await page.locator(`[data-app="${app}"]`).waitFor()
    const labels = app === 'parent' ? ['Account', 'Children', 'Display', 'Security', 'Email & app', 'Notifications', 'App info', 'Hidden items', 'Offline & sync'] : ['Account', 'Display', 'Security', 'Notifications', 'Offline & sync', 'App info']
    await page.getByRole('button', { name: 'Account', exact: true }).waitFor()
    assert.equal(await page.locator('input').count(), 0, 'No editable controls on the menu')
    const readsBeforeNavigation = await page.evaluate(() => window.reads)
    await open('Account')
    assert.equal(await page.evaluate(() => window.hardwareBack()), true, 'Android back returns to Settings')
    await page.getByRole('button', { name: 'Account', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.hardwareBack()), false, 'Menu releases Android back to app navigation')
    assert.equal(await page.evaluate(() => window.reads), readsBeforeNavigation, 'Notification preferences load only when opened')
    for (const width of [390, 320, 360]) {
      await page.setViewportSize({ width, height: 740 })
      for (const mode of ['dark', 'light']) {
        await page.evaluate(mode => window.setMode(mode), mode)
        await page.locator(`[data-mode="${mode}"]`).waitFor()
        await page.screenshot({ path: `${out}/${app}-${mode}-${width}.png`, fullPage: true })
        if (width === 390 && mode === 'dark') {
          const footer = await page.getByRole('button', { name: app === 'parent' ? 'Sign out' : 'Log out', exact: true }).boundingBox()
          await page.screenshot({ path: `${out}/${app}-preview.png`, clip: { x: 0, y: 0, width, height: Math.ceil(footer.y + footer.height + 16) } })
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow')
        assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'Menu fits one screen')
        for (const label of labels) {
          const box = await page.getByRole('button', { name: label, exact: true }).boundingBox()
          assert.ok(box.width >= 44 && box.height >= 44, 'Accessible tap target')
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 740 })
    await page.evaluate(() => window.setMode('dark'))
    const before = await page.evaluate(() => window.calls.length)
    for (const label of labels) {
      await open(label)
      await page.getByRole('button', { name: 'Back to Settings', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Account', exact: true }).count(), 0, 'Only selected section renders')
      await page.screenshot({ path: `${out}/${app}-${label.toLowerCase().replaceAll(/[^a-z]+/g, '-')}.png`, fullPage: true })
      await back()
      assert.equal(await page.locator('input').count(), 0)
    }
    assert.equal(await page.evaluate(() => window.calls.length), before, 'Navigation never mutates settings')
    await page.evaluate(() => window.openBell())
    await page.getByRole('radio', { name: 'Score and cards only', exact: true }).waitFor()
    await page.getByRole('radio', { name: 'Off', exact: true }).click()
    await page.getByText('Saved.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('switch', { name: 'Chats', exact: true }).isChecked(), true)
    await back()
    await page.evaluate(() => window.openBell())
    await page.getByRole('radio', { name: 'Off', exact: true }).waitFor()
    await back()
    if (app === 'parent') {
      await open('Security')
      await page.getByLabel('Current password', { exact: true }).fill('sample-current')
      await page.getByLabel('New password', { exact: true }).fill('sample-next-password')
      await open('Update password')
      assert.deepEqual(await page.evaluate(() => window.calls.find(call => call.name === 'password').args), ['sample-current', 'sample-next-password'])
      await page.getByLabel('Current password', { exact: true }).fill('draft-must-clear')
      await back(); await open('Security')
      assert.equal(await page.getByLabel('Current password', { exact: true }).inputValue(), '')
      await back(); await open('Account')
      await page.getByLabel('Display name', { exact: true }).fill('Updated Parent')
      await open('Update display name')
      assert.deepEqual(await page.evaluate(() => window.calls.find(call => call.name === 'name').args), ['Updated Parent'])
      await back()
    }
    await page.evaluate(() => window.override({ notificationStateStatus: 'error' }))
    await open('Notifications')
    await page.getByText(app === 'parent' ? /Notification status could not be read/ : /The latest check failed/).waitFor()
    await back()
    await open(app === 'parent' ? 'Sign out' : 'Log out')
    assert.ok(await page.evaluate(() => window.calls.some(call => call.name === 'signout')))
  }
  assert.deepEqual(errors, [])
  console.log('Actual Parent and Coach Settings: compact menus, every section, 320/360/390 widths, dark/light, tap targets, notification shortcut, independent alerts, password update/clearing, profile update, failure states and signout passed.')
} finally { await browser.close() }
