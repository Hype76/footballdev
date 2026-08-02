import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium, devices } from 'playwright'

const port = Number(process.env.TEAM_REMOVAL_BROWSER_PORT || 5400 + Math.floor(Math.random() * 300))
const baseUrl = `http://127.0.0.1:${port}`
const fixturePassword = 'FixturePass123!'

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const timeoutId = setTimeout(() => { socket.destroy(); resolve(false) }, 250)
      socket.once('connect', () => { clearTimeout(timeoutId); socket.destroy(); resolve(true) })
      socket.once('error', () => { clearTimeout(timeoutId); socket.destroy(); resolve(false) })
    })
    if (connected) return
    await wait(200)
  }
  throw new Error(`Timed out waiting for local Vite port ${port}`)
}

function startDevServer() {
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BROWSER: 'none',
      VITE_APP_URL: baseUrl,
      VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
      VITE_PARENT_APP_URL: baseUrl,
      VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
      VITE_SUPABASE_URL: 'http://fixture.supabase.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, getOutput: () => output }
}

async function stopDevServer(server) {
  if (server.child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.child.kill()
  }
  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

function playerRow() {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    club_id: 'club-fixture',
    player_name: 'FP TEST Team Removal',
    section: 'Squad',
    team: 'U12 Fixture Team',
    team_id: 'team-u12',
    positions: ['Midfielder'],
    parent_contacts: [],
    status: 'active',
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
  }
}

async function installApiRoutes(context) {
  let removed = false
  let previewScopes = []
  let mutationCount = 0
  const requestPaths = []

  await context.route('http://fixture.supabase.test/rest/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    requestPaths.push(path)
    const body = route.request().postDataJSON?.() || {}
    const reply = (value, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(value),
    })

    if (path.endsWith('/rest/v1/rpc/get_team_players')) return reply(removed ? [] : [playerRow()])
    if (path.endsWith('/rest/v1/rpc/preview_player_team_removal')) {
      previewScopes.push(body.scope_value)
      return reply({
        teamMembershipAffected: 1,
        upcomingStandaloneEventsAffected: body.scope_value === 'team_and_future_events' ? 2 : 0,
        recurringOccurrencesAffected: body.scope_value === 'team_and_future_events' ? 3 : 0,
        unsentInvitationsSuppressed: body.scope_value === 'team_and_future_events' ? 2 : 0,
        historicalRecordsPreserved: true,
      })
    }
    if (path.endsWith('/rest/v1/rpc/remove_player_from_team')) {
      mutationCount += 1
      removed = true
      return reply({ affectedOccurrenceCount: body.scope_value === 'team_and_future_events' ? 5 : 0, communicationSent: false, status: 'completed' })
    }
    if (path.endsWith('/rest/v1/evaluations')) return reply([])
    return reply([])
  })

  return {
    getMutationCount: () => mutationCount,
    getPreviewScopes: () => previewScopes,
    getRequestPaths: () => requestPaths,
  }
}

async function signIn(page, email) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill(email)
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'))
}

async function validateManager(browser, contextOptions, label) {
  const context = await browser.newContext(contextOptions)
  const api = await installApiRoutes(context)
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })

  await signIn(page, 'manager.fixture@footballplayer.test')
  await page.goto(`${baseUrl}/players/current`, { waitUntil: 'networkidle' })
  try {
    await page.getByText('FP TEST Team Removal', { exact: true }).waitFor()
  } catch {
    throw new Error(`${label} Player row missing. URL: ${page.url()}. Requests: ${api.getRequestPaths().join(', ')}. Body: ${(await page.locator('body').innerText()).slice(0, 2000)}. Console: ${consoleErrors.join(' | ')}`)
  }
  await page.getByRole('button', { name: 'Remove from Team' }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('heading', { name: /Remove FP TEST Team Removal from Team/ }).waitFor()
  await dialog.getByLabel('Remove from Team only').waitFor()
  assert.equal(await dialog.getByLabel('Remove from Team only').isChecked(), true)
  assert.equal(await dialog.getByLabel('Remove from Team and future events').isChecked(), false)
  await dialog.getByText('The Player may still appear in already configured future events for this Team.').waitFor()
  await dialog.getByText('Historical records preserved').waitFor()

  await dialog.getByLabel('Remove from Team and future events').check()
  await dialog.getByText('Upcoming standalone events affected').waitFor()
  await dialog.getByText('3', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Remove from Team and future events' }).click()
  await page.getByText(/was removed from this Team\. 5 upcoming event occurrences removed\./).waitFor()

  assert.equal(api.getMutationCount(), 1)
  assert.deepEqual(api.getPreviewScopes(), ['team_only', 'team_and_future_events'])
  assert.deepEqual(consoleErrors, [], `${label} console errors: ${consoleErrors.join(' | ')}`)
  await context.close()
}

const server = startDevServer()
try {
  await waitForPort()
  const browser = await chromium.launch({ headless: true })
  try {
    await validateManager(browser, { viewport: { width: 1440, height: 1000 } }, 'desktop')
    await validateManager(browser, devices['iPhone 13'], 'mobile')

    const coachContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await installApiRoutes(coachContext)
    const coachPage = await coachContext.newPage()
    await signIn(coachPage, 'coach.fixture@footballplayer.test')
    await coachPage.goto(`${baseUrl}/players/current`, { waitUntil: 'networkidle' })
    await coachPage.getByText('FP TEST Team Removal', { exact: true }).waitFor()
    assert.equal(await coachPage.getByRole('button', { name: 'Remove from Team' }).count(), 0)
    await coachContext.close()
  } finally {
    await browser.close()
  }
  console.log(JSON.stringify({ desktop: 'passed', mobile: 'passed', coachControlHidden: true, inAppBrowserUsed: false }))
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  await stopDevServer(server)
}
