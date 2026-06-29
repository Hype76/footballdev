import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { once } from 'node:events'
import net from 'node:net'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.SQUAD_PROFILE_BROWSER_PORT || 4700 + Math.floor(Math.random() * 500))
const baseUrl = `http://127.0.0.1:${port}`
const fixtureUserId = 'coach-fixture'
const fixtureEmail = 'coach.fixture@footballplayer.test'
const { privateKey: fixtureJwtPrivateKey, publicKey: fixtureJwtPublicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const fixtureJwtKeyId = 'fixture-key'
const fixtureJwtPublicJwk = {
  ...fixtureJwtPublicKey.export({ format: 'jwk' }),
  alg: 'RS256',
  kid: fixtureJwtKeyId,
  key_ops: ['verify'],
  use: 'sig',
}
const fixtureJwtHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: fixtureJwtKeyId, typ: 'JWT' })).toString(
  'base64url',
)
const fixtureJwtPayload = Buffer.from(
  JSON.stringify({
    aud: 'authenticated',
    email: fixtureEmail,
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: 'authenticated',
    sub: fixtureUserId,
  }),
).toString('base64url')
const fixtureAccessTokenBody = `${fixtureJwtHeader}.${fixtureJwtPayload}`
const fixtureAccessToken = `${fixtureAccessTokenBody}.${createSign('RSA-SHA256')
  .update(fixtureAccessTokenBody)
  .sign(fixtureJwtPrivateKey, 'base64url')}`
const fixturePlayerId = 'player-fixture'
const fixturePlayerName = 'Fixture Player'
const fixturePlayerPath = `/player/${encodeURIComponent(fixturePlayerName)}?source=squad&playerId=${fixturePlayerId}`

const players = [
  {
    id: fixturePlayerId,
    club_id: 'club-fixture',
    team_id: 'team-u12',
    player_name: fixturePlayerName,
    shirt_number: '9',
    section: 'Squad',
    team: 'U12 Fixture Team',
    positions: ['Forward'],
    parent_name: 'Fixture Parent',
    parent_email: 'parent.fixture@example.test',
    parent_contacts: [{ name: 'Fixture Parent', email: 'parent.fixture@example.test', type: 'parent' }],
    status: 'active',
    created_at: '2026-06-20T09:00:00.000Z',
    updated_at: '2026-06-20T09:00:00.000Z',
  },
  {
    id: 'player-name-collision',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    player_name: 'Fixture Player Trial',
    shirt_number: '14',
    section: 'Trial',
    team: 'U12 Fixture Team',
    positions: ['Midfield'],
    parent_name: '',
    parent_email: '',
    parent_contacts: [],
    status: 'active',
    created_at: '2026-06-19T09:00:00.000Z',
    updated_at: '2026-06-19T09:00:00.000Z',
  },
]

const evaluations = [
  {
    id: 'evaluation-fixture',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    player_id: fixturePlayerId,
    player_name: fixturePlayerName,
    section: 'Squad',
    team: 'U12 Fixture Team',
    parent_name: 'Fixture Parent',
    parent_email: 'parent.fixture@example.test',
    parent_contacts: [{ name: 'Fixture Parent', email: 'parent.fixture@example.test', type: 'parent' }],
    session: 'Fixture session',
    coach: 'Coach Fixture',
    date: '2026-06-20',
    status: 'Submitted',
    average_score: 8,
    scores: { Control: 8 },
    comments: { overall: 'Fixture note' },
    form_responses: { Control: '8' },
    created_at: '2026-06-20T10:00:00.000Z',
  },
]

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForPort(host, targetPort, timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port: targetPort })
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
        resolve(false)
      })
    })

    if (connected) {
      return
    }
  }

  throw new Error(`Timed out waiting for ${host}:${targetPort}`)
}

function startPreviewServer() {
  if (!existsSync('dist/index.html')) {
    throw new Error('Build dist is missing. Run a fixture production build before this browser walkthrough.')
  }

  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run preview -- --host 127.0.0.1 --port ${port} --strictPort`],
    {
      cwd: process.cwd(),
      env: { ...process.env, BROWSER: 'none' },
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

  return {
    child,
    getOutput: () => output,
  }
}

async function stopPreviewServer(server) {
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

  if (server.child.exitCode === null) {
    server.child.kill('SIGKILL')
  }
}

function getFilterValue(searchParams, key) {
  const value = searchParams.get(key)
  return value?.startsWith('eq.') ? value.slice(3) : ''
}

function filterRows(rows, searchParams) {
  const id = getFilterValue(searchParams, 'id')
  const playerName = getFilterValue(searchParams, 'player_name')
  const teamId = getFilterValue(searchParams, 'team_id')
  const clubId = getFilterValue(searchParams, 'club_id')

  return rows.filter((row) => {
    if (id && row.id !== id) {
      return false
    }
    if (playerName && row.player_name !== playerName) {
      return false
    }
    if (teamId && row.team_id !== teamId) {
      return false
    }
    if (clubId && row.club_id !== clubId) {
      return false
    }
    return true
  })
}

async function fulfillJson(route, body) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

function fixtureAuthUser() {
  return {
    id: fixtureUserId,
    aud: 'authenticated',
    role: 'authenticated',
    email: fixtureEmail,
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-06-20T09:00:00.000Z',
    updated_at: '2026-06-20T09:00:00.000Z',
  }
}

function fixtureUserProfile() {
  return {
    id: fixtureUserId,
    email: fixtureEmail,
    username: 'Coach Fixture',
    name: 'Coach Fixture',
    display_name: 'Coach Fixture',
    role: 'coach',
    role_label: 'Coach',
    role_rank: 30,
    club_id: 'club-fixture',
    status: 'active',
    suspended_at: null,
  }
}

async function preparePage(context) {
  const playerRequests = []
  const authRequests = []
  const routedRequests = []

  await context.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.includes('/rest/v1/') || url.includes('/auth/v1/')) {
      routedRequests.push(url)
    }
    if (url.includes('/rest/v1/')) {
      await fulfillJson(route, [])
      return
    }
    await route.fallback()
  })

  await context.route('**/auth/v1/token**', async (route) => {
    const request = route.request()
    authRequests.push(request.url())

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, {})
      return
    }

    await fulfillJson(route, {
      access_token: fixtureAccessToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'fixture-refresh-token',
      user: fixtureAuthUser(),
    })
  })
  await context.route('**/auth/v1/user**', async (route) => {
    const request = route.request()
    authRequests.push(request.url())

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, {})
      return
    }

    await fulfillJson(route, fixtureAuthUser())
  })
  await context.route('**/auth/v1/.well-known/jwks.json**', async (route) => {
    authRequests.push(route.request().url())
    await fulfillJson(route, { keys: [fixtureJwtPublicJwk] })
  })
  await context.route(/\/rest\/v1\/users(?:\?|$)/, async (route) => {
    await fulfillJson(route, fixtureUserProfile())
  })
  await context.route(/\/rest\/v1\/user_club_memberships(?:\?|$)/, async (route) => {
    await fulfillJson(route, [])
  })
  await context.route(/\/rest\/v1\/club_user_invites(?:\?|$)/, async (route) => {
    await fulfillJson(route, [])
  })
  await context.route(/\/rest\/v1\/clubs(?:\?|$)/, async (route) => {
    await fulfillJson(route, {
      id: 'club-fixture',
      name: 'Fixture Club',
      plan_key: 'development_club',
      subscription_status: 'active',
    })
  })
  await context.route(/\/rest\/v1\/players(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url())
    playerRequests.push(url)
    await fulfillJson(route, filterRows(players, url.searchParams))
  })
  await context.route(/\/rest\/v1\/evaluations(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url())
    await fulfillJson(route, filterRows(evaluations, url.searchParams))
  })
  await context.route(/\/rest\/v1\/teams(?:\?|$)/, async (route) => {
    await fulfillJson(route, [
      {
        id: 'team-u12',
        club_id: 'club-fixture',
        name: 'U12 Fixture Team',
        require_approval: true,
      },
    ])
  })
  await context.route(/\/rest\/v1\/team_staff(?:\?|$)/, async (route) => {
    await fulfillJson(route, [
      {
        user_id: fixtureUserId,
        team_id: 'team-u12',
        role: 'coach',
        role_rank: 30,
      },
    ])
  })
  await context.route(/\/rest\/v1\/parent_player_links(?:\?|$)/, async (route) => {
    await fulfillJson(route, [])
  })
  await context.route(/\/rest\/v1\/player_staff_notes(?:\?|$)/, async (route) => {
    await fulfillJson(route, [])
  })
  await context.route(/\/rest\/v1\/communication_logs(?:\?|$)/, async (route) => {
    await fulfillJson(route, [])
  })
  await context.route(/\/rest\/v1\/assessment_fields(?:\?|$)/, async (route) => {
    await fulfillJson(route, [])
  })
  await context.route(/\/rest\/v1\/email_templates(?:\?|$)/, async (route) => {
    await fulfillJson(route, [])
  })
  await context.route('http://fixture.supabase.test/rest/v1/**', async (route) => {
    await fulfillJson(route, [])
  })
  await context.route('**/.netlify/functions/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Fixture function stub.' }),
    })
  })

  return {
    getAuthRequests: () => authRequests,
    getPlayerRequests: () => playerRequests,
    getRoutedRequests: () => routedRequests,
    page: await context.newPage(),
  }
}

const server = startPreviewServer()
let browser

try {
  await waitForPort('127.0.0.1', port)

  browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.clearCookies()
  const consoleErrors = []
  const pageErrors = []
  const restRequests = []
  const { getAuthRequests, getPlayerRequests, getRoutedRequests, page } = await preparePage(context)

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('/rest/v1/')) {
      restRequests.push(url)
    }
  })

  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.getByPlaceholder('you@club.com').fill(fixtureEmail)
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL((url) => url.pathname !== '/sign-in', { timeout: 15000 })

  await page.goto(`${baseUrl}/players/current?section=Squad`, { waitUntil: 'domcontentloaded' })
  const profileLink = page.locator(`[data-player-profile-href="${fixturePlayerPath}"]`).first()
  try {
    await profileLink.waitFor({ state: 'visible', timeout: 15000 })
  } catch (error) {
    const bodyText = (await page.locator('body').innerText()).slice(0, 700).replace(/\s+/g, ' ')
    throw new Error(
      `Expected fixture squad player card at ${page.url()}. Auth requests: ${getAuthRequests().join(', ')}. Routed requests: ${getRoutedRequests().join(', ')}. Rest requests: ${restRequests.join(', ')}. Console errors: ${consoleErrors.join(' | ')}. Body: ${bodyText}`,
      { cause: error },
    )
  }
  const renderedHref = await profileLink.getAttribute('data-player-profile-href')
  assert.equal(renderedHref, fixturePlayerPath)

  const cardBox = await page.locator('[data-player-card]').first().boundingBox()
  const nameBox = await page.locator('[data-player-card-name]').first().boundingBox()
  const contentPaddingLeft = await page
    .locator('[data-player-card-content]')
    .first()
    .evaluate((element) => Number.parseFloat(window.getComputedStyle(element).paddingLeft))
  assert.ok(cardBox, 'Expected the player card to render for spacing checks.')
  assert.ok(nameBox, 'Expected the player name to render for spacing checks.')
  assert.ok(contentPaddingLeft >= 24, `Expected card content left padding to clear the accent, got ${contentPaddingLeft}px.`)
  assert.ok(nameBox.x - cardBox.x >= 24, `Expected player name to clear the left accent, got ${nameBox.x - cardBox.x}px.`)

  await profileLink.click()
  await page.waitForURL(`**${fixturePlayerPath}`, { timeout: 15000 })

  await page.getByRole('heading', { name: 'Player details' }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByText('Contact: Fixture Parent', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByText('Email: parent.fixture@example.test', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByText('Forward', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByRole('button', { name: 'Edit Details' }).waitFor({ state: 'visible', timeout: 15000 })

  assert.equal(await page.getByText('Saved player details are not attached yet.').count(), 0)
  assert.equal(await page.getByText('Saved player record could not be found.').count(), 0)
  assert.equal(await page.getByRole('button', { name: /^Delete player$/ }).count(), 0)

  const idLookupRequest = getPlayerRequests().find((url) => url.searchParams.get('id') === `eq.${fixturePlayerId}`)
  assert.ok(idLookupRequest, 'Expected a saved-player id lookup request.')
  assert.equal(idLookupRequest.searchParams.has('team_id'), false)
  assert.equal(idLookupRequest.searchParams.has('team'), false)

  await wait(1000)
  const serviceWorkerState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      return { supported: false, registrations: [], cacheNames: [] }
    }

    const registrations = await navigator.serviceWorker.getRegistrations()
    const cacheNames = 'caches' in window ? await caches.keys() : []
    return {
      cacheNames,
      controller: navigator.serviceWorker.controller?.scriptURL || '',
      registrations: registrations.map((registration) => ({
        active: registration.active?.scriptURL || '',
        installing: registration.installing?.scriptURL || '',
        waiting: registration.waiting?.scriptURL || '',
      })),
      supported: true,
    }
  })

  assert.deepEqual(pageErrors, [])
  assert.deepEqual(consoleErrors, [])

  console.log(`ok authenticated fixture production build route ${baseUrl}/players/current?section=Squad`)
  console.log(`ok rendered href ${renderedHref}`)
  console.log(`ok profile url ${page.url()}`)
  console.log(`ok id lookup ${idLookupRequest.toString()}`)
  console.log(`ok service worker ${JSON.stringify(serviceWorkerState)}`)

  await context.close()
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopPreviewServer(server)
}
