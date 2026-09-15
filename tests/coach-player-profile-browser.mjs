import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const source = await readFile('apps/coach-mobile/src/CoachOperationalScreens.js', 'utf8')
const helpers = source.slice(source.indexOf('function useDomainStyles('), source.indexOf('export function CoachCalendarScreen('))
const screen = source.slice(source.indexOf('export function CoachPlayersScreen('), source.indexOf('export function CoachSessionsScreen('))
const entry = `
import React,{useState,useMemo,useEffect,useCallback,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {View,Text,StyleSheet,Pressable,TextInput} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {coachPlayerFormFromPlayer,filterCoachPlayers,formatCoachParentAppInstallationStatus,getCoachPlayerMutationPolicy} from './apps/mobile-core/src/coachPlayersCore.js';
import {formatUkDate} from './src/lib/date-format.js';
const BrandLoader=()=>null,useConfirmedConnectionIssue=v=>v,useConfirmedConnectionMessage=v=>v,getMobileIconName=()=> 'person',message=e=>e.message;
const readCoachOfflineResources=async()=>null,saveCoachOfflineResources=async()=>{},peekMobileResource=()=>undefined,readMobileResource=async(u,k,fn)=>fn(),invalidateMobileResource=()=>{};
const players=Array.from({length:16},(_,i)=>({id:'player-'+i,playerName:'FP TEST Player '+i,section:'Squad',positions:['Defender'],shirtNumber:String(i+1),status:'active',parentContacts:[],parentAppInstallationStatusAvailable:true,parentAppContactCount:2,parentAppInstalledContactCount:1}));
const getCoachPlayerList=async()=>players,saveCoachPlayer=async()=>{};
window.requests=[];window.scrollRequests=0;window.pending={};
const getCoachPlayerDetail=async(user,id)=>{
 window.requests.push(id);
 if(window.hold===id)await new Promise(resolve=>window.pending[id]=resolve);
 if(window.fail){window.fail=false;throw new Error('Player details could not be loaded.');}
 return {player:{...players.find(p=>p.id===id),notes:'Private profile for '+id},fields:[],sessions:[],evaluations:[{id:'evaluation',date:'2026-09-15',session:'FP TEST Session',averageScore:7,comments:'Development notes'}]};
};
${helpers}
${screen}
const user={id:'coach',clubId:'club',activeTeamId:'team'};
function App(){const [mode,setMode]=useState('light'),[readOnly,setReadOnly]=useState(false);window.mode=setMode;window.readOnly=setReadOnly;
 const context=useMemo(()=>({id:'team',clubId:'club',teamId:'team',roleRank:30,paymentAccess:{canMutate:!readOnly}}),[readOnly]);
 const palette=createCoachTheme({mode}).tokens;
 return <View style={{minHeight:'100vh',backgroundColor:palette.background,padding:12}}><CoachPlayersScreen context={context} user={user} palette={palette} onNavigate={()=>{}} onRequestScrollTop={()=>{window.scrollRequests++;window.scrollTo(0,0)}}/></View>;
}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const browser = await chromium.launch({headless:true})
await mkdir('output/playwright/coach-player-profile',{recursive:true})
try {
  const page = await browser.newPage({viewport:{width:390,height:844}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<body style="margin:0"><div id="root"></div></body>')
  await page.addScriptTag({content:result.outputFiles[0].text})
  await page.getByText('FP TEST Player 12',{exact:true}).click()
  await page.getByText('Private profile for player-12',{exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>window.scrollRequests>0 && window.scrollY===0))
  assert.equal(await page.getByLabel('Search Players',{exact:true}).count(),0)
  assert.equal(await page.getByText('FP TEST Player 11',{exact:true}).count(),0)
  await page.getByRole('button',{name:'Show recent records',exact:true}).click()
  await page.getByText('15:09:2026 | FP TEST Session | Score 7 | Development notes',{exact:true}).waitFor()
  for(const mode of ['light','dark'])for(const width of [320,390]){
    await page.evaluate(mode=>window.mode(mode),mode);await page.setViewportSize({width,height:844})
    await page.getByRole('button',{name:'Back to Players',exact:true}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:'output/playwright/coach-player-profile/'+mode+'-'+width+'.png',fullPage:true})
  }
  await page.getByRole('button',{name:'Edit Player',exact:true}).click()
  await page.getByLabel('Player name',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByText('Private profile for player-12',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Back to Players',exact:true}).click()
  await page.getByLabel('Search Players',{exact:true}).fill('Player 1')
  await page.evaluate(()=>window.fail=true)
  await page.getByText('FP TEST Player 14',{exact:true}).click()
  await page.getByText('Player details could not be loaded.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Try again',exact:true}).click()
  await page.getByText('Private profile for player-14',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(()=>window.requests.slice(-2)),['player-14','player-14'])
  await page.getByRole('button',{name:'Back to Players',exact:true}).click()
  assert.equal(await page.getByLabel('Search Players',{exact:true}).inputValue(),'Player 1')
  await page.evaluate(()=>window.hold='player-10')
  await page.getByText('FP TEST Player 10',{exact:true}).click()
  await page.getByText('Opening FP TEST Player 10...',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Back to Players',exact:true}).click()
  await page.getByText('FP TEST Player 11',{exact:true}).click()
  await page.getByText('Private profile for player-11',{exact:true}).waitFor()
  await page.evaluate(()=>window.pending['player-10']())
  assert.equal(await page.getByText('Private profile for player-10',{exact:true}).count(),0)
  await page.evaluate(()=>window.readOnly(true))
  await page.getByRole('button',{name:'Edit Player',exact:true}).waitFor({state:'hidden'})
  await page.getByText('Private profile for player-11',{exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS: actual Coach player rows open focused profiles, scroll to top, retain filters on Back, retry the selected player, cancel late responses, preserve edit permissions, and render at 320/390px in light/dark themes.')
} finally {await browser.close()}
