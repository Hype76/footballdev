import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {addEmailAppAccess} from '../netlify/functions/lib/_email-app-access.js'
import {APP_DOWNLOAD_LINKS} from '../src/lib/app-download-links.js'
await mkdir('output/playwright/email-app-access',{recursive:true})
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage()
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());const match=/^\/email-apps\/(parent|coach)-(ios|android)\.png$/.exec(url.pathname)
  if(url.hostname==='footballplayer.online'&&match)return route.fulfill({contentType:'image/png',body:await readFile(new URL(`../public${url.pathname}`,import.meta.url))})
  return route.abort()
 })
 for(const width of [320,600])for(const role of ['parent','coach','both','mixed']){
  await page.setViewportSize({width,height:1000})
  const payload=addEmailAppAccess({emailAppRole:role==='mixed'?'parent':role,emailCcAppRole:role==='mixed'?'coach':undefined,cc:role==='mixed'?['coach@example.test']:undefined,html:'<!doctype html><html><body style="margin:0;padding:12px;font-family:Arial,sans-serif;color:#17382f"><main style="max-width:600px;margin:0 auto"><h1 style="font-size:24px">Your invitation</h1><p>Follow your player and the updates shared with you.</p><a style="display:inline-block;padding:14px 20px;background:#075e45;color:#fff;border-radius:8px" href="https://example.test/accept">Accept invitation</a></main></body></html>'})
  await page.setContent(payload.html)
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${role} ${width} overflow`)
  assert.equal(await page.getByRole('link',{name:'Accept invitation',exact:true}).getAttribute('href'),'https://example.test/accept')
  for(const img of await page.locator('img').all()){const box=await img.boundingBox();assert.ok(box.width>=100&&box.width<=136);assert.ok(Math.abs(box.width-box.height)<1);const src=await img.getAttribute('src'),target=await img.locator('..').getAttribute('href');const key=src.includes('/parent-')?'parent':'coach';assert.equal(target,src.includes('-ios')?APP_DOWNLOAD_LINKS[key].apple:APP_DOWNLOAD_LINKS[key].android)}
  const links=await page.getByRole('link',{name:'Sign in on the website',exact:true}).evaluateAll(items=>items.map(i=>i.href))
  assert.deepEqual(links,role==='parent'?[APP_DOWNLOAD_LINKS.parent.web]:role==='coach'?[APP_DOWNLOAD_LINKS.coach.web]:[APP_DOWNLOAD_LINKS.parent.web,APP_DOWNLOAD_LINKS.coach.web])
  await page.screenshot({path:`output/playwright/email-app-access/${role}-${width}.png`,fullPage:true})
 }
 console.log('PASS: rendered Parent/Coach/both/mixed email app sections at 320/600, original action intact, no overflow, all local QR assets loaded and correct clickable stores/website.')
}finally{await browser.close()}
