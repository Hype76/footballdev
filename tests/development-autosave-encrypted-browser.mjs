import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const modules = path.resolve('apps/coach-mobile/node_modules')
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {DevelopmentOfflineEditor} from './apps/coach-mobile/src/DevelopmentOfflineEditor.js';
import {coachOfflineProfileStore,readCoachDevelopmentDrafts,saveCoachOfflineResources,clearCoachOfflineState} from './apps/coach-mobile/src/offline.js';
const context={id:'context',authorityId:'assignment',authoritySource:'team_staff',clubId:'club',teamId:'team',role:'coach',roleRank:30};
const user={id:'coach',clubId:'club',activeTeamId:'team',roleRank:30,coachContexts:[context]};
const form={id:'form',name:'Assessment',version:1,fields:[{id:'comments',label:'Overall comments',type:'textarea',options:[],roleRank:20}]};
window.nativeDelay=0;window.diskFailure=false;window.generationWrites=0;window.notifications=[];window.queuedEvents=[];
window.readDrafts=()=>readCoachDevelopmentDrafts(user.id,context);window.clear=()=>clearCoachOfflineState();
const styles={panel:{padding:12,gap:8},heading:{fontSize:20},label:{fontSize:16},body:{fontSize:14},input:{borderWidth:1,minHeight:48,padding:8},secondary:{minHeight:48,padding:8},secondaryText:{color:'#123'},row:{gap:8},helper:{fontSize:12}};
function App(){const [player,setPlayer]=React.useState('one'),[visible,setVisible]=React.useState(true);window.player=setPlayer;window.visible=setVisible;return visible?<DevelopmentOfflineEditor key={player} context={context} form={form} player={{id:player}} styles={styles} user={user} stale={true} onQueued={event=>window.queuedEvents.push(event)}/>:<div>Closed editor</div>}
await coachOfflineProfileStore.read(user.id);
if(!(await coachOfflineProfileStore.read(user.id)))await coachOfflineProfileStore.write(user);
await saveCoachOfflineResources(user.id,context,{home:{summary:'x'.repeat(100000)}});
createRoot(document.getElementById('root')).render(<App/>);window.ready=true;`
const native = `
const pause=()=>new Promise(resolve=>setTimeout(resolve,window.nativeDelay));
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY='after-unlock';
export async function getItemAsync(key){await pause();return localStorage.getItem(key)}
export async function setItemAsync(key,value){await pause();localStorage.setItem(key,value)}
export async function deleteItemAsync(key){await pause();localStorage.removeItem(key)}
export async function getRandomBytesAsync(length){return crypto.getRandomValues(new Uint8Array(length))}
export const randomUUID=()=>crypto.randomUUID();
export default {async getItem(key){await pause();return localStorage.getItem(key)},async setItem(key,value){await pause();if(window.diskFailure&&key.includes('.g.'))throw Error('Synthetic disk failure');if(key.includes('.g.'))window.generationWrites++;localStorage.setItem(key,value)},async removeItem(key){await pause();localStorage.removeItem(key)}};`
const mocks = [
  [/^@react-native-async-storage\/async-storage$|^expo-crypto$|^expo-secure-store$/, native],
  [/\/config$/, `export const getMobileRuntimeConfig=()=>({isUsable:true,isProduction:false,supabaseUrl:'https://ndohkecigwlwayghsopw.supabase.co'});`],
  [/coachDevelopmentSync$/, `const listeners=new Set();export const subscribeDevelopmentSync=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};export const notifyDevelopmentSync=event=>{window.notifications.push(event);listeners.forEach(listener=>listener(event))};export const syncCoachDevelopmentDrafts=async()=>{};`],
]
const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, format: 'esm', write: false, jsx: 'automatic', loader: { '.js': 'jsx' }, nodePaths: [modules], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, plugins: [{ name: 'healthy-slow-native', setup(builder) { mocks.forEach(([filter], index) => builder.onResolve({ filter }, () => ({ path: String(index), namespace: 'mock' }))); builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[Number(args.path)][1], loader: 'js', resolveDir: process.cwd() })) } }] })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 392, height: 850 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://localhost:9883/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  const mount = async () => { await page.goto('http://localhost:9883/'); await page.addScriptTag({ content: result.outputFiles[0].text, type: 'module' }); await page.waitForFunction(() => window.ready); await page.getByLabel('Overall comments', { exact: true }).waitFor() }
  await mount()
  await page.evaluate(() => { window.nativeDelay = 70; window.generationWrites = 0; window.notifications = [] })
  const started = Date.now()
  await page.getByLabel('Overall comments', { exact: true }).pressSequentially('abcdefghijklmnop', { delay: 30 })
  await page.getByText('Saving on this phone...', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save private draft', exact: true }).isEnabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Finalise and share', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Save private draft', exact: true }).click()
  await page.waitForFunction(() => window.queuedEvents.length === 1)
  const savedMs = Date.now() - started
  assert.ok(savedMs < 8000, 'Sixteen healthy slow-native edits acknowledge the latest input within the original timeout')
  const writes = await page.evaluate(() => window.generationWrites)
  assert.ok(writes <= 2, 'Sixteen keystrokes produce at most two complete encrypted writes')
  assert.equal(await page.evaluate(() => window.notifications.length), 1, 'Only the latest durable snapshot schedules sync')
  assert.equal(await page.getByText(/Phone storage is taking too long/).count(), 0)
  const drafts = await page.evaluate(() => window.readDrafts())
  const saved = Object.values(drafts).find(draft => draft.playerId === 'one')
  assert.equal(saved.values.comments, 'abcdefghijklmnop')
  assert.equal(Object.keys(drafts).length, 1)
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('.g.')).every(key => !localStorage.getItem(key).includes('abcdefghijklmnop'))), true)

  // Switch away and back before the final pending write is admitted. Hydration
  // must wait for this scope's complete drain, rather than read the first edit.
  await page.getByLabel('Coach summary note', { exact: true }).pressSequentially('pending player note', { delay: 10 })
  await page.evaluate(() => window.player('two'))
  await page.getByLabel('Overall comments', { exact: true }).waitFor()
  await page.evaluate(() => window.player('one'))
  await page.waitForFunction(() => document.querySelector('[aria-label="Coach summary note"]')?.value === 'pending player note')
  await page.getByText('Saved on this phone. Waiting to sync.', { exact: true }).waitFor()
  await mount()
  assert.equal(await page.getByLabel('Coach summary note', { exact: true }).inputValue(), 'pending player note')
  assert.equal(await page.getByLabel('Overall comments', { exact: true }).inputValue(), 'abcdefghijklmnop')

  await page.evaluate(() => { window.diskFailure = true; window.nativeDelay = 20 })
  await page.getByLabel('Coach summary note', { exact: true }).fill('Newest input survives disk failure')
  await page.getByText('Some changes have not been saved. Keep this screen open and retry Save private draft.', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Coach summary note', { exact: true }).inputValue(), 'Newest input survives disk failure')
  assert.equal(await page.getByRole('button', { name: 'Finalise and share', exact: true }).isDisabled(), true)
  await page.evaluate(() => { window.diskFailure = false })
  await page.getByRole('button', { name: 'Save private draft', exact: true }).click()
  await page.getByText('Saved on this phone. Waiting to sync.', { exact: true }).waitFor()
  await mount()
  assert.equal(await page.getByLabel('Coach summary note', { exact: true }).inputValue(), 'Newest input survives disk failure')
  assert.equal(Object.keys(await page.evaluate(() => window.readDrafts())).length, 1)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ healthyNativeCallMs: 70, edits: 16, encryptedWrites: writes, newestSaveAcknowledgementMs: savedMs, coldReload: 'PASS', pendingPlayerSwitch: 'PASS', diskFailureRetry: 'PASS', duplicateDrafts: 0 }))
} finally { await browser.close() }
