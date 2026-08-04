import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'

const port = Number(process.env.GAMEDAY_DEMO_PARITY_BROWSER_PORT || 5900 + Math.floor(Math.random() * 200))
const baseUrl = `http://127.0.0.1:${port}`
const artifactDir = 'docs/audits/FP-V1-GAMEDAY-DEMO-LIVE-PARITY-31C-screenshots'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 250)
      socket.once('connect', () => {
        clearTimeout(timeout)
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
    if (connected) return
    await wait(150)
  }
  throw new Error(`Timed out waiting for ${baseUrl}`)
}

function startServer() {
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
        VITE_APP_URL: baseUrl,
        VITE_PARENT_APP_URL: baseUrl,
        VITE_SUPABASE_URL: 'http://fixture.supabase.test',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, getOutput: () => output }
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.child.kill()
  }
  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

async function openDemo(context) {
  await context.route('http://fixture.supabase.test/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await context.route('**/api/parent-development/history', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"reports":[]}' })
  })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const dataMutations = []
  const communicationRequests = []
  const navigations = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  })
  page.on('request', (request) => {
    const url = request.url()
    const isReadOnlyRpc = /\/rpc\/get_/i.test(url)
    const isWriteMethod = !['GET', 'HEAD'].includes(request.method())
    if (isWriteMethod && !isReadOnlyRpc && /supabase|\.netlify\/functions/i.test(url)) {
      dataMutations.push(`${request.method()} ${url}`)
    }
    if (isWriteMethod && !isReadOnlyRpc && /email|push|sms|chat|invite/i.test(url) && /supabase|\.netlify\/functions/i.test(url)) {
      communicationRequests.push(`${request.method()} ${url}`)
    }
  })

  await page.goto(`${baseUrl}/sign-in?tab=parent`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: 'Parent' }).click()
  await page.getByPlaceholder('you@club.com').fill('parent.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill('FixturePass123!')
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/parent-portal', { timeout: 30000 })
  const entry = page.getByTestId('demo-game-day-entry').getByRole('button', { name: 'Open Demo Game Day' })
  await entry.waitFor({ state: 'visible', timeout: 30000 })
  await entry.click()
  try {
    await page.getByTestId('demo-game-day-context').waitFor({ state: 'visible', timeout: 10000 })
  } catch (error) {
    throw new Error(`Demo Game Day did not open at ${page.url()}. Navigations: ${navigations.slice(-10).join(' -> ')}. Session flag: ${await page.evaluate(() => window.sessionStorage.getItem('footballplayer.online:parent-demo-game-day:open:v1'))}. Page errors: ${pageErrors.join(' | ')}. Console: ${consoleErrors.slice(-10).join(' | ')}. Body: ${(await page.locator('body').innerText()).slice(0, 1200)}`, { cause: error })
  }
  communicationRequests.length = 0
  consoleErrors.length = 0
  dataMutations.length = 0
  pageErrors.length = 0
  return { communicationRequests, consoleErrors, dataMutations, page, pageErrors }
}

async function startDemoMatch(page) {
  await page.getByTestId('demo-game-day-practise').click()
  const cockpit = page.getByRole('region', { name: 'Game Mode cockpit' })
  await cockpit.waitFor({ state: 'visible' })
  await cockpit.getByRole('button', { name: 'Start match' }).click()
  const startDialog = page.getByRole('dialog', { name: 'Start this match?' })
  await startDialog.waitFor({ state: 'visible' })
  await startDialog.getByRole('button', { name: 'Start match' }).click()
  await page.getByTestId('game-day-live-actions').waitFor({ state: 'visible' })
}

async function reopenDemoMatch(page) {
  await page.getByRole('region', { name: 'Game Mode cockpit' }).waitFor({ state: 'visible' })
}

async function saveEvent(page, actionKey) {
  await page.locator(`[data-match-day-action="${actionKey}"]`).click()
  const dialog = page.getByRole('dialog', { name: 'Add match event' })
  await dialog.waitFor({ state: 'visible' })

  if (actionKey === 'yellow_card' || actionKey === 'red_card') {
    await dialog.getByRole('combobox', { name: 'Player' }).selectOption({ index: 1 })
  }
  if (actionKey === 'substitution') {
    await dialog.getByRole('combobox', { name: 'Player Off' }).selectOption({ index: 1 })
    await dialog.getByRole('combobox', { name: 'Player On' }).selectOption({ index: 2 })
  }

  await dialog.getByRole('button', { name: 'Save event' }).click()
  await dialog.waitFor({ state: 'hidden' })
}

async function saveGoal(page) {
  await page.locator('[data-match-day-action="goal"]').click()
  const dialog = page.getByRole('dialog', { name: 'Add goal' })
  await dialog.waitFor({ state: 'visible' })
  const scorer = dialog.getByRole('combobox', { name: /Scorer/ })
  if (await scorer.count()) await scorer.selectOption({ index: 1 })
  await dialog.getByRole('button', { name: 'Save goal' }).click()
  await dialog.waitFor({ state: 'hidden' })
}

async function verifyCanonicalTimeline(page) {
  const timeline = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Match Timeline' }) })
  const showAll = timeline.getByRole('button', { name: /Show all/ })
  if (await showAll.count()) await showAll.click()
  await timeline.getByText('Yellow card', { exact: true }).first().waitFor({ state: 'visible' })
  await timeline.getByText('Red card', { exact: true }).first().waitFor({ state: 'visible' })
  await timeline.getByText('Substitution', { exact: true }).first().waitFor({ state: 'visible' })
  await timeline.getByText('Hydration break', { exact: true }).first().waitFor({ state: 'visible' })
}

async function runJourney(browser, name, options) {
  const context = await browser.newContext(options)
  const run = await openDemo(context)
  const { page } = run
  try {
    assert.equal(await page.locator('[data-match-day-experience="demo"]').count(), 1)
    assert.equal(await page.getByText('Communication and customer mutations are blocked.', { exact: false }).count(), 1)
    assert.equal(await page.getByRole('button', { name: /Create fixture/i }).count(), 0)
    assert.equal(await page.getByText(/Request scorer/i).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await startDemoMatch(page)
    assert.equal(await page.getByRole('button', { name: 'Manage fixture' }).count(), 0)

    const actionKeys = await page.getByTestId('game-day-live-actions').locator('[data-match-day-action]').evaluateAll(
      (actions) => actions.map((action) => action.getAttribute('data-match-day-action')),
    )
    assert.deepEqual(actionKeys, ['goal', 'yellow_card', 'red_card', 'substitution'])

    await saveGoal(page)
    await saveEvent(page, 'yellow_card')
    await saveEvent(page, 'red_card')
    await saveEvent(page, 'substitution')
    await page.locator('[data-match-day-timer-action="hydration"]').click()

    await verifyCanonicalTimeline(page)
    await page.screenshot({ path: `${artifactDir}/${name}-canonical-actions.png`, fullPage: true })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await reopenDemoMatch(page)
    await verifyCanonicalTimeline(page)

    await page.getByRole('button', { name: 'Reset Demo Game Day' }).click()
    const resetDialog = page.getByRole('dialog', { name: 'Reset Demo Game Day?' })
    await resetDialog.getByRole('button', { name: 'Reset Demo Game Day' }).click()
    await page.getByTestId('demo-game-day-prepared-fixture').waitFor({ state: 'visible' })
    assert.match(await page.getByTestId('demo-game-day-prepared-fixture').innerText(), /Score\s+0\s*-\s*0/)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.screenshot({ path: `${artifactDir}/${name}-reset.png`, fullPage: true })

    await page.getByRole('button', { name: 'Exit Demo' }).click()
    await page.getByTestId('demo-game-day-entry').waitFor({ state: 'visible' })
    assert.equal(await page.evaluate(() => window.sessionStorage.getItem('footballplayer.online:parent-demo-game-day:open:v1')), null)
    await page.getByTestId('demo-game-day-entry').getByRole('button', { name: 'Open Demo Game Day' }).click()
    await page.getByTestId('demo-game-day-context').waitFor({ state: 'visible' })
    await page.goBack()
    await page.getByTestId('demo-game-day-entry').waitFor({ state: 'visible' })
    assert.equal(await page.evaluate(() => window.sessionStorage.getItem('footballplayer.online:parent-demo-game-day:open:v1')), null)

    assert.deepEqual(run.dataMutations, [])
    assert.deepEqual(run.communicationRequests, [])
    assert.deepEqual(run.pageErrors, [])
    assert.deepEqual(run.consoleErrors, [])
  } finally {
    await context.close()
  }
}

await mkdir(artifactDir, { recursive: true })
const server = startServer()
try {
  await waitForPort()
  const browser = await chromium.launch({ headless: true })
  try {
    await runJourney(browser, 'desktop-1440', { viewport: { width: 1440, height: 1000 } })
    await runJourney(browser, 'tablet-768', { viewport: { width: 768, height: 1024 } })
    await runJourney(browser, 'android-390', { isMobile: true, viewport: { width: 390, height: 844 } })
  } finally {
    await browser.close()
  }
  console.log('Demo and live Game Day parity browser checks passed.')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  await stopServer(server)
}
