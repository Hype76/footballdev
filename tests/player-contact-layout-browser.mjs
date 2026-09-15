import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const source = await readFile('src/components/players/PlayerDetailsSection.jsx', 'utf8')
const constants = source.slice(source.indexOf('const fieldClass'), source.indexOf('export function'))
const summary = source.slice(source.indexOf('function PlayerDetailsSummary('))
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {getParentPortalInviteActionForContact,normalizeParentPortalInviteEmail} from './src/lib/parent-portal-invite-actions.js';
import {isInviteEmailTemplate} from './src/lib/email-templates.js';
const PLAYER_CONTACT_TYPES={self:'self'},PlayerStatePanel=()=>null;
${constants}
${summary}
const contacts=[{name:'First Parent',email:'a.very.long.parent.email.address.for.layout@example.test'},{name:'Second Parent',email:'second@example.test'},{name:'Third Parent',email:'third@example.test'}];
const noop=()=>{};window.calls=[];
createRoot(document.getElementById('root')).render(<PlayerDetailsSummary contacts={contacts} player={{id:'player',section:'Squad',team:'FP TEST U14',shirtNumber:'22',positions:['Midfielder'],status:'active'}} parentPortalLinks={[{id:'active',email:contacts[0].email,status:'active'},{id:'pending',email:contacts[1].email,status:'pending',inviteSentAt:'2026-09-15'}]} directEmailTemplates={[{optionKey:'parent:update',label:'Team update',audience:'parent'}]} selectedDirectEmailTemplateKey="parent:update" onSendParentPortalInviteForContact={c=>window.calls.push(c.email)} onSendParentPasswordReset={noop} onRemoveParentPortalAccess={noop} onSendDirectEmail={noop} onStartEditingPlayer={noop} onMovePlayerToTrial={noop} onSelectedDirectEmailTemplateChange={noop}/>);`
const built=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}})
const assets=await readdir('dist/assets');const css=await Promise.all(assets.filter(name=>name.endsWith('.css')).map(name=>readFile('dist/assets/'+name,'utf8')))
const browser=await chromium.launch({headless:true});await mkdir('output/playwright/player-contact-layout',{recursive:true})
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.setContent('<body><main id="root" style="max-width:950px;margin:auto;padding:20px"></main></body>')
 for(const content of css)await page.addStyleTag({content})
 await page.addScriptTag({content:built.outputFiles[0].text})
 for(const mode of ['light','dark'])for(const width of [320,390,768,1100,1600]){
  await page.setViewportSize({width,height:900});await page.evaluate(mode=>document.body.className='theme-'+mode,mode)
  await page.getByRole('region',{name:'Player contacts'}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Contacts must not overflow')
  const actions=page.getByRole('region',{name:'Player contacts'}).getByRole('button');
  for(const action of await actions.all()){const box=await action.boundingBox();assert.ok(box.height>=44);assert.ok(box.width>=90,'Actions must have readable width')}
  const email=page.getByText('Email: a.very.long.parent.email.address.for.layout@example.test',{exact:true});assert.ok((await email.boundingBox()).width>180,'Email must have a useful reading width')
  await page.screenshot({path:'output/playwright/player-contact-layout/'+mode+'-'+width+'.png',fullPage:true})
 }
 await page.getByRole('button',{name:'Send parent portal invite',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.calls),['third@example.test'])
 assert.deepEqual(errors,[]);console.log('PASS: actual contact summary, long emails, active/pending/new actions and full-width cards at 320/390/768/1100/1600px in light/dark themes.')
}finally{await browser.close()}
