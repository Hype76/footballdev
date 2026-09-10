import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root,'apps/coach-mobile/node_modules')
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {NotificationCategorySettings} from './apps/mobile-core/src/NotificationCategorySettings.js';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {getMobileIconName} from './apps/mobile-core/src/mobileIconSystem.js';
import {createParentMobileTheme} from './apps/mobile-core/src/parentThemeCore.js';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {normalizeNotificationCategories} from './apps/mobile-core/src/notificationCategories.js';
window.online=true;window.failSave=false;window.failRead=false;window.calls=[];
const read=(app,user)=>JSON.parse(localStorage.getItem(app+user)||'null');
const client={from(){let app,user=window.actor;return {select(){return this},eq(key,value){if(key==='app')app=value;else user=value;return this},maybeSingle(){return {async abortSignal(){if(!window.online||window.failRead)throw Error('offline');const row=read(app,user);return {data:row?{...row,game_day:row.gameDay}:null}}}}}},
rpc(name,args){return {async abortSignal(){window.calls.push(args);await new Promise(r=>setTimeout(r,60));if(!window.online||window.failSave)throw Error('offline');const next={...normalizeNotificationCategories(read(args.app_value,window.actor)),[args.key_value]:args.value_json};localStorage.setItem(args.app_value+window.actor,JSON.stringify(next));return {data:next}}}}};
function Icon({iconKey,name,...rest}){return <MaterialIcons name={name||getMobileIconName(iconKey)} {...rest}/>}
function App(){const [app,setApp]=React.useState('coach'),[mode,setMode]=React.useState('dark'),[user,setUser]=React.useState('one');window.actor=user;window.showApp=setApp;window.setMode=setMode;window.switchUser=setUser;
const tokens=(app==='parent'?createParentMobileTheme({mode}):createCoachTheme({mode})).tokens;const palette=app==='parent'?{...tokens,text:tokens.textPrimary,textMuted:tokens.textSecondary,accent:tokens.buttonPrimary}:tokens;return <div style={{padding:16,background:palette.background,minHeight:'100vh',boxSizing:'border-box'}}><h1 style={{color:palette.textPrimary,fontFamily:'sans-serif',fontSize:26}}>Settings</h1><div style={{padding:16,borderRadius:20,background:palette.surface,border:'1px solid '+palette.border}}><NotificationCategorySettings key={app+user} app={app} userId={user} palette={palette} Icon={Icon} client={client}/></div></div>}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],
  resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],nodePaths:[modules],alias:{'react-native':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},
  banner:{js:"globalThis.process={env:{NODE_ENV:'production'}};"},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},
  plugins:[{name:'synthetic-auth-only',setup(builder){builder.onResolve({filter:/\/supabase$/},()=>({path:'supabase',namespace:'mock'}));builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase = {}',loader:'js'}))}}],
})
await mkdir('output/playwright/notification-settings',{recursive:true})
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:390,height:844}})
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message)})
  await page.route('http://localhost:9876/**',route=>route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>'}))
  const mount=async()=>{await page.goto('http://localhost:9876');await page.addScriptTag({content:result.outputFiles[0].text});await page.waitForFunction(()=>typeof window.showApp==='function')}
  await mount()
  for(const app of ['coach','parent']) {
    await page.evaluate(app=>window.showApp(app),app)
    const scores=page.getByRole('radio',{name:'Score and cards only',exact:true})
    await page.waitForFunction(()=>!document.body.innerText.includes('Checking your saved choices'))
    if(app==='parent') assert.equal(await scores.getAttribute('aria-checked'),'true'); else assert.equal(await page.getByRole('radio').count(),0)
    const inviteName=app==='coach'?'Availability & event updates':'Invites', chatName=app==='coach'?'Chats & messages':'Chats';
    for(const name of app==='coach'?[inviteName,chatName]:['Invites','Chats','New resources']) assert.equal(await page.getByRole('switch',{name,exact:true}).isChecked(),true)
    if(app==='parent') { await page.getByRole('radio',{name:'Off',exact:true}).click()
    await page.getByText('Saved.',{exact:true}).waitFor()
    assert.equal(await page.getByRole('switch',{name:inviteName,exact:true}).isChecked(),true)
    await page.getByRole('radio',{name:'Full Game Day notifications',exact:true}).click()
    await page.waitForFunction(()=>!document.body.innerText.includes('Saving your choice'))
    }
    await page.getByRole('switch',{name:chatName,exact:true}).click()
    await page.waitForFunction(()=>!document.body.innerText.includes('Saving your choice'))
    assert.equal(await page.getByRole('switch',{name:chatName,exact:true}).isChecked(),false)
    await page.evaluate(()=>window.failSave=true)
    await page.getByRole('switch',{name:inviteName,exact:true}).click()
    await page.getByText(/Could not confirm this change/).waitFor()
    assert.equal(await page.getByRole('switch',{name:inviteName,exact:true}).isChecked(),true)
    await page.evaluate(()=>window.failSave=false)
    await page.getByRole('button',{name:'Retry notification choices'}).click()
    await page.waitForFunction(()=>!document.body.innerText.includes('Checking your saved choices'))
    for(const mode of ['dark','light']) {
      await page.evaluate(mode=>window.setMode(mode),mode)
      await page.screenshot({path:'output/playwright/notification-settings/'+app+'-'+mode+'.png',fullPage:true})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true)
    }
  }
  await mount()
  await page.waitForFunction(()=>!document.body.innerText.includes('Checking your saved choices'))
  assert.equal(await page.getByRole('radio').count(),0)
  const inviteName='Availability & event updates', chatName='Chats & messages'
  assert.equal(await page.getByRole('switch',{name:chatName,exact:true}).isChecked(),false)
  await page.evaluate(()=>window.switchUser('two'))
  await page.waitForFunction(()=>!document.body.innerText.includes('Checking your saved choices'))
  assert.equal(await page.getByRole('switch',{name:'New resources',exact:true}).count(),0)
  assert.equal(await page.getByRole('switch',{name:chatName,exact:true}).isChecked(),true)
  await page.evaluate(()=>{window.online=false;window.switchUser('offline')})
  await page.getByText(/Connect to the internet and retry/).waitFor()
  assert.equal(await page.getByRole('switch',{name:inviteName,exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('radio').count(),0)
  assert.deepEqual(errors,[])
  console.log('Coach and Parent category screens: defaults, independent toggles, persistence, save failure, offline state, account isolation, dark/light and phone width passed.')
} finally { await browser.close() }
