import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const modules = path.resolve('apps/coach-mobile/node_modules')
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {CoachSquadPanel} from './apps/coach-mobile/src/CoachSquadPanel.js';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
window.calls=[];window.notices=[];window.fail='';window.delay=20;
const players=Array.from({length:7},(_,i)=>({id:String(i),playerName:i===6?'A long player name for mobile layout':'Player '+i}));
const base={id:'fixture',squadDecisions:[],squadNotificationContacts:players.map(p=>({playerId:p.id,canNotify:p.id!=='2',hasContact:p.id!=='2',emailRecipientCount:p.id==='2'?0:1}))};
function App(){const [match,setMatch]=React.useState(base),[busy,setBusy]=React.useState(false),[allowed,setAllowed]=React.useState(true),[visible,setVisible]=React.useState(true);const server=React.useRef(base);
window.refresh=()=>setMatch(m=>({...m}));window.allow=setAllowed;window.show=setVisible;
return <div style={{padding:12,background:'#071108',color:'white'}}><div style={{display:visible?'block':'none'}}><CoachSquadPanel actions={{canSetSquad:allowed}} busy={busy} match={match} players={players} palette={createCoachTheme({mode:'dark'}).tokens} styles={{cardTitle:{color:"white",fontSize:20,fontWeight:"700"},body:{color:"white"},meta:{color:"#cbd5e1"}}}
onSetDecision={async(player,decision)=>{window.calls.push({id:player.id,decision});setBusy(true);await new Promise(r=>setTimeout(r,window.delay));if(window.fail===player.id){setBusy(false);throw Error('Failed save')};const next={...server.current,squadDecisions:[...server.current.squadDecisions.filter(d=>d.playerId!==player.id),{playerId:player.id,status:decision,decisionRevision:player.id+'-'+decision,decidedAt:'now'}]};server.current=next;setMatch(next);setBusy(false);return next;}}
onNotify={async(rows)=>{window.notices.push(rows.map(r=>r.id));return rows.map(p=>({playerId:p.id,revision:p.decisionRevision,sent:true}));}} /></div></div>}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({ stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},
  alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},
  define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},
  plugins:[{name:'icons',setup(builder){builder.onResolve({filter:/^@expo\/vector-icons\/MaterialIcons$/},()=>({path:'icons',namespace:'mock'}));builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export default ()=>null;',loader:'jsx'}))}}] })
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:320,height:850}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('http://localhost:9877/**',route=>route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>'}))
  const mount=async()=>{await page.goto('http://localhost:9877/');await page.addScriptTag({content:result.outputFiles[0].text})}
  const choose=(id,selected=true)=>page.getByRole('button',{name:(selected?'Selected: ':'Not selected: ')+'Player '+id,exact:true}).click()
  const save=()=>page.getByRole('button',{name:/^Save selections/}).first().click()
  await mount()
  await choose(0);await choose(1,false);await choose(2)
  assert.deepEqual(await page.evaluate(()=>window.calls),[],'Tapping several decisions must not save or reload')
  await page.getByText('3 unsaved changes',{exact:true}).first().waitFor()
  assert.equal(await page.getByRole('button',{name:/Send notifications/}).first().isDisabled(),true)
  await page.evaluate(()=>{window.refresh();window.show(false)})
  await page.evaluate(()=>window.show(true))
  await page.getByText('3 unsaved changes',{exact:true}).first().waitFor()
  await mkdir('output/playwright',{recursive:true})
  await page.screenshot({path:'output/playwright/squad-unsaved-mobile.png',fullPage:true})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=320),true,'Mobile rows must fit the viewport')
  await save()
  await page.getByText('3 selections saved. Send notifications when you are ready.',{exact:true}).waitFor()
  assert.equal((await page.evaluate(()=>window.calls)).length,3)
  assert.deepEqual(await page.evaluate(()=>window.notices),[],'Saving must not send messages')
  await page.getByRole('button',{name:'Send notifications (2)',exact:true}).first().click()
  await page.getByText('2 players notified.',{exact:true}).waitFor()
  await choose(0,false);await choose(0,true)
  assert.equal(await page.getByRole('button',{name:/^Save selections/}).count(),0,'Reverting a choice should remove its pending change')
  await choose(1,true)
  await page.getByRole('button',{name:'Discard changes',exact:true}).first().click()
  assert.equal(await page.getByRole('button',{name:/^Save selections/}).count(),0)
  await mount();await choose(0);await choose(1);await choose(2)
  await page.evaluate(()=>window.fail='1');await save()
  await page.getByText(/1 saved\. Remaining selections/).waitFor()
  await page.getByText('2 unsaved changes',{exact:true}).first().waitFor()
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.id)),['0','1'],'Stop after an uncertain save')
  await page.evaluate(()=>window.fail='');await save()
  await page.getByText('2 selections saved. Send notifications when you are ready.',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.id)),['0','1','1','2'],'Retry must not repeat confirmed saves')
  await choose(0,false)
  await page.evaluate(()=>window.allow(false))
  await page.getByText('Squad decisions are locked after kick-off.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button',{name:'Not selected: Player 0',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:/^Save selections/}).first().isDisabled(),true)
  await page.getByRole('button',{name:'Discard changes',exact:true}).first().click()
  await page.getByRole('button',{name:/^Save selections/}).first().waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('button',{name:/^Save selections/}).count(),0,'A permission change must still allow discarding drafts')
  assert.deepEqual(errors,[])
  console.log('PASS: rapid selection, draft retention, mobile width, explicit save, separate notifications, undo, discard, partial failure, retry and role lock')
} finally { await browser.close() }
