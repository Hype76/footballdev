import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const modules = path.resolve('apps/coach-mobile/node_modules')
const code = 'FP-0123456789ABCDEF'
const script = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {CoachClubPromotionScreen} from './apps/coach-mobile/src/CoachClubPromotionScreen.js';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
window.requests=[];window.shares=[];window.failNext=true;
window.navigator.share=async value=>window.shares.push(value);
function App(){const [mode,setMode]=useState('light');const [id,setId]=useState('coach-one');window.theme=setMode;window.actor=setId;
const theme=createCoachTheme({mode,context:{}});return <div style={{background:theme.tokens.background,minHeight:'100vh',padding:16,boxSizing:'border-box'}}><CoachClubPromotionScreen key={id} user={{id}} palette={theme.tokens}/></div>}
createRoot(document.getElementById('root')).render(<App/>);` },
  plugins: [{ name: 'promotion-request-fixture', setup(builder) {
    builder.onResolve({ filter: /mobileSignup$/ }, () => ({ path: 'promotion-request', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export async function mobileAccountRequest(role,name,body,actor){window.requests.push({role,name,body,actor});if(window.failNext){window.failNext=false;throw new Error('No connection. Try again when online.')}return {success:true,code:'${code}',shareUrl:'https://footballplayer.online/club-signup?ref=${code}',terms:'New paid clubs only. 50% off the first 3 monthly payments, then the normal price. Once per club. Cannot be combined with other discounts.'}}` }))
  } }], bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' }, platform: 'browser',
  alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>')
  await page.addScriptTag({ content: script.outputFiles[0].text })
  await page.getByText('No connection. Try again when online.').waitFor()
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await page.getByText(code, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Share code', exact: true }).click()
  await page.getByRole('button', { name: 'Share link', exact: true }).click()
  const shares = await page.evaluate(() => window.shares)
  assert.equal(shares.length, 2)
  assert.match(shares[0].text, new RegExp(code))
  assert.doesNotMatch(shares[0].text, /https:/)
  assert.match(shares[1].text, /https:\/\/footballplayer.online\/club-signup\?ref=/)
  assert.match(shares[1].text, /Once per club/)
  await mkdir('output/playwright/coach-club-promotion', { recursive: true })
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    for (const mode of ['light', 'dark']) {
      await page.evaluate(value => window.theme(value), mode)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      const box = await page.getByRole('button', { name: 'Share link', exact: true }).boundingBox()
      assert.ok(box.height >= 48 && box.width >= 44)
      await page.screenshot({ path: `output/playwright/coach-club-promotion/coach-${mode}-${width}.png`, fullPage: true })
    }
  }
  await page.evaluate(() => window.actor('coach-two'))
  await page.waitForFunction(() => window.requests.at(-1).actor === 'coach-two')
  assert.equal((await page.evaluate(() => window.requests))[0].name, 'coach-club-promotion')
  assert.deepEqual(errors, [])
  console.log('PASS: actual Coach promotion screen, offline retry, code/link sharing, account change, readable light/dark 320/390px layouts and accessible actions')
} finally { await browser.close() }
