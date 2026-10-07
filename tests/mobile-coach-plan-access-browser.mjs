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
  import {StyleSheet, Text, View, Linking} from 'react-native';
  import {CoachUpgradeAction} from './apps/coach-mobile/src/CoachUpgradeAction.js';
  Linking.openURL = async url => { window.fixture.opened.push(url); };
  const useMobileAuth = () => ({user:window.fixture.user,refreshUserProfile:async()=>{}});
  const getMobileRuntimeConfig = () => ({apiBaseUrl:'https://footballplayer.online'});
  import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
  import {
    quoteSubscription,
  } from './src/lib/subscription-pricing.js';
  const CoachThemeContext = createContext(null);
  ${selected}
  export default function Preview({mode, authority, offline}) {
    const theme = createCoachTheme({mode, context:{}});
    const value = createCoachThemeContext(theme);
    window.fixture.user.isOfflineProfile = offline;
    const context = {
      id: authority + ':' + offline,
      planKey: 'matchday',
      paymentAccess: {state: 'active', canMutate: true, payerAuthority: authority},
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
    const [authority,setAuthority] = React.useState('team');
    const [offline,setOffline] = React.useState(false);
    window.setMode = setMode; window.setAuthority = setAuthority; window.setOffline = setOffline;
    return <div data-mode={mode}><Preview mode={mode} authority={authority} offline={offline} /></div>;
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
      builder.onResolve({filter:/mobileSignup$/},()=>({path:'signup',namespace:'mock'}));
      builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export async function mobileAccountRequest(role,endpoint,body,actor){window.fixture.requests.push({role,endpoint,body,actor});return {actorId:actor,purpose:'upgrade',tokenHash:'a'.repeat(56)}}`,loader:'js'}));
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
  await page.evaluate(() => {window.fixture={user:{id:'20000000-0000-4000-8000-000000000001'},requests:[],opened:[]};});
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.getByRole('heading', { name: 'Plan access', exact: true }).waitFor()

  assert.equal(await page.getByText('Matchday', { exact: true }).count(), 1)
  assert.equal(await page.getByText('Team', { exact: true }).count(), 1)
  assert.equal(await page.getByText('Club', { exact: true }).count(), 1)
  assert.match(await page.locator('#root').innerText(), /£7\.99\/month or £79\.90\/year/)
  assert.match(await page.locator('#root').innerText(), /From £59\.99\/month or £599\.90\/year/)
  assert.doesNotMatch(await page.locator('#root').innerText(), /Payer authority|Operational changes|authoritative|coupon|checkout/i)
  assert.match(await page.locator('#root').innerText(), /Includes up to 20 teams/)
  assert.match(await page.locator('#root').innerText(), /More than 20 teams[\s\S]*Contact us for a quote/)
  assert.doesNotMatch(await page.locator('#root').innerText(), /Each 10 teams|More Club teams/)
  const upgrade = page.getByRole('button', {name:'Upgrade plan',exact:true})
  assert.equal(await upgrade.count(), 1)
  await upgrade.click()
  await page.waitForFunction(()=>window.fixture.opened.length===1)
  assert.deepEqual(await page.evaluate(()=>window.fixture.requests), [{role:'coach',endpoint:'create-coach-web-handoff',body:{purpose:'upgrade'},actor:'20000000-0000-4000-8000-000000000001'}])
  const opened = new URL(await page.evaluate(()=>window.fixture.opened[0]))
  assert.equal(opened.origin, 'https://footballplayer.online')
  assert.equal(opened.pathname, '/coach-app-handoff')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(opened.hash.slice(1))), {token_hash:'a'.repeat(56),actor:'20000000-0000-4000-8000-000000000001',purpose:'upgrade'})
  await page.evaluate(()=>window.setAuthority('none'))
  await page.getByText('Ask your Team or Club account owner if you want to change plan.',{exact:true}).waitFor()
  assert.equal(await upgrade.count(),0)
  await page.evaluate(()=>{window.setAuthority('club');window.setOffline(true)})
  await upgrade.waitFor()
  assert.equal(await upgrade.isDisabled(),true)
  assert.equal(await page.evaluate(()=>window.fixture.requests.length),1)
  await page.evaluate(()=>{window.setAuthority('team');window.setOffline(false)})
  await upgrade.waitFor()
  assert.equal(await upgrade.isEnabled(),true)

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
  console.log('PASS: actual Coach Plan access renders Matchday allowance plus Team and Club upgrade summaries at 320/390px in light/dark with owner-only single-use website Stripe handoff, non-owner guidance and offline protection.')
} finally {
  await browser.close()
}
