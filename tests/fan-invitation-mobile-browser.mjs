import assert from 'node:assert/strict'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// Exercise the real Fans screen and hook; replace device services and network only.
const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const out = 'output/playwright/fan-invitation-mobile'
await mkdir(out, { recursive: true })
const mocks = {
  auth: `export const useMobileAuth=()=>({user:window.user,refreshUserProfile:async()=>window.remount(),signOut:async()=>{if(window.failSignOut)throw Error('Could not sign out. Try again.');window.signedOut=(window.signedOut||0)+1}});`,
  supabase: `export const getAccessToken=async()=> 'synthetic'; export const supabase={rpc:async(name,args)=>({data:await window.rpc(name,args)}),from:()=>{window.directKitReads=(window.directKitReads||0)+1;throw Error('Fan has no direct club access')},storage:{from:()=>({getPublicUrl:key=>({data:{publicUrl:'http://localhost:9877/kits/'+key}})})}};`,
  config: `export const getMobileRuntimeConfig=()=>({apiBaseUrl:'http://localhost:9877'});`,
  'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
  'expo-notifications': `export const useLastNotificationResponse=()=>null; export const requestPermissionsAsync=async()=>({status:'denied'}); export const getExpoPushTokenAsync=async()=>({data:'synthetic'});`,
  'expo-secure-store': `export const getItemAsync=async()=>null; export const deleteItemAsync=async()=>{}; export const setItemAsync=async()=>{};`,
  'expo-constants': `export default {};`,
  '@react-native-async-storage/async-storage': `export default {getItem:async()=>null,setItem:async()=>{}};`,
  'expo-keep-awake': `export const activateKeepAwakeAsync=async()=>{},deactivateKeepAwake=()=>{},isAvailableAsync=async()=>false;`,
  'expo-file-system/legacy': `export const cacheDirectory='',downloadAsync=async()=>({}),deleteAsync=async()=>{};`,
  'expo-sharing': `export const isAvailableAsync=async()=>false,shareAsync=async()=>{};`,
  'react-native-safe-area-context': `import React from 'react';import {View} from 'react-native';export const SafeAreaView=({children,style})=><View style={[style,{paddingTop:59,height:844}]}>{children}</View>;`,
}
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Linking} from 'react-native';import {FanInvitationScreen} from './apps/parent-mobile/src/FanInvitationScreen.js';
window.calls=[];window.signedIn=0;window.closed=0;window.accepted=0;window.refreshed=0;window.rpc=async(name,args)=>{window.calls.push({name,args});if(window.delay){await new Promise(resolve=>window.finish=resolve)}if(window.fail)throw Error('Invite failed');return name==='get_fan_invitation_branding'?{club_name:'Demo FC'}:{club_name:'Demo FC',player_name:'Private Player',permissions:{game_day:true}}};Linking.openURL=async url=>{window.opened=url};
function App(){const [token,setToken]=useState('one'),[session,setSession]=useState(null);window.actor=setSession;window.token=setToken;window.remount=async()=>{window.refreshed++};return <FanInvitationScreen token={token} session={session} onSignIn={()=>window.signedIn++} onClose={()=>window.closed++} onAccepted={()=>window.accepted++}/>};createRoot(document.getElementById('root')).render(<App/>);
`

const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic',
  loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'],
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
const browser = await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:320,height:720}})
 await page.route('http://localhost:9877/**',r=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><div id="root"></div></body></html>'}))
 await page.goto('http://localhost:9877');await page.addScriptTag({content:result.outputFiles[0].text})
 const button=name=>page.getByRole('button',{name,exact:true})
 await page.getByText('Demo FC',{exact:true}).waitFor()
 assert.equal(await page.getByText('Private Player',{exact:true}).count(),0)
 assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.name)),['get_fan_invitation_branding'])
 await button('Sign in').click();assert.equal(await page.evaluate(()=>window.signedIn),1)
 await button('Create account on website').click();await page.waitForFunction(()=>window.opened);assert.equal(await page.evaluate(()=>window.opened),'https://parent.footballplayer.online/fan-invite/one?continue=web')
 await page.evaluate(()=>window.actor({user:{id:'a',email:'a@example.test'}}))
 await page.getByText('Follow Private Player',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='accept_fan_invitation').length),0)
 await page.evaluate(()=>window.fail=true);await button('Accept invitation').click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.accepted),0)
 await page.evaluate(()=>{window.fail=false;window.delay=true});await button('Accept invitation').click();await button('Accepting invitation...').waitFor();assert.equal(await button('Accepting invitation...').isDisabled(),true)
 await page.evaluate(()=>{window.delay=false;window.finish()});await page.waitForFunction(()=>window.accepted===1);assert.equal(await page.evaluate(()=>window.refreshed),1)
 await page.evaluate(()=>{window.delay=true;window.token('old')});await page.getByText('Loading invitation...').waitFor()
 await page.evaluate(()=>{window.delay=false;window.actor(null)});await button('Sign in').waitFor();await page.evaluate(()=>window.finish());assert.equal(await page.getByText('Follow Private Player',{exact:true}).count(),0)
 await assertRenderedTextContrast(page,'Native invitation320')
 await page.screenshot({path:out+'/invitation-signed-out-320.png',fullPage:true})
 console.log('PASS native Fan invitation: anonymous branding only, exact token handoff, explicit acceptance, error retry, busy state, stale account response discarded')
} finally {await browser.close()}
