import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'

await fs.mkdir('output', { recursive: true })
await fs.writeFile('output/marketing-final-test.html', `<html><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {MarketingPage} from '/src/components/marketing/MarketingPage.jsx';import GlobalInstallAppButton from '/src/components/pwa/GlobalInstallAppButton.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(MarketingPage,{page:new URLSearchParams(location.search).get('page')}),React.createElement(GlobalInstallAppButton)));</script></body></html>`)
process.env.VITE_PAYMENTS_DISABLED = 'false'
process.env.VITE_SUPABASE_URL = 'https://stats.example.invalid'
process.env.VITE_SUPABASE_ANON_KEY = ''
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_synthetic'
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const origin = 'http://127.0.0.1:' + server.httpServer.address().port
const browser = await chromium.launch({ headless: true }), page = await browser.newPage()
const errors = [], checkouts = []
let releaseCheckout
let statsRequests = 0, statsStatus = 200
let statsRows = [{ matches_recorded: 71, goals_recorded: 168, alerts_sent: 5272, teams_active: 39, clubs_active: 15, updated_at: '2026-10-05T19:00:00.068223Z' }]
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error' && message.text().includes('Marketing interaction failed')) errors.push(message.text()) })
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedOffer = value } } })
  // Older Safari can fetch with AbortController but has no AbortSignal.timeout.
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true })
})
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.hostname === 'stats.example.invalid' && url.pathname === '/rest/v1/marketing_matchday_stats') {
    assert.equal(request.method(), 'GET')
    assert.equal(request.headers().apikey, 'sb_publishable_synthetic')
    statsRequests++
    return route.fulfill({ status: statsStatus, json: statsRows })
  }
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
    assert.equal(await page.getByRole('link', { name: 'Set up your team', exact: true }).getAttribute('href'), '/sign-in?mode=signup&plan=matchday')
    const signup = page.getByRole('link', { name: 'Set up your team', exact: true })
    assert.ok((await signup.boundingBox()).height >= 52, 'Signup has a prominent accessible touch target')
    assert.ok(await signup.evaluate(element => getComputedStyle(element).fontWeight >= 700), 'Signup is emphasised')
    assert.equal(await signup.evaluate(element => getComputedStyle(element).color), 'rgb(255, 255, 255)', 'Signup text remains readable against its blue background')
    await page.locator('.signin-new').screenshot({ path: `output/signup-action-${width}.png` })
    await page.getByRole('link', { name: 'Get help joining', exact: true }).click()
    await page.getByRole('dialog', { name: 'Talk to us' }).waitFor()
    assert.equal(new URL(page.url()).hash, '', 'Joining help opens the form without scrolling to the footer')
    await page.getByRole('button', { name: 'Close contact form' }).click()
    if (width < 800) await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.locator('.main-nav').getByRole('link', { name: 'Contact', exact: true }).click()
    await page.getByRole('dialog', { name: 'Talk to us' }).waitFor()
    await page.getByRole('button', { name: 'Close contact form' }).click()
    assert.equal(await page.getByRole('link', { name: /Parent or fan/ }).getAttribute('href'), 'https://parent.footballplayer.online/parent-login')
    await open('pricing')
    await page.getByRole('heading', { name: /The right tools/ }).waitFor()
    await page.getByText(/Live offer: use SYNTHETIC/).waitFor()
    assert.equal(await page.locator('.plan-card').count(), 3)
    assert.equal(await page.locator('.plan-grid').evaluate(element => getComputedStyle(element).display), 'grid')
    const planPositions = await page.locator('.plan-card').evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })))
    if (width >= 800) assert.equal(planPositions[0].y, planPositions[2].y)
    else assert.ok(planPositions[2].y > planPositions[0].y)
    assert.match(await page.locator('.plan-card').nth(1).textContent(), /£7\.99/)
    assert.match(await page.locator('.plan-card').nth(2).textContent(), /£59\.99[\s\S]*20 teams/)
    await page.locator('.compare-scroll').scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.getByRole('button', { name: 'About Teams included', exact: true }).click()
    assert.equal(await page.locator('#feature-tip-1').isVisible(), true)
    assert.ok(await page.locator('#feature-tip-1').evaluate(tip => {
      const bounds = tip.getBoundingClientRect()
      return tip.contains(document.elementFromPoint(bounds.left + 5, bounds.top + 5))
    }), 'Tooltip paints above the sticky feature column')
    await page.screenshot({ path: `output/feedback-tooltip-${width}.png` })
    assert.equal(await page.locator('.compare-table tbody th').first().evaluate(element => getComputedStyle(element).color), 'rgb(16, 28, 53)')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    await page.keyboard.press('Escape')
    const comparison = page.locator('.compare-scroll')
    await comparison.scrollIntoViewIfNeeded()
    const original = await page.locator('.compare-table thead th').first().boundingBox()
    const feature = await page.locator('.compare-table tbody th').first().boundingBox()
    await comparison.evaluate(element => { element.scrollTop = 150; element.scrollLeft = 180 })
    const pinned = await page.locator('.compare-table thead th').first().boundingBox()
    const pinnedFeature = await page.locator('.compare-table tbody th').first().boundingBox()
    assert.ok(Math.abs(pinned.y - original.y) < 2, 'Comparison heading stays fixed while rows scroll')
    assert.ok(Math.abs(pinned.x - original.x) < 2, 'Feature heading stays fixed while plans scroll')
    assert.ok(Math.abs(pinnedFeature.x - feature.x) < 2, 'Feature column stays fixed while plans scroll')
    assert.ok(await comparison.evaluate(element => element.scrollHeight > element.clientHeight), 'Comparison rows can scroll vertically')
    assert.ok((await page.locator('.compare-table tbody tr').first().boundingBox()).height < 100, 'Rows are compact')
    await comparison.screenshot({ path: `output/mobile-comparison-pinned-${width}.png` })
    await comparison.evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0 })
    await page.locator('.feature-info').first().evaluate(element => element.blur())
    const featureInfo = page.getByRole('button', { name: 'About Teams included', exact: true })
    await featureInfo.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await featureInfo.evaluate(element => element.focus({ preventScroll: true }))
    assert.equal(await page.locator('#feature-tip-1').isVisible(), true, 'Keyboard focus opens feature information')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#feature-tip-1').isVisible(), false, 'Escape dismisses feature information')
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }) })
    await page.screenshot({ path: `output/final-pricing-${width}.png`, fullPage: true })
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
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await open('teams')
    assert.equal(await page.locator('.laptop-screen').first().evaluate(element => getComputedStyle(element).borderTopWidth), width === 390 ? '12px' : '14px')
    await page.screenshot({ path: `output/final-teams-${width}.png`, fullPage: true })
    await open('clubs')
    assert.equal(await page.locator('.laptop-screen').count(), 1)
    assert.equal(await page.locator('.laptop-base').count(), 1)
    assert.equal(await page.locator('.laptop-scene .image-caption').textContent(), 'Screens from Football Player in a web browser')
    await page.locator('.laptop-scene').screenshot({ path: `output/feedback-club-laptop-${width}.png` })
    await open('home')
    assert.equal(await page.locator('.demo-intro p').first().textContent(), 'Tap "Goal" on the Coach’s phone below, then choose a scorer and watch the update arrive on the parent’s phone.')
    await page.locator('[data-view="club"]').click()
    assert.equal(await page.locator('[data-view-kind]').getAttribute('data-view-kind'), 'desktop')
    assert.equal(await page.locator('[data-view-caption]').textContent(), 'Screens from Football Player in a web browser')
    assert.notEqual(await page.locator('[data-view-kind]').evaluate(element => getComputedStyle(element, '::after').content), 'none', 'Club tab retains its laptop base')
    await open('how-to')
    assert.equal(await page.locator('.tutorial-grid').evaluate(element => getComputedStyle(element).display), 'grid')
    const columns = await page.locator('.tutorial-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
    assert.equal(columns, width === 390 ? 1 : 2)
    await page.screenshot({ path: `output/final-how-to-${width}.png`, fullPage: true })
  }
  await page.evaluate(() => sessionStorage.removeItem('fp-v3-stats'))
  statsRequests = 0
  await open('home')
  await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')))
  assert.equal(await page.getByRole('button', { name: 'Install App', exact: true }).count(), 0)
  assert.deepEqual(await page.locator('[data-stat]').allTextContents(), ['71', '168', '5,272', '39', '15'])
  assert.equal(await page.locator('.stat-grid').isVisible(), true)
  assert.match(await page.locator('[data-stats-status]').textContent(), /Updated 5 Oct.*20:00.*BST/)
  for (const name of ['matchday', 'teams', 'clubs']) {
    await open(name)
    assert.deepEqual(await page.locator('[data-stat]').allTextContents(), ['71', '168', '5,272', '39', '15'])
  }
  assert.equal(statsRequests, 1, 'Four route loads reuse the five-minute session cache')
  await page.evaluate(() => {
    const cached = JSON.parse(sessionStorage.getItem('fp-v3-stats'))
    cached.cachedAt = Date.now() - 300001
    sessionStorage.setItem('fp-v3-stats', JSON.stringify(cached))
  })
  statsRows = [{ matches_recorded: 0, goals_recorded: 0, alerts_sent: 0, teams_active: 0, clubs_active: 0, updated_at: '2026-10-05T19:00:00.068223Z' }]
  await open('home')
  assert.equal(statsRequests, 2, 'Expired totals are refreshed')
  assert.deepEqual(await page.locator('[data-stat]').allTextContents(), ['0', '0', '0', '0', '0'])
  await page.evaluate(() => sessionStorage.removeItem('fp-v3-stats'))
  statsRows = [{ matches_recorded: null, goals_recorded: 'invalid', alerts_sent: '', teams_active: false, updated_at: 'invalid' }]
  await open('home')
  assert.deepEqual(await page.locator('[data-stat]').allTextContents(), Array(5).fill('Unavailable'))
  assert.equal(await page.locator('[data-stats-status]').textContent(), 'Football Player activity')
  for (const scenario of [{ rows: [], status: 200 }, { rows: { message: 'Synthetic unavailable' }, status: 503 }]) {
    await page.evaluate(() => sessionStorage.removeItem('fp-v3-stats'))
    statsRows = scenario.rows
    statsStatus = scenario.status
    await open('home')
    assert.equal(await page.locator('.stat-grid').isVisible(), true)
    assert.deepEqual(await page.locator('[data-stat]').allTextContents(), Array(5).fill('Unavailable'))
    assert.match(await page.locator('[data-stats-status]').textContent(), /temporarily unavailable/)
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      const fitted = await page.locator('[data-stat]').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1))
      assert.ok(fitted, 'Unavailable labels fit their statistics cells')
      await page.locator('.stats').screenshot({ path: `output/mobile-unavailable-stats-${width}.png` })
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS final marketing interactions and layout; stats publishable-key fallback, five real counters on four routes, UK timestamp, zero/invalid/missing/unavailable states and cache reuse/expiry. All writes mocked.')
} finally { await browser.close(); await server.close() }
