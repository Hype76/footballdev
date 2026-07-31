import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.MATCHDAY_PRACTICE_BROWSER_PORT || 5100 + Math.floor(Math.random() * 300))
const baseUrl = `http://127.0.0.1:${port}`

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const timeoutId = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 250)
      socket.once('connect', () => {
        clearTimeout(timeoutId)
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        clearTimeout(timeoutId)
        socket.destroy()
        resolve(false)
      })
    })

    if (connected) return
    await wait(200)
  }

  throw new Error(`Timed out waiting for 127.0.0.1:${port}`)
}

function startDevServer() {
  const env = {
    ...process.env,
    BROWSER: 'none',
    VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
    VITE_APP_URL: baseUrl,
    VITE_PARENT_APP_URL: baseUrl,
    VITE_SUPABASE_URL: 'http://fixture.supabase.test',
    VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
  }
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 0.0.0.0 --port ${port} --strictPort`], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, getOutput: () => output }
}

async function stopDevServer(server) {
  if (!server?.child || server.child.exitCode !== null) return

  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.child.kill()
  }

  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

async function preparePage(browser, viewport, { darkMode = false } = {}) {
  const context = await browser.newContext({ viewport })
  const productionMutationRequests = []
  const consoleErrors = []
  const pageErrors = []
  const resourceFailures = []
  let capturePracticeRequests = false

  await context.route('**/.netlify/functions/**', async (route) => {
    if (capturePracticeRequests && !['GET', 'HEAD'].includes(route.request().method())) {
      productionMutationRequests.push(`${route.request().method()} ${route.request().url()}`)
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })
  await context.route('**/api/parent-development/history**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reports: [] }) })
  })
  await context.route('**/auth/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await context.route('**/rest/v1/**', async (route) => {
    if (capturePracticeRequests && !['GET', 'HEAD'].includes(route.request().method())) {
      productionMutationRequests.push(`${route.request().method()} ${route.request().url()}`)
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await context.route('**/?match-timer-sync=*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', headers: { date: new Date().toUTCString() }, body: '' })
  })

  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    if (['document', 'script', 'stylesheet'].includes(request.resourceType()) && request.failure()?.errorText !== 'net::ERR_ABORTED') {
      resourceFailures.push(`${request.resourceType()}: ${request.url()} ${request.failure()?.errorText || 'failed'}`)
    }
  })

  await page.goto(`${baseUrl}/sign-in?tab=parent`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: 'Parent' }).click()
  await page.getByPlaceholder('you@club.com').fill('parent.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/parent-portal', { timeout: 30000 })
  await page.getByTestId('practice-match-entry').waitFor({ state: 'visible', timeout: 30000 })

  if (darkMode) {
    await page.evaluate(() => window.localStorage.setItem('app-theme-mode', 'dark'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('practice-match-entry').waitFor({ state: 'visible', timeout: 30000 })
  }

  await wait(500)
  capturePracticeRequests = true
  return { consoleErrors, context, page, pageErrors, productionMutationRequests, resourceFailures }
}

async function runDesktopJourney(browser) {
  const setup = await preparePage(browser, { width: 1440, height: 1000 })
  const { page } = setup

  try {
    await page.evaluate(() => window.localStorage.setItem('football-player:practice-match-scoring:v1:other-parent', 'untouched-parent-session'))
    await page.getByTestId('practice-match-entry').getByRole('button', { name: 'Start practice match' }).click()
    await page.getByTestId('practice-pre-match').waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('button', { name: 'Record team goal' }).count(), 0)

    await page.goto(`${baseUrl}/parent-portal?practice=match-scoring&matchDayId=real-fixture-attempt`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Practice Rovers v Training United' }).waitFor({ state: 'visible' })
    assert.equal(await page.getByText('real-fixture-attempt').count(), 0)

    await page.getByTestId('practice-pre-match').getByRole('button', { name: 'Start practice match' }).click()
    const startDialog = page.getByRole('dialog', { name: 'Start this match?' })
    await startDialog.waitFor({ state: 'visible' })
    assert.match(await page.evaluate(() => document.activeElement?.textContent || ''), /Cancel/i)
    await page.keyboard.press('Escape')
    await startDialog.waitFor({ state: 'hidden' })
    await page.getByTestId('practice-pre-match').waitFor({ state: 'visible' })

    await page.getByTestId('practice-pre-match').getByRole('button', { name: 'Start practice match' }).click()
    await startDialog.getByRole('button', { name: 'Start match' }).dblclick()
    await page.getByTestId('practice-live-controls').waitFor({ state: 'visible' })
    assert.equal(await page.getByText('Practice match started', { exact: true }).count(), 1)

    await page.getByLabel('Synthetic goalscorer').selectOption('practice-player-alex')
    await page.getByRole('button', { name: 'Record team goal' }).click()
    await page.getByRole('button', { name: 'Record opposition goal' }).click()
    await page.getByRole('button', { name: 'Pause timer' }).click()
    await page.getByRole('button', { name: 'Resume timer' }).click()
    await page.getByRole('button', { name: 'Go to half-time' }).click()
    await page.getByTestId('practice-half-time').getByRole('button', { name: 'Start second half' }).click()
    await page.getByRole('button', { name: 'Go to full-time' }).click()
    await page.getByTestId('practice-full-time').getByRole('button', { name: 'Conclude practice' }).click()

    await page.getByTestId('practice-complete').waitFor({ state: 'visible' })
    await page.getByText('Nothing from this match was shared or added to your team\'s records.').waitFor({ state: 'visible' })
    assert.match(await page.getByTestId('practice-game-mode').innerText(), /1\s*-\s*1/)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByTestId('practice-complete').waitFor({ state: 'visible', timeout: 30000 })
    assert.match(await page.getByTestId('practice-game-mode').innerText(), /1\s*-\s*1/)
    assert.equal(await page.evaluate(() => window.localStorage.getItem('football-player:practice-match-scoring:v1:other-parent')), 'untouched-parent-session')

    await page.getByRole('button', { name: 'Practise again' }).click()
    await page.getByTestId('practice-pre-match').waitFor({ state: 'visible' })
    assert.match(await page.getByTestId('practice-game-mode').innerText(), /0\s*-\s*0/)
    assert.deepEqual(setup.productionMutationRequests, [])
    assert.deepEqual(setup.pageErrors, [])
    assert.deepEqual(setup.resourceFailures, [])
    assert.deepEqual(setup.consoleErrors, [])
  } finally {
    await setup.context.close()
  }
}

async function runMobileDarkJourney(browser) {
  const setup = await preparePage(browser, { width: 390, height: 844 }, { darkMode: true })
  const { page } = setup

  try {
    await page.getByTestId('practice-match-entry').getByRole('button', { name: 'Start practice match' }).click()
    await page.getByTestId('practice-match-scoring').waitFor({ state: 'visible' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true)
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-dark') || document.body.classList.contains('theme-dark')), true)
    await page.getByTestId('practice-pre-match').getByRole('button', { name: 'Start practice match' }).click()
    await page.getByRole('dialog', { name: 'Start this match?' }).getByRole('button', { name: 'Cancel' }).click()
    await page.getByTestId('practice-pre-match').waitFor({ state: 'visible' })
    assert.deepEqual(setup.productionMutationRequests, [])
    assert.deepEqual(setup.pageErrors, [])
    assert.deepEqual(setup.resourceFailures, [])
    assert.deepEqual(setup.consoleErrors, [])
  } finally {
    await setup.context.close()
  }
}

const server = startDevServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ headless: true })
  await runDesktopJourney(browser)
  await runMobileDarkJourney(browser)
  console.log('PASS practice match scoring browser: desktop completion, refresh, reset, mobile dark mode, accessibility, and zero production mutations')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) await browser.close()
  await stopDevServer(server)
}
