import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import{TeamCoachReminderSettings}from'/src/components/coach-reminders/TeamCoachReminderSettings.jsx';
import{createTeamCoachReminderSettingsStore}from'/src/lib/team-coach-reminder-settings-store.js';
import{normalizeTeamCoachReminderPolicy}from'/src/lib/coach-reminder-settings.js';import'/src/index.css';
window.calls=[];window.failure='';window.delay=false;let policy=normalizeTeamCoachReminderPolicy(null,{clubId:'club',teamId:'team'});
const store=createTeamCoachReminderSettingsStore({clubId:'club',teamId:'team',request:async payload=>{
window.calls.push(payload);if(window.delay)await new Promise(resolve=>window.release=resolve);
if(window.failure){const failure=window.failure;window.failure='';throw Object.assign(new Error(failure),{statusCode:failure==='policy changed'?409:503})}
if(payload.action==='save')policy={...policy,id:'policy',revision:policy.revision+1,options:payload.options,optedIn:payload.optedIn};
return{policy,deliveryEnabled:false};}});
createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:640}}><TeamCoachReminderSettings store={store}/></main>);`
const server=await createServer({cacheDir:'node_modules/.vite-team-reminder-settings',server:{host:'127.0.0.1',port:0},plugins:[{
  name:'team-reminder-settings-fixture',resolveId(id){if(id==='/__team-reminders.jsx')return id},load(id){if(id==='/__team-reminders.jsx')return entry},
  configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    if(req.url!=='/team-reminders.html')return next()
    res.setHeader('Content-Type','text/html')
    res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__team-reminders.jsx"></script></body></html>'))
  })},
}]})
await server.listen()
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:320,height:850}}),errors=[]
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)})
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/team-reminders.html`)
  const enable=page.getByRole('checkbox',{name:/Enable this team.s configured reminders and deadlines/}),save=page.getByRole('button',{name:'Save team reminders',exact:true})
  try {await enable.waitFor()} catch(error) {console.error(await page.locator('body').innerText());console.error(await page.evaluate(()=>window.calls));throw error}
  assert.equal(await enable.isChecked(),false)
  await page.getByRole('checkbox',{name:'Automatically remind players with no answer'}).check()
  await enable.check();await save.click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.action==='save').length),0)
  await page.getByLabel('Reminder hours').fill('12')
  await page.evaluate(()=>{window.failure='network unavailable';window.delay=true})
  await save.click()
  await page.getByRole('button',{name:'Please wait...'}).waitFor()
  assert.equal(await enable.isDisabled(),true)
  await page.evaluate(()=>{window.delay=false;window.release()})
  await page.getByRole('alert').filter({hasText:'network unavailable'}).waitFor()
  await save.click();await page.getByRole('status').filter({hasText:'Team reminder settings saved.'}).waitFor()
  const commands=await page.evaluate(()=>window.calls.filter(x=>x.action==='save'))
  assert.equal(commands.length,2);assert.equal(commands[0].requestId,commands[1].requestId)
  await page.evaluate(()=>window.failure='policy changed')
  await save.click();await page.getByRole('alert').filter({hasText:'policy changed'}).waitFor()
  assert.equal(await save.isDisabled(),true);assert.equal(await enable.isDisabled(),true)
  await page.getByRole('button',{name:'Reload team settings'}).click()
  await enable.uncheck();await save.click();await page.getByRole('status').filter({hasText:'Team reminder settings saved.'}).waitFor()
  assert.equal(await enable.isChecked(),false)
  assert.equal(await page.getByLabel('Reminder hours').inputValue(),'12')
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:850})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  }
  assert.deepEqual(errors,[])
  console.log('PASS: connected shared settings editor, explicit configuration and opt-in, save/retry identity, busy controls, conflict reload, opt-out, responsive layout.')
} finally {await browser.close();await server.close()}
