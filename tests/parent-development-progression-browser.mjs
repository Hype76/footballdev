import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root = process.cwd(), modules = path.join(root, 'apps/parent-mobile/node_modules')
const source = await readFile('apps/parent-mobile/src/ParentPortalScreens.js', 'utf8')
const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(node => node.declaration || node)
const components = ['colorsFor', 'usePortalStyles', 'Button', 'DevelopmentScreen'].map(name => {
  const node = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name)
  return source.slice(node.start, node.end)
}).join('\n')
const entry = `import React,{useState,useEffect,useLayoutEffect,useMemo,useRef} from 'react';import{createRoot}from'react-dom/client';
import{View,Text,Pressable,ScrollView,StyleSheet}from'react-native';
import{createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME}from'./apps/mobile-core/src/parentThemeCore.js';
import{getParentStatusColours}from'./apps/mobile-core/src/parentStatusColours.js';
import{formatParentProductDateTime}from'./apps/mobile-core/src/parentDateTimeCore.js';
import{createPdfVisitTracker}from'./apps/mobile-core/src/pdfVisit.js';
import{getParentDevelopmentProgression}from'./apps/mobile-core/src/parentDevelopmentProgression.js';
import{ParentDevelopmentProgressionChart}from'./apps/parent-mobile/src/ParentDevelopmentProgressionChart.js';
const ParentIcon=()=>null,ResourceState=()=>null,formatDate=value=>formatParentProductDateTime(value,{includeTime:false,year:'numeric'});
${components}
const create=(id,value,formId='elite')=>({id,recordDate:'2026-10-07',finalizedAt:'2026-10-07T'+(id==='first'?'10':'11')+':00:00Z',club:{id:'club'},team:{id:'team'},player:{id:'player'},form:{id:formId,name:formId==='elite'?'Elite Attacking Review':formId},progressionAllowed:true,overallScore:value,responseItems:[{fieldId:'score',label:'Finishing',numericScore:value,maxScore:10,includeInProgressChart:true}],sections:[],canDownloadPdf:true});
const initial=[create('first',5),create('second',7.8),create('single',6,'single'),{...create('excluded',10,'excluded'),progressionAllowed:false,sections:[{key:'progressionChart',title:'Progression chart',body:'Orphan heading',chartPoints:[{label:'5 Oct 2026',value:2},{label:'7 Oct 2026',value:10}]}]},create('unrelated',9,'u14')];
function App(){const[mode,setMode]=useState('light'),[reports,setReports]=useState(initial);window.mode=setMode;window.longHistory=()=>setReports([...initial,...Array.from({length:30},(_,i)=>({...create('extra-'+i,i%10+1),recordDate:'2026-10-08',finalizedAt:'2026-10-08T12:00:00Z'}))]);
const tokens=createParentMobileTheme({mode}).tokens;
return <View style={{height:844,backgroundColor:tokens.background}}><View testID="header" style={{height:64,flexShrink:0}}><Text style={{color:tokens.textPrimary}}>FP TEST Parent</Text></View><ScrollView testID="page-scroll" style={{flex:1,minHeight:0}} contentContainerStyle={{padding:16}}><DevelopmentScreen resource={{items:reports,loading:false}} themeTokens={tokens} onOpen={()=>{}}/></ScrollView><View testID="footer" style={{height:64,flexShrink:0}}><Text style={{color:tokens.textPrimary}}>Home Calendar Matchday Chat More</Text></View></View>}
createRoot(document.getElementById('root')).render(<App/>);`
const bundled = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' }, nodePaths: [modules], conditions: ['browser'], mainFields: ['browser','module','main'], resolveExtensions: ['.web.js','.jsx','.js'], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true }), out = 'output/playwright/parent-development-progression'
await mkdir(out, { recursive: true })
try {
  for (const width of [320,390]) for (const mode of ['light','dark']) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true }), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div>')
    await page.addScriptTag({ content: bundled.outputFiles[0].text })
    await page.evaluate(mode => window.mode(mode), mode)
    const footer = await page.getByTestId('footer').boundingBox()
    await page.getByRole('button', { name: 'View Development report', exact: true }).first().click()
    await page.getByRole('heading', { name: 'Progression chart', exact: true }).waitFor()
    assert.equal(await page.getByTestId('parent-progression-line').count(), 1)
    const firstPoint = page.getByRole('button', { name: '07:10:2026 #1: 5 out of 10', exact: true })
    const box = await firstPoint.boundingBox()
    assert.equal(box.width,44); assert.equal(box.height,44)
    const scrollBefore = await page.getByTestId('page-scroll').boundingBox()
    await firstPoint.click()
    await page.getByText('07:10:2026 #1: 5 / 10', { exact: true }).waitFor()
    assert.deepEqual(await page.getByTestId('page-scroll').boundingBox(),scrollBefore,'Selecting a point never moves the page viewport')
    await assertRenderedTextContrast(page)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    assert.deepEqual(await page.getByTestId('footer').boundingBox(),footer)
    await page.screenshot({path:out+'/'+mode+'-'+width+'.png'})
    for (const index of [2,3]) {
      await page.getByRole('button',{name:'Back to Development',exact:true}).click()
      await page.getByRole('button',{name:'View Development report',exact:true}).nth(index).click()
      assert.equal(await page.getByRole('heading',{name:'Progression chart',exact:true}).count(),0,'A single record or excluded form never shows an empty chart heading')
      assert.equal(await page.getByText('Orphan heading',{exact:true}).count(),0)
    }
    await page.getByRole('button',{name:'Back to Development',exact:true}).click()
    await page.evaluate(()=>window.longHistory())
    await page.getByRole('button',{name:'View Development report',exact:true}).first().click()
    await page.getByTestId('parent-progression-line').nth(30).waitFor()
    assert.equal(await page.getByTestId('parent-progression-line').count(),31,'Long shared histories retain every scored assessment')
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long charts scroll inside the phone width')
    assert.deepEqual(await page.getByTestId('footer').boundingBox(),footer)
    assert.deepEqual(errors,[])
    await page.close()
  }
  console.log('PASS: actual Parent report charts at 320/390 light/dark, same-day Elite points, 44px point actions, stable viewport/footer, single/excluded heading suppression and bounded long histories. Native handset receipt remains separate.')
} finally { await browser.close() }
