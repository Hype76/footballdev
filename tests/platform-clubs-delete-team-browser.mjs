import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const configuredBaseUrl = String(process.env.PLATFORM_CLUBS_BROWSER_BASE_URL || '').replace(/\/$/, '')
const port = Number(process.env.PLATFORM_CLUBS_BROWSER_PORT || 4400 + Math.floor(Math.random() * 500))
const baseUrl = configuredBaseUrl || `http://127.0.0.1:${port}`
const fixtureEmail = 'platform.fixture@footballplayer.test'
const fixturePassword = 'FixturePass123!'
const fixtureUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const disposableClub = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Disposable Runtime Club FC',
  contact_email: 'owner@example.test',
  contact_phone: '',
  plan_key: 'small_club',
  plan_status: 'active',
  is_plan_comped: false,
  status: 'active',
  suspended_at: null,
  created_at: '2026-06-24T09:00:00.000Z',
}
const disposableTeams = [
  { id: '22222222-2222-4222-8222-222222222222', name: 'U12 Tigers Fixture', club_id: disposableClub.id },
  { id: '33333333-3333-4333-8333-333333333333', name: 'U13 Lions Fixture', club_id: disposableClub.id },
]

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForCondition(condition, message, timeoutMs = 15000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return
    }

    await wait(50)
  }

  throw new Error(message)
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
    VITE_SUPABASE_URL: 'http://fixture.supabase.test',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable-key',
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
      'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    },
    contentType: 'application/json',
    body: status === 204 ? '' : JSON.stringify(payload),
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
    created_at: '2026-06-24T09:00:00.000Z',
    updated_at: '2026-06-24T09:00:00.000Z',
  }
}

function fixtureProfile() {
  return {
    id: fixtureUserId,
    email: fixtureEmail,
    username: 'Platform Fixture',
    name: 'Platform Fixture',
    display_name: 'Platform Fixture',
    role: 'super_admin',
    role_label: 'Super Admin',
    role_rank: 100,
    club_id: null,
    status: 'active',
    suspended_at: null,
  }
}

async function prepareContext(browser, { deleteResponses = [] } = {}) {
  const context = await browser.newContext()
  const requests = {
    deleteTeam: [],
    auth: [],
    functions: [],
  }
  const consoleMessages = []
  let teamDeleted = false
  let deleteResponseIndex = 0

  const handlePlatformAdminAccessRoute = async (route) => {
    requests.functions.push({ method: route.request().method(), url: route.request().url() })
    if (route.request().method() === 'POST') {
      await fulfillJson(route, 200, {
        success: true,
        hasPlatformAdminAccess: true,
        user: {
          ...fixtureProfile(),
          displayName: 'Platform Fixture',
          accountStatus: 'active',
          clubId: '',
          clubName: 'Platform',
          clubOptions: [],
          parentPortalLinks: [],
        },
      })
      return
    }

    await fulfillJson(route, 200, { success: true, hasPlatformAdminAccess: true, platformAdmin: { id: fixtureUserId, email: fixtureEmail, name: 'Platform Fixture' } })
  }

  const handlePlatformDeleteTeamRoute = async (route) => {
    const request = route.request()
    const body = request.postDataJSON()
    requests.deleteTeam.push({
      method: request.method(),
      headers: request.headers(),
      body,
    })
    const nextResponse = deleteResponses[deleteResponseIndex] || {
      status: 200,
      body: { success: true, team: { id: body.teamId, name: 'U12 Tigers Fixture', clubId: disposableClub.id } },
    }
    deleteResponseIndex += 1

    if (nextResponse.abort) {
      await route.abort('failed')
      return
    }

    if (nextResponse.status >= 200 && nextResponse.status < 300) {
      teamDeleted = body.teamId === disposableTeams[0].id
    }

    await fulfillJson(route, nextResponse.status, nextResponse.body)
  }

  await context.route('**/.netlify/functions/platform-admin-access**', handlePlatformAdminAccessRoute)
  await context.route('**/.netlify/functions/platform-delete-team**', handlePlatformDeleteTeamRoute)

  await context.route('**/.netlify/functions/**', async (route) => {
    const url = route.request().url()

    if (url.includes('/.netlify/functions/platform-admin-access')) {
      await handlePlatformAdminAccessRoute(route)
      return
    }

    if (url.includes('/.netlify/functions/platform-delete-team')) {
      await handlePlatformDeleteTeamRoute(route)
      return
    }

    await fulfillJson(route, 404, { success: false, message: 'Unexpected fixture function call.' })
  })

  await context.route('**/auth/v1/**', async (route) => {
    const request = route.request()
    requests.auth.push({
      method: request.method(),
      url: request.url(),
      body: request.postData(),
    })

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, 204, {})
      return
    }

    await fulfillJson(route, 200, {
      access_token: `fixture-token-${fixtureEmail}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'fixture-refresh-token',
      user: fixtureAuthUser(),
    })
  })

  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request()

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, 204, {})
      return
    }

    const url = new URL(request.url())
    const tableName = getTableName(request.url())

    if (tableName === 'users' && url.searchParams.get('id')?.startsWith('eq.')) {
      await fulfillJson(route, 200, fixtureProfile())
      return
    }

    const payloads = {
      clubs: [disposableClub],
      users: [],
      teams: teamDeleted ? disposableTeams.slice(1) : disposableTeams,
      players: [],
      evaluations: [],
      communication_logs: [],
      audit_logs: [],
      parent_player_links: [],
      user_club_memberships: [],
    }

    await fulfillJson(route, 200, payloads[tableName] || [])
  })

  const page = await context.newPage()
  page.on('console', (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    throw error
  })

  return {
    context,
    page,
    requests,
    consoleMessages,
  }
}

function dialog(page) {
  return page.locator('[role="dialog"]').filter({ hasText: 'Delete team' })
}

function teamDeleteButton(page, teamName) {
  return page
    .getByText(teamName, { exact: true })
    .locator('xpath=..')
    .getByRole('button', { name: 'Delete team' })
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(fixtureEmail)
  await page.getByLabel('Password').fill(fixturePassword)
  const authResponse = page.waitForResponse((response) =>
    response.url().includes('/auth/v1/token') &&
    response.request().method() !== 'OPTIONS' &&
    response.status() === 200,
  )
  await page.getByRole('button', { name: 'Log in' }).click()
  await authResponse
  await page.waitForResponse((response) =>
    response.url().includes('/.netlify/functions/platform-admin-access') &&
    response.status() === 200,
  ).catch(() => null)
  await wait(300)
}

async function openTeamDeleteModal(page, teamName) {
  await teamDeleteButton(page, teamName).click()
  await dialog(page).waitFor({ state: 'visible', timeout: 15000 })
}

async function openPlatformClubs(page) {
  await signIn(page)
  await page.goto(`${baseUrl}/platform-clubs`, { waitUntil: 'domcontentloaded' })
  await page.locator('p').filter({ hasText: disposableClub.name }).first().waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('span').filter({ hasText: 'U12 Tigers Fixture' }).first().waitFor({ state: 'visible', timeout: 15000 })
}

async function runScenario(name, callback) {
  await callback()
  console.log(`ok ${name}`)
}

const server = configuredBaseUrl ? null : startDevServer()
let browser

try {
  if (!configuredBaseUrl) {
    await waitForPort('127.0.0.1', port)
  }
  browser = await chromium.launch()

  await runScenario('team delete modal shows the exact disposable team and club', async () => {
    const { context, page } = await prepareContext(browser)
    await openPlatformClubs(page)
    await openTeamDeleteModal(page, 'U12 Tigers Fixture')

    await dialog(page).getByText('Team', { exact: true }).waitFor({ state: 'visible' })
    await dialog(page).getByText('U12 Tigers Fixture', { exact: true }).waitFor({ state: 'visible' })
    await dialog(page).getByText('Club', { exact: true }).waitFor({ state: 'visible' })
    await dialog(page).getByText(disposableClub.name, { exact: true }).waitFor({ state: 'visible' })

    await context.close()
  })

  await runScenario('empty password stays inside the modal and sends no delete request', async () => {
    const { context, page, requests } = await prepareContext(browser)
    await openPlatformClubs(page)
    await openTeamDeleteModal(page, 'U12 Tigers Fixture')
    await dialog(page).getByRole('button', { name: 'Delete team' }).click()

    await dialog(page).getByText('Enter your password to confirm this action.', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(requests.deleteTeam.length, 0)

    await context.close()
  })

  await runScenario('successful submit sends the team id, club id, and unchanged password once, then removes the row', async () => {
    const { context, page, requests, consoleMessages } = await prepareContext(browser)
    await openPlatformClubs(page)
    await openTeamDeleteModal(page, 'U12 Tigers Fixture')

    await dialog(page).getByLabel('Enter your password to confirm').fill(`  ${fixturePassword}  `)
    await dialog(page).getByRole('button', { name: 'Delete team' }).click()
    try {
      await waitForCondition(() => requests.deleteTeam.length === 1, 'Delete team request was not sent once.')
    } catch (error) {
      const modalText = await dialog(page).innerText().catch(() => '')
      console.error(JSON.stringify({
        authRequests: requests.auth.length,
        deleteRequests: requests.deleteTeam.length,
        modalText,
        consoleMessages,
      }, null, 2))
      throw error
    }

    assert.equal(requests.deleteTeam.length, 1)
    assert.equal(requests.deleteTeam[0].method, 'DELETE')
    assert.equal(requests.deleteTeam[0].body.teamId, disposableTeams[0].id)
    assert.equal(requests.deleteTeam[0].body.clubId, disposableClub.id)
    assert.equal(requests.deleteTeam[0].body.password, `  ${fixturePassword}  `)
    assert.match(requests.deleteTeam[0].headers.authorization || '', /^Bearer fixture-token-/)
    await dialog(page).waitFor({ state: 'detached', timeout: 15000 })
    await page.getByText('Team deleted.', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByText('U12 Tigers Fixture', { exact: true }).waitFor({ state: 'detached', timeout: 15000 })
    await page.getByText('U13 Lions Fixture', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })

    await context.close()
  })

  await runScenario('Enter key submit targets the selected team', async () => {
    const { context, page, requests } = await prepareContext(browser)
    await openPlatformClubs(page)
    await openTeamDeleteModal(page, 'U13 Lions Fixture')

    await dialog(page).getByLabel('Enter your password to confirm').fill(fixturePassword)
    await dialog(page).getByLabel('Enter your password to confirm').press('Enter')
    await waitForCondition(() => requests.deleteTeam.length === 1, 'Enter key did not send the delete team request.')

    assert.equal(requests.deleteTeam.length, 1)
    assert.equal(requests.deleteTeam[0].body.teamId, disposableTeams[1].id)
    assert.equal(requests.deleteTeam[0].body.clubId, disposableClub.id)

    await context.close()
  })

  await runScenario('server error paths stay visible in the modal', async () => {
    const cases = [
      {
        status: 401,
        body: { success: false, code: 'invalid_password', message: 'Password confirmation failed. Check your password and try again.' },
        expected: 'Password confirmation failed. Check your password and try again.',
      },
      {
        status: 403,
        body: { success: false, code: 'forbidden', message: 'Only platform admins can delete teams.' },
        expected: 'You do not have permission to complete this platform admin action.',
      },
      {
        status: 404,
        body: { success: false, code: 'team_not_found', message: 'Team was not found.' },
        expected: 'Team was not found.',
      },
      {
        status: 409,
        body: { success: false, code: 'deletion_conflict', message: 'This team cannot be deleted because linked records still depend on it.' },
        expected: 'This team cannot be deleted because linked records still depend on it.',
      },
    ]

    for (const nextCase of cases) {
      const { context, page } = await prepareContext(browser, { deleteResponses: [nextCase] })
      await openPlatformClubs(page)
      await openTeamDeleteModal(page, 'U12 Tigers Fixture')
      await dialog(page).getByLabel('Enter your password to confirm').fill(fixturePassword)
      await dialog(page).getByRole('button', { name: 'Delete team' }).click()

      await dialog(page).getByText(nextCase.expected, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
      await dialog(page).getByText('U12 Tigers Fixture', { exact: true }).waitFor({ state: 'visible' })
      await context.close()
    }
  })

  await runScenario('network failure stays visible in the modal', async () => {
    const { context, page } = await prepareContext(browser, { deleteResponses: [{ abort: true }] })
    await openPlatformClubs(page)
    await openTeamDeleteModal(page, 'U12 Tigers Fixture')
    await dialog(page).getByLabel('Enter your password to confirm').fill(fixturePassword)
    await dialog(page).getByRole('button', { name: 'Delete team' }).click()

    await dialog(page).getByText('Network failure. Check your connection and try again.', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await dialog(page).getByText('U12 Tigers Fixture', { exact: true }).waitFor({ state: 'visible' })

    await context.close()
  })
} catch (error) {
  if (server) {
    console.error(server.getOutput())
  }
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
