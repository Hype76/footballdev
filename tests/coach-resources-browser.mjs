import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { COACH_RESOURCE_CATEGORIES, groupCoachResources } from '../apps/mobile-core/src/coachResourceBrowseCore.js'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const source = await readFile('apps/coach-mobile/src/CoachPhase31EScreens.js', 'utf8')
const helpers = source.slice(source.indexOf('function phaseStyles('), source.indexOf('export function CoachPhase31EScreen('))
const screen = source.slice(source.indexOf('function ResourcesDomain('), source.indexOf('function ChatDomain('))
const fixture = [
  {id:'old', title:'Training report 01-09-2026', category:'training', description:'Passing practice', links:[]},
  {id:'new', title:'Training report 15-09-2026', category:'training', description:'First touch', links:[{id:'link',linkedType:'player',linkedId:'p0'}]},
  {id:'general', title:'Club handbook', category:'general', links:[]},
  {id:'match', title:'Match plan', category:'match_day', originalFilename:'tactics.pdf', links:[]},
]
assert.deepEqual(groupCoachResources(fixture).find(group=>group.category==='training').resources.map(r=>r.id),['new','old'])
assert.equal(groupCoachResources(fixture,'TACtics')[0].resources[0].id,'match')
assert.equal(groupCoachResources(fixture,'Match day')[0].category,'match_day')
assert.deepEqual(COACH_RESOURCE_CATEGORIES.map(c=>c.value),['general','training','match_day','development','admin'])
const entry = `
import React,{useState,useMemo,useEffect,useCallback,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {View,Text,StyleSheet,Pressable,TextInput,Switch,Modal,ScrollView} from 'react-native';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {COACH_RESOURCE_CATEGORIES,groupCoachResources} from './apps/mobile-core/src/coachResourceBrowseCore.js';
import {getResourceDisplayTitle} from './src/lib/resource-date-presentation.js';
const SafeAreaView=View,config={isProduction:true};
const resources=${JSON.stringify(fixture)};
window.calls=[];window.created=[];window.playerLoads=0;
const getCoachPlayerList=async()=>{window.playerLoads++;if(window.failPlayers){window.failPlayers=false;throw new Error('Player loading failed.')}return Array.from({length:22},(_,i)=>({id:'p'+i,playerName:'FP TEST Player '+i}))};
const getCoachFriendlyError=e=>e.message,getCoachResourceErrorMessage=e=>e.message;
const getCoachResourceAccessUrl=async()=>{if(window.failOpen){window.failOpen=false;throw new Error('Resource could not be opened.')}return 'https://example.test/resource'};
const Linking={canOpenURL:async()=>true,openURL:async u=>window.calls.push(['open',u])};
const createCoachExternalResource=async(u,form)=>{window.created.push(form);if(window.holdCreate)await new Promise(resolve=>window.releaseCreate=resolve);resources.push({id:'created',title:form.title,category:form.category,links:[]})};
const setCoachResourceSharing=async(u,r,targets)=>{window.calls.push(['share',r.id,targets]);if(window.failShare){window.failShare=false;throw new Error('Sharing failed. Try again.')}r.links.push(...targets.map((t,i)=>({...t,id:'new-link-'+i})));};
const removeCoachResourceSharing=async(u,r,id)=>{window.calls.push(['remove',r.id,id]);r.links=r.links.filter(l=>l.id!==id)};
${helpers}
${screen}
function App(){const [mode,setMode]=useState('light'),[rank,setRank]=useState(50),[stale,setStale]=useState(false),[data,setData]=useState(resources.slice()),[notice,setNotice]=useState('');window.mode=setMode;window.rank=setRank;window.stale=setStale;
const user=useMemo(()=>({id:'coach',activeTeamId:'team',roleRank:rank}),[rank]);const styles=phaseStyles(createCoachTheme({mode}).tokens);const load=useCallback(async()=>setData(resources.slice()),[]);
return <View style={{minHeight:'100vh',padding:12,backgroundColor:styles.chatModal.backgroundColor}}><Text>{notice}</Text><ResourcesDomain data={data} load={load} setNotice={setNotice} stale={stale} styles={styles} user={user}/></View>}
createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const browser=await chromium.launch({headless:true})
await mkdir('output/playwright/coach-resources',{recursive:true})
try {
  const page=await browser.newPage({viewport:{width:390,height:844}})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<body style="margin:0"><div id="root"></div></body>')
  await page.addScriptTag({content:result.outputFiles[0].text})
  await page.getByLabel('Search resources',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Open Resource',exact:true}).count(),0)
  assert.equal(await page.evaluate(()=>window.playerLoads),0)
  await page.getByRole('button',{name:'Training resources',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Open Resource',exact:true}).count(),2)
  const titles=await page.getByText(/Training report \d/).allTextContents()
  assert.deepEqual(titles,['Training report 15:09:2026','Training report 01:09:2026'])
  await page.getByLabel('Search resources',{exact:true}).fill('first')
  assert.equal(await page.getByRole('button',{name:'Open Resource',exact:true}).count(),1)
  await page.getByLabel('Search resources',{exact:true}).fill('zzzz')
  await page.getByText('No resources match your search.',{exact:true}).waitFor()
  await page.getByLabel('Search resources',{exact:true}).fill('training')
  await page.evaluate(()=>window.failOpen=true)
  await page.getByRole('button',{name:'Open Resource',exact:true}).first().click()
  await page.getByText('Resource could not be opened.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Open Resource',exact:true}).first().click()
  await page.getByText('Resource opened.',{exact:true}).waitFor()
  for(const mode of ['light','dark'])for(const width of [320,390]){
    await page.evaluate(mode=>window.mode(mode),mode);await page.setViewportSize({width,height:844})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:'output/playwright/coach-resources/browse-'+mode+'-'+width+'.png',fullPage:true})
  }
  await page.evaluate(()=>window.failPlayers=true)
  await page.getByRole('button',{name:'Manage access',exact:true}).first().click()
  await page.getByText('Player loading failed.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Retry loading players',exact:true}).click()
  await page.getByRole('button',{name:'Remove from FP TEST Player 0',exact:true}).waitFor()
  await page.getByLabel('Search players to assign',{exact:true}).fill('Player 21')
  await page.getByRole('button',{name:'Assign to FP TEST Player 21',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Remove from FP TEST Player 0',exact:true}).count(),0)
  await page.evaluate(()=>window.failShare=true)
  await page.getByRole('button',{name:'Assign to FP TEST Player 21',exact:true}).click()
  await page.getByText('Sharing failed. Try again.',{exact:true}).last().waitFor()
  await page.getByRole('button',{name:'Assign to FP TEST Player 21',exact:true}).click()
  await page.getByRole('button',{name:'Remove from FP TEST Player 21',exact:true}).waitFor()
  for(const mode of ['light','dark'])for(const width of [320,390]){
    await page.evaluate(mode=>window.mode(mode),mode);await page.setViewportSize({width,height:844})
    const back=await page.getByRole('button',{name:'Back to Resources',exact:true}).boundingBox();assert.ok(back.y>=0 && back.y<150)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:'output/playwright/coach-resources/access-'+mode+'-'+width+'.png'})
  }
  await page.getByLabel('Search players to assign',{exact:true}).fill('Nobody')
  await page.getByText('No players match your search.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Assign to all Players',exact:true}).click()
  await page.getByText('Resource assigned to 20 Players.',{exact:true}).last().waitFor()
  const bulkTargets=await page.evaluate(()=>window.calls.filter(call=>call[0]==='share').at(-1)[2])
  assert.equal(bulkTargets.length,20)
  assert.ok(bulkTargets.every(target=>!['p0','p21'].includes(target.linkedId)))
  await page.getByLabel('Search players to assign',{exact:true}).fill('Player 21')
  await page.getByRole('button',{name:'Remove from FP TEST Player 21',exact:true}).click()
  await page.getByRole('button',{name:'Assign to FP TEST Player 21',exact:true}).waitFor()
  await page.evaluate(()=>window.stale(true))
  await page.getByText('Reconnect to change resource access.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Share with active Team',exact:true}).getAttribute('aria-disabled'),'true')
  await page.evaluate(()=>{window.stale(false);window.rank(30)})
  await page.getByText('Your role can view resource access. A Team Admin can change it.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Share with active Team',exact:true}).getAttribute('aria-disabled'),'true')
  await page.getByRole('button',{name:'Back to Resources',exact:true}).click()
  await page.getByRole('button',{name:'Back to Resources',exact:true}).waitFor({state:'hidden'})
  assert.equal(await page.getByLabel('Search resources',{exact:true}).inputValue(),'training')
  await page.evaluate(()=>window.rank(50))
  await page.getByRole('button',{name:'Add secure external link',exact:true}).click()
  await page.getByLabel('Resource title',{exact:true}).fill('FP TEST Match resource')
  await page.getByLabel('HTTPS Resource URL',{exact:true}).fill('https://example.test/tactics')
  await page.getByRole('button',{name:'Match day',exact:true}).click()
  await page.evaluate(()=>window.holdCreate=true)
  await page.getByRole('button',{name:'Create Resource',exact:true}).click()
  await page.getByRole('button',{name:'Creating resource...',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Creating resource...',exact:true}).getAttribute('aria-disabled'),'true')
  await page.evaluate(()=>window.releaseCreate())
  await page.getByText('External Resource created.',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(()=>window.created),[{title:'FP TEST Match resource',externalUrl:'https://example.test/tactics',category:'match_day'}])
  assert.deepEqual(errors,[])
  console.log('PASS: actual ResourcesDomain collapses categories, filters live, sorts newest first, opens a focused access manager with player search, preserves Back, handles failures, guards mutations, restricts stale/read-only actions, saves category, and renders at 320/390px in light/dark themes.')
} finally {await browser.close()}
