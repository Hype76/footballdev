import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'
process.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES='true'
process.env.VITE_SUPABASE_URL='https://fixture.example.invalid'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_synthetic'
await fs.mkdir('output',{recursive:true})
await fs.writeFile('output/billing-cancel-test.html',`<html><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {AuthProvider,useAuth} from '/src/lib/auth.js';import {BillingPage} from '/src/pages/BillingPage.jsx';import '/src/index.css';function Ready(){const {user}=useAuth();return user?React.createElement(BillingPage):null;}createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(MemoryRouter,null,React.createElement(Ready))));</script></body></html>`)
const server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen()
const origin='http://127.0.0.1:'+server.httpServer.address().port
const browser=await chromium.launch({headless:true}),page=await browser.newPage()
let authorized=false,calls=0,release;const errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(()=>{sessionStorage.setItem('auth-access-browser-fixture-email','club.fixture@footballplayer.test');localStorage.setItem('auth-access-browser-fixture-profile-patch:club.fixture@footballplayer.test',JSON.stringify({roleRank:90}))})
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.origin!==origin)return route.abort()
 if(url.pathname==='/.netlify/functions/get-billing-summary')return route.fulfill({json:{success:true,billing:{club:{planKey:'club',planStatus:'active',stripeCustomerId:'cus_fixture',stripeSubscriptionId:'sub_fixture',subscriptionTeamCapacity:20,cancellationAuthorized:authorized},subscription:{id:'sub_fixture'},invoices:[]}}})
 if(url.pathname==='/.netlify/functions/create-billing-portal-session'){calls++;await new Promise(resolve=>{release=resolve});return route.fulfill({status:502,json:{success:false,message:'Subscription management could not be opened.'}})}
 if(!['GET','HEAD','OPTIONS'].includes(req.method()))throw Error('Unexpected write')
 return route.continue()
})
try{
 await page.goto(origin+'/output/billing-cancel-test.html',{waitUntil:'networkidle'})
 assert.equal(await page.getByRole('button',{name:'Cancel subscription',exact:true}).count(),0)
 authorized=true;await page.reload({waitUntil:'networkidle'})
 const button=page.getByRole('button',{name:'Cancel subscription',exact:true});await button.waitFor()
 await button.evaluate(el=>{el.click();el.click()})
 await page.getByRole('button',{name:'Opening subscription management...'}).waitFor()
 for(let attempt=0;calls===0&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,50))
 assert.equal(calls,1,'Same-task double click sends only one cancellation request')
 release();await page.getByText('Subscription management could not be opened.',{exact:true}).waitFor()
 assert.ok(await page.getByRole('button',{name:'Cancel subscription',exact:true}).isEnabled())
 assert.deepEqual(errors,[])
 console.log('PASS cancellation UI: server authorization false hidden/true visible, same-task double-click guard, provider failure recoverable; mocked only')
}finally{await browser.close();await server.close()}
