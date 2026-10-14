import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd(), modules = path.join(root, 'apps/parent-mobile/node_modules')
const source = await readFile('apps/parent-mobile/App.js', 'utf8')
const declarations = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(node => node.declaration || node)
const functions = ['createParentAppPalette', 'createParentAppStyles'].map(name => {
  const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(node, name)
  return source.slice(node.start, node.end)
}).join('\n')
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{View,Text,StyleSheet,Platform}from'react-native';
import{MobileSwitch}from'./apps/mobile-core/src/MobileSwitch.js';
import{createParentMobileTheme}from'./apps/mobile-core/src/parentThemeCore.js';
import{getParentBadgeColours,getParentStatusColours}from'./apps/mobile-core/src/parentStatusColours.js';
${functions}
window.changes=[];window.events=[];
function App(){const[value,setValue]=useState(false),[platform,setPlatform]=useState('ios'),[mode,setMode]=useState('light');
window.platform=setPlatform;window.mode=setMode;window.value=setValue;Platform.OS=platform;
const tokens=createParentMobileTheme({mode}).tokens,styles=createParentAppStyles(tokens);
return <View style={{padding:16,backgroundColor:tokens.background}}><Text>Platform controls regression fixture</Text>
<MobileSwitch accessibilityLabel='Notifications' value={value} trackColor={{false:'#bbbbbb',true:'#ff0000'}} onChange={event=>window.events.push(event.nativeEvent.value)} onValueChange={next=>{window.changes.push(next);setValue(next)}}/>
<MobileSwitch accessibilityLabel='Locked off' value={false} disabled onValueChange={()=>window.changes.push('unexpected')}/>
<MobileSwitch accessibilityLabel='Locked on' value disabled onValueChange={()=>window.changes.push('unexpected')}/>
<View testID='navigation' style={styles.tabBar}><Text>Navigation</Text></View></View>}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], nodePaths: [modules], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
const output = 'output/playwright/mobile-platform-controls'
await mkdir(output, { recursive: true })
let cases = 0
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><main id="root"></main></body>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const toggle = page.getByRole('switch', { name: 'Notifications', exact: true })
  await toggle.waitFor()
  for (const mode of ['light', 'dark']) for (const width of [320, 390, 430]) {
    const geometry = []
    for (const platform of ['ios', 'android']) {
      await page.setViewportSize({ width, height: 780 })
      await page.evaluate(({ platform, mode }) => { window.platform(platform); window.mode(mode); window.value(false); window.changes = []; window.events = [] }, { platform, mode })
      await page.waitForFunction(() => document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false')
      await toggle.click()
      assert.equal(await toggle.getAttribute('aria-checked'), 'true')
      assert.deepEqual(await page.evaluate(() => window.changes), [true])
      assert.deepEqual(await page.evaluate(() => window.events), [true])
      await toggle.press('Space')
      assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'Keyboard activation toggles controlled state')
      assert.deepEqual(await page.evaluate(() => window.changes), [true, false])
      await toggle.press('Enter')
      assert.equal(await toggle.getAttribute('aria-checked'), 'true')
      await toggle.press('Enter')
      assert.deepEqual(await page.evaluate(() => window.changes), [true, false, true, false], 'Enter fires once per activation')
      for (const [label, checked] of [['Locked off', 'false'], ['Locked on', 'true']]) {
        const locked = page.getByRole('switch', { name: label, exact: true })
        assert.equal(await locked.getAttribute('aria-checked'), checked)
        assert.equal(await locked.getAttribute('aria-disabled'), 'true')
        await locked.click({ force: true })
      }
      assert.deepEqual(await page.evaluate(() => window.changes), [true, false, true, false], 'Disabled settings cannot mutate')
      const measurements = await toggle.evaluate(element => {
        const rect = element.getBoundingClientRect(), track = element.firstElementChild, thumb = track.firstElementChild
        return { width: rect.width, height: rect.height, trackWidth: track.getBoundingClientRect().width, trackHeight: track.getBoundingClientRect().height, thumbWidth: thumb.getBoundingClientRect().width, thumbHeight: thumb.getBoundingClientRect().height, off: getComputedStyle(track).backgroundColor }
      })
      assert.ok(measurements.width >= 44 && measurements.height >= 44, 'Accessible touch target')
      assert.equal(measurements.off, 'rgb(187, 187, 187)', 'Caller off colour retained')
      assert.equal(await page.getByTestId('navigation').evaluate(element => getComputedStyle(element).paddingBottom), '4px', 'Both platforms retain the iOS bar spacing')
      geometry.push(measurements)
      await toggle.click()
      assert.equal(await toggle.evaluate(element => getComputedStyle(element.firstElementChild).backgroundColor), 'rgb(21, 128, 61)', 'Shared on colour retained')
      assert.equal(await toggle.evaluate(element => getComputedStyle(element.firstElementChild.firstElementChild).backgroundColor), 'rgb(255, 255, 255)', 'White active thumb')
      await page.screenshot({ path: `${output}/${platform}-${mode}-${width}.png` })
      cases += 1
    }
    assert.deepEqual(geometry[0], geometry[1], 'Same control geometry across platform branches')
  }
  assert.deepEqual(errors, [])
  console.log(`PASS ${cases} platform/theme/width cases: shared switch geometry, controlled callbacks, disabled states, screen-reader state, keyboard activation and iOS navigation spacing`)
} finally { await browser.close() }
