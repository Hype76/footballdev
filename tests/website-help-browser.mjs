import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'
process.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES='true'
await fs.mkdir('output',{recursive:true})
await fs.writeFile('output/website-help-integration.html',`<html><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {MarketingPage} from '/src/components/marketing/MarketingPage.jsx';import {WebsiteAuthHeader} from '/src/components/login/WebsiteAuthHeader.jsx';import {LoginPage} from '/src/pages/LoginPage.jsx';import {AuthProvider} from '/src/lib/auth.js';import '/src/index.css';let mode=new URLSearchParams(location.search).get('mode');const app=mode==='coach'||mode==='parent'?React.createElement(AuthProvider,null,React.createElement(LoginPage,{role:mode})):React.createElement(MarketingPage,{page:mode||'home'});createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,app));</script></body></html>`)
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen()
const origin='http://127.0.0.1:'+server.httpServer.address().port
const browser=await chromium.launch({headless:true}),page=await browser.newPage()
let result={id:'pricing',answer:'UNTRUSTED PROSE',href:'https://evil.invalid'},calls=0,hold=false,release
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.origin!==origin)return route.abort()
 if(url.pathname==='/api/website-help'){
  calls++;assert.equal(req.method(),'POST');assert.deepEqual(Object.keys(req.postDataJSON()),['message']);assert.ok(!req.headers().authorization)
  if(hold)await new Promise(resolve=>{release=resolve})
  return route.fulfill({json:result})
 }
 if(url.pathname==='/.netlify/functions/get-live-promotion')return route.fulfill({json:{success:true,promotion:null}})
 if(!['GET','HEAD','OPTIONS'].includes(req.method()))throw Error('Unexpected customer write '+url.pathname)
 return route.continue()
})
try{
 for(const width of [320,390,1280])for(const mode of ['home','sign-in','coach','parent']){
  await page.setViewportSize({width,height:900})
  await page.goto(origin+'/output/website-help-integration.html?mode='+mode,{waitUntil:'networkidle'})
  const trigger=page.getByRole('button',{name:'Open Football Player help',exact:true})
  assert.equal(await trigger.count(),1,'Exactly one widget')
  assert.ok(await page.getByText('Here to help',{exact:true}).isVisible())
  await trigger.click();const dialog=page.getByRole('dialog',{name:'Football Player help',exact:true})
  await dialog.waitFor();assert.ok(await page.getByLabel('Your product question').evaluate(el=>document.activeElement===el))
  const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=900)
  await page.getByRole('button',{name:'Where can I see pricing?',exact:true}).click()
  await dialog.getByText(/Club includes up to 20 teams/).waitFor()
  assert.equal(await dialog.getByText('UNTRUSTED PROSE').count(),0)
  assert.equal(await dialog.locator('a').first().getAttribute('href'),'/pricing')
  await dialog.screenshot({path:'output/website-help-'+mode+'-'+width+'.png'})
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await dialog.count(),0)
  assert.ok(await page.getByRole('button',{name:'Open Football Player help',exact:true}).evaluate(el=>document.activeElement===el))
  await trigger.click();await dialog.getByRole('button',{name:'Contact us',exact:true}).click()
  await page.getByRole('dialog',{name:'Talk to us',exact:true}).waitFor()
  assert.equal(await dialog.count(),0,'Contact action closes help and opens existing contact')
  await page.getByRole('button',{name:'Close contact form',exact:true}).click()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 }
 await page.goto(origin+'/output/website-help-integration.html?mode=home',{waitUntil:'networkidle'})
 await page.getByRole('button',{name:'Open Football Player help'}).click()
 const input=page.getByLabel('Your product question');await input.fill('Where can I see pricing?')
 hold=true;const before=calls
 await page.getByRole('button',{name:'Ask',exact:true}).evaluate(el=>{el.click();el.click()})
 await page.getByRole('status').filter({hasText:'Finding product help...'}).waitFor();assert.equal(calls,before+1)
 hold=false;release();await page.getByRole('dialog',{name:'Football Player help',exact:true}).getByText(/Club includes up to 20 teams/).waitFor()
 assert.deepEqual(errors,[])
 console.log('PASS help integration: 12 public/chooser/Coach/Parent viewport scenarios, one widget, approved answers only, keyboard focus, contact event, duplicate guard, no overflow/provider/customer writes')
}finally{await browser.close();await server.close()}
