import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createServer} from 'vite'
import {chromium} from 'playwright'
await fs.mkdir('output',{recursive:true})
await fs.writeFile('output/first250-test.html',`<html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{MarketingPage}from'/src/components/marketing/MarketingPage.jsx';import'/src/index.css';const root=createRoot(document.getElementById('root'));window.unmountPage=()=>{window.retainedCounter=document.querySelector('.promotion-counter');root.unmount()};root.render(React.createElement(MarketingPage,{page:'matchday'}));</script></body></html>`)
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen()
const origin='http://127.0.0.1:'+server.httpServer.address().port,browser=await chromium.launch({headless:true}),page=await browser.newPage()
const errors=[],requests=[],cases=[];let payload,status=200,pending=false,aborted=0
page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',request=>{if(request.url().endsWith('/manage-team-branding'))aborted++})
await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());assert.ok(['GET','HEAD','OPTIONS'].includes(request.method()),'No writes');if(url.pathname==='/.netlify/functions/manage-team-branding'){assert.equal(request.method(),'GET');requests.push(request.url());if(pending)return;return route.fulfill({status,json:payload})}if(url.origin!==origin)return route.fulfill({status:200,body:''});return route.continue()})
try{
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:900})
  for(const scenario of [{name:'39',data:{status:'active',capacity:250,reserved:39,remaining:211},text:'39 teams reserved · 211 places remaining',filled:39},{name:'40',data:{status:'active',capacity:250,reserved:40,remaining:210},text:'40 teams reserved · 210 places remaining',filled:40},{name:'sold-out',data:{status:'active',capacity:250,reserved:250,remaining:0},text:'All 250 places have been reserved.',filled:250},{name:'inactive',data:{status:'not_active'},text:'This offer is not currently active.'},{name:'capacity-invalid',data:{status:'active',capacity:251,reserved:40,remaining:211},text:'temporarily unavailable'},{name:'remaining-invalid',data:{status:'active',capacity:250,reserved:40,remaining:211},text:'temporarily unavailable'},{name:'reserved-invalid',data:{status:'active',capacity:250,reserved:38,remaining:212},text:'temporarily unavailable'},{name:'outage',data:{},status:503,text:'temporarily unavailable'}]){
   payload=scenario.data;status=scenario.status||200;await page.goto(origin+'/output/first250-test.html',{waitUntil:'domcontentloaded'})
   const counter=page.locator('#first-250 .promotion-counter');await counter.getByText(scenario.text,{exact:false}).waitFor()
   const grid=counter.locator('.promotion-footballs');assert.equal(await grid.isVisible(),scenario.filled!=null)
   if(scenario.filled!=null){assert.equal(await grid.locator('.promotion-football-grid .is-filled').count(),scenario.filled);assert.equal(await counter.locator('.promotion-total strong').innerText(),String(scenario.filled))}else assert.equal(await counter.locator('.promotion-total span').isVisible(),false)
   const key=counter.locator('.promotion-football-key');assert.equal(await key.isVisible(),scenario.filled!=null);if(scenario.filled!=null){assert.equal(await counter.locator('[data-offer-reserved-label]').innerText(),scenario.filled+' teams reserved');assert.equal(await counter.locator('[data-offer-remaining-label]').innerText(),(250-scenario.filled)+' places available')}if(scenario.name!=='39'){assert.equal((await counter.innerText()).includes('39 teams'),false);assert.equal((await counter.innerText()).includes('211 places'),false)}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   assert.equal(await page.getByRole('link',{name:'Start your team',exact:true}).getAttribute('href'),'/sign-in?mode=signup&plan=matchday')
   assert.ok(await page.getByRole('button',{name:'Share with fellow coaches',exact:true}).isEnabled())
   if(['39','sold-out','inactive'].includes(scenario.name))await counter.screenshot({path:'output/first250-'+scenario.name+'-'+width+'.png'})
   cases.push({width,state:scenario.name,status:'PASS'})
  }
 }
 pending=true;const before=aborted;await page.goto(origin+'/output/first250-test.html',{waitUntil:'domcontentloaded'});await page.getByText('Checking offer availability...', {exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('#first-250 .promotion-counter')?.getAttribute('aria-live')==='polite');await page.evaluate(()=>window.unmountPage());await page.waitForFunction(()=>!document.querySelector('.promotion-counter'));await new Promise(resolve=>setTimeout(resolve,100));assert.ok(aborted>before,'Disposal aborts pending GET');assert.equal(await page.evaluate(()=>window.retainedCounter.querySelector('.promotion-summary').textContent),'Checking offer availability...','Disposed request does not mutate detached UI')
 assert.deepEqual(errors,[]);const receipt={status:'PASS',cases,requests:requests.length,method:'GET only, mocked',lifecycleAbort:true,pageErrors:errors};await fs.writeFile('output/first250-counter-browser-receipt.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:'PASS',cases:cases.length,lifecycleAbort:true,requests:requests.length,pageErrors:0}))
}finally{await browser.close();await server.close()}
