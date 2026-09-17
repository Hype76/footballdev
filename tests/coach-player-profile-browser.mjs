import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const source = await readFile('apps/coach-mobile/src/CoachOperationalScreens.js', 'utf8')
const helpers = source.slice(source.indexOf('function useDomainStyles('), source.indexOf('export function CoachCalendarScreen('))
const screen = source.slice(source.indexOf('export function CoachPlayersScreen('), source.indexOf('export function CoachSessionsScreen('))
  .replace('  const cancelForm =', '  window.submitPlayerForm = save;\n  const cancelForm =')
const entry = `
import React,{useState,useMemo,useEffect,useCallback,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {View,Text,StyleSheet,Pressable,TextInput} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {coachPlayerFormFromPlayer,filterCoachPlayers,formatCoachParentAppInstallationStatus,getCoachPlayerMutationPolicy} from './apps/mobile-core/src/coachPlayersCore.js';
import {getParentPortalInviteActionForContact,getUnlistedParentAccessLinks} from './src/lib/parent-portal-invite-actions.js';
import {formatUkDate} from './src/lib/date-format.js';
const BrandLoader=()=>null,useConfirmedConnectionIssue=v=>v,useConfirmedConnectionMessage=v=>v,getMobileIconName=()=> 'person',message=e=>e.message;
const readCoachOfflineResources=async()=>null,saveCoachOfflineResources=async()=>{},peekMobileResource=()=>undefined,readMobileResource=async(u,k,fn)=>fn(),invalidateMobileResource=()=>{};
const players=Array.from({length:16},(_,i)=>({id:'player-'+i,playerName:'FP TEST Player '+i,section:'Squad',positions:['Defender'],shirtNumber:String(i+1),status:'active',parentContacts:[{name:'FP TEST Parent',email:'parent@example.test',type:'parent'},{name:'Second Parent',email:'second@example.test',type:'parent'}],parentAppInstallationStatusAvailable:true,parentAppContactCount:2,parentAppInstalledContactCount:1}));
const getCoachPlayerList=async()=>players.map(p=>({...p}));window.saved=[];window.inviteCalls=[];let parentLinks=[];window.setParentLinks=links=>{parentLinks=links};const saveCoachPlayer=async(u,f,p)=>{window.saved.push(f);if(window.holdSave)await new Promise((resolve,reject)=>{window.resolveSave=resolve;window.rejectSave=()=>reject(new Error('Earlier save failed.'))});const saved={...(p||{id:'created-player',status:'active'}),...f,positions:f.positions?f.positions.split(','):[]};const i=players.findIndex(row=>row.id===saved.id);if(i>=0)players[i]=saved;else players.push(saved);return saved};const sendCoachParentInvite=async(u,id,c)=>{window.inviteCalls.push(c.email);parentLinks=[{id:'link',email:c.email,status:'pending',invite_sent_at:'2026-09-15'}];return{success:true}};const getCoachParentLinks=async()=>parentLinks;const revokeCoachParentAccess=async()=>{parentLinks=[]};
window.requests=[];window.scrollRequests=0;window.pending={};
const getCoachPlayerDetail=async(user,id)=>{
 window.requests.push(id);
 if(window.hold===id)await new Promise(resolve=>window.pending[id]=resolve);
 if(window.fail){window.fail=false;throw new Error('Player details could not be loaded.');}
 return {player:{...players.find(p=>p.id===id),notes:'Private profile for '+id},parentLinks,matchStats:{year:2026,matchdaySquad:6,goals:3,assists:2},fields:[],sessions:[],evaluations:[{id:'evaluation',date:'2026-09-15',session:'FP TEST Session',averageScore:7,comments:'Development notes'}]};
};
${helpers}
${screen}
const user={id:'coach',clubId:'club',activeTeamId:'team'};
function App(){const [mode,setMode]=useState('light'),[readOnly,setReadOnly]=useState(false),[quickAction,setQuickAction]=useState(null);window.mode=setMode;window.readOnly=setReadOnly;window.quickAdd=()=>setQuickAction({intent:'create-player'});const handled=useCallback(()=>setQuickAction(null),[]);
 const context=useMemo(()=>({id:'team',clubId:'club',teamId:'team',roleRank:30,paymentAccess:{canMutate:!readOnly}}),[readOnly]);
 const palette=createCoachTheme({mode,context:{clubAccent:'#1d4079'}}).tokens;
 return <View style={{minHeight:'100vh',backgroundColor:palette.background,padding:12}}><CoachPlayersScreen context={context} user={user} palette={palette} quickAction={quickAction} onQuickActionHandled={handled} onNavigate={()=>{}} onRequestScrollTop={()=>{window.scrollRequests++;window.scrollTo(0,0)}}/></View>;
}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const browser = await chromium.launch({headless:true})
await mkdir('output/playwright/coach-player-profile',{recursive:true})
await writeFile('output/playwright/coach-player-profile/preview.js',result.outputFiles[0].text)
await writeFile('output/playwright/coach-player-profile/index.html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coach player profile preview</title></head><body style="margin:0;max-width:390px;margin-inline:auto"><div id="root"></div><script src="preview.js"></script></body></html>')
try {
  const page = await browser.newPage({viewport:{width:390,height:844}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  const expectProfile = async (id) => {
    await page.getByRole('button',{name:'Show private notes',exact:true}).or(page.getByRole('button',{name:'Hide private notes',exact:true})).waitFor()
    if(await page.getByRole('button',{name:'Show private notes',exact:true}).count()) await page.getByRole('button',{name:'Show private notes',exact:true}).click()
    await page.getByText('Private profile for '+id,{exact:true}).waitFor()
  }
  await page.setContent('<body style="margin:0"><div id="root"></div></body>')
  await page.addScriptTag({content:result.outputFiles[0].text})
  await page.getByText('FP TEST Player 12',{exact:true}).click()
  await page.getByRole('button',{name:'Show private notes',exact:true}).waitFor()
  assert.equal(await page.getByText('Private profile for player-12',{exact:true}).count(),0)
  await page.screenshot({path:'output/playwright/coach-player-profile/compact-default-390.png',fullPage:true})
  await expectProfile('player-12')
  assert.ok(await page.evaluate(()=>window.scrollRequests>0 && window.scrollY===0))
  assert.equal(await page.getByLabel('Search Players',{exact:true}).count(),0)
  assert.equal(await page.getByText('FP TEST Player 11',{exact:true}).count(),0)
  await page.getByRole('button',{name:'Show match stats',exact:true}).click()
  await page.getByText('Matchday squad',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Show player details',exact:true}).click()
  await page.getByText('No Session history.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Show parent and player contacts',exact:true}).click()
  await page.getByRole('button',{name:'Hide parent and player contacts',exact:true}).waitFor()
  assert.equal(await page.getByText('parent@example.test',{exact:true}).count(),1)
  assert.equal(await page.getByRole('button',{name:'Hide player details',exact:true}).getAttribute('aria-expanded'),'true')
  await page.getByRole('button',{name:'Hide player details',exact:true}).click()
  assert.equal(await page.getByText('No Session history.',{exact:true}).count(),0)
  await page.getByRole('button',{name:'Send Parent app invite',exact:true}).first().click()
  await page.getByText('Parent invite sent to parent@example.test.',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(()=>window.inviteCalls),['parent@example.test'])
  await page.getByRole('button',{name:'Resend Parent app invite',exact:true}).waitFor()
  await page.getByRole('button',{name:'Show recent records',exact:true}).click()
  await page.getByText('15:09:2026 | FP TEST Session | Score 7 | Development notes',{exact:true}).waitFor()
  for(const mode of ['light','dark'])for(const width of [320,390]){
    await page.evaluate(mode=>window.mode(mode),mode);await page.setViewportSize({width,height:844})
    await page.getByRole('button',{name:'Back to Players',exact:true}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await assertRenderedTextContrast(page, `compact Coach profile ${mode} ${width}`)
    await page.screenshot({path:'output/playwright/coach-player-profile/'+mode+'-'+width+'.png',fullPage:true})
  }
  await page.getByRole('button',{name:'Edit Player',exact:true}).click()
  await page.getByLabel('Player name',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Contact 2 email',{exact:true}).inputValue(),'second@example.test')
  await page.getByLabel('Contact 1 name',{exact:true}).fill('Edited Parent')
  assert.equal(await page.getByLabel('Contact 2 email',{exact:true}).inputValue(),'second@example.test')
  await page.getByRole('button',{name:'Add another contact',exact:true}).click()
  await page.getByLabel('Contact 3 name',{exact:true}).fill('Third Parent')
  await page.getByRole('button',{name:'Remove contact 3',exact:true}).click()
  assert.equal(await page.getByLabel('Contact 3 name',{exact:true}).count(),0)
  await page.getByRole('button',{name:'Back to player profile',exact:true}).click()
  await expectProfile('player-12')
  await page.getByRole('button',{name:'Edit Player',exact:true}).click()
  await page.getByLabel('Player name',{exact:true}).fill('FP TEST Renamed Player')
  await page.getByRole('button',{name:'Save Player',exact:true}).click()
  await page.getByText('FP TEST Renamed Player',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Back to Players',exact:true}).click()
  await page.getByText('FP TEST Renamed Player',{exact:true}).waitFor()
  assert.equal(await page.getByText('FP TEST Player 12',{exact:true}).count(),0)
  await page.getByRole('button',{name:/Add Player/}).click()
  await page.getByLabel('Player name',{exact:true}).fill('FP TEST Created Player')
  await page.getByRole('button',{name:'Save Player',exact:true}).click()
  await expectProfile('created-player')
  await page.getByRole('button',{name:'Back to Players',exact:true}).click()
  await page.getByText('FP TEST Created Player',{exact:true}).waitFor()
  await page.getByText('FP TEST Created Player',{exact:true}).click()
  await page.getByRole('button',{name:'Edit Player',exact:true}).click()
  await page.getByLabel('Player name',{exact:true}).fill('FP TEST Deferred Save')
  const savesBefore = await page.evaluate(()=>{window.holdSave=true;return window.saved.length})
  // Invoke the real save handler twice before React can commit disabled state.
  await page.evaluate(()=>{void window.submitPlayerForm();void window.submitPlayerForm()})
  await page.waitForFunction(()=>typeof window.resolveSave==='function')
  assert.equal(await page.evaluate(()=>window.saved.length),savesBefore+1)
  await page.evaluate(()=>window.quickAdd())
  await page.waitForFunction(()=>document.querySelector('[aria-label="Player name"]')?.value==='')
  await page.getByLabel('Player name',{exact:true}).fill('FP TEST Unsaved New Player')
  await page.getByLabel('Contact 1 email',{exact:true}).fill('new-parent@synthetic.test')
  await page.evaluate(()=>window.resolveSave())
  await page.getByRole('button',{name:'Save Player',exact:true}).waitFor()
  assert.equal(await page.getByLabel('Player name',{exact:true}).inputValue(),'FP TEST Unsaved New Player')
  assert.equal(await page.getByLabel('Contact 1 email',{exact:true}).inputValue(),'new-parent@synthetic.test')
  assert.equal(await page.getByText('Player saved. Use the Parent invite button beside a contact to send their invitation.',{exact:true}).count(),0)
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByText('FP TEST Deferred Save',{exact:true}).waitFor()
  await page.getByText('FP TEST Deferred Save',{exact:true}).click()
  await page.getByRole('button',{name:'Edit Player',exact:true}).click()
  await page.getByRole('button',{name:'Save Player',exact:true}).click()
  await page.getByRole('button',{name:'Saving...',exact:true}).waitFor()
  await page.evaluate(()=>window.quickAdd())
  await page.waitForFunction(()=>document.querySelector('[aria-label="Player name"]')?.value==='')
  await page.getByLabel('Player name',{exact:true}).fill('FP TEST Keep After Earlier Error')
  await page.evaluate(()=>{window.rejectSave();window.holdSave=false})
  await page.getByRole('button',{name:'Save Player',exact:true}).waitFor()
  assert.equal(await page.getByLabel('Player name',{exact:true}).inputValue(),'FP TEST Keep After Earlier Error')
  assert.equal(await page.getByText('Earlier save failed.',{exact:true}).count(),0)
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByLabel('Search Players',{exact:true}).fill('Player 1')
  await page.evaluate(()=>window.fail=true)
  await page.getByText('FP TEST Player 14',{exact:true}).click()
  await page.getByText('Player details could not be loaded.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Try again',exact:true}).click()
  await expectProfile('player-14')
  assert.deepEqual(await page.evaluate(()=>window.requests.slice(-2)),['player-14','player-14'])
  await page.getByRole('button',{name:'Back to Players',exact:true}).click()
  assert.equal(await page.getByLabel('Search Players',{exact:true}).inputValue(),'Player 1')
  await page.evaluate(()=>window.hold='player-10')
  await page.getByText('FP TEST Player 10',{exact:true}).click()
  await page.getByText('Opening FP TEST Player 10...',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Back to Players',exact:true}).click()
  await page.getByText('FP TEST Player 11',{exact:true}).click()
  await page.getByRole('button',{name:'Show match stats',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Show private notes',exact:true}).getAttribute('aria-expanded'),'false')
  await expectProfile('player-11')
  await page.evaluate(()=>window.pending['player-10']())
  assert.equal(await page.getByText('Private profile for player-10',{exact:true}).count(),0)
  await page.evaluate(()=>window.setParentLinks([{id:'former-link',email:'former@example.test',status:'active'}]))
  await page.getByRole('button',{name:'Refresh player details',exact:true}).click()
  await page.getByRole('button',{name:'Show parent and player contacts',exact:true}).click()
  await page.getByText('Additional Parent access',{exact:true}).waitFor()
  await page.getByText('former@example.test',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Remove Parent access',exact:true}).click()
  await page.getByRole('button',{name:'Keep access',exact:true}).click()
  await page.getByText('former@example.test',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Remove Parent access',exact:true}).click()
  await page.getByRole('button',{name:'Confirm remove access',exact:true}).click()
  await page.getByText('Additional Parent access',{exact:true}).waitFor({state:'hidden'})
  await page.evaluate(()=>window.readOnly(true))
  await page.getByRole('button',{name:'Edit Player',exact:true}).waitFor({state:'hidden'})
  await expectProfile('player-11')
  assert.deepEqual(errors,[])
  console.log('PASS: Coach player profiles preserve contacts, reject duplicate saves, preserve newer Quick Add forms after delayed save success/error, retain filters, reject late detail responses, preserve permissions, and render at 320/390px in light/dark themes.')
} finally {await browser.close()}
