import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const source = await readFile('apps/parent-mobile/App.js', 'utf8')
const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(node => node.declaration || node)
const functions = ['BottomTabs', 'createParentAppPalette', 'createParentAppStyles'].map(name => {
  const node = nodes.find(item => item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, name)
  return source.slice(node.start, node.end)
}).join('\n')
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{View,Text,Pressable,StyleSheet,Platform}from'react-native';
import ParentIcon from './apps/parent-mobile/src/ParentIcon.js';
import{getParentTabIconKey}from'./apps/mobile-core/src/mobileIconSystem.js';
import{createParentMobileTheme}from'./apps/mobile-core/src/parentThemeCore.js';
import{getParentBadgeColours,getParentStatusColours}from'./apps/mobile-core/src/parentStatusColours.js';
let theme;const useParentTheme=()=>theme;
${functions}
function App(){const[mode,setMode]=useState('light'),[active,setActive]=useState('matchday'),[count,setCount]=useState(19);
window.mode=setMode;window.count=setCount;window.selected=()=>active;
const tokens=createParentMobileTheme({mode}).tokens,palette=createParentAppPalette(tokens);theme={palette,styles:createParentAppStyles(tokens)};
return <BottomTabs activeTab={active} onChange={setActive} theme={mode} tabs={[{key:'home',label:'Home'},{key:'calendar',label:'Calendar'},{key:'matchday',label:'Matchday'},{key:'chat',label:'Chat'},{key:'more',label:'More',count}]}/>}
createRoot(document.getElementById('root')).render(<App/>);`
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], nodePaths: [modules], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
const output = 'output/playwright/parent-bottom-tabs'
await mkdir(output, { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><main id="root"></main></body>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('tab', { name: 'Matchday', exact: true }).waitFor()
  let checks = 0
  for (const mode of ['light', 'dark']) {
    await page.evaluate(value => window.mode(value), mode)
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 780 })
      for (const [label, key] of [['Home', 'home'], ['Calendar', 'calendar'], ['Matchday', 'matchday'], ['Chat', 'chat'], ['More', 'more']]) {
        const tab = page.getByRole('tab', { name: label === 'More' ? 'More, 19 new' : label, exact: true })
        await tab.click()
        await page.waitForFunction(value => window.selected() === value, key)
        assert.notEqual(await tab.evaluate(element => getComputedStyle(element).borderTopColor), 'rgba(0, 0, 0, 0)', 'Selected indicator retained')
        const geometry = await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => {
          const label = [...tab.children].find(child => ['Home', 'Calendar', 'Matchday', 'Chat', 'More'].includes(child.textContent))
          const range = document.createRange(); range.selectNodeContents(label)
          const rect = label.getBoundingClientRect(), touch = tab.getBoundingClientRect()
          return { label: label.textContent, lines: range.getClientRects().length, height: rect.height, fontSize: Number.parseFloat(getComputedStyle(label).fontSize), fits: label.scrollWidth <= label.clientWidth + 1, touchWidth: touch.width, touchHeight: touch.height }
        }))
        assert.deepEqual(geometry.map(item => item.label), ['Home', 'Calendar', 'Matchday', 'Chat', 'More'])
        for (const item of geometry) {
          assert.equal(item.lines, 1, `${mode} ${width}: ${item.label} single line`)
          assert.ok(item.fits, `${mode} ${width}: ${item.label} fully visible`)
          assert.ok(item.height < item.fontSize * 1.8, 'No second label line')
          assert.ok(item.touchWidth >= 44 && item.touchHeight >= 44, 'Accessible touch target retained')
        }
        assert.equal(await page.getByText('19', { exact: true }).count(), 1)
        checks += 1
      }
      if (width === 360) {
        await page.getByRole('tab', { name: 'Matchday', exact: true }).click()
        await page.screenshot({ path: `${output}/${mode}-360.png` })
      }
    }
  }
  await page.evaluate(() => window.count(119))
  await page.getByRole('tab', { name: 'More, 119 new', exact: true }).waitFor()
  assert.equal(await page.getByText('119', { exact: true }).count(), 1)
  await page.evaluate(() => window.count(0))
  await page.getByRole('tab', { name: 'More', exact: true }).waitFor()
  assert.equal(await page.getByText('119', { exact: true }).count(), 0)
  await page.setViewportSize({ width: 320, height: 780 })
  const enlarged = await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => {
    const label = [...tab.children].find(child => ['Home', 'Calendar', 'Matchday', 'Chat', 'More'].includes(child.textContent))
    label.style.fontSize = '13.2px'
    const range = document.createRange(); range.selectNodeContents(label)
    return { label: label.textContent, lines: range.getClientRects().length, height: label.getBoundingClientRect().height }
  }))
  for (const label of enlarged) assert.ok(label.height < 23, `Enlarged ${label.label} cannot wrap onto a second row`)
  assert.deepEqual(errors, [])
  console.log(`PASS ${checks} actual Parent bottom navigation cases: four phone widths, both themes, all tab actions, full default-size labels, enlarged text cannot wrap, touch targets and unread counts; native font fitting needs handset confirmation`)
} finally {
  await browser.close()
}
