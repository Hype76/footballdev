import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root=process.cwd(),modules=path.join(root,'apps/coach-mobile/node_modules'),out='output/playwright/compact-match-invites'
await mkdir(out,{recursive:true})
const source=await readFile('apps/coach-mobile/src/CoachPhase31EScreens.js','utf8')
const helpers=source.slice(source.indexOf('function phaseStyles('),source.indexOf('export function CoachPhase31EScreen'))
const domain=source.slice(source.indexOf('function InvitesDomain('))
const core=source.match(/import \{\s+COACH_PHASE_31E_BACKEND_DELTAS,[\s\S]*?from '..\/..\/mobile-core\/src\/coachPhase31ECore'/)[0].replace('../../mobile-core/src/coachPhase31ECore','./apps/mobile-core/src/coachPhase31ECore.js')
const names=['Brendan Templeton','Ethan Clarke','Finn Saunders','Freddie Norman','Freddy Davison','Jenson Bailey','Josh Allen','Joshua Mcgrory','Kaylan Thorley','Kyle De Dominicis','Lewis Gibbs','Louis Burton','Marcell Danner','Mason Wright','Salvador','Stanley Mcgaw','Thadeous Knight']
const entry=`import React,{useState,useEffect,useMemo,useRef}from'react';import{createRoot}from'react-dom/client';import{View,Text,StyleSheet,Pressable,Modal,Alert}from'react-native';import MaterialIcons from'@expo/vector-icons/MaterialIcons';import{CoachMatchInviteTable}from'./apps/coach-mobile/src/CoachMatchInviteTable.js';import{InviteStatusBadge}from'./apps/mobile-core/src/InviteStatusBadge.js';import{createCoachTheme}from'./apps/coach-mobile/src/coachThemeCore.js';${core}
const config={isProduction:true};const getCoachFriendlyError=e=>e.message;window.sends=[];const recordCoachInviteIntent=async(user,invite)=>{window.sends.push(invite.playerId);return{recipientCount:1}};Alert.alert=(title,message,buttons)=>window.alert={title,message,buttons};
${helpers}\n${domain}
const names=${JSON.stringify(names)};const match={id:'fixture-one',teamId:'team',status:'scheduled',matchDate:'2099-09-06',opponent:'St Neots',kickoffTime:'10:45',venueName:'St Neots'};
const rows=names.map((playerName,i)=>({id:'invite-'+i,playerId:'player-'+i,playerName,kind:'match',eventId:match.id,status:[9,14,15].includes(i)?'awaiting':'available',deliveryState:'delivered',deliveryStatus:'delivered',sentAt:'2099-09-01',respondedAt:[9,14,15].includes(i)?'':'2099-09-02'}));
function App(){const[mode,setMode]=useState('dark'),[invites,setInvites]=useState(rows),[stale,setStale]=useState(false),[rank,setRank]=useState(50),[key,setKey]=useState(0),[notice,setNotice]=useState('');window.mode=setMode;window.invites=setInvites;window.stale=setStale;window.rank=setRank;window.reset=()=>{setKey(k=>k+1);setInvites(rows)};window.rows=rows;
const palette=createCoachTheme({mode,context:{clubAccent:'#1d3f78'}}).tokens;return <View dataSet={{mode}} style={{backgroundColor:palette.background,padding:8,minHeight:'100vh'}}><Text style={{color:palette.textPrimary,fontSize:24,fontWeight:'800',padding:8}}>Match Invites</Text>{notice?<Text>{notice}</Text>:null}<InvitesDomain key={key} data={{matches:[match,{...match,id:'fixture-two',opponent:'Second opponent'}],match:invites,players:names.map((playerName,i)=>({id:'player-'+i,playerName,shirtNumber:String([4,1,7,10,9,22,27,98,11,27,5,8,15,3,18,20,6][i])})),training:[]}} palette={palette} styles={phaseStyles(palette)} user={{id:'coach',activeTeamId:'team',roleRank:rank}} stale={stale} load={async()=>{}} reloadHome={async()=>{}} setNotice={setNotice} onNavigate={()=>{}}/></View>};createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
await writeFile(`${out}/app.js`,result.outputFiles[0].text)
await writeFile(`${out}/index.html`,'<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div><script src="app.js"></script>')
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.setContent('<body style="margin:0"><div id="root"></div>');await page.addScriptTag({content:result.outputFiles[0].text})
 await page.getByRole('button',{name:'Open availability for St Neots'}).click()
 const boxes=()=>page.getByRole('checkbox')
 assert.equal(await boxes().count(),17)
 assert.equal(await page.getByText('98',{exact:true}).count(),1,'Saved shirt numbers are displayed')
 await page.getByRole('button',{name:'Filter Available, 14 players'}).waitFor()
 await page.getByRole('button',{name:'Filter Awaiting, 3 players'}).click();assert.equal(await boxes().count(),3)
 await boxes().first().click();await page.getByText('1 Player selected.',{exact:true}).waitFor();await page.evaluate(()=>window.invites(window.rows.map(r=>r.playerId==='player-9'?{...r,status:'available'}:r)));await page.getByText('1 Player selected.',{exact:true}).waitFor({state:'hidden'});assert.equal(await boxes().count(),2,'An incoming response cannot leave a hidden player selected');await page.evaluate(()=>window.invites(window.rows));await page.getByRole('button',{name:'Filter Awaiting, 3 players'}).waitFor()
 await boxes().first().click();await page.getByText('1 Player selected.',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Filter Available, 14 players'}).click();assert.equal(await boxes().count(),14)
 assert.equal(await page.getByText('1 Player selected.',{exact:true}).count(),0,'Filter changes clear hidden selections')
 await page.getByRole('button',{name:'Filter Unavailable, 0 players'}).click();await page.getByText('No players match this filter.').waitFor()
 await page.getByRole('button',{name:'All 17',exact:true}).click();assert.equal(await boxes().count(),17)
 await page.getByRole('button',{name:'Sort by player'}).click();assert.match(await boxes().first().getAttribute('aria-label'),/^Thadeous/)
 await page.getByRole('button',{name:'Sort by player'}).click();assert.match(await boxes().first().getAttribute('aria-label'),/^Brendan/)
 await page.getByRole('button',{name:'Sort by response'}).click();await page.getByRole('button',{name:'Sort by response'}).click();assert.match(await boxes().first().getAttribute('aria-label'),/^Kyle/);await page.getByRole('button',{name:'Sort by player'}).click()
 for(const mode of ['dark','light'])for(const width of [390,320]){
  await page.evaluate(mode=>window.mode(mode),mode);await page.locator(`[data-mode="${mode}"]`).waitFor();await page.setViewportSize({width,height:844})
  await assertRenderedTextContrast(page,`Compact invites ${mode} ${width}`)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  const height=await boxes().first().boundingBox();assert.ok(height.height<70,'Rows remain compact')
  await page.screenshot({path:`${out}/${mode}-${width}.png`,fullPage:true})
 }
 await page.getByRole('button',{name:'Kyle De Dominicis invitation details'}).click();await page.getByText('Seen: Not yet',{exact:true}).waitFor();await page.getByRole('button',{name:'Close invitation details'}).click()
 await page.getByRole('button',{name:'Notify awaiting players'}).click();assert.match(await page.evaluate(()=>window.alert.title),/Resend 3 Invitations/);assert.equal(await page.evaluate(()=>window.sends.length),0)
 await page.evaluate(()=>window.alert.buttons[0].onPress?.());assert.equal(await page.evaluate(()=>window.sends.length),0)
 await page.getByRole('button',{name:'Notify awaiting players'}).click();await page.evaluate(()=>window.alert.buttons[1].onPress());await page.waitForFunction(()=>window.sends.length===3);assert.deepEqual(await page.evaluate(()=>window.sends),['player-9','player-14','player-15'])
 await page.evaluate(()=>window.stale(true));await page.locator('[role=checkbox][aria-disabled=true]').first().waitFor();assert.equal(await boxes().first().getAttribute('aria-disabled'),'true');assert.equal(await page.getByRole('button',{name:'Notify awaiting players'}).getAttribute('aria-disabled'),'true')
 await page.evaluate(()=>{window.stale(false);window.rank(20)});await page.locator('[role=checkbox]:not([aria-disabled=true])').first().waitFor();assert.equal(await page.getByRole('button',{name:'Notify awaiting players'}).getAttribute('aria-disabled'),'true')
 await page.evaluate(()=>{window.invites(window.rows.map((r,i)=>i===0?{...r,status:'maybe'}:i===1?{...r,responseSource:'staff_on_behalf'}:r))})
 await page.getByRole('button',{name:'Filter Maybe, 1 players'}).click();assert.equal(await boxes().count(),1)
 await page.getByRole('button',{name:'All 17',exact:true}).click();await page.getByRole('button',{name:'Ethan Clarke invitation details'}).click();await page.getByText('Seen: Not yet',{exact:true}).waitFor();await page.getByRole('button',{name:'Close invitation details'}).click()
 await page.getByRole('button',{name:'All events',exact:true}).click();await page.getByRole('button',{name:'Open availability for Second opponent'}).click();await page.getByText('No availability requests have been sent for this fixture.').waitFor();assert.equal(await boxes().count(),0)
 assert.deepEqual(errors,[])
 console.log('PASS: compact Match table filters/counts, empty state, sorting, selection clearing, shirt numbers, message details, staff Seen exclusion, Notify confirmation/permissions, fixture reset, light/dark contrast, 320/390px and no console errors.')
}finally{await browser.close()}
