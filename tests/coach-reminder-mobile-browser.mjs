import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {realpathSync} from 'node:fs'
import {resolve} from 'node:path'
import {createServer,transformWithEsbuild} from 'vite'
import {chromium} from 'playwright'

const nativeModules=realpathSync(resolve('apps/coach-mobile/node_modules'))
const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import{CoachTeamReminderSettingsView}from'/apps/coach-mobile/src/CoachTeamReminderSettings.js';
import{createTeamCoachReminderSettingsStore}from'/src/lib/team-coach-reminder-settings-store.js';
import{normalizeTeamCoachReminderPolicy}from'/src/lib/coach-reminder-settings.js';
window.calls=[];window.failure='';let policy=normalizeTeamCoachReminderPolicy(null,{clubId:'club',teamId:'team'});
const store=createTeamCoachReminderSettingsStore({clubId:'club',teamId:'team',createRequestId:()=>crypto.randomUUID(),request:async payload=>{
window.calls.push(payload);if(window.failure){const message=window.failure;window.failure='';throw Object.assign(new Error(message),{statusCode:message==='policy changed'?409:503})}
if(payload.action==='save')policy={...policy,revision:policy.revision+1,options:payload.options,optedIn:payload.optedIn};return{policy,deliveryEnabled:false}}});
createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:640}}><CoachTeamReminderSettingsView store={store} palette={{text:'#16251f',border:'#c5d5ca',danger:'#b3261e'}}/></main>);`
const server=await createServer({configFile:false,optimizeDeps:{entries:[],include:['react','react-dom/client','react-native']},cacheDir:'node_modules/.vite-reminder-native',server:{host:'127.0.0.1',port:0,fs:{allow:[resolve('.'),resolve(nativeModules,'../../..')]}},
 resolve:{alias:[{find:/^react-native$/,replacement:resolve(nativeModules,'react-native-web/dist/index.js')},{find:/^react$/,replacement:resolve(nativeModules,'react')},{find:/^react\/(.*)$/,replacement:resolve(nativeModules,'react/$1')},{find:/^react-dom$/,replacement:resolve(nativeModules,'react-dom')},{find:/^react-dom\/(.*)$/,replacement:resolve(nativeModules,'react-dom/$1')}]},
 plugins:[{name:'native-reminder-fixture',enforce:'pre',resolveId(id){if(id==='../../mobile-core/src/supabase')return '\0reminder-native-supabase';if(id==='/__native-reminders.jsx'||id==='expo-crypto')return '\0'+id},
 load(id){if(id==='\0/__native-reminders.jsx')return entry;if(id==='\0expo-crypto')return 'export const randomUUID=()=>crypto.randomUUID();';if(id==='\0reminder-native-supabase')return 'export const getAccessToken=async()=>"fixture";'},
 async transform(code,id){if(id.includes('CoachTeamReminderSettings.js')||id.includes('__native-reminders.jsx'))return transformWithEsbuild(code,id,{loader:'jsx',jsx:'automatic'})},
 configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url!=='/native-reminders.html')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/__native-reminders.jsx"></script></body></html>'))})}}]})
await server.listen()
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:320,height:900}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 page.on('console',message=>{if(message.type()==='error')console.error(message.text())})
 page.on('requestfailed',request=>console.error(request.url(),request.failure()?.errorText))
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/native-reminders.html`)
 const enable=page.getByRole('checkbox',{name:'Enable configured team reminders and deadlines'}),save=page.getByRole('button',{name:'Save team reminders',exact:true})
 try{await enable.waitFor()}catch(error){console.error(errors);console.error(await page.locator('body').innerText());throw error}
 assert.equal(await enable.getAttribute('aria-checked'),'false')
 await page.getByRole('checkbox',{name:'Remind unanswered invitations'}).click()
 assert.equal(await page.getByRole('textbox',{name:'Reminder hours'}).inputValue(),'')
 await page.getByRole('textbox',{name:'Reminder hours'}).fill('12')
 await page.getByRole('radio',{name:'Automatically mark unanswered Not attending and notify'}).click()
 await page.getByRole('textbox',{name:'Deadline hours'}).fill('48')
 await enable.click();await save.click();await page.getByText('Team reminder settings saved.',{exact:true}).waitFor()
 await page.evaluate(()=>window.failure='network unavailable');await save.click();await page.getByRole('alert').waitFor()
 await save.click();await page.getByText('Team reminder settings saved.',{exact:true}).waitFor()
 const commands=await page.evaluate(()=>window.calls.filter(call=>call.action==='save'))
 assert.equal(commands[1].requestId,commands[2].requestId)
 await page.evaluate(()=>window.failure='policy changed');await save.click();await page.getByRole('alert').waitFor()
 assert.equal(await save.getAttribute('aria-disabled'),'true')
 await page.getByRole('button',{name:'Reload team settings'}).click();await enable.click();await save.click()
 await page.getByText('Team reminder settings saved.',{exact:true}).waitFor();assert.equal(await enable.getAttribute('aria-checked'),'false')
 await mkdir('output/coach-reminders',{recursive:true})
 for(const width of [320,390,768]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`output/coach-reminders/mobile-settings-${width}.png`,fullPage:true})}
 assert.deepEqual(errors,[]);console.log('Native settings browser passed: blank defaults, modes, retry, conflict, opt-out and compact widths.')
}finally{await browser.close();await server.close()}
