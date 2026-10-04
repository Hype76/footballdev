import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const output = 'output/playwright/coach-club-logo'
await mkdir(output, { recursive: true })
const source = await readFile(process.env.COACH_LOGO_SOURCE || 'apps/coach-mobile/App.js', 'utf8')
const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
const selected = ['CoachHeader', 'createCoachStyles'].map(name => {
  const node = nodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  return source.slice(node.start, node.end)
}).join('\n').replace("require('./assets/football-player-logo.png')", "require('./apps/coach-mobile/assets/football-player-logo.png')")
const entry = `
import React,{useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Image,StyleSheet,AppState} from 'react-native';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
let theme;const useCoachTheme=()=>theme;const config={isProduction:true};
const NotificationStatusButton=()=>null;
AppState.addEventListener=(_event,callback)=>{window.foreground=()=>callback('active');return{remove(){}}};
${selected}
function App(){const[context,setContext]=useState({id:'cambourne',clubId:'club',clubName:'Cambourne Town FC',role:'head_manager',roleRank:70,planKey:'large_club',planStatus:'active',clubLogoUrl:'https://badge.test/good.png'});
const[mode,setMode]=useState('dark');window.context=patch=>setContext(old=>({...old,...patch}));window.mode=setMode;
const model=createCoachTheme({context,mode});theme={...model,styles:createCoachStyles(model.tokens)};
return <View style={{backgroundColor:theme.tokens.background,minHeight:'100vh',padding:16}}><CoachHeader context={context} user={{roleLabel:'Team Admin'}}/></View>}
createRoot(document.getElementById('root')).render(<App/>);`
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.png': 'dataurl' }, alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' } })
const png = await readFile('apps/coach-mobile/assets/football-player-logo.png')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let requests = 0
  let recovered = false
  await page.route('https://badge.test/**', route => {
    requests++
    const broken = new URL(route.request().url()).pathname.startsWith('/bad') && !recovered
    return route.fulfill({ status: broken ? 404 : 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: broken ? Buffer.from('missing image') : png })
  })
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const imageUri = () => page.locator('img').getAttribute('src')
  const loaded = async () => {
    await page.waitForFunction(() => { const image = document.querySelector('img'); return image?.complete && image.naturalWidth > 0 })
  }
  await page.waitForFunction(() => document.querySelector('img'))
  await loaded()
  assert.ok((await imageUri()) === 'https://badge.test/good.png', 'Allowed remote logo must be shown')
  // A request/decoding failure must leave visible, correctly labelled fallback artwork.
  for (const mode of ['dark', 'light']) {
    recovered = false
    await page.evaluate(mode => { window.mode(mode); window.context({ clubLogoUrl: 'https://badge.test/bad-' + mode + '.png' }) }, mode)
    await page.waitForFunction(() => document.querySelector('img')?.src.startsWith('data:image/png'))
    await loaded()
    assert.equal(await page.getByLabel('Football Player logo', { exact: true }).count(), 1)
    const count = requests
    await page.screenshot({ path: `${output}/fallback-${mode}.png` })
    assert.equal(requests, count, 'Fallback must not loop remote requests')
    recovered = true
    await page.evaluate(() => window.foreground())
    await page.waitForFunction(() => document.querySelector('img')?.src.startsWith('https://badge.test/bad'))
    await loaded()
    assert.equal(await page.getByLabel('Cambourne Town FC logo', { exact: true }).count(), 1)
  }
  recovered = false
  await page.evaluate(() => window.context({ clubLogoUrl: 'https://badge.test/bad-switch.png' }))
  await page.waitForFunction(() => document.querySelector('img')?.src.startsWith('data:image/png'))
  await page.evaluate(() => window.context({ id: 'another-club', clubName: 'Another club', clubLogoUrl: 'https://badge.test/good-other.png' }))
  await page.waitForFunction(() => document.querySelector('img')?.src.endsWith('good-other.png'))
  await loaded()
  assert.equal(await page.getByLabel('Another club logo', { exact: true }).count(), 1)
  for (const patch of [{ clubLogoUrl: 'http://badge.test/unsafe.png' }, { clubLogoUrl: '' }, { planKey: 'matchday', clubLogoUrl: 'https://badge.test/denied.png' }]) {
    const count = requests
    await page.evaluate(patch => window.context(patch), patch)
    await page.waitForFunction(() => document.querySelector('img')?.src.startsWith('data:image/png'))
    await loaded()
    assert.equal(requests, count, 'Invalid or plan-denied logos must never be requested')
  }
  assert.equal(await page.getByText('LIVE', { exact: true }).count(), 1)
  assert.equal(await page.getByText('Team Admin', { exact: false }).count(), 1)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log('PASS: actual Coach header preserves allowed logos, renders failed-image fallback in both themes, recovers on foreground/context changes, and retains HTTPS and Matchday entitlement gates.')
} finally { await browser.close() }
