import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const source = await readFile('apps/coach-mobile/src/CoachPhase31EScreens.js', 'utf8')
const styles = source.slice(source.indexOf('function phaseStyles('), source.indexOf('\nfunction InviteDeliveryTicks'))
const button = source.slice(source.indexOf('function Button('), source.indexOf('\nfunction Empty('))
const empty = source.slice(source.indexOf('function Empty('), source.indexOf('\nexport function CoachPhase31EScreen('))
const development = source.slice(source.indexOf('function DevelopmentDomain('), source.indexOf('\nfunction ResourcesDomain('))
const entry = `
import React,{useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js'
import {resolveCoachDevelopmentForm} from './apps/mobile-core/src/coachPhase31ECore.js'
const DevelopmentOfflineEditor=({form,player,styles})=><View accessibilityLabel="Development editor" style={styles.panel}><Text style={styles.body}>Editor for {player.playerName}</Text>{form.fields.map(field=><TextInput key={field.id} accessibilityLabel={field.label} value="" onChangeText={()=>{}} />)}</View>
${styles}
${button}
${empty}
${development}
const data={players:[{id:'player-a',playerName:'FP TEST Alex'},{id:'player-b',playerName:'FP TEST Bailey'}],forms:[{id:'form-a',name:'FP TEST Attacking Review',fields:[{id:'attack',label:'Attacking score',roleRank:0}]},{id:'form-b',name:'FP TEST Defensive Review',fields:[{id:'defence',label:'Defensive score',roleRank:0}]}],drafts:[],records:[{id:'record-a',playerId:'player-a',date:'15:09:2026',status:'finalised',formName:'FP TEST Attacking Review',averageScore:7},{id:'record-b',playerId:'player-b',date:'14:09:2026',status:'finalised',formName:'FP TEST Defensive Review',averageScore:8}]}
const context={id:'team',clubId:'club',teamId:'team',role:'coach'}
const user={id:'coach',roleRank:70}
function App(){const [mode,setMode]=useState('light');window.setMode=setMode;const palette=createCoachTheme({mode,context:{clubAccent:'#1d4079'}}).tokens;const styles=phaseStyles(palette);const [notice,setNotice]=useState('');return <View style={{backgroundColor:palette.background,minHeight:'100vh',padding:12}}><View accessibilityLabel="Development header" style={styles.developmentHeader}><Text accessibilityRole="header" style={styles.title}>Development</Text><Text style={styles.body}>FP TEST Team | Coach</Text></View><DevelopmentDomain context={context} data={data} load={()=>{}} setNotice={setNotice} stale={false} styles={styles} user={user}/>{notice?<Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text>:null}</View>}
createRoot(document.getElementById('root')).render(<App/>)`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:390,height:844}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<body style="margin:0"><div id="root"></div></body>')
  await page.addScriptTag({content:result.outputFiles[0].text})
  const playerSelector=page.getByRole('button',{name:'Choose Development Player',exact:true})
  const formSelector=page.getByRole('button',{name:'Choose Development form',exact:true})
  await playerSelector.waitFor()
  assert.equal(await playerSelector.getAttribute('aria-expanded'),'false')
  assert.equal(await page.getByText('FP TEST Bailey',{exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'Show recent forms',exact:true}).getAttribute('aria-expanded'),'false')
  const outerAppearance=await page.getByLabel('Development header',{exact:true}).evaluate(element=>{const style=getComputedStyle(element);return {background:style.backgroundColor,borderBottom:style.borderBottomWidth,borderLeft:style.borderLeftWidth,borderRadius:style.borderTopLeftRadius,borderRight:style.borderRightWidth,borderTop:style.borderTopWidth}})
  assert.deepEqual(outerAppearance,{background:'rgba(0, 0, 0, 0)',borderBottom:'1px',borderLeft:'0px',borderRadius:'0px',borderRight:'0px',borderTop:'0px'})
  await playerSelector.click()
  await page.getByRole('radio',{name:'FP TEST Bailey. Choose this Player',exact:true}).click()
  await page.getByText('Editor for FP TEST Bailey',{exact:true}).waitFor()
  assert.equal(await playerSelector.getAttribute('aria-expanded'),'false')
  await formSelector.click()
  await page.getByRole('radio',{name:'FP TEST Defensive Review. Choose this form',exact:true}).click()
  await page.getByLabel('Defensive score',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Attacking score',{exact:true}).count(),0)
  await page.getByText('FP TEST Defensive Review selected. The form fields have been updated.',{exact:true}).waitFor()
  assert.equal(await page.getByText('14:09:2026 | finalised | FP TEST Defensive Review | 8',{exact:true}).count(),0)
  await page.getByRole('button',{name:'Show recent forms',exact:true}).click()
  await page.getByText('14:09:2026 | finalised | FP TEST Defensive Review | 8',{exact:true}).waitFor()
  const order=await page.evaluate(()=>{const recent=[...document.querySelectorAll('[aria-label="Hide recent forms"]')][0];const editor=document.querySelector('[aria-label="Development editor"]');return Boolean(recent?.compareDocumentPosition(editor)&Node.DOCUMENT_POSITION_FOLLOWING)})
  assert.equal(order,true)
  const editorAppearance=await page.getByLabel('Development editor',{exact:true}).evaluate(element=>{const style=getComputedStyle(element);return {background:style.backgroundColor,borderBottom:style.borderBottomWidth,borderLeft:style.borderLeftWidth,borderRadius:style.borderTopLeftRadius,borderRight:style.borderRightWidth,borderTop:style.borderTopWidth}})
  assert.deepEqual(editorAppearance,{background:'rgba(0, 0, 0, 0)',borderBottom:'1px',borderLeft:'0px',borderRadius:'0px',borderRight:'0px',borderTop:'0px'})
  const compactAppearance=await playerSelector.evaluate(element=>{const style=getComputedStyle(element);return {background:style.backgroundColor,borderBottom:style.borderBottomWidth,borderLeft:style.borderLeftWidth,borderRadius:style.borderTopLeftRadius,borderRight:style.borderRightWidth,borderTop:style.borderTopWidth}})
  assert.deepEqual(compactAppearance,{background:'rgba(0, 0, 0, 0)',borderBottom:'1px',borderLeft:'0px',borderRadius:'0px',borderRight:'0px',borderTop:'0px'})
  await mkdir('output/playwright/coach-development-selectors',{recursive:true})
  for(const mode of ['light','dark'])for(const width of [320,390]){await page.evaluate(value=>window.setMode(value),mode);await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await assertRenderedTextContrast(page,`Coach Development selectors ${mode} ${width}`);await page.screenshot({path:`output/playwright/coach-development-selectors/${mode}-${width}.png`,fullPage:true})}
  assert.deepEqual(errors,[])
  console.log('PASS: Coach Development uses compact Player and Form selectors, preserves form-field remounting, and places Recent forms before the editor and keeps it collapsed until requested at 320/390px in light/dark themes.')
} finally {await browser.close()}
