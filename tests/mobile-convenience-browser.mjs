import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const modules=path.resolve('apps/coach-mobile/node_modules')
const entry=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {CoachSquadPanel} from './apps/coach-mobile/src/CoachSquadPanel.js';
import {CoachNotificationHistoryScreen} from './apps/coach-mobile/src/CoachNotificationHistoryScreen.js';
import {VenueMapPreview} from './apps/mobile-core/src/VenueMapPreview.js';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
window.templates=[];window.writes=[];window.opens=[];window.fail=false;
window.historyItems=[{id:1,title:'Availability updated',body:'Player response received',created_at:'2026-09-09T10:00:01Z',data:{app:'coach',route:'invites',targetId:'response'}},{id:2,title:'Availability updated',body:'Player response received',created_at:'2026-09-09T10:00:01Z',data:{app:'coach',route:'invites',targetId:'response'}},{id:3,title:'Match ready for review',body:'Review the match report',created_at:'2026-09-09T09:00:00Z',data:{app:'coach',route:'matchday',matchDayId:'match'}}];
const palette=createCoachTheme({mode:'dark'}).tokens;
const styles={stack:{gap:12},screenTitle:{color:palette.textPrimary,fontSize:29,fontWeight:'900'},bodyText:{color:palette.textSecondary,fontSize:15},helperText:{color:palette.textMuted,fontSize:12},card:{padding:16,borderWidth:1,borderColor:palette.border,borderRadius:18},cardTitle:{color:palette.textPrimary,fontSize:18,fontWeight:'800'},body:{color:palette.textPrimary,fontSize:14},meta:{color:palette.textSecondary,fontSize:12}};
const players=[{id:'0',playerName:'Alex'},{id:'1',playerName:'Jamie'},{id:'2',playerName:'Sam'}];
const store=async(action='list',name='',playerIds=[])=>{if(window.fail)throw Error('offline');if(action==='save'){window.templates=[...window.templates.filter(t=>t.name!==name),{name,playerIds}]};if(action==='delete')window.templates=window.templates.filter(t=>t.name!==name);return [...window.templates]};
function App(){const [tab,setTab]=React.useState('squad'),[key,setKey]=React.useState(0),[allowed,setAllowed]=React.useState(true),[offline,setOffline]=React.useState(false),[location,setLocation]=React.useState('Synthetic Football Ground');window.tab=setTab;window.remount=()=>setKey(k=>k+1);window.allow=setAllowed;window.offline=setOffline;window.locationText=setLocation;
return <div style={{padding:16,background:palette.background,minHeight:'100vh'}}>{tab==='squad'?<CoachSquadPanel key={key} templateStore={store} actions={{canSetSquad:allowed}} match={{id:'match',squadDecisions:[]}} players={players} palette={palette} styles={styles} onSetDecision={async()=>{window.writes.push('save');throw Error('test stop')}} onNotify={async()=>{window.writes.push('notify');return []}}/>:tab==='map'?<VenueMapPreview key={location} location={location} offline={offline} colors={palette} styles={styles}/>:<CoachNotificationHistoryScreen key={key} user={{id:'coach'}} homeState={{unreadChat:0}} onNavigate={()=>{}} onOpenNotification={data=>window.opens.push(data)} palette={palette} styles={styles}/>}</div>}
createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'fakes',setup(b){b.onResolve({filter:/coachNotificationHistory$/},()=>({path:'history',namespace:'fake'}));b.onResolve({filter:/^@expo\/vector-icons\/MaterialIcons$/},()=>({path:'icons',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},args=>({loader:'jsx',contents:args.path==='icons'?'export default()=>null;':'export async function getCoachNotificationHistory(){if(window.fail)throw Error("offline");return window.historyItems}'}))}}]})
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:320,height:850}}), errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  let lookups=0,tiles=0
  await page.route('https://photon.komoot.io/**',route=>{lookups++;return route.fulfill({contentType:'application/json',body:JSON.stringify({features:[{geometry:{coordinates:[0.12,52.2]},properties:{name:'Synthetic Football Ground',city:'Cambridge'}}]})})})
  await page.route('https://tile.openstreetmap.org/**',route=>{tiles++;return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDeoAAAAASUVORK5CYII=','base64')})})
  await page.goto('about:blank');await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>');await page.addScriptTag({content:result.outputFiles[0].text})
  await page.getByRole('button',{name:'Selected: Alex',exact:true}).click()
  await page.getByRole('textbox',{name:'Template name'}).fill('Regular squad')
  await page.getByRole('button',{name:'Save selected players as template',exact:true}).click()
  await page.getByRole('button',{name:'Apply Regular squad',exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(()=>window.writes),[])
  await page.evaluate(()=>window.remount())
  await page.getByRole('button',{name:'Apply Regular squad',exact:true}).click()
  await page.getByText('3 unsaved changes',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(()=>window.writes),[],'Applying templates cannot save selections or send notifications')
  await page.getByText('1 selected · 2 not selected · 0 to choose',{exact:true}).waitFor()
  await page.evaluate(()=>{window.templates=[{name:'Old squad',playerIds:['0','gone']}];window.remount()})
  await page.getByRole('button',{name:'Apply Old squad',exact:true}).click()
  await page.getByText(/1 template players are no longer/).waitFor()
  await page.evaluate(()=>window.allow(false))
  await page.getByText('Squad decisions are locked after kick-off.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Apply Old squad',exact:true}).isDisabled(),true)
  await page.evaluate(()=>window.allow(true));await page.getByRole('button',{name:'Delete Old squad',exact:true}).click()
  await page.getByRole('button',{name:'Confirm delete template'}).click();await page.getByText('Template deleted.',{exact:true}).waitFor()
  await page.evaluate(()=>window.tab('map'));await page.getByRole('button',{name:'Preview venue map'}).waitFor();assert.equal(lookups,0);assert.equal(tiles,0)
  await page.getByRole('button',{name:'Preview venue map'}).click();await page.getByLabel('Venue map preview',{exact:true}).waitFor();await page.getByText('© OpenStreetMap contributors',{exact:true}).waitFor();assert.equal(lookups,1)
  await page.getByRole('button',{name:'Zoom in'}).click()
  await page.evaluate(()=>window.offline(true));await page.getByText('Connect to preview the venue map.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Zoom in'}).isDisabled(),true)
  await page.evaluate(()=>window.locationText('Changed venue'));await page.getByRole('button',{name:'Preview venue map'}).waitFor();assert.equal(await page.getByLabel('Venue map preview',{exact:true}).count(),0)
  await page.evaluate(()=>window.tab('notifications'));await page.getByRole('button',{name:'Open notification: Availability updated'}).waitFor();assert.equal(await page.getByRole('button',{name:'Open notification: Availability updated'}).count(),1)
  await page.getByRole('button',{name:'Open notification: Match ready for review'}).click();assert.equal((await page.evaluate(()=>window.opens))[0].targetId,'match')
  await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Refresh notifications'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Open notification: Availability updated'}).count(),1)
  await mkdir('output/playwright/mobile-convenience',{recursive:true});await page.screenshot({path:'output/playwright/mobile-convenience/notification-history-dark.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.deepEqual(errors,[])
  console.log('PASS: saved templates, draft-only apply, missing players, lock/delete; map opt-in, attribution, zoom/offline/context reset; notification history, deduplication, links and failure recovery at 320px')
} finally {await browser.close()}
