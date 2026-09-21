import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const output = 'output/playwright/coach-team-kits'
await mkdir(output, { recursive: true })

const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {View} from 'react-native';
  import {CoachTeamKitSettings} from './apps/coach-mobile/src/CoachTeamKitSettings.js';
  import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
  globalThis.kitTeam = {};
  globalThis.kitClub = {home:{colour:'#111827',imagePath:'paid/home.png'},away:{colour:'#ffffff',imagePath:'paid/away.png'}};
  globalThis.kitSaveCalls = 0;
  globalThis.kitLoadCalls = 0;
  globalThis.failNextSave = false;
  globalThis.failLoad = false;
  const baseUser = {id:'user-a',clubId:'club-a',activeTeamId:'team-a',role:'head_manager',roleRank:70,hasActivePlanAccess:true,planKey:'matchday'};
  function App() {
    const [mode, setMode] = React.useState('light');
    const [rank, setRank] = React.useState(70);
    const [instance, setInstance] = React.useState(0);
    window.setMode = setMode;
    window.setRank = value => { setRank(value); setInstance(current => current + 1); };
    window.remount = () => setInstance(current => current + 1);
    const theme = createCoachTheme({mode, context:{planKey:'matchday'}});
    return <div data-mode={mode} data-rank={rank}>
      <View style={{backgroundColor:theme.tokens.background,minHeight:'100%',padding:16}}>
        <View style={{alignSelf:'center',maxWidth:720,width:'100%'}}>
          <CoachTeamKitSettings key={instance} palette={theme.tokens} user={{...baseUser,roleRank:rank}} />
        </View>
      </View>
    </div>;
  }
  createRoot(document.getElementById('root')).render(<App />);
`

const cacheMock = `
  export async function loadMobileClubKits(){ return globalThis.kitClub; }
  export function setMobileTeamKits(clubId, teamId, kits){ globalThis.lastKitCache={clubId,teamId,kits}; return kits; }
`
const dataMock = `
  export async function getCoachTeamKits(){
    globalThis.kitLoadCalls += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    if(globalThis.failLoad) throw new Error('load failed');
    return globalThis.kitTeam;
  }
  export async function saveCoachTeamKits(user, values){
    globalThis.kitSaveCalls += 1;
    await new Promise(resolve => setTimeout(resolve, 60));
    if(globalThis.failNextSave){ globalThis.failNextSave=false; throw new Error('Save failed. Try again.'); }
    return {home:{colour:values.home.colour,imagePath:null,source:'team'},away:{colour:values.away.colour,imagePath:null,source:'team'}};
  }
`

const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'jsx' },
  bundle: true,
  write: false,
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl', '.ttf': 'dataurl' },
  platform: 'browser',
  conditions: ['browser'],
  mainFields: ['browser', 'module', 'main'],
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  nodePaths: [modules],
  alias: {
    'react-native': path.join(modules, 'react-native-web'),
    react: path.join(modules, 'react'),
    'react-dom': path.join(modules, 'react-dom'),
  },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' },
  plugins: [{
    name: 'kit-data-mocks',
    setup(builder) {
      builder.onResolve({ filter: /mobileKitCache$/ }, () => ({ path: 'cache', namespace: 'kit-mock' }))
      builder.onResolve({ filter: /coachTeamKitsData$/ }, () => ({ path: 'data', namespace: 'kit-mock' }))
      builder.onLoad({ filter: /^cache$/, namespace: 'kit-mock' }, () => ({ contents: cacheMock, loader: 'js' }))
      builder.onLoad({ filter: /^data$/, namespace: 'kit-mock' }, () => ({ contents: dataMock, loader: 'js' }))
    },
  }],
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://localhost:9879/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>',
  }))
  await page.goto('http://localhost:9879')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const homeInput = page.getByLabel('Home kit hex colour')
  const awayInput = page.getByLabel('Away kit hex colour')
  await homeInput.waitFor()
  assert.equal(await homeInput.inputValue(), '#111827')
  assert.equal(await awayInput.inputValue(), '#ffffff')

  await page.getByLabel('Home kit #dc2626').click()
  assert.equal(await homeInput.inputValue(), '#dc2626')

  const awayHue = page.getByLabel('Away kit hue')
  const awaySaturation = page.getByLabel('Away kit saturation')
  const hueBox = await awayHue.boundingBox()
  await awayHue.click({ position: { x: hueBox.width * 0.34, y: hueBox.height / 2 } })
  assert.equal(await awayInput.inputValue(), '#ffffff')
  const saturationBox = await awaySaturation.boundingBox()
  await awaySaturation.click({ position: { x: saturationBox.width * 0.9, y: saturationBox.height / 2 } })
  const pickedAway = await awayInput.inputValue()
  assert.match(pickedAway, /^#[0-9a-f]{6}$/)
  assert.notEqual(pickedAway, '#ffffff')
  assert.notEqual(pickedAway, '#ff0000')

  await page.evaluate(() => { globalThis.failNextSave = true })
  await page.getByRole('button', { name: 'Save kit colours' }).click()
  await page.getByText('Save failed. Try again.').waitFor()
  assert.equal(await page.evaluate(() => globalThis.kitSaveCalls), 1)
  await page.getByRole('button', { name: 'Save kit colours' }).evaluate(button => { button.click(); button.click() })
  await page.getByText('Team kit colours saved.').waitFor()
  assert.equal(await page.evaluate(() => globalThis.kitSaveCalls), 2)

  await page.evaluate(() => { globalThis.failLoad = true; window.remount() })
  await page.getByRole('button', { name: 'Retry loading kit colours' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save kit colours' }).count(), 0)
  await page.evaluate(() => { globalThis.failLoad = false })
  await page.getByRole('button', { name: 'Retry loading kit colours' }).click()
  await page.getByRole('button', { name: 'Save kit colours' }).waitFor()

  await page.evaluate(() => window.setRank(20))
  await page.getByText('A Team Manager or Club Admin can change these colours.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save kit colours' }).count(), 0)
  assert.equal(await page.getByLabel('Home kit hue').count(), 0)

  await page.evaluate(() => window.setRank(70))
  await page.getByRole('button', { name: 'Save kit colours' }).waitFor()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    for (const mode of ['light', 'dark']) {
      await page.evaluate(nextMode => window.setMode(nextMode), mode)
      await page.locator(`[data-mode="${mode}"]`).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: `${output}/${mode}-${width}.png`, fullPage: true })
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS: rendered Coach team kit settings supports continuous colour selection, save retry, double-tap protection, read-only roles, and 320/390px light/dark layouts.')
} finally {
  await browser.close()
}
