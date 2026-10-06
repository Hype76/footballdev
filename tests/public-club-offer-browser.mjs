import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'
process.env.VITE_PAYMENTS_DISABLED='false'
await fs.mkdir('output',{recursive:true})
await fs.writeFile('output/club-offer-test.html',`<html><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {MarketingPage} from '/src/components/marketing/MarketingPage.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(MarketingPage,{page:'pricing'})));</script></body></html>`)
let server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen()
let origin='http://127.0.0.1:'+server.httpServer.address().port
const browser=await chromium.launch({headless:true});const page=await browser.newPage()
const errors=[],requests=[],checkouts=[];let mode='failed',release
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(url.origin!==origin)return route.abort()
 if(url.pathname.includes('/.netlify/functions/get-live-promotion'))return route.fulfill({json:{success:true,promotion:null}})
 if(url.pathname.includes('/.netlify/functions/send-contact-request')){
  requests.push(req.postDataJSON())
  if(mode==='pending')await new Promise(resolve=>{release=resolve})
  return route.fulfill({status:mode==='failed'?503:200,json:mode==='failed'?{success:false,message:'Synthetic failure'}:{success:true,id:'mock-accepted'}})
 }
 if(url.pathname.includes('/.netlify/functions/create-checkout-session')){checkouts.push(req.postDataJSON());return route.fulfill({status:503,json:{success:false,message:'Synthetic checkout unavailable'}})}
 if(!['GET','HEAD','OPTIONS'].includes(req.method()))throw Error('Unexpected write')
 return route.continue()
})
async function assertCentered(dialog,width,height){
 const b=await dialog.boundingBox()
 assert.ok(b.x>=15&&b.y>=15&&b.x+b.width<=width-15&&b.y+b.height<=height-15, 'Dialog is inside viewport')
 assert.ok(Math.abs(b.x+b.width/2-width/2)<2&&Math.abs(b.y+b.height/2-height/2)<2,'Dialog is centred')
 if(width===1280)assert.equal(Math.round(b.width),720,'Comfortable desktop width')
}
try{
 for(const {width,height} of [{width:320,height:900},{width:390,height:900},{width:1280,height:900},{width:1280,height:600}]){
  await page.setViewportSize({width,height});await page.goto(origin+'/output/club-offer-test.html',{waitUntil:'networkidle'})
  assert.equal(await page.locator('.plan-trial').count(),2)
  await page.locator('.footer-support-button').click()
  const contact=page.getByRole('dialog',{name:'Talk to us'})
  await contact.waitFor()
  await assertCentered(contact,width,height)
  await contact.getByLabel('Your name',{exact:true}).fill('Saved contact draft')
  await contact.getByRole('button',{name:'Send enquiry',exact:true}).scrollIntoViewIfNeeded()
  assert.ok(await contact.getByRole('button',{name:'Send enquiry',exact:true}).isVisible())
  await contact.screenshot({path:'output/contact-dialog-'+width+'-'+height+'.png'})
  await contact.getByRole('button',{name:'Close contact form'}).click()
  await page.locator('.footer-support-button').click()
  assert.equal(await contact.getByLabel('Your name',{exact:true}).inputValue(),'Saved contact draft')
  await contact.getByRole('button',{name:'Close contact form'}).click()
  await page.getByRole('link',{name:'Choose Club',exact:true}).click()
  await page.getByText('Synthetic checkout unavailable').waitFor()
  assert.equal(checkouts.at(-1).offerKey,'club_20');assert.equal(checkouts.at(-1).teamCapacity,20)
  await page.getByRole('button',{name:'Need more teams?',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Need more teams?'})
  await assertCentered(dialog,width,height)
  await dialog.getByLabel('Club name',{exact:true}).fill('Rovers Athletic')
  await dialog.getByLabel('Your name',{exact:true}).fill('Sam Smith')
  await dialog.getByLabel('Email address',{exact:true}).fill('sam@example.test')
  await dialog.getByLabel('Number of teams',{exact:true}).fill('650')
  await dialog.getByRole('button',{name:'Submit for quote'}).click();await dialog.getByText('Synthetic failure').waitFor()
  assert.equal(await dialog.getByLabel('Club name',{exact:true}).inputValue(),'Rovers Athletic')
  await dialog.getByRole('button',{name:'Close quote form'}).click();await page.getByRole('button',{name:'Need more teams?',exact:true}).click()
  assert.equal(await dialog.getByLabel('Club name',{exact:true}).inputValue(),'Rovers Athletic')
  mode='pending';const before=requests.length
  await dialog.getByRole('button',{name:'Submit for quote'}).click()
  await page.waitForFunction(()=>document.querySelector('#marketing-club-quote-dialog button[type=submit]').disabled)
  await dialog.locator('form').evaluate(form=>form.requestSubmit())
  assert.equal(requests.length,before+1)
  mode='success';release();await dialog.getByText('Thank you, Sam Smith.').waitFor()
  assert.ok(await dialog.getByText('650 teams',{exact:true}).isVisible())
  assert.ok(await dialog.getByText('sam@example.test',{exact:true}).isVisible())
  await dialog.screenshot({path:`output/club-quote-success-${width}.png`})
  await dialog.getByRole('button',{name:'Done',exact:true}).click()
  await page.locator('.plan-guide').screenshot({path:`output/club-plan-guide-${width}.png`})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  mode='failed'
 }
 await page.goto('about:blank')
 await server.close()
 process.env.VITE_PAYMENTS_DISABLED='true'
 server=await createServer({server:{host:'127.0.0.1',port:0}});await server.listen()
 origin='http://127.0.0.1:'+server.httpServer.address().port
 await page.goto(origin+'/output/club-offer-test.html',{waitUntil:'networkidle'})
 const disabledUrl=page.url(), checkoutCount=checkouts.length
 await page.getByRole('link',{name:'Choose Club',exact:true}).click()
 await page.getByText('Club checkout is currently unavailable. Contact us for help choosing your 20-team Club plan.').waitFor()
 assert.equal(page.url(),disabledUrl,'Disabled Club checkout stays on pricing')
 assert.equal(checkouts.length,checkoutCount,'Disabled Club checkout never creates an old offer checkout')
 assert.deepEqual(errors,[])
 console.log('PASS: 4 viewport/height configurations, Club20 checkout, quote validation, failure/draft, duplicate guard, confirmation, no overflow, no live writes')
}finally{await browser.close();await server.close()}
