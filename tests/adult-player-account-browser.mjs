import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium, devices } from 'playwright'

const port = Number(process.env.ADULT_PLAYER_BROWSER_PORT || 4700 + Math.floor(Math.random() * 300))
const baseUrl = `http://127.0.0.1:${port}`
const outputDirectory = 'outputs/fp-v1-adult-player-account-foundation-08a'
const fixtureEmail = 'adult-player.fixture@footballplayer.test'
const fixturePassword = 'FixturePass123!'

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
    if (connected) {
      return
    }
    await wait(200)
  }
  throw new Error(`Timed out waiting for 127.0.0.1:${port}`)
}

function startServer() {
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run dev -- --mode production --host 0.0.0.0 --port ${port} --strictPort`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
        VITE_APP_URL: baseUrl,
        VITE_PARENT_APP_URL: baseUrl,
        VITE_SUPABASE_URL: 'http://fixture.supabase.test',
        VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  return { child, getOutput: () => output }
}

async function stopServer(server) {
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

  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

async function preparePage(page) {
  let matchResponse = 'awaiting_response'
  let trainingResponse = 'awaiting_response'
  let responseCalls = 0

  await page.route('**/rest/v1/rpc/get_own_adult_player_invitation_state', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          invitation_id: 'match:match-request-fixture',
          invitation_type: 'match_attendance',
          source_record_id: 'match-request-fixture',
          event_id: 'match-fixture',
          event_type: 'match_day',
          event_title: 'Match Day vs Browser United',
          event_start: '2026-08-08T14:00:00.000Z',
          event_end: '2026-08-08T16:00:00.000Z',
          event_location: 'Fixture Stadium',
          team_name: 'U12 Fixture Team',
          response_state: matchResponse,
          selection_state: matchResponse === 'available' ? 'selected' : 'undecided',
          can_respond: true,
          lock_reason: '',
          response_deadline: '2026-08-07T18:00:00.000Z',
          last_responded_at: matchResponse === 'awaiting_response' ? null : '2026-07-30T08:00:00.000Z',
        },
        {
          invitation_id: 'training:training-request-fixture',
          invitation_type: 'training_attendance',
          source_record_id: 'training-request-fixture',
          event_id: 'training-fixture',
          event_type: 'training',
          event_title: 'First Team Training',
          event_start: '2026-08-05T17:30:00.000Z',
          event_end: '2026-08-05T19:00:00.000Z',
          event_location: 'Fixture Training Ground',
          team_name: 'U12 Fixture Team',
          response_state: trainingResponse,
          selection_state: 'not_applicable',
          can_respond: true,
          lock_reason: '',
          response_deadline: '2026-08-05T17:30:00.000Z',
          last_responded_at: trainingResponse === 'awaiting_response' ? null : '2026-07-30T08:00:00.000Z',
        },
      ]),
    })
  })

  await page.route('**/rest/v1/rpc/respond_own_adult_player_match_invitation', async (route) => {
    const request = route.request().postDataJSON()
    assert.equal(request.request_id_value, 'match-request-fixture')
    assert.equal('player_id_value' in request, false)
    assert.equal('parent_link_id_value' in request, false)
    matchResponse = request.response_value
    responseCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        requestId: 'match-request-fixture',
        responseState: matchResponse,
        responseSource: 'adult_player',
      }),
    })
  })

  await page.route('**/rest/v1/rpc/respond_own_adult_player_training_invitation', async (route) => {
    const request = route.request().postDataJSON()
    assert.equal(request.request_player_id_value, 'training-request-fixture')
    assert.equal('player_id_value' in request, false)
    assert.equal('parent_link_id_value' in request, false)
    trainingResponse = request.response_value
    responseCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        requestPlayerId: 'training-request-fixture',
        responseState: trainingResponse,
        responseSource: 'adult_player',
      }),
    })
  })

  return {
    getResponseCalls: () => responseCalls,
  }
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByRole('button', { name: 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill(fixtureEmail)
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/player', { timeout: 30000 })
  await page.getByRole('heading', { name: 'Adult Player Fixture' }).waitFor({ state: 'visible' })
}

async function runJourney(browser, name, contextOptions) {
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()
  const prepared = await preparePage(page)

  await signIn(page)
  await page.getByRole('heading', { name: 'Your invitations' }).waitFor({ state: 'visible' })
  await page.getByText('Match Day vs Browser United', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('First Team Training', { exact: true }).waitFor({ state: 'visible' })

  assert.equal(await page.getByText('Family portal', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Team management', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Platform Admin', { exact: true }).count(), 0)

  await page.getByLabel('Respond to Match Day vs Browser United').getByRole('button', { name: 'Available', exact: true }).click()
  await page.getByText('Your response has been saved.', { exact: true }).waitFor({ state: 'visible' })
  await page.getByText('You are selected for this fixture.', { exact: true }).waitFor({ state: 'visible' })

  await page.getByLabel('Respond to First Team Training').getByRole('button', { name: 'Not attending', exact: true }).click()
  await page.getByText('Not attending', { exact: true }).first().waitFor({ state: 'visible' })
  assert.equal(prepared.getResponseCalls(), 2)

  await page.goto(`${baseUrl}/parent-portal`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL('**/player', { timeout: 15000 })
  await page.goto(`${baseUrl}/coach`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL('**/player', { timeout: 15000 })
  await page.getByRole('heading', { name: 'Adult Player Fixture' }).waitFor({ state: 'visible' })
  await page.getByRole('heading', { name: 'Your invitations' }).waitFor({ state: 'visible' })

  await page.screenshot({
    path: `${outputDirectory}/${name}.png`,
    fullPage: true,
  })

  await context.close()
}

await mkdir(outputDirectory, { recursive: true })
const server = startServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  await runJourney(browser, 'desktop-1440x1000', {
    viewport: { width: 1440, height: 1000 },
  })
  await runJourney(browser, 'iphone-13', {
    ...devices['iPhone 13'],
  })
  await runJourney(browser, 'pixel-7', {
    ...devices['Pixel 7'],
  })

  const pwaContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const pwaPage = await pwaContext.newPage()
  await preparePage(pwaPage)
  await signIn(pwaPage)
  await pwaPage.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await pwaPage.reload({ waitUntil: 'domcontentloaded' })
  await pwaPage.getByRole('heading', { name: 'Your invitations' }).waitFor({ state: 'visible' })
  const isControlled = await pwaPage.evaluate(() => Boolean(navigator.serviceWorker.controller))
  assert.equal(isControlled, true)
  await pwaContext.close()

  console.log('Adult-player desktop, iPhone, Android, route-denial, response, and service-worker journeys passed.')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopServer(server)
}
