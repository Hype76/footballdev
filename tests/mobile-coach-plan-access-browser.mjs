import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const output = 'output/playwright/coach-plan-access'
await mkdir(output, { recursive: true })

const appSource = await readFile('apps/coach-mobile/App.js', 'utf8')
const functions = parse(appSource, { sourceType: 'module', plugins: ['jsx'] }).program.body
  .filter(node => node.type === 'FunctionDeclaration')
const selected = ['FoundationRoute', 'ScreenIntro', 'Section', 'InfoRow', 'useCoachTheme', 'createCoachThemeContext', 'createCoachStyles']
  .map(name => {
    const node = functions.find(candidate => candidate.id.name === name)
    assert.ok(node, `Missing actual Coach function ${name}`)
    return appSource.slice(node.start, node.end)
  })
  .join('\n')

const previewModule = `
  import React, {createContext, useContext} from 'react';
  import {StyleSheet, Text, View} from 'react-native';
  import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
  import {
    CLUB_ADDITIONAL_BLOCK_ANNUAL_PENCE,
    CLUB_ADDITIONAL_BLOCK_MONTHLY_PENCE,
    quoteSubscription,
  } from './src/lib/subscription-pricing.js';
  const CoachThemeContext = createContext(null);
  ${selected}
  export default function Preview({mode}) {
    const theme = createCoachTheme({mode, context:{}});
    const value = createCoachThemeContext(theme);
    const context = {
      planKey: 'matchday',
      paymentAccess: {state: 'active', canMutate: true, payerAuthority: 'team'},
    };
    return <CoachThemeContext.Provider value={value}>
      <View style={{backgroundColor:theme.tokens.background, minHeight:'100%', padding:16}}>
        <FoundationRoute context={context} route="payment" />
      </View>
    </CoachThemeContext.Provider>;
  }
`

const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import Preview from 'preview:plan';
  function App() {
    const [mode, setMode] = React.useState('light');
    window.setMode = setMode;
    return <div data-mode={mode}><Preview mode={mode} /></div>;
  }
  createRoot(document.getElementById('root')).render(<App />);
`

const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'jsx' },
  bundle: true,
  write: false,
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.ttf': 'dataurl' },
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
    name: 'plan-preview',
    setup(builder) {
      builder.onResolve({ filter: /^preview:plan$/ }, () => ({ path: 'plan', namespace: 'preview' }))
      builder.onLoad({ filter: /.*/, namespace: 'preview' }, () => ({ contents: previewModule, loader: 'jsx', resolveDir: root }))
    },
  }],
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.route('http://localhost:9878/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>',
  }))
  await page.goto('http://localhost:9878')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.getByRole('heading', { name: 'Plan access', exact: true }).waitFor()

  assert.equal(await page.getByText('Matchday', { exact: true }).count(), 1)
  assert.equal(await page.getByText('Team', { exact: true }).count(), 1)
  assert.equal(await page.getByText('Club', { exact: true }).count(), 1)
  assert.match(await page.locator('#root').innerText(), /£7\.99\/month or £79\.90\/year/)
  assert.match(await page.locator('#root').innerText(), /From £59\.99\/month or £599\.90\/year/)
  assert.doesNotMatch(await page.locator('#root').innerText(), /Payer authority|Operational changes|authoritative|coupon|checkout/i)
  assert.equal(await page.getByRole('button').count(), 0)

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
  console.log('PASS: actual Coach Plan access renders Matchday allowance plus Team and Club upgrade summaries at 320/390px in light/dark with no mobile purchase action.')
} finally {
  await browser.close()
}
