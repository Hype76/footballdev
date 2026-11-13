import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { build, createServer, preview } from 'vite'
import { chromium } from 'playwright'
import { activeTvSponsors, TV_RECOVERY_MS, TV_REFRESH_MS, TV_SPONSOR_BUCKET, TV_SPONSOR_EXTENSIONS, TV_SPONSOR_MAX_BYTES, tvUpcomingPeriodWindow } from '../src/lib/club-matchday-tv.js'

const port = Number(process.env.CLUB_TV_BROWSER_PORT || 43136), origin = `http://127.0.0.1:${port}`
Object.assign(process.env, { VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true', VITE_APP_URL: origin, VITE_PARENT_APP_URL: origin, VITE_SUPABASE_URL: 'http://fixture.supabase.test', VITE_SUPABASE_ANON_KEY: 'fixture-anon-key' })
const server = await createServer({ cacheDir: 'output/playwright/.vite-club-tv', server: { host: '127.0.0.1', port, strictPort: true }, mode: 'development' })
await server.listen()
const browser = await chromium.launch({ headless: true })
const output = 'output/playwright/club-matchday-tv'
await mkdir(output, { recursive: true })

async function verifyProductionEntries() {
  const buildOptions = { outDir: `${output}/production`, emptyOutDir: true }
  const fixtureFlag = process.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES
  try {
    process.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES = 'false'
    await build({ mode: 'production', logLevel: 'warn', build: buildOptions })
  } finally {
    process.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES = fixtureFlag
  }
  const production = await preview({ mode: 'production', logLevel: 'error', build: buildOptions, preview: { host: '127.0.0.1', port: 0 } })
  const base = `http://127.0.0.1:${production.httpServer.address().port}`
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const errors = []
  try {
    await context.route('**/club-matchday-tv/view/**', async route => {
      await route.fulfill({ response: await route.fetch({ url: `${base}/matchday-tv-view.html` }) })
    })
    await context.route('**/.netlify/functions/club-matchday-tv', route => route.fulfill({ status: 401, json: { message: 'Sign in to open the club matchday display.' } }))
    const viewer = await context.newPage()
    viewer.on('pageerror', error => errors.push(error.message))
    await viewer.goto(`${base}/club-matchday-tv/view/cedarfield-fc`)
    await viewer.getByText('Sign in with your Club Admin account to open this display.', { exact: true }).waitFor({ timeout: 15000 })
    const admin = await context.newPage()
    admin.on('pageerror', error => errors.push(error.message))
    await admin.goto(`${base}/sign-in`)
    await admin.waitForFunction(() => document.querySelector('#root')?.innerText.trim().length > 10, null, { timeout: 15000 })
    assert.deepEqual(errors, [], 'Both compiled entry pages start without browser errors')
    console.log('PASS: compiled Club Admin and standalone Matchday TV entry pages.')
  } catch (error) {
    if (errors.length) throw new Error(errors.join('\n'), { cause: error })
    throw error
  } finally {
    await context.close()
    await new Promise(resolve => production.httpServer.close(resolve))
  }
}
const date = '2026-10-21'
const fixtureEmail = 'club.fixture@footballplayer.test'
const fixtureSession = { access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_at: 4102444800, expires_in: 31536000, token_type: 'bearer', user: { id: 'fixture-user', aud: 'authenticated', role: 'authenticated', email: fixtureEmail } }
const clubBadge = `data:image/webp;base64,${(await readFile('src/assets/football-player-logo.webp')).toString('base64')}`
const makeMatch = (index) => ({ id: `match-${index}`, teamName: `U${index + 7} Blue`, opponent: `Visitors ${index + 1}`, homeAway: index % 2 ? 'away' : 'home', matchDate: date, kickoff: '10:00', kickoffTbc: false, venue: `Pitch ${index + 1}`, status: index < 3 ? 'live' : index < 6 ? 'full_time' : 'scheduled', homeScore: index % 3, awayScore: 0, timerStatus: index < 3 ? 'running' : index < 6 ? 'full_time' : 'not_started', elapsed: 1200, timerStartedAt: '2026-10-21T09:00:00Z', events: [{ id: `event-${index}`, type: 'goal', side: 'club', shirt: '9', minute: 12 }, { id: `red-${index}`, type: 'red_card', side: 'opponent', shirt: '4', minute: 19 }] })
let matches = Array.from({ length: 19 }, (_, index) => makeMatch(index)), denied = false, unavailable = false, requests = [], unlockAccepted = false
const longTeamName = 'U7 Cambourne Town Football Club Saturday Development Team Blue 26/27'
matches[0] = { ...matches[0], teamName: longTeamName, venue: 'Cambourne Sports Centre, Pitch 1, 45 High Street' }
matches[2] = { ...matches[2], venue: 'Cambourne Fitness and Sports Centre' }
matches[4] = { ...matches[4], homeScore: 16, awayScore: 13 }
matches[7] = { ...matches[7], kickoffTbc: true }
let displayWindow
let settings = { slug: null, preferences: null, revision: 0 }
const firstAvailabilityCheck = Promise.withResolvers()
let failFirstCedarfieldCheck = true
let holdNextScorePoll
let viewingDate = date
const artwork = new Map()
const signedArtworkUrl = (path) => `http://fixture.supabase.test/storage/v1/object/sign/${TV_SPONSOR_BUCKET}/${path}?token=fixture-read`
const errors = []
try {
  await verifyProductionEntries()
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await context.addInitScript((session) => {
    if (!sessionStorage.getItem('auth-access-browser-fixture-email')) sessionStorage.setItem('auth-access-browser-fixture-email', 'club.fixture@footballplayer.test')
    sessionStorage.setItem('selected-access-mode', 'team')
    sessionStorage.setItem('selected-access-mode-explicit', 'true')
    localStorage.setItem('sb-fixture-auth-token', JSON.stringify(session))
  }, fixtureSession)
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/club-matchday-tv/view/')) {
      return route.fulfill({ response: await route.fetch({ url: `${origin}/matchday-tv-view.html` }) })
    }
    if (url.hostname === 'fixture.supabase.test') {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const uploadPrefix = `/storage/v1/object/upload/sign/${TV_SPONSOR_BUCKET}/`
      const readPrefix = `/storage/v1/object/sign/${TV_SPONSOR_BUCKET}/`
      if (url.pathname.startsWith(uploadPrefix)) {
        assert.equal(url.searchParams.get('token'), 'fixture-write')
        const request = route.request()
        const file = await new Response(request.postDataBuffer(), { headers: { 'content-type': request.headers()['content-type'] } }).formData()
        const original = file.get('')
        const path = url.pathname.slice(uploadPrefix.length)
        artwork.set(path, { bytes: Buffer.from(await original.arrayBuffer()), type: original.type })
        return route.fulfill({ json: { Key: `${TV_SPONSOR_BUCKET}/${path}` }, headers })
      }
      if (url.pathname.startsWith(readPrefix)) {
        assert.equal(url.searchParams.get('token'), 'fixture-read')
        const original = artwork.get(url.pathname.slice(readPrefix.length))
        return route.fulfill({ body: original.bytes, contentType: original.type, headers })
      }
      if (url.pathname === '/auth/v1/token') {
        assert.equal(url.searchParams.get('grant_type'), 'password')
        assert.deepEqual(route.request().postDataJSON(), { email: fixtureEmail, password: 'Fixture-Club-Password', gotrue_meta_security: {} })
        return route.fulfill({ json: fixtureSession, headers })
      }
      return route.fulfill({ json: [], headers })
    }
    if (url.pathname === '/.netlify/functions/club-matchday-tv') {
      const body = route.request().postDataJSON(); requests.push(body)
      if (body.slug && (!body.action || ['view', 'weather', 'sponsorArtwork'].includes(body.action))
        && settings.preferences?.accessMode !== 'public' && !route.request().headers().authorization) {
        return route.fulfill({ status: 401, json: { message: 'Sign in to open the club matchday display.' } })
      }
      if (body.action === 'settings') return route.fulfill({ json: { club: { id: body.clubId }, settings } })
      if (body.action === 'sponsorUpload') {
        assert.ok(body.bytes > 0 && body.bytes <= TV_SPONSOR_MAX_BYTES)
        const path = `11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-${String(artwork.size + 1).padStart(12, '0')}.${TV_SPONSOR_EXTENSIONS[body.mimeType]}`
        return route.fulfill({ json: { club: { id: body.clubId }, upload: { path, token: 'fixture-write' } } })
      }
      if (body.action === 'sponsorArtwork') {
        assert.ok(settings.preferences.sponsorAds.some(ad => ad.imagePath === body.imagePath))
        return route.fulfill({ json: { club: { id: body.clubId }, imageUrl: signedArtworkUrl(body.imagePath) } })
      }
      if (body.action === 'availability') {
        if (body.slug === 'cedarfield-fc' && failFirstCedarfieldCheck) {
          failFirstCedarfieldCheck = false
          await firstAvailabilityCheck.promise
          return route.fulfill({ status: 503, json: { message: 'Availability could not be checked.' } })
        }
        return route.fulfill({ json: { club: { id: body.clubId }, availability: body.slug === 'oakfield-town' ? 'taken' : 'available' } })
      }
      if (body.action === 'save') {
        settings = { slug: body.slug || settings.slug, preferences: body.preferences, revision: settings.revision + 1 }
        return route.fulfill({ json: { club: { id: body.clubId }, settings } })
      }
      if (body.action === 'view') {
        if (body.slug !== settings.slug) return route.fulfill({ status: 403, json: { message: 'This link is unavailable for your Club Admin account.' } })
        const preferences = settings.preferences?.accessMode === 'public'
          ? { ...settings.preferences, sponsorAds: activeTvSponsors(settings.preferences.sponsorAds, viewingDate) }
          : settings.preferences
        return route.fulfill({ json: { club: { id: 'club-fixture' }, settings: { ...settings, preferences } } })
      }
      if (body.action === 'unlock') return route.fulfill({ status: unlockAccepted ? 200 : 401, contentType: 'application/json', body: JSON.stringify(unlockAccepted ? { club: { id: body.clubId }, unlocked: true } : { message: 'Password not accepted. The display stays locked.' }) })
      const payload = denied ? { message: 'Access is restricted to your own active Club Admin workspace.' } : unavailable ? { message: 'Scores could not be refreshed.' } : body.action === 'weather' ? { club: { id: body.clubId }, weather: { temperature: 13, windMph: 7, location: 'Club ground', condition: 'cloudy', time: '2026-10-21T09:00:00Z' } } : { club: { id: body.clubId, name: 'Test Club United', logoUrl: clubBadge, accent: '#1465c0' }, date: body.date, window: body.period && body.period !== 'day' ? tvUpcomingPeriodWindow(body.date, body.period, date) : displayWindow, matches, refreshedAt: '2026-10-21T09:00:00Z' }
      if (!body.action && holdNextScorePoll) {
        const hold = holdNextScorePoll
        holdNextScorePoll = null
        await hold.promise
      }
      return route.fulfill({ status: denied ? 403 : unavailable ? 503 : 200, contentType: 'application/json', body: JSON.stringify(payload) })
    }
    if (url.pathname.startsWith('/.netlify/functions/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    return route.continue()
  })
  const page = await context.newPage()
  async function assertScoreFits() {
    const fits = await page.locator('.club-tv-score>[data-result="win"]').evaluate(score => {
      const range = document.createRange()
      range.selectNode(score.firstChild)
      const text = range.getBoundingClientRect()
      const box = score.getBoundingClientRect()
      return text.left >= box.left && text.right <= box.right
    })
    assert.ok(fits, 'Both scores stay inside their result badge')
  }
  async function nextGoal(selector) {
    for (let second = 0; second < 12; second++) {
      await page.clock.runFor(1000)
      if (await page.locator(selector).isVisible()) return
    }
    assert.fail(`Goal celebration missing: ${selector}`)
  }
  async function openSettings() {
    await page.goto(`${origin}/club-matchday-tv/settings`)
    await page.getByLabel('Appearance', { exact: true }).waitFor()
  }
  async function saveAndPreview() {
    await page.getByRole('button', { name: 'Save settings' }).click()
    await page.getByText('Display settings saved.', { exact: true }).waitFor()
    await page.getByRole('link', { name: 'Preview saved display' }).click()
    await page.getByRole('heading', { name: 'Test Club United' }).waitFor()
  }
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.goto(`${origin}/coach`)
  const matchOperations = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Match Operations' }) })
  await matchOperations.getByRole('link', { name: 'Matchday TV' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Matchday TV' }).count(), 1)
  assert.equal(await page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Club setup' }) }).getByRole('link', { name: 'Matchday TV' }).count(), 0)
  await page.screenshot({ path: `${output}/match-operations-menu.png` })
  await matchOperations.getByRole('link', { name: 'Matchday TV' }).click()
  await page.getByRole('heading', { name: 'Matchday TV', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Preview saved display' }).waitFor()
  await page.goto(`${origin}/club-matchday-tv`)
  await page.getByRole('heading', { name: 'Test Club United' }).waitFor()
  assert.equal(await page.locator('.club-tv-identity small').textContent(), 'WELCOME TO')
  assert.equal(await page.locator('.club-tv-light').count(), 1)
  assert.ok(await page.locator('.club-tv-team-badge').count() >= 12)
  const scoreBadge = page.locator('.club-tv-own .club-tv-team-badge').first()
  assert.equal(await scoreBadge.getAttribute('src'), clubBadge)
  assert.equal((await scoreBadge.boundingBox()).width, 28)
  assert.equal((await page.locator('.club-tv-identity img').boundingBox()).width, 72)
  assert.equal((await page.locator('.club-tv-home-teams .club-tv-team-badge').first().boundingBox()).width, 28)
  assert.ok(Math.abs((await page.locator('.club-tv-road-item .club-tv-team-badge').first().boundingBox()).width - 22) < 0.1)
  assert.equal(await page.locator('.club-tv-team:not(.club-tv-own) .club-tv-team-badge').count(), 0)
  assert.equal(await page.locator('.club-tv-road-item').first().locator('.club-tv-team-badge').count(), 1)
  assert.equal(await page.locator('.club-tv-match').count(), 8)
  assert.deepEqual(await page.locator('.club-tv-match-meta > strong').allTextContents(), ['LIVE', 'LIVE', 'LIVE', 'FULL TIME', 'FULL TIME', 'FULL TIME', 'KO 10:00', 'KO TBC'])
  assert.deepEqual((await page.locator('.club-tv-home-pitch').allTextContents()).slice(0, 2), ['1', ''])
  assert.ok((await page.locator('.club-tv-match-meta').first().boundingBox()).width >= 78)
  assert.ok((await page.locator('.club-tv-home-pitch').first().boundingBox()).width >= 76)
  const scoreStyles = await page.locator('.club-tv-score>strong').evaluateAll(scores =>
    scores.map(score => [score.dataset.result || '', getComputedStyle(score).backgroundColor]))
  assert.deepEqual(scoreStyles.slice(0, 6), [
    ['', 'rgb(23, 77, 160)'], ['', 'rgb(23, 77, 160)'], ['', 'rgb(23, 77, 160)'],
    ['draw', 'rgb(245, 207, 82)'], ['win', 'rgb(24, 116, 66)'], ['loss', 'rgb(178, 33, 55)'],
  ])
  await assertScoreFits()
  const nameStyles = await page.locator('.club-tv-team-name').evaluateAll(names => names.map(name => {
    const style = getComputedStyle(name)
    return [style.fontFamily, style.fontSize, style.fontWeight, style.whiteSpace, style.textOverflow]
  }))
  assert.equal(new Set(nameStyles.map(style => JSON.stringify(style))).size, 1)
  assert.deepEqual(nameStyles[0].slice(3), ['nowrap', 'ellipsis'])
  assert.ok(await page.locator('.club-tv-match').first().getByTitle(longTeamName).evaluate(name => name.scrollWidth > name.clientWidth))
  assert.equal(await page.locator('.club-tv-home-row').count(), 6)
  assert.deepEqual(await page.locator('.club-tv-live-pitch').allTextContents(), ['Pitch 1', 'Pitch 2'])
  assert.equal(await page.locator('.club-tv-road-track').count(), 1)
  assert.equal(await page.locator('.club-tv-ordering').count(), 0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => document.querySelectorAll('.club-tv-road-track>div:first-child .club-tv-road-item').length === 1)
  assert.equal(await page.locator('.club-tv-road-track>div:first-child .club-tv-road-item').count(), 1)
  const firstAway = await page.locator('.club-tv-road-track>div:first-child').textContent()
  await page.getByRole('button', { name: 'Next away fixture' }).click()
  assert.notEqual(await page.locator('.club-tv-road-track>div:first-child').textContent(), firstAway)
  const reducedRoadFits = await page.locator('.club-tv-road').evaluate((road) => {
    const bounds = road.getBoundingClientRect()
    return [...road.querySelectorAll('.club-tv-road-track>div:first-child .club-tv-road-item')]
      .every(item => { const row = item.getBoundingClientRect(); return row.right <= bounds.right + 1 && row.bottom <= bounds.bottom + 1 })
  })
  assert.equal(reducedRoadFits, true, 'Reduced motion keeps every away fixture visible')
  await page.setViewportSize({ width: 1366, height: 600 })
  await page.waitForFunction(() => {
    const edge = selector => document.querySelector(selector)?.getBoundingClientRect()
    const home = edge('.club-tv-home-panel'), score = edge('.club-tv-fixtures')
    const homeRow = edge('.club-tv-home-row:last-of-type'), scoreRow = edge('.club-tv-match:last-of-type')
    return home && score && homeRow && scoreRow && homeRow.bottom <= home.bottom + 1 && scoreRow.bottom <= score.bottom + 1
  })
  const reducedLayout = await page.evaluate(() => {
    const edge = selector => document.querySelector(selector)?.getBoundingClientRect()
    const footer = edge('.club-tv-footer'), home = edge('.club-tv-home-panel'), score = edge('.club-tv-fixtures')
    const homeRow = document.querySelector('.club-tv-home-row:last-of-type')?.getBoundingClientRect()
    const scoreRow = document.querySelector('.club-tv-match:last-of-type')?.getBoundingClientRect()
    return { footerBottom: footer.bottom, homeFits: homeRow.bottom <= home.bottom + 1, scoreFits: scoreRow.bottom <= score.bottom + 1, homeBottom: home.bottom, homeRowBottom: homeRow.bottom, scoreBottom: score.bottom, scoreRowBottom: scoreRow.bottom }
  })
  assert.ok(reducedLayout.footerBottom <= 601 && reducedLayout.homeFits && reducedLayout.scoreFits, `Reduced-motion 600px TV keeps centre and footer visible: ${JSON.stringify(reducedLayout)}`)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  assert.equal(await page.locator('.club-tv-goal-large').count(), 0)
  assert.match(await page.locator('.club-tv-pages').textContent(), /Page 1 \/ [2-9]/)
  assert.ok(requests.every((request) => request.clubId === 'club-fixture'))
  assert.equal(await page.locator('audio').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'TV mode', exact: true }).count(), 0)
  assert.equal(await page.locator('.club-tv-controls').isVisible(), true)
  const bounds = await page.locator('.club-tv-footer').boundingBox()
  assert.ok(bounds.y + bounds.height <= 1081, `TV footer fits 1080p: ${JSON.stringify(bounds)}`)
  const fullWidthLastRow = await page.locator('.club-tv-match').last().boundingBox()
  assert.ok(fullWidthLastRow.y + fullWidthLastRow.height <= bounds.y + 1, 'All live score rows fit above the footer')
  await page.screenshot({ path: `${output}/tv-full.png` })
  const dateInput = page.getByLabel('Match date')
  assert.equal(await dateInput.getAttribute('min'), date)
  await dateInput.fill('2026-10-20')
  assert.equal(await dateInput.inputValue(), date)
  const priorMatches = matches
  matches = [...matches, { ...makeMatch(81), matchDate: '2026-10-20', opponent: 'Past Away Fixture' }, { ...makeMatch(82), matchDate: '2026-10-20', opponent: 'Past Home Fixture' }]
  for (const [button, heading, period] of [['Weekend', 'At home this weekend', 'weekend'], ['Week', 'At home this week', 'week'], ['Month', 'At home this month', 'month']]) {
    await page.getByRole('button', { name: button, exact: true }).click()
    await page.getByRole('heading', { name: heading, exact: true }).waitFor()
    await page.locator('.club-tv-home-date').first().waitFor()
    assert.equal(await page.getByRole('button', { name: button, exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(requests.filter(request => !request.action).at(-1).period, period)
    assert.ok(await page.locator('.club-tv-home-date').count() > 0)
    assert.equal(await page.getByText(/Past (Away|Home) Fixture/).count(), 0)
  }
  matches = priorMatches
  const beforeEmptyPeriod = matches
  matches = []
  await page.clock.runFor(11000)
  await page.getByRole('heading', { name: 'No matches in this period' }).waitFor()
  matches = beforeEmptyPeriod
  await page.getByLabel('Match date').fill('2026-10-24')
  await page.getByRole('heading', { name: 'At home on this date', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Month', exact: true }).getAttribute('aria-pressed'), 'false')
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await page.getByRole('heading', { name: 'At home today', exact: true }).waitFor()
  await page.locator('.club-tv-home-row').first().waitFor()
  assert.equal(requests.filter(request => !request.action).at(-1).period, 'day')
  const fullMatchday = matches
  const compactMatches = [
    { ...makeMatch(7), teamName: 'U14 JPL 26/27', opponent: 'Peterborough United Football Club U16 Girls', matchDate: '2026-10-24', venue: 'Bespoke Builds Training Ground', timerStatus: 'not_started', homeScore: 0, awayScore: 0, events: [] },
    { ...makeMatch(8), teamName: 'U12 Boys Gold 26/27', opponent: 'Soham Town Rangers Youth Black', matchDate: '2026-10-27', kickoffTbc: true, venue: 'Soham Village College', timerStatus: 'not_started', homeScore: 0, awayScore: 0, events: [] },
  ]
  matches = compactMatches
  await page.clock.runFor(11000)
  assert.equal(await page.locator('.club-tv-match').count(), 2)
  assert.equal(await page.locator('.club-tv-home-row').count(), 1)
  await page.screenshot({ path: `${output}/compact-two-matches.png` })
  displayWindow = { kind: 'week', startDate: '2026-10-22', endDate: '2026-10-28' }
  await page.clock.runFor(11000)
  await page.getByRole('heading', { name: 'Week ahead', exact: true }).waitFor()
  assert.match(await page.locator('.club-tv-home-row').first().textContent(), /Tue 27 Oct/)
  assert.equal(await page.locator('.club-tv-home-opponent').first().textContent(), 'vSoham Town Rangers Youth Black')
  assert.equal(await page.locator('.club-tv-home-date').first().textContent(), 'Tue 27 Oct')
  assert.equal(await page.locator('.club-tv-home-row').first().locator('> :last-child').getAttribute('class'), 'club-tv-home-date')
  assert.match(await page.locator('.club-tv-road-track>div:first-child').textContent(), /Sat 24 Oct/)
  await page.screenshot({ path: `${output}/week-ahead.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  const weeklyRow = await page.locator('.club-tv-home-row').first().boundingBox()
  const weeklyDate = await page.locator('.club-tv-home-date').first().boundingBox()
  const weeklyOpponent = await page.locator('.club-tv-home-opponent').first().boundingBox()
  assert.ok(weeklyOpponent.x + weeklyOpponent.width <= weeklyDate.x, 'Opponent and date do not overlap on a narrow display')
  assert.ok(weeklyDate.x + weeklyDate.width <= weeklyRow.x + weeklyRow.width + 1, 'Weekly date remains within the row')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: `${output}/week-ahead-narrow.png`, fullPage: true })
  await page.setViewportSize({ width: 1920, height: 1080 })
  matches = compactMatches.map((match, index) => index ? match : { ...match, homeScore: 1, events: [{ id: 'future-goal', type: 'goal', side: 'club', shirt: '7', minute: 3 }] })
  await page.clock.runFor(11000)
  assert.equal(await page.locator('.club-tv-goal-large,.club-tv-goal-small').count(), 0)
  matches = []
  await page.clock.runFor(11000)
  await page.getByRole('heading', { name: 'No live scores or results yet' }).waitFor()
  matches = fullMatchday; displayWindow = undefined
  await page.clock.runFor(11000)
  await page.keyboard.press('Escape')
  await page.clock.runFor(31000)
  assert.match(await page.locator('.club-tv-pages').textContent(), /Page 2 \/ 3/)
  await page.getByRole('button', { name: 'Pause carousel' }).click()
  await page.clock.runFor(31000)
  assert.match(await page.locator('.club-tv-pages').textContent(), /Page 2 \/ 3.*Paused/)
  await page.getByRole('button', { name: 'Previous match page' }).click()
  matches = matches.map((match, index) => index ? match : { ...match, homeScore: match.homeScore + 1, events: [...match.events, { id: 'new-goal', type: 'goal', side: 'club', shirt: '11', minute: 22 }] })
  await nextGoal('.club-tv-goal-large')
  assert.match(await page.locator('.club-tv-goal-large').textContent(), /#11/)
  await page.screenshot({ path: `${output}/goal-large.png` })
  await page.clock.runFor(8000)
  assert.equal(await page.locator('.club-tv-goal-large').count(), 0)

  matches = fullMatchday.map(match => ({ ...match, status: 'live', timerStatus: 'running' }))
  await page.goto(`${origin}/club-matchday-tv`)
  const carousel = page.locator('.club-tv-pages')
  const firstFixture = page.locator('.club-tv-match .club-tv-own .club-tv-team-name').first()
  await firstFixture.waitFor()
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 200)))
  await page.getByRole('button', { name: 'Next match page' }).click()
  assert.match(await carousel.textContent(), /Page 2 \/ 3/)
  const previousFixture = await firstFixture.textContent()
  const scorePollCount = () => requests.filter(request => !request.action).length
  const polls = scorePollCount()
  await page.clock.runFor(TV_REFRESH_MS - 1000)
  assert.equal(scorePollCount(), polls)
  const beforeGoal = await carousel.textContent()
  const goalFixture = matches[17].teamName
  assert.notEqual(previousFixture, goalFixture)
  matches = matches.map((match, index) => index === 17 || index === 18 ? {
    ...match, homeScore: match.homeScore + 1,
    events: [...match.events, { id: `cross-page-goal-${index}`, type: 'goal', side: 'club', shirt: String(index), minute: 29,
      createdAt: index === 17 ? '2026-10-21T09:01:02Z' : '2026-10-21T09:01:01Z' }],
  } : match)
  await page.clock.runFor(1000)
  await page.locator('.club-tv-goal-large').waitFor()
  assert.equal(scorePollCount(), polls + 1)
  assert.equal(await firstFixture.textContent(), goalFixture)
  assert.match(await page.locator('.club-tv-goal-large').textContent(), /#17/)
  const duringGoal = await carousel.textContent()
  assert.match(duringGoal, /Page 2 \/ 3/)
  assert.ok(Number(duringGoal.match(/(\d+)s/)[1]) >= Number(beforeGoal.match(/(\d+)s/)[1]) - 1)
  await page.clock.runFor(7000)
  assert.equal(await page.locator('.club-tv-goal-large').count(), 0)
  assert.equal(await firstFixture.textContent(), previousFixture)
  assert.equal(await carousel.textContent(), duringGoal)
  await page.clock.runFor(1000)
  assert.notEqual(await carousel.textContent(), duringGoal)

  await page.clock.fastForward(TV_RECOVERY_MS - 19000)
  assert.match(await carousel.textContent(), /Page 2 \/ 3/)
  const holdRecovery = Promise.withResolvers()
  holdNextScorePoll = holdRecovery
  const movedFixture = matches.find(match => match.teamName === previousFixture)
  matches = [...matches.filter(match => match !== movedFixture), movedFixture]
  await page.clock.runFor(1000)
  await page.waitForFunction(() => document.querySelector('.club-tv-pages')?.textContent.includes('Page 2 / 3'))
  const duringRecovery = await carousel.textContent()
  await page.clock.runFor(3000)
  assert.equal(holdNextScorePoll, null)
  assert.equal(await carousel.textContent(), duringRecovery)
  holdRecovery.resolve()
  await page.waitForFunction(() => document.querySelector('.club-tv-pages')?.textContent.includes('Page 3 / 3'))
  assert.equal((await carousel.textContent()).split('Next in ')[1], duringRecovery.split('Next in ')[1])
  assert.equal(await page.getByText(previousFixture, { exact: true }).first().isVisible(), true)

  await page.clock.fastForward(TV_RECOVERY_MS - 4000)
  await page.getByRole('button', { name: 'Pause carousel' }).click()
  const fallbackRefresh = Promise.withResolvers()
  holdNextScorePoll = fallbackRefresh
  matches = matches.slice(0, 12)
  await page.clock.runFor(1000)
  assert.equal(holdNextScorePoll, null)
  fallbackRefresh.resolve()
  await page.waitForFunction(() => document.querySelector('.club-tv-pages')?.textContent.includes('Page 2 / 2 · Paused'))
  assert.equal(await page.locator('.club-tv-goal-large,.club-tv-goal-small').count(), 0)
  matches = fullMatchday.map((match, index) => index ? match : { ...match, homeScore: match.homeScore + 1, events: [...match.events, { id: 'new-goal', type: 'goal', side: 'club', shirt: '11', minute: 22 }] })
  await page.clock.resume()
  console.log('PASS: 10-second score checks, newest goal on another page, and 15-minute recovery preserve carousel position and rotation time.')

  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ appearance: 'dark' })), `fp:club-matchday-tv:user-${fixtureEmail}:club-fixture`)
  await page.goto(`${origin}/club-matchday-tv`)
  await page.locator('.club-tv-dark').waitFor()
  await openSettings()
  assert.equal(await page.getByLabel('Appearance', { exact: true }).inputValue(), 'dark')
  await page.getByLabel('Appearance', { exact: true }).selectOption('light')
  await page.getByLabel('Club link ending').fill('A1B2')
  await page.getByText('Use at least four letters. Numbers and single hyphens are also allowed.', { exact: true }).waitFor()
  await page.getByLabel('Club link ending').fill('Settings')
  await page.getByText('Reserved', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).isDisabled(), true)
  await page.getByLabel('Club link ending').fill('Oakfield-Town')
  await page.getByText('Already taken', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).isDisabled(), true)
  await page.getByLabel('Club link ending').fill('Cedarfield-FC')
  await page.getByText('Checking availability…', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).isDisabled(), true)
  await page.locator('.club-tv-admin form').dispatchEvent('submit')
  assert.equal(requests.some(request => request.action === 'save'), false)
  firstAvailabilityCheck.resolve()
  await page.getByText('Availability could not be checked. Try again to save this ending.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).isDisabled(), true)
  await page.getByRole('button', { name: 'Check availability again' }).click()
  await page.getByText('Available', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).isEnabled(), true)
  await page.getByLabel('Club link ending').fill('CEDARFIELD-FC')
  assert.equal(await page.getByLabel('Club link ending').inputValue(), 'cedarfield-fc')
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).isEnabled(), true)
  const previewUrl = `${origin}/club-matchday-tv/view/cedarfield-fc`
  assert.equal(await page.getByLabel('Full viewing link').inputValue(), previewUrl)
  await page.getByRole('button', { name: 'Copy link preview' }).click()
  await page.getByText('Link copied. Save settings to activate it.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), previewUrl)
  assert.equal(await page.getByLabel('Viewing access').inputValue(), 'admin')
  await page.getByLabel('Large goal celebration').uncheck()
  await page.getByLabel('Club ground postcode').fill('CB23 6FY')
  const png = process.env.CLUB_TV_TEST_MAP ? await readFile(process.env.CLUB_TV_TEST_MAP) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64')
  await page.getByLabel('Pitch map', { exact: true }).setInputFiles({ name: 'ground.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length)]) })
  await page.getByAltText('Uploaded pitch map preview').waitFor()
  const dropped = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([Uint8Array.from(bytes)], 'dropped.png', { type: 'image/png' }))
    return transfer
  }, [...png])
  await page.locator('.club-tv-upload').first().dispatchEvent('drop', { dataTransfer: dropped })
  await page.getByAltText('Uploaded pitch map preview').waitFor()
  await page.getByLabel('Sponsor artwork').setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
  await page.getByRole('alert').getByText('Each sponsor image must be PNG, JPG or WebP and up to 5 MB.').waitFor()
  const advert = await readFile('public/club-tv-goal-alerts.webp')
  const originalAdvert = Buffer.concat([advert, Buffer.alloc(TV_SPONSOR_MAX_BYTES - advert.length)])
  await page.getByLabel('Sponsor artwork').setInputFiles({ name: 'Sponsor One.webp', mimeType: 'image/webp', buffer: originalAdvert })
  await page.getByAltText('Sponsor 1 preview').waitFor()
  const sponsorDrop = await page.evaluateHandle(async () => {
    const transfer = new DataTransfer()
    const canvas = document.createElement('canvas')
    canvas.width = 2; canvas.height = 2
    canvas.getContext('2d').fillRect(0, 0, 2, 2)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    transfer.items.add(new File([blob], 'Sponsor Two.png', { type: 'image/png' }))
    return transfer
  })
  await page.locator('.club-tv-upload').last().dispatchEvent('drop', { dataTransfer: sponsorDrop })
  await page.getByAltText('Sponsor 2 preview').waitFor()
  const firstPreview = await page.getByAltText('Sponsor 1 preview').getAttribute('src')
  const secondPreview = await page.getByAltText('Sponsor 2 preview').getAttribute('src')
  const [firstPath, secondPath] = [...artwork.keys()]
  const firstSponsor = signedArtworkUrl(firstPath), secondSponsor = signedArtworkUrl(secondPath)
  await page.getByRole('button', { name: 'Preview sponsor 1' }).click()
  assert.equal(await page.getByAltText('Full preview of sponsor 1').getAttribute('src'), firstPreview)
  await page.screenshot({ path: `${output}/sponsor-settings-preview.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: `${output}/sponsor-settings-preview-narrow.png` })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.getByRole('button', { name: 'Move sponsor 1 down' }).click()
  assert.equal(await page.getByAltText('Sponsor 1 preview').getAttribute('src'), secondPreview)
  await page.getByRole('button', { name: 'Move sponsor 1 down' }).click()
  await page.getByLabel('Time per advert').selectOption('10')
  await page.getByLabel('Sponsor 1 start date').fill('2026-10-21')
  await page.getByLabel('Sponsor 1 end date').fill('2026-10-20')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await page.getByRole('alert').getByText('Each advert end date must be on or after its start date.').waitFor()
  await page.getByLabel('Sponsor 1 end date').fill('2026-10-21')
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
  assert.equal(digest(artwork.get(firstPath).bytes), digest(originalAdvert), 'The exact 5 MB original reaches Storage')
  assert.ok((await page.getByAltText('Uploaded pitch map preview').getAttribute('src')).startsWith('data:image/webp;base64,'), 'Pitch maps are converted to WebP')
  await page.getByLabel('Show pitchside ordering').check()
  await saveAndPreview()
  assert.equal(await page.locator('.club-tv-match').count(), 8)
  await page.locator('.club-tv-pitch').waitFor()
  await page.getByAltText('Club sponsor advert').waitFor()
  assert.equal(await page.getByAltText('Club sponsor advert').getAttribute('src'), firstSponsor)
  const displayedHash = await page.getByAltText('Club sponsor advert').evaluate(async img => {
    const bytes = await (await fetch(img.src)).arrayBuffer()
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  })
  assert.equal(displayedHash, digest(originalAdvert), 'The TV downloads the exact uploaded original')
  await page.screenshot({ path: `${output}/sponsor-artwork.png` })
  await page.reload()
  await page.getByAltText('Club sponsor advert').waitFor()
  assert.equal(await page.getByAltText('Club sponsor advert').getAttribute('src'), firstSponsor)
  await page.locator('.club-tv-pitch').waitFor()
  await page.getByRole('button', { name: 'Pause carousel' }).click()
  await page.getByText('Coming soon').waitFor()
  await page.getByRole('button', { name: 'Resume carousel' }).click()
  await page.clock.runFor(11000)
  await page.locator(`img[alt="Club sponsor advert"][src="${secondSponsor}"]`).waitFor()
  await page.getByRole('button', { name: 'Pause carousel' }).click()
  await openSettings()
  assert.equal(await page.getByLabel('Time per advert').inputValue(), '10')
  assert.equal(await page.getByLabel('Sponsor 1 start date').inputValue(), '2026-10-21')
  await page.getByLabel('Show advert 1').uncheck()
  await page.getByLabel('Sponsor 2 start date').fill('2026-10-22')
  await saveAndPreview()
  await page.getByText('Your company could advertise here.').waitFor()
  await openSettings()
  await page.getByLabel('Show advert 1').check()
  await page.getByLabel('Sponsor 2 start date').fill('')
  await page.getByLabel('Show pitchside ordering').uncheck()
  await saveAndPreview()
  assert.equal(await page.locator('.club-tv-ordering').count(), 0)
  await page.setViewportSize({ width: 1366, height: 650 })
  const mapArea = await page.locator('.club-tv-pitch img').boundingBox()
  await page.screenshot({ path: `${output}/short-screen-map.png` })
  assert.ok(mapArea.height >= 150, `Pitch map remains legible on a short screen: ${JSON.stringify(mapArea)}`)
  for (let i = 0; i < 3 && !(await page.getByAltText('Free live goal alerts for grassroots football. Scan the QR code to get started.').count()); i++) await page.clock.runFor(11000)
  const goalAd = page.getByRole('region', { name: 'Matchday adverts' }).getByAltText('Free live goal alerts for grassroots football. Scan the QR code to get started.')
  await goalAd.waitFor()
  for (const [width, height, minimumArtworkWidth] of [[1366, 650, 290], [1632, 776, 340], [1920, 1080, 450], [800, 900, 450], [390, 844, 350]]) {
    await page.setViewportSize({ width, height })
    await goalAd.evaluate(img => img.decode())
    const size = await goalAd.evaluate(img => {
      const { width, height } = img.getBoundingClientRect()
      return Math.min(width, height * img.naturalWidth / img.naturalHeight)
    })
    assert.ok(size >= minimumArtworkWidth, `At ${width} by ${height}, the entire advert is at least ${minimumArtworkWidth}px wide. Actual: ${size}px.`)
    assert.ok(size <= 520, `At ${width} by ${height}, artwork is capped at 520px. Actual: ${size}px.`)
    assert.equal(await page.locator('.club-tv-sponsor img:visible').count(), 1, 'Only the current artwork occupies display space')
    await page.getByRole('heading', { name: 'Pitch map' }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.setViewportSize({ width: 1366, height: 650 })
  await page.screenshot({ path: `${output}/goal-alert-ad.png` })
  await page.getByRole('button', { name: 'Pause carousel' }).click()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openSettings()
  await page.getByLabel('Show pitchside ordering').check()
  await saveAndPreview()
  await page.getByText('Coming soon').waitFor()
  await page.getByText('13°C', { exact: false }).waitFor()
  await page.getByRole('img', { name: 'cloudy', exact: true }).waitFor()
  assert.equal(await page.locator('.club-tv-weather-source a').textContent(), 'MET Norway')
  assert.equal(await page.locator('.club-tv-split').count(), 1)
  await page.screenshot({ path: `${output}/tv-split.png` })
  const lastMatch = await page.locator('.club-tv-match').last().boundingBox(), footer = await page.locator('.club-tv-footer').boundingBox()
  assert.ok(lastMatch.y + lastMatch.height <= footer.y + 1, 'All score rows fit above the footer with the map visible')
  const mappedMatchday = matches
  matches = compactMatches; displayWindow = { kind: 'week', startDate: '2026-10-22', endDate: '2026-10-28' }
  await page.clock.runFor(11000)
  assert.equal(await page.locator('.club-tv-match').count(), 0)
  await page.screenshot({ path: `${output}/compact-map-light.png` })
  await openSettings()
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark')
  await saveAndPreview()
  assert.equal(await page.locator('.club-tv-dark').count(), 1)
  await page.screenshot({ path: `${output}/compact-map-dark.png` })
  await page.reload()
  await page.locator('.club-tv-dark').waitFor()
  await openSettings()
  assert.equal(await page.getByLabel('Appearance', { exact: true }).inputValue(), 'dark')
  await page.getByLabel('Appearance', { exact: true }).selectOption('light')
  await saveAndPreview()
  await page.locator('.club-tv-light').waitFor()
  matches = mappedMatchday; displayWindow = undefined
  await page.clock.runFor(11000)
  await openSettings()
  await page.getByLabel('Show map on half the display').uncheck()
  await saveAndPreview()
  const weatherFooter = await page.locator('.club-tv-footer').boundingBox()
  const weatherLastRow = await page.locator('.club-tv-match').last().boundingBox()
  assert.ok(weatherLastRow.y + weatherLastRow.height <= weatherFooter.y + 1, 'Weather and full-width matches fit above the footer')
  await page.screenshot({ path: `${output}/full-width-weather-light.png` })
  await openSettings()
  await page.getByLabel('Show map on half the display').check()
  await saveAndPreview()
  matches = matches.map((match, index) => index ? match : { ...match, homeScore: match.homeScore + 1, events: [...match.events, { id: 'small-goal', type: 'goal', side: 'club', shirt: '7', minute: 25 }] })
  await nextGoal('.club-tv-goal-small')
  assert.equal(await page.locator('.club-tv-goal-large').count(), 0)
  await page.clock.runFor(8000)
  await page.reload()
  await page.locator('.club-tv-pitch').waitFor()
  assert.equal(await page.locator('.club-tv-goal-small').count(), 0)
  await page.setViewportSize({ width: 1366, height: 600 })
  const shortHome = await page.locator('.club-tv-home-panel').boundingBox()
  const shortHomeLastRow = await page.locator('.club-tv-home-row').last().boundingBox()
  assert.ok(shortHomeLastRow.y + shortHomeLastRow.height <= shortHome.y + shortHome.height + 1, 'Shorter displays page home fixtures before clipping')
  assert.ok(await page.locator('.club-tv-home-row').count() < 6, 'Shorter displays reduce home fixtures per page')
  await page.setViewportSize({ width: 1366, height: 768 })
  const shorterFooter = await page.locator('.club-tv-footer').boundingBox()
  const shorterLastRow = await page.locator('.club-tv-match').last().boundingBox()
  assert.ok(shorterLastRow.y + shorterLastRow.height <= shorterFooter.y + 1, 'Shorter displays reduce rows per page without overlap')
  await page.screenshot({ path: `${output}/compact-shorter-display.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${output}/narrow-web.png`, fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await assertScoreFits()
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openSettings()
  await page.getByRole('button', { name: 'Copy viewing link' }).click()
  await page.getByText('Viewing link copied.', { exact: true }).waitFor()
  const copiedUrl = await page.evaluate(() => navigator.clipboard.readText())
  assert.equal(copiedUrl, `${origin}/club-matchday-tv/view/cedarfield-fc`)
  const previousViewRequests = requests.filter(request => request.action === 'view').length
  await page.goto(copiedUrl.replace('cedarfield-fc', 'Cedarfield-FC'))
  await page.waitForURL(copiedUrl)
  await page.getByText('Sign in with your Club Admin account to open this display.').waitFor()
  assert.ok(requests.filter(request => request.action === 'view').length > previousViewRequests)
  await page.getByLabel('Email', { exact: true }).fill(fixtureEmail)
  await page.getByLabel('Password', { exact: true }).fill('Fixture-Club-Password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('heading', { name: 'Test Club United' }).waitFor()
  await page.locator('.club-tv-pitch').waitFor()
  assert.equal(await page.getByText('Display settings', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Back to Club Admin' }).count(), 0)
  assert.equal(await page.getByAltText('Club sponsor advert').getAttribute('src'), firstSponsor)
  matches = matches.map((match, index) => index ? match : { ...match, homeScore: match.homeScore + 1, events: [...match.events, { id: 'copied-link-goal', type: 'goal', side: 'club', shirt: '10', minute: 28 }] })
  await nextGoal('.club-tv-goal-small')
  assert.match(await page.locator('.club-tv-goal-small').textContent(), /#10/)
  await openSettings()
  await page.getByLabel('Viewing access').selectOption('public')
  await saveAndPreview()
  assert.equal(settings.preferences.accessMode, 'public')
  await page.evaluate(() => localStorage.removeItem('fp-matchday-tv-auth'))
  await page.goto(copiedUrl)
  await page.getByRole('heading', { name: 'Test Club United' }).waitFor()
  await page.locator('.club-tv-pitch').waitFor()
  await page.locator(`img[alt="Club sponsor advert"][src="${firstSponsor}"]`).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 0)
  const requestsBeforeDateChange = requests.filter(request => request.action === 'view').length
  viewingDate = '2026-10-22'
  await page.clock.fastForward(16 * 60 * 60 * 1000)
  await page.waitForFunction(() => document.querySelector('.club-tv-clock')?.textContent.includes('22 Oct'))
  await page.locator(`img[alt="Club sponsor advert"][src="${secondSponsor}"]`).waitFor()
  assert.ok(requests.filter(request => request.action === 'view').length > requestsBeforeDateChange)
  viewingDate = date
  await page.clock.setSystemTime(new Date('2026-10-21T12:00:00Z'))
  settings = { ...settings, preferences: { ...settings.preferences, accessMode: 'admin' } }
  for (let i = 0; i < 15 && !(await page.getByRole('button', { name: 'Sign in', exact: true }).isVisible()); i++) {
    await page.clock.runFor(1000)
  }
  await page.getByText('Sign in with your Club Admin account to open this display.').waitFor()
  assert.equal(await page.locator('.club-tv-match').count(), 0)
  await page.goto(`${origin}/club-matchday-tv`)
  await page.getByRole('heading', { name: 'Test Club United' }).waitFor()
  await page.getByRole('button', { name: 'Full screen and lock' }).click()
  await page.getByRole('button', { name: 'Unlock Club Admin', exact: true }).waitFor()
  assert.equal(await page.locator('.club-tv-controls').count(), 0)
  await page.locator('.club-tv:fullscreen').waitFor()
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), true)
  await page.screenshot({ path: `${output}/full-screen-locked.png` })
  assert.equal(await page.locator('.club-tv-credit a, a.club-tv-credit').count(), 0)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('link', { name: 'Back to Club Admin' }).count(), 0)
  await page.goto(`${origin}/coach`)
  await page.waitForURL('**/club-matchday-tv')
  await page.getByRole('button', { name: 'Unlock Club Admin', exact: true }).click()
  const passwordInput = page.getByLabel('Club Admin password', { exact: true })
  assert.equal(await passwordInput.getAttribute('type'), 'password')
  assert.equal(await page.getByRole('dialog', { name: 'Unlock Club Admin' }).getByRole('button', { name: /show|reveal/i }).count(), 0)
  await passwordInput.fill('fixture-abandoned-secret')
  await page.clock.runFor(119000)
  assert.equal(await passwordInput.isVisible(), true)
  await page.clock.runFor(1000)
  assert.equal(await page.getByRole('dialog', { name: 'Unlock Club Admin' }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Back to Club Admin' }).count(), 0)
  assert.equal(requests.some((request) => request.action === 'unlock'), false)
  assert.equal(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) => String(value).includes('fixture-abandoned-secret'))), false)
  await page.getByRole('button', { name: 'Unlock Club Admin', exact: true }).click()
  assert.equal(await passwordInput.inputValue(), '')
  await passwordInput.fill('fixture-wrong-secret')
  await page.getByRole('button', { name: 'Unlock and return' }).click()
  await page.getByRole('alert').filter({ hasText: 'Password not accepted' }).waitFor()
  assert.equal(await passwordInput.inputValue(), '')
  assert.equal(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) => String(value).includes('fixture-wrong-secret'))), false)
  await page.getByRole('button', { name: 'Keep display locked' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Unlock Club Admin', exact: true }).waitFor()
  unlockAccepted = true
  await page.getByRole('button', { name: 'Unlock Club Admin', exact: true }).click()
  await passwordInput.fill('fixture-correct-secret')
  await page.getByRole('button', { name: 'Unlock and return' }).click()
  await page.waitForURL('**/coach')
  assert.equal(await page.evaluate(() => Object.values(sessionStorage).includes('locked')), false)
  await page.goto(`${origin}/club-matchday-tv`)
  await page.getByRole('heading', { name: 'Test Club United' }).waitFor()
  unavailable = true
  await page.clock.runFor(11000)
  await page.getByRole('status').filter({ hasText: 'Scores could not be refreshed' }).waitFor()
  assert.equal(await page.locator('.club-tv-match').count(), 8)
  unavailable = false
  denied = true
  await page.clock.runFor(11000)
  await page.getByRole('heading', { name: 'Club access required' }).waitFor()
  assert.equal(await page.locator('.club-tv-match').count(), 0)
  assert.equal(await page.locator('.club-tv-pitch').count(), 0)
  denied = false
  await page.evaluate(() => sessionStorage.setItem('auth-access-browser-fixture-email', 'coach.fixture@footballplayer.test'))
  await page.reload()
  await page.getByRole('heading', { name: 'This feature is not available' }).waitFor()
  assert.equal(await page.locator('.club-tv').count(), 0)
  await page.goto(`${origin}/coach`)
  await page.getByRole('heading', { name: 'Coach Home', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Matchday TV' }).count(), 0)
  await page.goto(`${origin}/club-matchday-tv/settings`)
  await page.getByRole('heading', { name: 'This feature is not available' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: club admin settings and copied viewer link, live scores, rotating sponsors, scrolling away fixtures, pitchside panel, map, narrow layout, reconnect, revocation and timed masked password lock.')
  await context.close()
} finally { await browser.close(); await server.close() }
