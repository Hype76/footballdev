import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const mocks = {
  biometrics: 'export const getBiometricEnabled=async()=>true; export const setBiometricEnabled=async()=>{}; export const authenticateWithBiometrics=async()=>{}',
  config: `export const getMobileRuntimeConfig=()=>({isUsable:true,isProduction:false,supabaseUrl:'https://ndohkecigwlwayghsopw.supabase.co'})`,
  notifications: 'export const revokeNativePushDevice=async()=>{}',
  profile: `export async function fetchMobileProfile(user) { window.profileCalls++; if(window.networkDown) throw new TypeError('Network request failed'); return {...window.profile,id:user.id} }`,
  supabase: `export const supabase={auth:window.mockAuth}; export const clearMobileSessionStorage=async()=>{}; export const getAccessToken=async()=>''; export const isSupabaseConfigured=true; export const mobileConfigError=''; export const mobileSessionStorageError=''; export const readSavedMobileSession=async()=>window.savedSession`,
  mobileResourceCache: 'export const mobileResourceCache={clear(){}}',
  data: 'export const markParentMessageRead=async()=>{}; export const submitParentPollVote=async()=>{}',
  '@react-native-async-storage/async-storage': `export default {
    async getItem(key){if(window.slowRead && key.endsWith('.active')) await new Promise(r=>setTimeout(r,1800));return window.storage[key]??null},
    async setItem(key,value){window.writes++;if(window.failWrites) throw Error('synthetic storage write unavailable');window.storage[key]=value},
    async removeItem(key){delete window.storage[key]}
  }`,
  'expo-secure-store': `export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY=1;
    export async function getItemAsync(key){return window.keys[key]??null}
    export async function setItemAsync(key,value){if(window.failWrites) throw Error('synthetic key write unavailable');window.keys[key]=value}
    export async function deleteItemAsync(key){delete window.keys[key]}`,
  'expo-crypto': `let seed=0;export async function getRandomBytesAsync(length){if(window.failWrites) throw Error('random unavailable during read');return Uint8Array.from({length},(_,i)=>(++seed+i)%256)};export const randomUUID=()=> 'synthetic-command'`,
}
const result = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AuthProvider,useMobileAuth} from './apps/mobile-core/src/auth.js';
    import {parentOfflineProfileStore,saveParentOfflineResources,saveParentOfflineSelection,readParentOfflineView} from './apps/parent-mobile/src/offline.js';
    function State(){window.authState=useMobileAuth();return <p>{window.authState.startupState}</p>}
    window.saveResources=saveParentOfflineResources;window.saveSelection=saveParentOfflineSelection;window.readView=readParentOfflineView;
    createRoot(document.getElementById('root')).render(<AuthProvider appRole="parent" offlineProfileStore={parentOfflineProfileStore}><State/></AuthProvider>)`, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' },
  alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web'), '@noble/ciphers': path.join(modules, '@noble/ciphers') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  plugins: [{ name: 'native-storage-fixtures', setup(b) {
    b.onResolve({filter: /.*/}, args => {
      const name = args.path.split('/').at(-1)
      const key = mocks[args.path] ? args.path : mocks[name] && /(?:auth|offline)\.js$/.test(args.importer) ? name : null
      return key ? {path:key,namespace:'fixture'} : undefined
    })
    b.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:mocks[args.path],loader:'js'}))
  }}],
})
const browser = await chromium.launch({headless:true})
async function open({storage={},keys={},networkDown=true,slowRead=false,failWrites=false,id='parent-one'}={}) {
  const page = await browser.newPage()
  await page.setContent('<div id="root"></div>')
  await page.evaluate(({storage,keys,networkDown,slowRead,failWrites,id})=>{
    Object.assign(window,{storage,keys,networkDown,slowRead,failWrites,writes:0,profileCalls:0})
    window.profile={role:'parent_portal',hasActivePlanAccess:true,selectedParentLinkId:'child-one',parentPortalLinks:[
      {id:'child-one',playerId:'player-one',linkType:'parent',clubId:'club',teamId:'team'},
      {id:'child-two',playerId:'player-two',linkType:'parent',clubId:'club',teamId:'team'},
      {id:'private-fan',playerId:'fan-player',linkType:'fan'},
    ]}
    window.savedSession={user:{id},expires_at:1,refresh_token:'synthetic-only'}
    window.mockAuth={startAutoRefresh(){},stopAutoRefresh(){},getSession(){throw Error('must use saved session offline')},
      onAuthStateChange(fn){window.authEvent=fn;return {data:{subscription:{unsubscribe(){}}}}}}
  },{storage,keys,networkDown,slowRead,failWrites,id})
  await page.addScriptTag({content:result.outputFiles[0].text})
  return page
}
try {
  const online=await open({networkDown:false})
  await online.waitForFunction(()=>window.authState?.startupState==='READY_SIGNED_IN')
  await online.evaluate(async()=>{
    const user=window.authState.user
    await window.saveResources(user,'child-two',{matches:[{id:'saved-fixture',opponent:'FP TEST'}],messages:[]})
    await window.saveSelection(user,'child-two')
  })
  const saved=await online.evaluate(()=>({storage:window.storage,keys:window.keys}))
  assert.ok(Object.keys(saved.storage).length>0,'Online login persists a real encrypted Parent cache')
  assert.ok(!JSON.stringify(saved.storage).includes('saved-fixture'),'Stored match data remains encrypted')
  await online.close()

  for(const options of [{failWrites:true},{slowRead:true}]) {
    const offline=await open({...saved,...options})
    await offline.waitForFunction(()=>window.authState?.startupState==='READY_SIGNED_IN')
    await offline.waitForFunction(()=>!window.authState.isProfileLoading)
    const state=await offline.evaluate(async()=>({
      state:window.authState.startupState,user:window.authState.user,locked:window.authState.isLocked,writes:window.writes,
      cache:await window.readView('parent-one','child-two'),
    }))
    assert.equal(state.user.id,'parent-one')
    assert.equal(state.user.isOfflineProfile,true)
    assert.equal(state.user.selectedParentLinkId,'child-two')
    assert.equal(state.user.selectedPlayerId,'player-two')
    assert.equal(state.user.parentPortalLinks.length,2,'Private Fan links stay excluded')
    assert.equal(state.locked,true,'Airplane mode does not bypass the biometric lock')
    assert.equal(state.writes,0,'Reading a saved profile must not require a write or fresh random bytes')
    assert.equal(state.cache.cache.resources.matches[0].id,'saved-fixture')
    await offline.evaluate(()=>{window.networkDown=false;window.failWrites=false;window.slowRead=false;window.authEvent('TOKEN_REFRESHED',window.savedSession)})
    await offline.waitForFunction(()=>window.authState?.user&&!window.authState.user.isOfflineProfile)
    await offline.evaluate(()=>window.authEvent('SIGNED_OUT',null))
    await offline.waitForFunction(()=>window.authState?.startupState==='READY_SIGNED_OUT'&&Object.keys(window.storage).length===0)
    assert.equal(await offline.evaluate(()=>window.authState.user),null)
    await offline.close()
  }
  for(const options of [{...saved,id:'different-parent'},{}]) {
    const missing=await open(options)
    await missing.waitForFunction(()=>window.authState?.startupState==='RECOVERABLE_ERROR')
    assert.equal(await missing.evaluate(()=>window.authState.user),null,'No access from another account or absent cache')
    await missing.close()
  }
  console.log('PASS: actual Parent offline adapter and AuthProvider restore an encrypted saved profile and fixtures in airplane mode with failed writes or slow storage, preserve selected child and biometrics, reconnect, sign out and reject other-account/missing caches.')
} finally {await browser.close()}
