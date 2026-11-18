import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { buildAdultPlayerInviteEmail } from '../netlify/functions/lib/_adult-player-invite-email.js'

const keepOpen = process.argv.includes('--serve')
const output = path.resolve('output/adult-player-walkthrough')
await mkdir(output, { recursive: true })
const token = '00000000-0000-4000-8000-000000000006'
const brand = { clubName: process.env.ADULT_WALKTHROUGH_CLUB || 'Fixture United', teamName: 'Adult team (test preview)',
  logoUrl: process.env.ADULT_WALKTHROUGH_LOGO || '/icons/icon-192.png', accent: process.env.ADULT_WALKTHROUGH_ACCENT || '#193e7c' }
const compiled = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {AdultPlayerInvitePage} from './src/pages/AdultPlayerInvitePage.jsx';createRoot(document.getElementById('root')).render(<AdultPlayerInvitePage/>);`, resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.webp': 'dataurl' },
  plugins: [{ name: 'isolated-test-auth', setup(b) {
    b.onResolve({ filter: /\/lib\/supabase-client\.js$/ }, () => ({ path: 'auth', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export const createTemporaryPlayerInviteClient=()=>({auth:{signInWithPassword:async credentials=>({data:{session:{access_token:'test-only',refresh_token:'test-only'}}})}});export const supabase={auth:{setSession:async()=>({error:null})}};` }))
  } }],
})
let server
let requests = []
const serveFixture = async (req, res, next) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/player-invite') {
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html><html class="theme-${url.searchParams.get('theme') === 'light' ? 'light' : 'dark'} accent-${url.searchParams.get('accent') === 'yellow' ? 'yellow' : 'green'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css?direct"></head><body><div id="root"></div><script src="/adult-fixture.js"></script></body></html>`)
  } else if (url.pathname === '/adult-fixture.js') {
    res.setHeader('Content-Type', 'application/javascript'); res.end(compiled.outputFiles[0].text)
  } else if (url.pathname === '/email-preview') {
    res.setHeader('Content-Type', 'text/html'); res.end(buildAdultPlayerInviteEmail({ ...brand, link: `http://127.0.0.1:${server.httpServer.address().port}/player-invite#invite=${token}` }).html)
  } else if (url.pathname === '/.netlify/functions/adult-player-setup') {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); requests.push(body)
    res.setHeader('Content-Type', 'application/json')
    if (body.token.endsWith('0008')) { res.statusCode = 410; res.end(JSON.stringify({ success: false, message: 'This invitation is unavailable or has expired. Ask your club to invite you again.' })) }
    else res.end(JSON.stringify({ success: true, state: body.token.endsWith('0007') ? 'accepted' : 'pending', ...brand }))
  } else next()
}
server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{ name: 'adult-walkthrough', configureServer(instance) { instance.middlewares.use(serveFixture) } }] })
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
let browser
try {
  browser = await chromium.launch()
  const errors = []
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('https://footballplayer.online/icons/icon-192.png', route => route.fulfill({ path: path.resolve('public/icons/icon-192.png') }))
  page.on('pageerror', error => errors.push(error.message))
  const contrast = async (selector) => page.locator(selector).first().evaluate(element => {
    const rgb = text => text.match(/[\d.]+/g).slice(0, 3).map(Number)
    const lum = color => { const c = rgb(color).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722 }
    let parent = element, background
    while (parent) { background = getComputedStyle(parent).backgroundColor; if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') break; parent = parent.parentElement }
    const a = lum(getComputedStyle(element).color), b = lum(background)
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
  })
  for (const { theme, accent } of [{ theme: 'light', accent: 'green' }, { theme: 'dark', accent: 'green' }, { theme: 'light', accent: 'yellow' }]) {
    await page.goto(`${base}/player-invite?theme=${theme}&accent=${accent}#invite=${token}`)
    await page.getByRole('button', { name: 'Create Player login', exact: true }).waitFor()
    await page.getByText(brand.clubName, { exact: true }).waitFor()
    assert.equal(await page.locator('header img').evaluate(image => image.complete && image.naturalWidth > 0), true)
    for (const selector of ['h1', 'h2', 'section p', 'label span', 'input[type=email]', 'input[type=password]', 'button[type=button]', 'form button:not([type])']) {
      assert.ok(await contrast(selector) >= 4.5, `${theme} ${selector} text contrast`)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: path.join(output, `02-signup-${theme}${accent === 'yellow' ? '-yellow' : ''}.png`), fullPage: true })
    await page.getByRole('button', { name: 'I already have an account' }).click()
    await page.getByLabel('Password', { exact: true }).waitFor()
    await page.getByRole('link', { name: 'Forgot your password?' }).waitFor()
    assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('autocomplete'), 'current-password')
    await page.screenshot({ path: path.join(output, `03-existing-account-${theme}.png`), fullPage: true })
  }
  await page.goto(`${base}/player-invite#invite=${token.replace(/6$/, '8')}`)
  await page.getByText('This invitation is unavailable or has expired. Ask your club to invite you again.').waitFor()
  assert.equal(await page.locator('input').count(), 0)
  await page.screenshot({ path: path.join(output, '04-expired-invitation.png'), fullPage: true })
  await page.goto(`${base}/player-invite#invite=${token.replace(/6$/, '7')}`)
  await page.getByRole('button', { name: 'Sign in and accept' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Create a Player login', exact: true }).count(), 0)
  assert.ok(requests.every(body => body.action === 'preview' && Object.keys(body).sort().join(',') === 'action,token'))
  let failPreview = true
  await page.route('**/.netlify/functions/adult-player-setup', route => failPreview ? route.abort() : route.continue())
  await page.goto(`${base}/player-invite#invite=${token}`)
  await page.getByText('We could not check your invitation. Check your connection and try again.').waitFor()
  failPreview = false
  await page.getByRole('button', { name: 'Check link again' }).click()
  await page.getByRole('button', { name: /^(Create Player login|Sign in and accept)$/ }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: 'Create Player login' }).waitFor()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: path.join(output, '02-signup-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/email-preview')
  await page.getByRole('heading', { name: 'Welcome to your team.' }).waitFor()
  assert.equal(await page.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, '01-club-invitation-email.png'), fullPage: true })
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme })
    for (const selector of ['h1', '.email-muted', 'a[href]']) assert.ok(await contrast(selector) >= 4.5, `email ${colorScheme} ${selector} contrast`)
    if (colorScheme === 'dark') await page.screenshot({ path: path.join(output, '01-club-invitation-email-dark.png'), fullPage: true })
  }
  const emailLink = await page.getByRole('link', { name: 'Set up Player access', exact: true }).getAttribute('href')
  assert.equal(new URL(emailLink).hash, '#invite=' + token)
  await page.getByRole('link', { name: 'Set up Player access', exact: true }).click()
  await page.getByRole('button', { name: 'Create Player login' }).waitFor()
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'email-preview.html'), buildAdultPlayerInviteEmail({ ...brand, link: `https://footballplayer.online/player-invite#invite=${token}` }).html)
  console.log('PASS adult invitation email link, club branding, mobile/desktop layout, light/dark contrast, existing account, used/expired states and connection retry')
  if (keepOpen) console.log(`Isolated walkthrough preview: ${base}/email-preview`)
} finally {
  await browser?.close()
  if (!keepOpen) await server.close()
}
