import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const source = await readFile('apps/parent-mobile/src/ParentPortalScreens.js', 'utf8')
const declarations = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(node => node.declaration || node)
const components = ['colorsFor', 'usePortalStyles', 'Button', 'DevelopmentScreen'].map(name => {
  const node = declarations.find(item => item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, `Actual Parent component ${name} exists`)
  return source.slice(node.start, node.end)
}).join('\n')
const entry = `import React,{useState,useEffect,useLayoutEffect,useMemo,useRef} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Pressable,StyleSheet} from 'react-native';
import {createPdfVisitTracker} from './apps/mobile-core/src/pdfVisit.js';
import {createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME} from './apps/mobile-core/src/parentThemeCore.js';
import {getParentStatusColours} from './apps/mobile-core/src/parentStatusColours.js';
import {formatParentProductDateTime} from './apps/mobile-core/src/parentDateTimeCore.js';
import {getParentDevelopmentProgression} from './apps/mobile-core/src/parentDevelopmentProgression.js';
import {ParentDevelopmentProgressionChart} from './apps/parent-mobile/src/ParentDevelopmentProgressionChart.js';
const ParentIcon=()=>null,ResourceState=()=>null;const formatDate=value=>formatParentProductDateTime(value,{year:'numeric'});
${components}
window.calls=[];window.guards=[];window.preparations=[];const onPrepare=(report,guard)=>window.preparations.push([report.id,guard()]);
const reports=[{id:'report-a',form:{name:'U14 JPL'},recordDate:'2026-10-13',canDownloadPdf:true,responseItems:[{fieldId:'technical',label:'Technical',numericScore:3,maxScore:10}]},{id:'report-b',form:{name:'Elite Review'},canDownloadPdf:true}];
function App(){const[mode,setMode]=useState('light'),[pending,setPending]=useState([]);window.mode=setMode;window.pending=setPending;
const tokens=createParentMobileTheme({mode}).tokens;
return <View style={{padding:12,backgroundColor:tokens.background,minHeight:'100vh'}}><DevelopmentScreen resource={{items:reports,loading:false}} themeTokens={tokens} onPrepare={onPrepare} pendingReportIds={pending} onOpen={(report,action,guard)=>{window.calls.push([report.id,action]);window.guards.push(guard);setPending([report.id])}}/></View>}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' }, nodePaths: [modules], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' } })
const browser = await chromium.launch({ headless: true })
const output = 'output/playwright/parent-development-pdf'
await mkdir(output, { recursive: true })
try {
  for (const mode of ['light', 'dark']) for (const width of [320, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<body style="margin:0"><div id="root"></div>')
    await page.addScriptTag({ content: result.outputFiles[0].text })
    await page.evaluate(mode => window.mode(mode), mode)
    await page.getByRole('button', { name: 'View Development report' }).first().click()
    await page.waitForFunction(() => window.preparations.length > 0)
    assert.deepEqual(await page.evaluate(() => window.preparations), [['report-a', true]], 'Actual report view starts guarded preparation before either PDF action')
    for (const label of ['Open PDF', 'Share PDF']) {
      const button = page.getByRole('button', { name: label, exact: true })
      const box = await button.boundingBox()
      assert.ok(box.height >= 44 && box.width >= 44)
      const borders = await button.evaluate(element => { const style = getComputedStyle(element); return [style.borderTopWidth, style.borderLeftWidth, style.borderRightWidth] })
      assert.deepEqual(borders, ['0px', '0px', '0px'], 'PDF actions remain compact and unboxed')
    }
    await page.getByRole('button', { name: 'Open PDF', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.calls), [['report-a', 'open']])
    assert.equal(await page.getByRole('button', { name: 'Share PDF', exact: true }).getAttribute('aria-disabled'), 'true')
    await page.getByRole('button', { name: 'Back to Development', exact: true }).click()
    await page.getByRole('button', { name: 'View Development report' }).first().click()
    assert.equal(await page.evaluate(() => window.guards[0]()), false, 'Back and return invalidates the old report visit')
    await page.evaluate(() => window.pending([]))
    await page.getByRole('button', { name: 'Share PDF', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), ['report-a', 'share'])
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${output}/${mode}-${width}.png`, fullPage: true })
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS: actual Development screen, Open/Share, pending Back navigation, stale visits, 320/390 light/dark')
} finally { await browser.close() }
