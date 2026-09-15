import { partnerBrowserFixture } from './helpers/partner-browser-fixture.mjs'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root = process.cwd(), modules = path.join(root, 'apps/parent-mobile/node_modules')
async function extract(file, names) {
  const source = await readFile(file, 'utf8')
  const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(n => n.type === 'ExportNamedDeclaration' ? n.declaration : n)
  return names.map(name => { const n = nodes.find(n => n?.type === 'FunctionDeclaration' && n.id.name === name); return source.slice(n.start, n.end) }).join('\n')
}
const portal = await extract('apps/parent-mobile/src/ParentPortalScreens.js', ['MoreScreen', 'usePortalStyles', 'colorsFor'])
const guest = await extract('apps/coach-mobile/src/CoachGuestScorer.js', ['CoachGuestScorer'])
const entry = `
import React,{useState,useMemo} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Image,Pressable,StyleSheet,Platform,Keyboard} from 'react-native';
import {MaterialIcons} from '@expo/vector-icons';
import ParentIcon from './apps/parent-mobile/src/ParentIcon';
import {PartnersBanner,PartnersScreen} from './apps/parent-mobile/src/PartnersScreen';
import {MatchResultIcon} from './apps/parent-mobile/src/MatchResultIcon';
import {PitchTypeIcon} from './apps/parent-mobile/src/PitchTypeIcon';
import {CoachDateTimeField} from './apps/coach-mobile/src/CoachDateTimeField';
import {createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME} from './apps/mobile-core/src/parentThemeCore';
window.native=()=>{Platform.OS='ios';Keyboard.dismiss=()=>window.keyboardDismissed=true};const request=()=>{};const useGuestScorerManagement=()=>({guest:null,busy:false,error:null,run:action=>window.guestAction=action});
${portal}\n${guest}
function App(){const[section,setSection]=useState('more'),[mode,setMode]=useState('light'),[time,setTime]=useState('10:45:00');window.section=setSection;window.mode=setMode;
const tokens=createParentMobileTheme({mode}).tokens,{colors,styles}=usePortalStyles(tokens);
return <View style={{padding:16,minHeight:'100vh',backgroundColor:colors.background}}>
{section==='more'?<MoreScreen onOpen={setSection} themeTokens={tokens}/>:section==='partners'?<><Pressable accessibilityRole="button" onPress={()=>setSection('more')}><Text style={styles.body}>Back to More</Text></Pressable><PartnersScreen appRole="parent" headingStyle={styles.header} textStyle={styles.body}/></>:section==='time'?<CoachDateTimeField label="Kick-off time" mode="time" value={time} onChange={setTime} styles={{field:{gap:8},input:{padding:12},inputText:{color:mode==='dark'?'#ffffff':'#10251f'}}}/>:section==='guest'?<CoachGuestScorer match={{id:'fixture',status:'scheduled'}} styles={{inputText:{color:colors.accentText}}}/>:<View style={{gap:20}}>{['won','loss','draw'].map((r,i)=><MatchResultIcon key={r} match={{status:'full_time',homeAway:'home',homeScore:2,awayScore:[1,3,2][i]}} textStyle={{color:colors.text}}/>)}<PitchTypeIcon compact textStyle={{color:colors.text}}/></View>}
</View>};createRoot(document.getElementById('root')).render(<App/>);`
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], nodePaths: [modules], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, plugins: [partnerBrowserFixture(), { name: 'native-picker', setup(b) { b.onResolve({ filter: /^@react-native-community\/datetimepicker$/ }, () => ({ path: 'picker', namespace: 'mock' })); b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `import React from 'react';export default function Picker(props){window.pickerProps=props;return <div>Native time picker</div>}`, loader: 'jsx', resolveDir: root })) } }], banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setContent('<html><body style="margin:0"><div id="root"></div></body></html>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await mkdir('output/playwright', { recursive: true })
  for (const width of [320,390]) for (const mode of ['light','dark']) {
    await page.setViewportSize({ width, height: 844 }); await page.evaluate(mode=>{window.mode(mode);window.section('more')},mode)
    const banner = page.getByRole('button',{name:'Partners and Special Offers',exact:true})
    await banner.waitFor();assert.ok((await banner.boundingBox()).height>=150)
    await page.screenshot({path:`output/playwright/partners-${width}-${mode}.png`,fullPage:true})
    await banner.click();await page.getByRole('heading',{name:'Partners & Special Offers'}).waitFor()
    await page.getByRole('button',{name:'Back to More'}).click();await banner.waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  }
  await page.evaluate(()=>window.section('icons'))
  for(const label of ['Won','Loss','Draw']) await page.getByLabel('Match result: '+label).waitFor()
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0))
  await page.screenshot({path:'output/playwright/result-icons.png'})
  await page.evaluate(()=>window.section('guest'))
  const guestButton=page.getByRole('button',{name:'Add guest scorer'});await guestButton.click()
  assert.equal(await page.evaluate(()=>window.guestAction),'create');assert.ok((await guestButton.boundingBox()).height<=48)
  await page.evaluate(()=>window.section('time'));assert.equal(await page.getByLabel('Kick-off time',{exact:true}).inputValue(),'10:45')
  await page.evaluate(()=>{window.section('guest');window.native()});await guestButton.waitFor();await page.evaluate(()=>window.section('time'))
  await page.getByRole('button',{name:'Kick-off time, 10:45',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.keyboardDismissed),true)
  assert.deepEqual(await page.evaluate(()=>({color:window.pickerProps.textColor,interval:window.pickerProps.minuteInterval,hour:window.pickerProps.value.getHours(),minute:window.pickerProps.value.getMinutes(),seconds:window.pickerProps.value.getSeconds(),is24Hour:window.pickerProps.is24Hour})),{color:'#ffffff',interval:1,hour:10,minute:45,seconds:0,is24Hour:true})
  await page.getByRole('button',{name:'Done',exact:true}).click()
  await page.getByRole('button',{name:'Kick-off time, 10:45',exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS: Partners banner and page, navigation, 320/390 light/dark, result artwork, TBC pitch, compact guest action and minute-only field.')
} finally { await browser.close() }
