import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.SCORE_HINT_BROWSER_PORT || 4800 + Math.floor(Math.random() * 500))
const baseUrl = `http://127.0.0.1:${port}`

const formFields = [
  { id: 'field-distribution', label: 'Distribution', type: 'score_1_10', order_index: 1 },
  { id: 'field-low-balls', label: 'Low Balls', type: 'score_1_10', order_index: 2 },
  { id: 'field-high-balls', label: 'High Balls', type: 'score_1_10', order_index: 3 },
  { id: 'field-penalties', label: 'Penalties', type: 'score_1_10', order_index: 4 },
  { id: 'field-confidence', label: 'Confidence', type: 'traffic_light', order_index: 5 },
].map((field) => ({
  ...field,
  club_id: 'club-fixture',
  team_id: 'team-u12',
  options: [],
  required: false,
  is_enabled: true,
  include_in_progress_chart: field.type === 'score_1_10',
  is_default: false,
}))

const teams = [
  {
    id: 'team-u12',
    club_id: 'club-fixture',
    name: 'U12 Fixture Team',
    is_active: true,
  },
]

const players = [
  {
    id: 'player-fixture',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    player_name: 'Fixture Player',
    section: 'Squad',
    team: 'U12 Fixture Team',
    status: 'active',
    parent_contacts: [],
  },
]

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForPort(host, nextPort, timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const isReady = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port: nextPort })
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

    if (isReady) {
      return
    }

    await wait(100)
  }

  throw new Error(`Timed out waiting for ${host}:${nextPort}`)
}

function startDevServer() {
  const env = {
    ...process.env,
    BROWSER: 'none',
    VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
    VITE_SUPABASE_URL: 'http://fixture.supabase.test',
    VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
  }
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  return {
    child,
    getOutput: () => output,
  }
}

async function stopDevServer(server) {
  if (!server?.child || server.child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], {
      stdio: 'ignore',
    })
  } else {
    server.child.kill()
  }

  await Promise.race([
    once(server.child, 'exit'),
    wait(3000),
  ])

  if (server.child.exitCode === null) {
    server.child.kill('SIGKILL')
  }
}

function getTableName(url) {
  const pathname = new URL(url).pathname
  const marker = '/rest/v1/'
  const markerIndex = pathname.indexOf(marker)

  return markerIndex === -1 ? '' : pathname.slice(markerIndex + marker.length).split('/')[0]
}

async function fulfillJson(route, status, payload) {
  await route.fulfill({
    status,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, prefer',
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      },
    contentType: 'application/json',
    body: status === 204 ? '' : JSON.stringify(payload),
  })
}

async function preparePage(context) {
  await context.route('**/.netlify/functions/**', async (route) => {
    await fulfillJson(route, 404, { success: false, message: 'Fixture function stub.' })
  })
  await context.route('**/auth/v1/**', async (route) => {
    await fulfillJson(route, 200, {})
  })
  await context.route('**/rest/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, 204, {})
      return
    }

    const tableName = getTableName(route.request().url())
    const payloadByTable = {
      email_templates: [],
      evaluations: [],
      feedback_forms: [],
      form_fields: formFields,
      parent_player_links: [],
      players,
      scheduled_emails: [],
      teams,
    }

    await fulfillJson(route, 200, payloadByTable[tableName] || [])
  })

  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message)
  })

  return { page, consoleErrors }
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('you@club.com').fill('coach.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/coach', { timeout: 15000 })
}

async function openDevelopmentForm(page) {
  await page.goto(`${baseUrl}/assess-player/new`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Development fields' }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByLabel('Form').selectOption('__default_development_form__')
  await page.getByRole('button', { name: 'Show scoring guide for Distribution' }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByRole('button', { name: 'Show scoring guide for Low Balls' }).waitFor({ state: 'visible', timeout: 15000 })
}

async function getPopover(page) {
  const popover = page.locator('[data-score-hint-popover="true"]')
  await popover.waitFor({ state: 'visible', timeout: 15000 })
  return popover
}

async function setThemeMode(page, mode) {
  await page.evaluate((nextMode) => {
    const root = document.documentElement
    const body = document.body

    window.localStorage.setItem('app-theme-mode', nextMode)
    window.localStorage.setItem('app-theme-accent', 'green')
    window.localStorage.setItem('app-theme-button-style', 'solid')
    root.classList.remove('theme-light', 'theme-dark')
    body.classList.remove('theme-light', 'theme-dark')
    root.classList.add(nextMode === 'dark' ? 'theme-dark' : 'theme-light')
    body.classList.add(nextMode === 'dark' ? 'theme-dark' : 'theme-light')
  }, mode)
  await page.locator(`body.theme-${mode}`).waitFor({ state: 'attached', timeout: 15000 })
}

async function assertReadablePopover(page, fieldLabel) {
  const popover = await getPopover(page)
  await popover.getByText(`Use this guide when scoring ${fieldLabel}.`).waitFor({ state: 'visible', timeout: 15000 })
  await popover.getByText('1. Well Below Standard').waitFor({ state: 'visible', timeout: 15000 })
  await popover.getByText('10. Exceptional').waitFor({ state: 'visible', timeout: 15000 })

  const metrics = await popover.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const styles = window.getComputedStyle(element)
    return {
      parentTag: element.parentElement?.tagName,
      position: styles.position,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }
  })

  assert.equal(metrics.parentTag, 'BODY')
  assert.equal(metrics.position, 'fixed')
  assert.ok(metrics.width >= 280, `Expected readable width, got ${metrics.width}`)
  assert.ok(metrics.height >= 240, `Expected readable height, got ${metrics.height}`)
  assert.ok(metrics.left >= 0)
  assert.ok(metrics.right <= metrics.viewportWidth)
  assert.ok(metrics.top >= 0)
  assert.ok(metrics.bottom <= metrics.viewportHeight)
}

async function assertPopoverTheme(page, expectedTheme) {
  const popover = await getPopover(page)
  const theme = await popover.evaluate((element) => {
    const styles = window.getComputedStyle(element)
    return {
      backgroundColor: styles.backgroundColor,
      borderColor: styles.borderColor,
      color: styles.color,
    }
  })

  if (expectedTheme === 'light') {
    assert.equal(theme.backgroundColor, 'rgb(255, 255, 255)')
    assert.equal(theme.borderColor, 'rgb(215, 229, 220)')
    assert.equal(theme.color, 'rgb(75, 95, 85)')
    return
  }

  assert.equal(theme.backgroundColor, 'rgb(20, 32, 28)')
  assert.equal(theme.borderColor, 'rgb(70, 96, 82)')
  assert.equal(theme.color, 'rgb(215, 227, 220)')
}

const server = startDevServer()
let browser

try {
  await waitForPort('127.0.0.1', port)

  browser = await chromium.launch()
  const context = await browser.newContext()
  const { page, consoleErrors } = await preparePage(context)

  await signIn(page)
  await setThemeMode(page, 'light')
  await openDevelopmentForm(page)
  await setThemeMode(page, 'light')

  await page.getByRole('button', { name: 'Show scoring guide for Distribution' }).click()
  await assertReadablePopover(page, 'Distribution')
  await assertPopoverTheme(page, 'light')

  await page.getByRole('button', { name: 'Show scoring guide for Low Balls' }).click()
  await assertReadablePopover(page, 'Low Balls')
  assert.equal(await page.locator('[data-score-hint-popover="true"]').count(), 1)
  assert.equal(await page.getByText('Use this guide when scoring Distribution.').count(), 0)

  await page.keyboard.press('Escape')
  await page.locator('[data-score-hint-popover="true"]').waitFor({ state: 'detached', timeout: 15000 })

  await page.getByRole('button', { name: 'Show scoring guide for Low Balls' }).click()
  await getPopover(page)
  await page.mouse.click(6, 6)
  await page.locator('[data-score-hint-popover="true"]').waitFor({ state: 'detached', timeout: 15000 })

  await setThemeMode(page, 'dark')
  await page.getByRole('button', { name: 'Show scoring guide for Distribution' }).click()
  await assertReadablePopover(page, 'Distribution')
  await assertPopoverTheme(page, 'dark')
  await page.keyboard.press('Escape')
  await page.locator('[data-score-hint-popover="true"]').waitFor({ state: 'detached', timeout: 15000 })

  await setThemeMode(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Show scoring guide for Distribution' }).click()
  await assertReadablePopover(page, 'Distribution')
  await assertPopoverTheme(page, 'light')

  await page.getByLabel('Confidence').selectOption('Amber')
  await page.getByText('Submit and export', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByRole('button', { name: 'Save development record' }).waitFor({ state: 'visible', timeout: 15000 })

  const seriousConsoleErrors = consoleErrors.filter((message) => !/favicon|404/.test(message))
  assert.deepEqual(seriousConsoleErrors, [])
  await context.close()

  console.log('ok score hint popover opens, dismisses, stays readable, and preserves form controls')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
