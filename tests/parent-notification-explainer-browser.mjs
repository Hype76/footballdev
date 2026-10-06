import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root=process.cwd(), modules=path.join(root,'apps/parent-mobile/node_modules')
const entry=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {NotificationExplainer} from './apps/parent-mobile/src/NotificationExplainer.js';
import {useFanAppLink} from './apps/parent-mobile/src/useFanAppLink.js';
window.initialLink=new Promise(resolve=>window.releaseInitialLink=resolve);window.urlListeners=[];
window.calls={setup:0,settings:0};window.nativeListeners=[];
window.phone={permissionGranted:false,permissionStatus:'undetermined',canAskAgain:true,visibleAlertsReady:false,enabled:false,registered:false};
window.communication={communicationChannel:'both'};window.categories={game_day:'scores_cards',invites:true};
window.emitState=state=>window.nativeListeners.forEach(fn=>fn(state));
const config={apiBaseUrl:'https://test.example',easProjectId:'mock'};
function App(){const fan=useFanAppLink();window.fanReady=fan.ready;window.fanRoute=fan.route;const [account,setAccount]=React.useState('one'),[child,setChild]=React.useState('child'),[ready,setReady]=React.useState(true),[settings,setSettings]=React.useState(false),[mode,setMode]=React.useState('dark');
Object.assign(window,{setAccount,setChild,setReady,setSettings,setMode});
const palette=mode==='dark'?{text:'#ffffff',border:'#455751',background:'#11221c'}:{text:'#132b22',border:'#acbeb4',background:'#ffffff'};
return <div style={{background:palette.background,minHeight:'100vh',padding:16,boxSizing:'border-box'}}><NotificationExplainer key={account+child} accountId={account} linkId={child} config={config} homeReady={ready && fan.ready && !fan.route} settingsOpen={settings} palette={palette} onState={React.useCallback(()=>{},[])}/></div>}
createRoot(document.getElementById('root')).render(<App/>);
`
const mocks={
  notifications:`export async function loadParentNotificationState(){if(window.failRead)throw Error('offline');return {...window.phone}};export async function enableParentNotifications(options){if(!options.isCurrent())throw Error('stale');window.calls.setup++;if(window.failSetup)throw Error('token/API');return window.phone={...window.phone,permissionGranted:!window.denyPrompt,visibleAlertsReady:!window.denyPrompt,permissionStatus:window.denyPrompt?'denied':'granted',registered:!window.denyPrompt,enabled:!window.denyPrompt}}`,
  communicationPreferences:`export async function getParentCommunicationPreference(){if(window.failRead)throw Error('offline');return window.communication}`,
  supabase:`export const supabase={from(){return {select(){return this},eq(){return this},maybeSingle(){return this},async abortSignal(){return {data:window.categories,error:window.failRead?Error('offline'):null}}}}}`,
  secure:`export async function getItemAsync(){return null};export async function setItemAsync(){};export async function deleteItemAsync(){}` ,
  storage:`export default {async getItem(key){return localStorage.getItem(key)},async setItem(key,value){localStorage.setItem(key,value)}}`,
  native:`export * from '${path.join(modules,'react-native-web/dist/index.js').replaceAll('\\','/')}';export const AppState={addEventListener(_,fn){window.nativeListeners.push(fn);return {remove(){window.nativeListeners=window.nativeListeners.filter(x=>x!==fn)}}}};export const Linking={getInitialURL:()=>window.initialLink,addEventListener(_,fn){window.urlListeners.push(fn);return {remove(){window.urlListeners=window.urlListeners.filter(x=>x!==fn)}}},async openSettings(){window.calls.settings++}}`,
}
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],
  nodePaths:[modules],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},
  plugins:[{name:'mock-native-and-account-services',setup(b){
    b.onResolve({filter:/^expo-secure-store$/},()=>({path:'secure',namespace:'fixture'}));
    b.onResolve({filter:/^(react-native|@react-native-async-storage\/async-storage)$/},args=>({path:args.path==='react-native'?'native':'storage',namespace:'fixture'}));
    b.onResolve({filter:/\/(notifications|communicationPreferences|supabase)$/},args=>({path:args.path.split('/').pop(),namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js',resolveDir:root}));
  }}],
})
await mkdir('output/playwright/parent-notification-explainer',{recursive:true})
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:320,height:740}}), errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>route.request().url().startsWith('http://localhost:9876')?route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>'}):route.abort())
  async function mount(){await page.goto('http://localhost:9876');await page.addScriptTag({content:result.outputFiles[0].text});await page.waitForFunction(()=>window.setReady);assert.equal(await button('Turn on').count(),0);await page.evaluate(()=>window.releaseInitialLink(null));await page.waitForFunction(()=>window.fanReady)}
  const button=name=>page.getByRole('button',{name,exact:true})
  await mount();await button('Turn on').waitFor()
  for(const mode of ['dark','light']){await page.evaluate(mode=>window.setMode(mode),mode);await page.screenshot({path:'output/playwright/parent-notification-explainer/'+mode+'.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=320),true)}
  await button('Not now').click();assert.deepEqual(await page.evaluate(()=>window.calls),{setup:0,settings:0})
  await page.evaluate(()=>window.setChild('another-child'));await page.waitForTimeout(80);assert.equal(await button('Turn on').count(),0)
  await mount();await page.waitForTimeout(80);assert.equal(await button('Turn on').count(),0)
  await page.evaluate(()=>window.setAccount('two'));await button('Turn on').waitFor()
  await page.evaluate(()=>window.setReady(false));assert.equal(await button('Turn on').count(),0)
  await page.evaluate(()=>window.setReady(true));await button('Turn on').waitFor();await button('Turn on').click();await page.waitForFunction(()=>window.calls.setup===1)
  await page.evaluate(()=>{window.phone={...window.phone,permissionGranted:false,visibleAlertsReady:false,permissionStatus:'denied',canAskAgain:false,registered:false,enabled:false};window.setAccount('blocked')});await button('Open phone settings').waitFor();await button('Open phone settings').click()
  assert.equal(await page.evaluate(()=>window.calls.settings),1)
  await page.evaluate(()=>{window.emitState('background');window.phone={...window.phone,permissionGranted:true,visibleAlertsReady:true};window.emitState('active')});await page.waitForFunction(()=>window.calls.setup===2)
  for(const [account,patch] of [['email',{communication:{communicationChannel:'email'}}],['category-off',{communication:{communicationChannel:'both'},categories:{game_day:'off',invites:true}}],['invites-off',{categories:{game_day:'full',invites:false}}],['paused',{categories:{game_day:'full',invites:true},phone:{permissionGranted:false,permissionStatus:'denied',registered:true,enabled:false}}],['offline',{failRead:true}]]) {
    await page.evaluate(([account,patch])=>{Object.assign(window,patch);window.setAccount(account)},[account,patch]);await page.waitForTimeout(100);assert.equal(await button('Turn on').count(),0);assert.equal(await button('Open phone settings').count(),0)
  }
  await page.evaluate(()=>{window.failRead=false;window.communication={communicationChannel:'both'};window.phone={permissionGranted:true,visibleAlertsReady:false,quietDelivery:true,permissionStatus:'provisional',registered:false,enabled:false};window.setAccount('quiet');window.setSettings(true)})
  await button('Open phone settings').waitFor();assert.equal(await button('Turn on').count(),0)
  await page.evaluate(()=>{window.phone={...window.phone,visibleAlertsReady:true,quietDelivery:false};window.setAccount('finish')});await button('Finish setup').waitFor()
  await page.evaluate(()=>{window.failSetup=true});await button('Finish setup').click();await page.getByText(/could not be completed/).waitFor()
  await mount();await page.evaluate(()=>{window.phone={permissionGranted:false,visibleAlertsReady:false,permissionStatus:'undetermined',canAskAgain:true};window.setAccount('invite-guard');window.setSettings(false);window.urlListeners.forEach(fn=>fn({url:'footballplayerparents://fan-invite/11111111-1111-4111-8111-111111111111'}))});await page.waitForTimeout(120);assert.equal(await button('Turn on').count(),0);
  assert.deepEqual(errors,[])
  console.log('Actual RN explainer browser: narrow light/dark, dismissal, account/child/login, suppressed readiness, explicit setup, Settings return, opt-outs, quiet delivery and setup failure passed. Native/network effects mocked and external requests blocked.')
}finally{await browser.close()}
