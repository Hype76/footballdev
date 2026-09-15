import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import QRCode from 'qrcode'
import { PNG } from 'pngjs'
import { fanAppHandoffLinks } from '../src/lib/fan-app-handoff.js'

const token = '20000000-0000-4000-8000-000000000099'
const links = fanAppHandoffLinks(token)
const expectedCodes = {
  iPhone: await QRCode.toDataURL('https://apps.apple.com/app/football-player-parents/id6772061464', { margin: 4, width: 220 }),
  Android: await QRCode.toDataURL('https://play.google.com/store/apps/details?id=com.footballplayer.parents', { margin: 4, width: 220 }),
}
const css = await readFile('src/pages/fans.css', 'utf8') + await readFile('src/pages/fan-invite.css', 'utf8')
const result = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter,Routes,Route}from'react-router-dom';import{FanInvitePage}from'./src/pages/FanInvitePage.jsx';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/fan-invite/:token' element={<FanInvitePage/>}/></Routes></BrowserRouter>);`, resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'choice-fixtures', setup(b) {
    b.onResolve({ filter: /\/auth\.js$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
    b.onResolve({ filter: /supabase-client\.js$/ }, () => ({ path: 'client', namespace: 'fixture' }))
    b.onResolve({ filter: /fans-client\.js$/ }, () => ({ path: 'rpc', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'auth' ? `export const useAuth=()=>({session:null});` : path === 'client' ? `export const supabase={auth:{}};` : `export async function fanRpc(name,args){window.rpcCalls.push({name,args});if(name!=='get_fan_invitation_branding')throw Error('Unauthorised fixture call');return {club_name:'FP TEST Club',theme_accent:'#123abc'};}`, loader: 'js' }))
  } }],
})
await mkdir('output/playwright/fan-app-choice', { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [320, 390, 1100]) for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode })
    await context.addInitScript(({ mode }) => {
      window.rpcCalls = []; window.copied = ''
      localStorage.setItem('app-theme-mode', mode)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copied = value } } })
    }, { mode })
    const requests = []
    await context.route('**/*', route => {
      requests.push(route.request().url())
      return route.fulfill({ contentType: 'text/html', body: `<html class="theme-${mode}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif;background:${mode === 'dark' ? '#030603' : '#f5f8f6'}}${css}</style><div id="root"></div><script>${result.outputFiles[0].text}</script>` })
    })
    const page = await context.newPage()
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`https://parent.footballplayer.test/fan-invite/${token}`)
    await page.getByRole('heading', { name: 'Choose how to continue' }).waitFor()
    await page.getByText('FP TEST Club', { exact: true }).waitFor()
    assert.equal(await page.getByRole('link', { name: 'Open Parent app', exact: true }).getAttribute('href'), links.app)
    for (const [name, href] of [['Download on the App Store', links.apple], ['Get it on Google Play', links.android]]) {
      assert.equal(await page.getByRole('link', { name, exact: true }).getAttribute('href'), href)
      assert.equal(await page.getByRole('link', { name, exact: true }).getAttribute('target'), '_blank')
    }
    for (const platform of ['iPhone', 'Android']) {
      const code = page.getByRole('img', { name: `Scan to download the Parent app for ${platform}` })
      await code.waitFor()
      assert.match(await code.getAttribute('src'), /^data:image\/png;base64,/)
      const pixels = dataUrl => PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64')).data
      assert.ok(pixels(await code.getAttribute('src')).equals(pixels(expectedCodes[platform])), `${platform} rendered QR pixels encode its exact public listing`)
    }
    assert.equal(await page.getByRole('button', { name: 'Create account', exact: true }).count(), 0)
    assert.deepEqual(await page.evaluate(() => window.rpcCalls.map(call => call.name)), ['get_fan_invitation_branding'])
    assert.equal(requests.length, 1, 'Choice page neither redirects nor loads third-party QR services')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow')
    assert.equal(await page.locator('html').getAttribute('class'), `theme-${mode}`)
    const surface = await page.locator('.fan-app-choice').evaluate(el => getComputedStyle(el).backgroundColor)
    assert.equal(surface === 'rgb(255, 255, 255)', mode === 'light', 'Actual panel palette follows the selected mode')
    await page.screenshot({ path: `output/playwright/fan-app-choice/${mode}-${width}.png`, fullPage: true })
    await page.getByText('Keep this invitation for after installing', { exact: true }).click()
    await page.getByRole('button', { name: 'Copy invitation link', exact: true }).click()
    await page.getByRole('status').getByText('Invitation link copied.').waitFor()
    assert.equal(await page.evaluate(() => window.copied), links.invitation)
    await page.getByRole('button', { name: 'Sign in or continue on website', exact: true }).click()
    await page.getByRole('button', { name: 'Create account', exact: true }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('continue'), 'web')
    assert.equal(new URL(page.url()).pathname, `/fan-invite/${token}`)
    await page.getByRole('button', { name: 'Back to app and download options' }).click()
    await page.getByRole('heading', { name: 'Choose how to continue' }).waitFor()
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('PASS: actual Fan invitation choice at 320, 390 and 1100px in light/dark; club branding, explicit choices, local QR codes, public store links and preserved invitation; no automatic navigation or private child reads.')
} finally { await browser.close() }
