import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const source = await readFile('src/components/players/PlayerDetailsSection.jsx', 'utf8')
const constants = source.slice(source.indexOf('const fieldClass'), source.indexOf('export function'))
const summary = source.slice(source.indexOf('function PlayerDetailsSummary('))
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {getParentPortalInviteActionForContact,getUnlistedParentAccessLinks,normalizeParentPortalInviteEmail} from './src/lib/parent-portal-invite-actions.js';
import {isInviteEmailTemplate} from './src/lib/email-templates.js';
const PLAYER_CONTACT_TYPES={self:'self'},PlayerStatePanel=()=>null;
${constants}
${summary}
const contacts=[{name:'First Parent',email:'a.very.long.parent.email.address.for.layout@example.test'},{name:'Second Parent',email:'second@example.test'},{name:'Third Parent',email:'third@example.test'}];
const noop=()=>{};window.calls=[];window.revoked=[];
createRoot(document.getElementById('root')).render(<PlayerDetailsSummary contacts={contacts} player={{id:'player',section:'Squad',team:'FP TEST U14',shirtNumber:'22',positions:['Midfielder'],status:'active'}} parentPortalLinks={[{id:'active',email:contacts[0].email,status:'active'},{id:'pending',email:contacts[1].email,status:'pending',inviteSentAt:'2026-09-15'},{id:'unlisted',email:'former.parent@example.test',status:'active'}]} directEmailTemplates={[{optionKey:'parent:update',label:'Team update',audience:'parent'}]} selectedDirectEmailTemplateKey="parent:update" onSendParentPortalInviteForContact={c=>window.calls.push(c.email)} onSendParentPasswordReset={noop} onRemoveParentPortalAccess={link=>window.revoked.push(link.id)} onSendDirectEmail={noop} onStartEditingPlayer={noop} onMovePlayerToTrial={noop} onSelectedDirectEmailTemplateChange={noop}/>);`
const built=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}})
const editor = await build({
  stdin: {
    contents: `import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlayerDetailsSection } from './src/components/players/PlayerDetailsSection.jsx'
import {
  addParentContactDraft, getEditableParentContacts, removeParentContactDraft,
  startEditingPlayerDraft, updateParentContactDraft,
} from './src/hooks/players/playerProfileUtils.js'
import { mapPlayerToRow, normalizePlayerRow } from './src/lib/domain/player-normalizers.js'

const player = {
  id: 'fixture', playerName: 'Fixture Player', section: 'Squad', team: 'Fixture Team',
  parentName: 'First Parent', parentEmail: 'first@example.test',
}
function Editor() {
  const [drafts, setDrafts] = useState(() => startEditingPlayerDraft({}, player))
  return <PlayerDetailsSection
    profilePlayers={[player]}
    playerDrafts={drafts}
    editingPlayerId={player.id}
    onAddParentContact={id => setDrafts(current => addParentContactDraft(current, id))}
    onParentContactDraftChange={(id, index, field, value) =>
      setDrafts(current => updateParentContactDraft(current, id, index, field, value))}
    onRemoveParentContact={(id, index) =>
      setDrafts(current => removeParentContactDraft(current, id, index))}
    onSavePlayer={id => {
      const draft = drafts[id]
      const row = mapPlayerToRow({ ...draft, parentContacts: getEditableParentContacts(draft) })
      window.savedContacts = normalizePlayerRow({ id, ...row }).parentContacts
    }}
  />
}
createRoot(document.getElementById('root')).render(<Editor />)`,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'https://fixture.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
    }),
  },
})
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
 assert.equal(await page.getByRole('button',{name:/send parent portal invite/i}).count(),0)
 await page.getByText('Invite sent',{exact:true}).waitFor()
 await page.getByRole('region',{name:'Additional Parent access'}).getByText('former.parent@example.test',{exact:true}).waitFor()
 await page.getByRole('region',{name:'Additional Parent access'}).getByRole('button',{name:'Remove Parent access',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.revoked),['unlisted'])
 assert.deepEqual(errors,[]);console.log('PASS: actual contact summary, long emails, active and pending invitation status and full-width cards at 320/390/768/1100/1600px in light/dark themes.')

 const editorPage = await browser.newPage()
 await editorPage.route('http://127.0.0.1/player-contact-test', route =>
  route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
 await editorPage.goto('http://127.0.0.1/player-contact-test')
 await editorPage.addScriptTag({ content: editor.outputFiles[0].text })
 const names = editorPage.getByRole('textbox', { name: 'Name', exact: true })
 const emails = editorPage.getByRole('textbox', { name: 'Email', exact: true })
 const addContact = editorPage.getByRole('button', { name: 'Add Another Contact' })
 await names.first().waitFor()
 assert.equal(await names.first().inputValue(), 'First Parent')
 for (let index = 0; index < 12; index++) await addContact.click()
 assert.equal(await names.count(), 13)
 assert.equal(await names.last().inputValue(), '')
 await names.last().fill('Last Parent')
 await emails.last().fill('last@example.test')
 await editorPage.getByRole('button', { name: 'Remove Contact' }).nth(1).click()
 assert.equal(await names.count(), 12)
 assert.equal(await emails.last().inputValue(), 'last@example.test')
 for (let index = 1; index < 11; index++) await emails.nth(index).fill(`contact${index}@example.test`)
 await addContact.click()
 await editorPage.getByRole('button', { name: 'Save', exact: true }).click()
 const savedContacts = await editorPage.evaluate(() => window.savedContacts)
 assert.equal(savedContacts.length, 12)
 assert.equal(savedContacts[0].email, 'first@example.test')
 assert.equal(savedContacts[11].email, 'last@example.test')
 console.log('PASS: add, edit, remove and save multiple parent contacts with an unused blank row.')
}finally{await browser.close()}
