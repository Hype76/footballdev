import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// Real settings page, Display section, theme storage and ToastProvider.
// All account writes are deferred local fakes; no live service is contacted.
const source = await readFile('src/pages/UserSettingsPage.jsx', 'utf8')
const stubs = {
  '../lib/auth.js': `export const useAuth=()=>window.testAuth; export const isDemoAccount=u=>!!u?.demo; export const isParentPortalUser=()=>false; export const isClubAdmin=()=>false; export const canManageClubSettings=()=>false; export const canManageTeamSettings=()=>false;`,
  '../lib/supabase.js': `export const updateOwnThemeSettings=({authUser,user,mode})=>{if(!window.themeRepro && (!user || user.id!==authUser.id || user.role!=="coach")) throw new Error("Missing matching theme profile"); return new Promise((resolve,reject)=>window.requests.push({account:authUser.id,mode,resolve:()=>{window.server[authUser.id]=mode;sessionStorage.setItem("test-server",JSON.stringify(window.server));resolve({themeMode:mode})},reject:()=>reject(new Error('offline'))}));}; export const requestLoginEmailChange=()=>{}; export const requestPasswordReauthentication=()=>{}; export const updateClubDisplaySettings=()=>{}; export const updateOwnUserSettings=()=>{}; export const updateSignedInPassword=()=>{};`,
  '../lib/onboarding.js': `export const buildOnboardingPlan=()=>({steps:[]}); export const getOnboardingProgress=()=>({}); export const loadOnboardingSnapshot=async()=>({}); export const openOnboarding=()=>{};`,
  '../lib/supabase-client.js': 'export const supabase={};',
  '../lib/training-attendance-visibility.js': 'export const canChooseTrainingAttendanceVisibility=()=>false; export const getTrainingAttendanceVisibility=()=>{}; export const setTrainingAttendanceVisibility=()=>{};',
  '../lib/paywall-access.js': 'export const CAPABILITIES={};',
  '../lib/paywall-ui.js': 'export const canUseUiFeature=()=>false; export const createUiFeatureUnavailableMessage=()=>"";',
  '../lib/plans.js': 'export const canEditClubIdentity=()=>false;',
}
for (const match of source.matchAll(/import \{ (\w+) \} from '(\.\.\/components\/user-settings\/[^']+)'/g)) {
  if (match[1] !== 'DisplaySettingsSection') stubs[match[2]] = `export const ${match[1]}=()=>null;`
}
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom'; import {UserSettingsPage} from './src/pages/UserSettingsPage.jsx'; import {ToastProvider} from './src/components/ui/Toast.jsx';
window.themeRepro=${process.env.THEME_SAVE_REPRO === '1'}; window.requests=[]; window.server=JSON.parse(sessionStorage.getItem("test-server")||"{}"); window.updates=[];
const root=createRoot(document.getElementById('root'));
window.setAccount=(id,themeMode=window.server[id]||'system',demo=false)=>{window.testAuth={authUser:id?{id}:null,user:id?{id,themeMode,demo,role:'coach'}:null,updateCurrentUserDetails:p=>{window.updates.push({id,...p});window.testAuth.user={...window.testAuth.user,...p};window.renderApp()},resetPassword:()=>{}};window.renderApp()};
window.renderApp=()=>root.render(<React.StrictMode><ToastProvider><MemoryRouter initialEntries={['/user-settings?area=display']}><UserSettingsPage/></MemoryRouter></ToastProvider></React.StrictMode>);
window.unmount=()=>root.unmount(); window.setAccount('first');`
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-account-services', setup(b) {
  b.onResolve({ filter: /.*/ }, args => stubs[args.path] && args.importer.endsWith('UserSettingsPage.jsx') ? { path: args.path, namespace: 'fake' } : undefined)
  b.onLoad({ filter: /.*/, namespace: 'fake' }, args => ({ contents: stubs[args.path], loader: 'js' }))
} }] })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') console.error('Browser console:', m.text()) })
  page.on('pageerror', e => { errors.push(e.message); console.error('Browser error:', e.message) })
  await page.route('http://theme.test/**', r => r.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>` }))
  const open = async () => { await page.goto('http://theme.test'); await page.getByRole('combobox').waitFor({timeout:10000}).catch(async error=>{console.error(await page.locator('body').innerText());throw error}) }
  const choose = mode => page.getByRole('combobox').selectOption(mode)
  const requests = count => page.waitForFunction(n => window.requests.length === n, count)
  const complete = (index, fail = false) => page.evaluate(({index,fail}) => window.requests[index][fail ? 'reject' : 'resolve'](), {index,fail})
  const saved = () => page.getByText('Theme updated', { exact: true })
  const failed = () => page.getByText('Theme not saved', { exact: true })

  if (process.env.THEME_SAVE_REPRO === '1') {
    await open(); await choose('dark'); await requests(1)
    await saved().waitFor()
    await complete(0,true); await failed().waitFor()
    assert.equal(await saved().count(),1)
    assert.equal(await failed().count(),1)
    console.log('REPRODUCED on unmodified main: success appears before persistence, then success and error coexist after a rejected save.')
  } else {
  await open()
  assert.equal(await page.getByRole('combobox').inputValue(), 'system')
  await choose('dark'); await requests(1)
  assert.equal(await saved().count(), 0)
  await complete(0, true); await failed().waitFor()
  assert.equal(await saved().count(), 0)
  assert.equal(await page.evaluate(()=>localStorage.getItem('app-theme-mode')), 'dark')
  await mkdir('output/playwright/theme-save', {recursive:true})
  await page.screenshot({path:'output/playwright/theme-save/failed-save.png'})
  await choose('light'); await requests(2)
  assert.equal(await failed().count(), 0)
  await complete(1); await saved().waitFor()
  await choose('dark'); await requests(3)
  assert.equal(await saved().count(), 0)
  await complete(2, true); await failed().waitFor()
  assert.equal(await saved().count(), 0)

  for (const fail of [false, true]) {
    await open(); await choose('dark'); await requests(1)
    await choose('light'); await choose('system')
    assert.equal(await page.evaluate(()=>window.requests.length),1)
    await complete(0,fail); await requests(2)
    assert.equal(await page.evaluate(()=>window.requests[1].mode),'system')
    assert.equal(await saved().count()+await failed().count(),0)
    assert.deepEqual(await page.evaluate(()=>window.updates),[])
    await complete(1); await saved().waitFor()
    assert.deepEqual(await page.evaluate(()=>window.updates),[{id:'first',themeMode:'system'}])
    assert.equal(await page.evaluate(()=>window.server.first),'system')
  }

  for (const fail of [false,true]) {
    await open(); await choose('dark'); await requests(1)
    await page.evaluate(()=>window.setAccount('second','light'))
    await page.waitForFunction(()=>document.querySelector('select').value==='light')
    await complete(0,fail)
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)))
    assert.deepEqual(await page.evaluate(()=>window.updates),[])
    assert.equal(await saved().count()+await failed().count(),0)
    await choose('system'); await requests(2); await complete(1); await saved().waitFor()
    assert.deepEqual(await page.evaluate(()=>window.updates),[{id:'second',themeMode:'system'}])
    await page.evaluate(()=>window.setAccount(null))
    await page.waitForFunction(()=>!document.querySelector('select'))
    assert.equal(await saved().count(),0)
  }

  await open(); await choose('dark'); await requests(1)
  await page.evaluate(()=>window.unmount()); await complete(0)
  assert.deepEqual(await page.evaluate(()=>window.updates),[])
  await open(); await page.evaluate(()=>window.setAccount('demo','system',true))
  await choose('light'); await saved().waitFor()
  assert.equal(await page.evaluate(()=>window.requests.length),0)
  await page.getByText('Your display preference has been saved on this device.',{exact:true}).waitFor()
  for (const mode of ['light','dark','system']) {
    await open(); await choose(mode); await requests(1); await complete(0); await saved().waitFor()
    await open()
    assert.equal(await page.getByRole('combobox').inputValue(),mode)
    assert.equal(await page.evaluate(()=>localStorage.getItem('app-theme-mode')),mode)
  }
  assert.deepEqual(errors,[])
  console.log('PASS: actual settings/toasts: pending, failure, recovery, success then failure, rapid saves, stale success/error, server and local persistence, account switch, logout, unmount, demo and System default. No live writes.')
  }
} finally { await browser.close() }


