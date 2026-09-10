import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const output = 'output/playwright/home-polish'
await mkdir(output, { recursive: true })
const source = await readFile('apps/coach-mobile/App.js', 'utf8')
const functions = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.filter(node => node.type === 'FunctionDeclaration')
const names = ['HomeScreen', 'HomeNextRow', 'IconSection', 'IconStat', 'IconAction', 'Section', 'CoachIcon', 'LoadingPanel', 'createCoachStyles']
const selected = names.map(name => {
  const node = functions.find(node => node.id.name === name)
  assert.ok(node, name)
  return source.slice(node.start, node.end)
}).join('\n')
const entry = `import {formatFixtureDateTime} from './src/lib/calendar-datetime-integrity.js';
import React from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Pressable,StyleSheet,Platform} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {getMobileIconName} from './apps/mobile-core/src/mobileIconSystem.js';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {BrandLoader} from './apps/mobile-core/src/BrandLoader.js';
Platform.OS='android';let theme;const useCoachTheme=()=>theme;
const formatDateTime=value=>value;
${selected}
function App(){const[mode,setMode]=React.useState('dark'),[loading,setLoading]=React.useState(false);window.mode=setMode;window.loading=setLoading;
const palette=createCoachTheme({mode,context:{clubAccent:'#2ba7aa'}}).tokens;theme={palette,styles:createCoachStyles(palette)};
return <View style={{backgroundColor:palette.background,minHeight:'100vh',padding:16}}>
<HomeScreen context={{teamId:'synthetic-team'}} onNavigate={route=>window.route=route} homeState={{loading,matches:[],sessions:[],nextCalendar:{id:'event',title:'Training',startsAt:'Thu 10 Sept, 16:00'},nextMatch:{opponent:'Visitors FC',matchDate:'2026-09-20',kickoffTime:'11:00'},nextSession:{title:'Training',startsAt:'Thu 10 Sept, 16:00'}}}/></View>}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], nodePaths: [modules], resolveExtensions: ['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<body style="margin:0"><div id="root"></div>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  for (const mode of ['dark', 'light']) for (const width of [320, 390]) {
    await page.evaluate(mode => window.mode(mode), mode)
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: 'Next Calendar item: Thu 10 Sept, 16:00' }).waitFor()
    assert.equal(await page.getByText(/Offline readiness|Offline downloads|Download for offline/).count(), 0)
    assert.ok((await page.getByRole('button', { name: 'Next Calendar item: Thu 10 Sept, 16:00' }).boundingBox()).y < 40)
    await page.screenshot({ path: `${output}/home-${mode}-${width}.png` })
    await page.evaluate(() => window.loading(true))
    await page.getByText('Loading your Coach overview...').waitFor()
    const panel = await page.getByText('Loading your Coach overview...').evaluate(element => {
      const node = element.parentElement
      return { height: node.getBoundingClientRect().height, border: getComputedStyle(node).borderWidth, background: getComputedStyle(node).backgroundColor }
    })
    assert.ok(panel.height <= 90, 'Loading must stay compact on a phone')
    assert.equal(panel.border, '0px')
    assert.equal(panel.background, 'rgba(0, 0, 0, 0)')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${output}/loading-${mode}-${width}.png` })
    await page.evaluate(() => window.loading(false))
  }
  await page.getByRole('button', { name: 'Next match: Sun 20 Sept, 11:00' }).click()
  assert.equal(await page.evaluate(() => window.route), 'matchday')
  assert.deepEqual(errors, [])
  console.log('PASS: actual Coach Home and loading layout at 320/390px in both themes; fixtures first, no offline panel, compact unboxed FP loader and Match Day navigation.')
} finally { await browser.close() }
