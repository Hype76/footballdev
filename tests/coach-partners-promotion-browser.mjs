import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const source = await readFile('apps/coach-mobile/App.js', 'utf8')
const functions = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.filter((node) => node.type === 'FunctionDeclaration')
const selected = ['CoachPartnerPromotionAction', 'CoachIcon', 'useCoachTheme', 'createCoachThemeContext', 'createCoachStyles']
  .map((name) => {
    const node = functions.find((candidate) => candidate.id.name === name)
    assert.ok(node, `${name} must exist`)
    return source.slice(node.start, node.end)
  }).join('\n')

const entry = `
import React,{createContext,useContext,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {getMobileIconName} from './apps/mobile-core/src/mobileIconSystem.js';
const CoachThemeContext=createContext(null);
${selected}
function App(){const [mode,setMode]=useState('light');window.setMode=setMode;const theme=createCoachTheme({mode,context:{clubAccent:'#1e477c'}});return <CoachThemeContext.Provider value={createCoachThemeContext(theme)}><View style={{backgroundColor:theme.tokens.background,minHeight:'100vh',padding:16}}><CoachPartnerPromotionAction onPress={()=>{window.opened=(window.opened||0)+1}}/></View></CoachThemeContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], nodePaths: [modules], alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 360 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await mkdir('output/playwright/coach-partners-promotion', { recursive: true })
  for (const width of [320, 390]) for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 360 })
    await page.evaluate((nextMode) => window.setMode(nextMode), mode)
    const action = page.getByRole('button', { name: 'Give a club 50% off', exact: true })
    await action.waitFor()
    assert.ok((await action.boundingBox()).height >= 82)
    assert.equal(await page.getByText('50%', { exact: true }).count(), 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `output/playwright/coach-partners-promotion/${mode}-${width}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: 'Give a club 50% off', exact: true }).click()
  assert.equal(await page.evaluate(() => window.opened), 1)
  assert.deepEqual(errors, [])
  console.log('PASS: Coach Partners referral offer uses the themed 50% icon row, opens correctly, and fits 320/390px light/dark layouts')
} finally {
  await browser.close()
}
