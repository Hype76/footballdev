import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'

await fs.mkdir('output', { recursive: true })
await fs.writeFile('output/marketing-final-test.html', `<html><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {MarketingPage} from '/src/components/marketing/MarketingPage.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(MarketingPage,{page:new URLSearchParams(location.search).get('page')})));</script></body></html>`)
process.env.VITE_PAYMENTS_DISABLED = 'false'
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const origin = 'http://127.0.0.1:' + server.httpServer.address().port
const browser = await chromium.launch({ headless: true }), page = await browser.newPage()
const errors = [], checkouts = []
let releaseCheckout
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error' && message.text().includes('Marketing interaction failed')) errors.push(message.text()) })
await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedOffer = value } } }) })
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin !== origin) return route.abort()
  if (url.pathname === '/.netlify/functions/get-live-promotion') return route.fulfill({ json: { success: true, promotion: { code: 'SYNTHETIC', promotionCodeId: 'promo_synthetic', percentOff: 10, duration: 'once' } } })
  if (url.pathname === '/.netlify/functions/create-checkout-session') {
    checkouts.push(request.postDataJSON())
    await new Promise(resolve => { releaseCheckout = resolve })
    return route.fulfill({ status: 503, json: { success: false, message: 'Synthetic checkout unavailable' } })
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) throw new Error('Unexpected write ' + url.pathname)
  return route.continue()
})
const open = async name => page.goto(origin + '/output/marketing-final-test.html?page=' + name, { waitUntil: 'networkidle' })
try {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await open('sign-in')
    await page.getByRole('link', { name: /Coach or club admin/ }).waitFor()
    assert.equal(await page.getByRole('link', { name: /Coach or club admin/ }).getAttribute('href'), '/sign-in')
    assert.equal(await page.locator('.main-nav .nav-sign').getAttribute('href'), '/sign-in/choose')
    assert.equal(await page.getByRole('link', { name: /Parent or fan/ }).getAttribute('href'), 'https://parent.footballplayer.online/parent-login')
    await open('pricing')
    await page.getByRole('heading', { name: /The right tools/ }).waitFor()
    await page.getByText(/Live offer: use SYNTHETIC/).waitFor()
    assert.equal(await page.locator('.plan-card').count(), 3)
    assert.match(await page.locator('.plan-card').nth(1).textContent(), /£7\.99/)
    assert.match(await page.locator('.plan-card').nth(2).textContent(), /£59\.99[\s\S]*20 teams/)
    await page.getByRole('button', { name: 'About Teams included', exact: true }).click()
    assert.equal(await page.locator('#feature-tip-1').isVisible(), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
  }
  await page.getByRole('link', { name: 'Choose Team', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-marketing-checkout]').getAttribute('aria-disabled') === 'true')
  await page.locator('[data-marketing-checkout]').dispatchEvent('click')
  assert.equal(checkouts.length, 1)
  assert.deepEqual(checkouts[0], { planName: 'Team', planKey: 'team', billingCycle: 'monthly', teamCapacity: 1, livePromotionCodeId: 'promo_synthetic' })
  releaseCheckout()
  await page.getByRole('status').filter({ hasText: 'Synthetic checkout unavailable' }).waitFor()
  assert.equal(await page.locator('[data-marketing-checkout]').getAttribute('aria-disabled'), null)
  await open('matchday')
  assert.equal(await page.locator('.promotion-total strong').textContent(), '39')
  assert.equal(await page.locator('.promotion-football-grid .promotion-slot').count(), 250)
  assert.equal(await page.locator('.promotion-football-grid .promotion-slot.is-filled').count(), 39)
  assert.match(await page.locator('.promotion-summary').textContent(), /39 teams already onboard.*211 places remaining/)
  await page.getByRole('button', { name: 'Share with fellow coaches', exact: true }).click()
  assert.equal(await page.locator('#offer-share-url').inputValue(), 'https://footballplayer.online/matchday/#first-250')
  await page.locator('[data-offer-share="copy"]').click()
  await page.waitForFunction(() => window.copiedOffer?.includes('https://footballplayer.online/matchday/#first-250'))
  assert.deepEqual(errors, [])
  console.log('PASS final chooser and pricing at 3 widths, tooltips, canonical Team checkout and promotion, duplicate prevention/error recovery, 39/250 counter and public sharing. All writes mocked.')
} finally { await browser.close(); await server.close() }
