import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// Exercise the real Fans screen and hook; replace device services and network only.
const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const out = 'output/playwright/fans-mobile'
await mkdir(out, { recursive: true })
const app = await readFile('apps/parent-mobile/App.js', 'utf8')
const handler = app.slice(app.indexOf('  function handleChildChange('), app.indexOf('  async function handleOpenMessage('))
const sectionReset = app.match(/setMoreSection\(\(section\) => section === 'fans' \? section : ''\)/)?.[0]
assert.ok(sectionReset, 'Authority refresh preserves the Fans route')
assert.match(app, /selectedParentLinkId=\{selectedLink\?\.id\} onSelectedParentLinkChange=\{\(linkId\) => handleChildChange\(linkId, \{ stayOnFans: true \}\)\}/)
const mocks = {
  auth: `export const useMobileAuth=()=>({user:window.user,refreshUserProfile:async()=>window.remount(),signOut:async()=>{}});`,
  supabase: `export const getAccessToken=async()=> 'synthetic'; export const supabase={rpc:async(name,args)=>({data:await window.rpc(name,args)})};`,
  config: `export const getMobileRuntimeConfig=()=>({apiBaseUrl:'http://localhost:9877'});`,
  'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
  'expo-notifications': `export const useLastNotificationResponse=()=>null; export const requestPermissionsAsync=async()=>({status:'denied'}); export const getExpoPushTokenAsync=async()=>({data:'synthetic'});`,
  'expo-secure-store': `export const getItemAsync=async()=>null; export const deleteItemAsync=async()=>{}; export const setItemAsync=async()=>{};`,
  'expo-constants': `export default {};`,
  '@react-native-async-storage/async-storage': `export default {getItem:async()=>null};`,
  ParentPortalScreens: `export const ResourcesScreen=()=>null;`,
  'react-native-safe-area-context': `export {View as SafeAreaView} from 'react-native';`,
}
const entry = `
import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
import {Alert,AppState,Share} from 'react-native';
import {FansScreen} from './apps/parent-mobile/src/FansScreen.js';
window.user={id:'parent-test',parentPortalLinks:[{id:'first',playerName:'First Child',clubName:'Demo FC',themeAccent:'#2ba7aa'},{id:'second',playerName:'Second Child',clubName:'Demo FC',themeAccent:'#2ba7aa'}]};
window.calls=[];window.rows=[];window.saved='';window.alert=null;
window.rpc=async(name,args)=>{
  window.calls.push({name,args});
  if(name==='list_fan_connections')return window.rows.filter(r=>!r.deleted);
  if(name==='create_fan_invitation'){
    const row={id:crypto.randomUUID(),name:args.name_value,email:args.email_value,parent_link_id:args.parent_link_id_value,is_owner:true,status:'pending',permissions:args.permissions_value,invite_token:crypto.randomUUID(),expires_at:new Date(Date.now()+86400000).toISOString()};window.rows.push(row);return row;
  }
  if(name==='delete_cancelled_fan_invitation'){
    if(window.failDelete)throw Error('Could not delete. Try again.');
    const row=window.rows.find(r=>r.id===args.connection_id_value);if(row.status!=='cancelled')throw Error('Only cancelled');row.deleted=true;
  }
};
window.emailRequests=0;window.fetch=async()=>{window.emailRequests++;return {ok:true,status:200,json:async()=>({success:true})}};
Alert.alert=(title,message,buttons)=>{window.alert={title,message,buttons}};
let appListener;AppState.addEventListener=(_event,fn)=>{appListener=fn;return {remove(){appListener=null}}};window.background=()=>{appListener?.('background');appListener?.('active')};
Share.share=async()=>{window.background();return {action:'sharedAction'}};
function App(){
 const [selectedLinkId,setSelectedLinkId]=useState('first'),[activeTab,setActiveTab]=useState('more'),[moreSection,setMoreSection]=useState('fans'),[key,setKey]=useState(0),[mode,setMode]=useState('dark');
 const parentLinks=window.user.parentPortalLinks,selectedMobileUser=window.user;
 const saveParentOfflineSelection=async(_user,id)=>{window.saved=id};const setChildSwitcherOpen=()=>{};
 ${handler}
 useEffect(()=>{${sectionReset}},[selectedLinkId]);
 window.remount=()=>setKey(k=>k+1);window.mode=setMode;window.navigate=()=>{setMoreSection('fans');setActiveTab('more')};window.normalSwitch=id=>handleChildChange(id);
 return <div data-mode={mode} data-tab={activeTab} data-section={moreSection}><div data-testid="header">{parentLinks.find(p=>p.id===selectedLinkId)?.playerName}</div>{activeTab==='more'&&moreSection==='fans'?<FansScreen key={key} embedded themeMode={mode} selectedParentLinkId={selectedLinkId} onSelectedParentLinkChange={id=>handleChildChange(id,{stayOnFans:true})}/>:null}</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic',
  loader: { '.js': 'jsx', '.ttf': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'],
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], nodePaths: [modules],
  alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' },
  plugins: [{ name: 'fans-services', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const key = args.path.split('/').at(-1)
      if (mocks[args.path] || mocks[key]) return { path: mocks[args.path] ? args.path : key, namespace: 'mock' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }))
  } }],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://localhost:9877/**', route => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:system-ui,sans-serif"><div id="root"></div></body></html>' }))
  await page.goto('http://localhost:9877')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const button = name => page.getByRole('button', { name, exact: true })
  await button('Second Child').click()
  await button('Second Child (selected)').waitFor()
  assert.equal(await page.getByTestId('header').innerText(), 'Second Child')
  assert.equal(await page.evaluate(() => window.saved), 'second')
  for (const mode of ['dark', 'light']) {
    await page.evaluate(mode => window.mode(mode), mode)
    await page.locator(`[data-mode="${mode}"]`).waitFor()
    const box = await button('Invite a Fan').boundingBox()
    assert.ok(box.height >= 54 && box.width > 300)
    await page.screenshot({ path: `${out}/invite-${mode}.png`, fullPage: true })
  }
  for (const method of ['Email', 'QR code', 'Share link']) {
    await button('Invite a Fan').click()
    await page.getByLabel('Fan name', { exact: true }).fill(`${method} Fan`)
    await page.getByLabel('Fan email', { exact: true }).fill('test@example.test')
    await button(method).click()
    await page.getByText(/to follow Second Child/).waitFor()
    await button('Confirm invitation').click()
    await page.getByText(`${method} Fan`, { exact: true }).waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
    await page.evaluate(() => window.remount())
    await button('Second Child (selected)').waitFor()
    assert.equal(await page.getByTestId('header').innerText(), 'Second Child')
  }
  const creates = await page.evaluate(() => window.calls.filter(c => c.name === 'create_fan_invitation'))
  assert.equal(creates.length, 3)
  assert.equal(await page.evaluate(() => window.emailRequests), 1)
  assert.ok(creates.every(c => c.args.parent_link_id_value === 'second'))
  assert.equal(await button('Delete').count(), 0)
  await page.evaluate(() => { window.rows[0].status='cancelled'; window.rows[1].status='revoked'; window.remount() })
  await button('Delete').click()
  assert.match(await page.evaluate(() => window.alert.message), /Email Fan/)
  await page.evaluate(() => window.alert.buttons[0].onPress?.())
  assert.equal(await page.evaluate(() => window.calls.filter(c=>c.name==='delete_cancelled_fan_invitation').length), 0)
  await button('Delete').click()
  await page.evaluate(() => { window.failDelete=true; window.alert.buttons[1].onPress() })
  await page.getByRole('alert').getByText('Could not delete. Try again.').waitFor()
  await button('Delete').click()
  await page.evaluate(() => { window.failDelete=false; window.alert.buttons[1].onPress() })
  await page.getByText('Email Fan', { exact: true }).waitFor({ state: 'hidden' })
  await page.evaluate(() => window.remount())
  await page.getByText('QR code Fan', { exact: true }).waitFor()
  assert.equal(await button('Delete').count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: `${out}/after-delete.png`, fullPage: true })
  await page.evaluate(() => window.normalSwitch('first'))
  await page.locator('[data-tab="home"]').waitFor()
  await page.evaluate(() => window.navigate())
  await button('First Child (selected)').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: native Fans child/header sync, persisted selection, email/QR/share remount, prominent branded action, confirmed cancelled-only deletion, retry after failure, normal child navigation.')
} finally { await browser.close() }
