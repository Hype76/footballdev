import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'

const configuredBaseUrl = String(process.env.PLATFORM_CLUBS_BROWSER_BASE_URL || '').replace(/\/$/, '')
const port = Number(process.env.PLATFORM_CLUBS_BROWSER_PORT || 4400 + Math.floor(Math.random() * 500))
const baseUrl = configuredBaseUrl || `http://127.0.0.1:${port}`
const fixtureEmail = 'platform.fixture@footballplayer.test'
const fixturePassword = 'FixturePass123!'
const fixtureUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const fixtureClubStaffId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const fixtureClubMembershipId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
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
  archived_at: null,
  archived_by: null,
  archived_previous_status: null,
  created_at: '2026-06-24T09:00:00.000Z',
}
const disposableTeams = [
  { id: '22222222-2222-4222-8222-222222222222', name: 'U12 Tigers Fixture', club_id: disposableClub.id, status: 'active', archived_at: null, archived_by: null, archived_previous_status: null },
  { id: '33333333-3333-4333-8333-333333333333', name: 'U13 Lions Fixture', club_id: disposableClub.id, status: 'active', archived_at: null, archived_by: null, archived_previous_status: null },
]

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForCondition(condition, message, timeoutMs = 15000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) {
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

async function prepareContext(
  browser,
  { createClubResponses = [], deleteResponses = [], viewport = null, ...contextOptions } = {},
) {
  const context = await browser.newContext(viewport ? { ...contextOptions, viewport } : contextOptions)
  const requests = {
    archiveTeam: [],
    createClub: [],
    deleteTeam: [],
    platformAccess: [],
    auth: [],
    functions: [],
  }
  const consoleMessages = []
  let createClubResponseIndex = 0
  const archivedTeamIds = new Set()
  const deletedTeamIds = new Set()
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

  const handlePlatformCreateClubRoute = async (route) => {
    const request = route.request()
    const body = request.postDataJSON()
    requests.createClub.push({
      method: request.method(),
      headers: request.headers(),
      body,
    })
    const nextResponse = createClubResponses[createClubResponseIndex] || {
      status: 200,
      body: {
        success: true,
        club: {
          ...disposableClub,
          id: '44444444-4444-4444-8444-444444444444',
          name: body.name || 'Disposable Created Club FC',
          contact_email: body.contactEmail || body.ownerEmail || 'owner@example.test',
        },
        invite: {
          id: '55555555-5555-4555-8555-555555555555',
          email: body.ownerEmail || 'owner@example.test',
          billingMode: body.billingMode || 'paid',
          planKey: body.planKey || 'small_club',
          sent: true,
          emailFailed: false,
          deliveryAttempted: true,
          deliveryStatus: 'accepted',
          deliveryPolicy: 'production',
          deliveryReason: 'production_delivery_accepted',
          deliveryMessage: 'Invite email accepted for delivery.',
          url: `${baseUrl}/club-invite/fixture-owner-token`,
        },
      },
    }
    createClubResponseIndex += 1

    await fulfillJson(route, nextResponse.status, nextResponse.body)
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
      deletedTeamIds.add(body.teamId)
    }

    await fulfillJson(route, nextResponse.status, nextResponse.body)
  }

  const handlePlatformClubAccessRoute = async (route) => {
    const request = route.request()
    const currentTeams = disposableTeams.filter((team) => !deletedTeamIds.has(team.id))
    requests.platformAccess.push({ method: request.method(), url: request.url(), body: request.postData() })
    await fulfillJson(route, 200, {
      success: true,
      access: {
        club: { id: disposableClub.id, name: disposableClub.name },
        owner: {
          id: '66666666-6666-4666-8666-666666666666',
          displayName: 'Fixture Owner',
          maskedEmail: 'ow***@example.test',
          role: 'admin',
          roleLabel: 'Club Admin',
          status: 'active',
          assignedTeams: [],
        },
        clubAdmins: [],
        teamAdmins: [{
          id: '77777777-7777-4777-8777-777777777777',
          displayName: 'Fixture Team Admin',
          maskedEmail: 'te***@example.test',
          role: 'head_manager',
          roleLabel: 'Team Admin',
          status: 'active',
          assignedTeams: currentTeams.slice(0, 1).map((team) => ({ id: team.id, name: team.name })),
        }],
        pendingInvitations: [{
          id: '88888888-8888-4888-8888-888888888888',
          source: 'owner',
          maskedEmail: 'pe***@example.test',
          role: 'admin',
          roleLabel: 'Club Admin',
          status: 'pending',
          deliveryStatus: 'unsent',
          sentAt: null,
          expiresAt: '2026-08-08T15:19:08.000Z',
          assignedTeams: [],
        }],
        invitationHistory: [],
        removedAccess: [{
          id: '99999999-9999-4999-8999-999999999999',
          targetUserId: '77777777-7777-4777-8777-777777777777',
          assignmentType: 'team_admin',
          role: 'head_manager',
          roleLabel: 'Team Admin',
          teamId: disposableTeams[1].id,
          teamName: disposableTeams[1].name,
          status: 'removed',
          removedAt: '2026-07-25T16:00:00.000Z',
        }],
        teams: currentTeams.map((team) => ({ id: team.id, name: team.name, status: 'active' })),
      },
    })
  }

  await context.route('**/.netlify/functions/platform-admin-access**', handlePlatformAdminAccessRoute)
  await context.route('**/.netlify/functions/platform-create-club**', handlePlatformCreateClubRoute)
  await context.route('**/.netlify/functions/platform-delete-team**', handlePlatformDeleteTeamRoute)
  await context.route('**/.netlify/functions/platform-club-access**', handlePlatformClubAccessRoute)

  await context.route('**/.netlify/functions/**', async (route) => {
    const url = route.request().url()

    if (url.includes('/.netlify/functions/platform-admin-access')) {
      await handlePlatformAdminAccessRoute(route)
      return
    }

    if (url.includes('/.netlify/functions/platform-create-club')) {
      await handlePlatformCreateClubRoute(route)
      return
    }

    if (url.includes('/.netlify/functions/platform-delete-team')) {
      await handlePlatformDeleteTeamRoute(route)
      return
    }

    if (url.includes('/.netlify/functions/platform-club-access')) {
      await handlePlatformClubAccessRoute(route)
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

    if (url.pathname.includes('/rest/v1/rpc/set_platform_team_archive_state')) {
      const body = request.postDataJSON()
      requests.archiveTeam.push({ method: request.method(), body })

      if (body.p_archived) {
        archivedTeamIds.add(body.p_team_id)
      } else {
        archivedTeamIds.delete(body.p_team_id)
      }

      const team = disposableTeams.find((candidate) => candidate.id === body.p_team_id)
      await fulfillJson(route, 200, {
        id: body.p_team_id,
        name: team?.name || 'Fixture Team',
        clubId: body.p_club_id,
        status: body.p_archived ? 'inactive' : 'active',
        archivedAt: body.p_archived ? '2026-08-07T17:00:00.000Z' : null,
        archivedBy: body.p_archived ? fixtureUserId : null,
        archivedPreviousStatus: body.p_archived ? 'active' : null,
      })
      return
    }

    if (tableName === 'users' && url.searchParams.get('id')?.startsWith('eq.')) {
      await fulfillJson(route, 200, fixtureProfile())
      return
    }

    const payloads = {
      clubs: [disposableClub],
      club_team_limit_overrides: [],
      users: [{
        id: fixtureClubStaffId,
        email: 'coach.role-control@example.test',
        username: 'Fixture Coach',
        name: 'Fixture Coach',
        role: 'coach',
        role_label: 'Coach',
        role_rank: 30,
        club_id: disposableClub.id,
        status: 'active',
        suspended_at: null,
      }],
      teams: disposableTeams
        .filter((team) => !deletedTeamIds.has(team.id))
        .map((team) => archivedTeamIds.has(team.id)
          ? {
              ...team,
              status: 'inactive',
              archived_at: '2026-08-07T17:00:00.000Z',
              archived_by: fixtureUserId,
              archived_previous_status: 'active',
            }
          : team),
      players: [],
      evaluations: [],
      communication_logs: [],
      audit_logs: [],
      parent_player_links: [],
      user_club_memberships: [{
        id: fixtureClubMembershipId,
        auth_user_id: fixtureClubStaffId,
        club_id: disposableClub.id,
        role: 'coach',
        role_label: 'Coach',
        role_rank: 30,
      }],
      club_roles: [
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          club_id: disposableClub.id,
          role_key: 'coach',
          role_label: 'Coach',
          role_rank: 30,
          is_system: true,
        },
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          club_id: disposableClub.id,
          role_key: 'manager',
          role_label: 'Manager',
          role_rank: 50,
          is_system: true,
        },
      ],
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
  return page.locator('[role="dialog"]').filter({ hasText: 'Permanently delete archived Team' })
}

function teamDeleteButton(page, teamName) {
  return page
    .getByText(teamName, { exact: true })
    .locator('xpath=../..')
    .getByRole('button', { name: 'Permanently delete' })
}

function teamArchiveButton(page, teamName) {
  return page
    .getByText(teamName, { exact: true })
    .locator('xpath=..')
    .getByRole('button', { name: 'Archive Team' })
}

async function waitForReadonlyInputValue(page, value) {
  await waitForCondition(async () => {
    const values = await page.locator('input[readonly]').evaluateAll((inputs) =>
      inputs.map((input) => input.value),
    )

    return values.includes(value)
  }, `Readonly input value was not visible: ${value}`)
}

async function signIn(page) {
  const emailField = page.getByLabel('Email')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })

    try {
      await emailField.waitFor({ state: 'visible', timeout: 15000 })
      break
    } catch (error) {
      if (attempt === 1) {
        throw error
      }
    }
  }

  await emailField.fill(fixtureEmail)
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

async function archiveTeamAndOpenDeleteModal(page, requests, teamName) {
  await teamArchiveButton(page, teamName).click()
  const archiveDialog = page.locator('[role="dialog"]').filter({ hasText: 'Archive Team' })
  await archiveDialog.waitFor({ state: 'visible', timeout: 15000 })
  await archiveDialog.getByRole('button', { name: 'Archive Team' }).click()
  await waitForCondition(
    () => requests.archiveTeam.some((request) => request.body.p_team_id === disposableTeams.find((team) => team.name === teamName)?.id),
    'Archive Team request was not sent.',
  )
  await archiveDialog.waitFor({ state: 'detached', timeout: 15000 })
  await page.getByRole('button', { name: /^Archive \(/ }).click()
  await page.getByText(teamName, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  await teamDeleteButton(page, teamName).click()
  await dialog(page).waitFor({ state: 'visible', timeout: 15000 })
}

async function openPlatformClubs(page) {
  await signIn(page)
  await page.goto(`${baseUrl}/platform-clubs`, { waitUntil: 'domcontentloaded' })
  await page.locator('p').filter({ hasText: disposableClub.name }).first().waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('span').filter({ hasText: 'U12 Tigers Fixture' }).first().waitFor({ state: 'visible', timeout: 15000 })
}

async function openPlatformRoute(page, path, title) {
  await signIn(page)
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: title, exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
}

async function submitCreateClubInvite(page, { clubName = 'Created Browser Club FC', ownerEmail = 'owner@example.test' } = {}) {
  await page.getByLabel('Club name').fill(clubName)
  await page.getByLabel('Owner invite email').fill(ownerEmail)
  await page.getByRole('button', { name: 'Add club and invite' }).click()
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
    const { context, page, requests } = await prepareContext(browser)
    await openPlatformClubs(page)
    assert.equal(await page.getByRole('button', { name: 'Permanently delete' }).count(), 0)
    await archiveTeamAndOpenDeleteModal(page, requests, 'U12 Tigers Fixture')

    await dialog(page).getByText('Team', { exact: true }).waitFor({ state: 'visible' })
    await dialog(page).getByText('U12 Tigers Fixture', { exact: true }).waitFor({ state: 'visible' })
    await dialog(page).getByText('Club', { exact: true }).waitFor({ state: 'visible' })
    await dialog(page).getByText(disposableClub.name, { exact: true }).waitFor({ state: 'visible' })

    await context.close()
  })

  await runScenario('empty password stays inside the modal and sends no delete request', async () => {
    const { context, page, requests } = await prepareContext(browser)
    await openPlatformClubs(page)
    await archiveTeamAndOpenDeleteModal(page, requests, 'U12 Tigers Fixture')
    await dialog(page).getByRole('button', { name: 'Permanently delete Team' }).click()

    await dialog(page).getByText('Enter your password to confirm this action.', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(requests.deleteTeam.length, 0)

    await context.close()
  })

  await runScenario('successful submit sends the team id, club id, and unchanged password once, then removes the row', async () => {
    const { context, page, requests, consoleMessages } = await prepareContext(browser)
    await openPlatformClubs(page)
    await archiveTeamAndOpenDeleteModal(page, requests, 'U12 Tigers Fixture')

    await dialog(page).getByLabel('Enter your password to confirm').fill(`  ${fixturePassword}  `)
    await dialog(page).getByRole('button', { name: 'Permanently delete Team' }).click()
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
    await page.getByText('Archived Team permanently deleted.', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByText('U12 Tigers Fixture', { exact: true }).first().waitFor({ state: 'detached', timeout: 15000 })

    await context.close()
  })

  await runScenario('Enter key submit targets the selected team', async () => {
    const { context, page, requests } = await prepareContext(browser)
    await openPlatformClubs(page)
    await archiveTeamAndOpenDeleteModal(page, requests, 'U13 Lions Fixture')

    await dialog(page).getByLabel('Enter your password to confirm').fill(fixturePassword)
    await dialog(page).getByLabel('Enter your password to confirm').press('Enter')
    await waitForCondition(() => requests.deleteTeam.length === 1, 'Enter key did not send the delete team request.')

    assert.equal(requests.deleteTeam.length, 1)
    assert.equal(requests.deleteTeam[0].body.teamId, disposableTeams[1].id)
    assert.equal(requests.deleteTeam[0].body.clubId, disposableClub.id)

    await context.close()
  })

  await runScenario('production invite accepted response shows accepted delivery and backup link', async () => {
    const { context, page, requests } = await prepareContext(browser, {
      createClubResponses: [{
        status: 200,
        body: {
          success: true,
          club: disposableClub,
          invite: {
            id: '55555555-5555-4555-8555-555555555555',
            email: 'owner@example.test',
            billingMode: 'paid',
            planKey: 'small_club',
            sent: true,
            emailFailed: false,
            deliveryAttempted: true,
            deliveryStatus: 'accepted',
            deliveryPolicy: 'production',
            deliveryReason: 'production_delivery_accepted',
            deliveryMessage: 'Invite email accepted for delivery.',
            url: `${baseUrl}/club-invite/accepted-fixture-token`,
          },
        },
      }],
    })
    await openPlatformClubs(page)
    await submitCreateClubInvite(page)

    await page.getByText('Invite email accepted for delivery.', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByText('Invite link backup', { exact: true }).waitFor({ state: 'visible' })
    await waitForReadonlyInputValue(page, `${baseUrl}/club-invite/accepted-fixture-token`)
    await page.getByText('Email delivery was skipped by local development policy.', { exact: true }).waitFor({ state: 'detached' })
    await page.getByText('Email delivery was skipped by staging policy.', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(requests.createClub.length, 1)

    await context.close()
  })

  await runScenario('production missing email configuration response shows manual link and support copy', async () => {
    const { context, page, requests } = await prepareContext(browser, {
      createClubResponses: [{
        status: 200,
        body: {
          success: true,
          club: disposableClub,
          invite: {
            id: '55555555-5555-4555-8555-555555555555',
            email: 'owner@example.test',
            billingMode: 'paid',
            planKey: 'small_club',
            sent: false,
            emailFailed: true,
            deliveryAttempted: false,
            deliveryStatus: 'configuration_error',
            deliveryPolicy: 'production',
            deliveryReason: 'missing_email_configuration',
            deliveryMessage: 'Invite email could not be sent because production email is not configured. Use the manual invite link below and contact platform support.',
            url: `${baseUrl}/club-invite/config-fixture-token`,
          },
        },
        warning: 'Invite email could not be sent because production email is not configured. Use the manual invite link below and contact platform support.',
      }],
    })
    await openPlatformClubs(page)
    await submitCreateClubInvite(page)

    await page.getByText('Manual invite link', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByText('Invite email could not be sent because production email is not configured. Use the manual invite link below and contact platform support.', { exact: true }).waitFor({ state: 'visible' })
    await waitForReadonlyInputValue(page, `${baseUrl}/club-invite/config-fixture-token`)
    await page.getByText('Email delivery was skipped by local development policy.', { exact: true }).waitFor({ state: 'detached' })
    await page.getByText('Email delivery was skipped by staging policy.', { exact: true }).waitFor({ state: 'detached' })
    assert.equal(requests.createClub.length, 1)

    await context.close()
  })

  await runScenario('fake-password and server error paths stay visible in the modal', async () => {
    const cases = [
      {
        status: 401,
        password: 'WrongFixturePassword!',
        body: { success: false, code: 'invalid_password', message: 'That password was not accepted.' },
        expected: 'That password was not accepted.',
      },
      {
        status: 403,
        body: { success: false, code: 'forbidden', message: 'Only platform admins can delete teams.' },
        expected: 'You do not have permission to delete teams.',
      },
      {
        status: 404,
        body: { success: false, code: 'team_not_found', message: 'Team was not found.' },
        expected: 'This team could not be found.',
      },
      {
        status: 409,
        body: { success: false, code: 'deletion_conflict', message: 'This team cannot be deleted because linked records still depend on it.' },
        expected: 'This team cannot be deleted because linked records still depend on it.',
      },
      {
        status: 500,
        body: { success: false, code: 'audit_failed', message: 'The team could not be deleted because the audit log could not be written.' },
        expected: 'The team could not be deleted because the audit log could not be written.',
      },
      {
        status: 500,
        body: { success: false, code: 'server_error', message: 'The server could not complete this action. Please contact support with reference FPO-V1-TEAMDELETE-SERVERERR-007.' },
        expected: 'The server could not complete this action. Please contact support with reference FPO-V1-TEAMDELETE-SERVERERR-007.',
      },
    ]

    for (const nextCase of cases) {
      const { context, page, requests } = await prepareContext(browser, { deleteResponses: [nextCase] })
      await openPlatformClubs(page)
      await archiveTeamAndOpenDeleteModal(page, requests, 'U12 Tigers Fixture')
      await dialog(page).getByLabel('Enter your password to confirm').fill(nextCase.password || fixturePassword)
      await dialog(page).getByRole('button', { name: 'Permanently delete Team' }).click()

      await dialog(page).getByText(nextCase.expected, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
      await dialog(page).getByText('U12 Tigers Fixture', { exact: true }).waitFor({ state: 'visible' })
      await teamDeleteButton(page, 'U12 Tigers Fixture').waitFor({ state: 'visible' })
      await context.close()
    }
  })

  await runScenario('network failure stays visible in the modal', async () => {
    const { context, page, requests } = await prepareContext(browser, { deleteResponses: [{ abort: true }] })
    await openPlatformClubs(page)
    await archiveTeamAndOpenDeleteModal(page, requests, 'U12 Tigers Fixture')
    await dialog(page).getByLabel('Enter your password to confirm').fill(fixturePassword)
    await dialog(page).getByRole('button', { name: 'Permanently delete Team' }).click()

    await dialog(page).getByText('Network failure. Check your connection and try again.', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await dialog(page).getByText('U12 Tigers Fixture', { exact: true }).waitFor({ state: 'visible' })

    await context.close()
  })

  await runScenario('existing-club access management renders on desktop without exposing secrets', async () => {
    const { context, page, requests } = await prepareContext(browser, { viewport: { width: 1440, height: 1000 } })
    await openPlatformClubs(page)
    await page.getByText('Club access', { exact: true }).waitFor({ state: 'visible' })

    for (const label of ['Owner', 'Club Admins', 'Team Administrators', 'Pending invitations', 'Removed access']) {
      await page.getByText(label, { exact: true }).last().waitFor({ state: 'visible' })
    }

    await page.getByRole('button', { name: 'Invite Club Admin' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Assign Team Admin' }).waitFor({ state: 'visible' })
    await page.getByLabel('Club role for Fixture Coach').selectOption('manager')
    const reviewRoleButton = page.getByRole('button', { name: 'Review role change' })
    await reviewRoleButton.focus()
    await page.keyboard.press('Enter')
    const roleDialog = page.locator('[role="dialog"]').filter({ hasText: 'Confirm staff role change' })
    await roleDialog.waitFor({ state: 'visible' })
    for (const [label, value] of [
      ['Current role', 'Coach'],
      ['New role', 'Manager'],
      ['Scope', disposableClub.name],
      ['Consequence', 'This grants only the selected club role authority.'],
    ]) {
      const detailRow = roleDialog.locator('li').filter({ hasText: label })
      await detailRow.getByText(value, { exact: true }).waitFor({ state: 'visible' })
    }
    await roleDialog.getByText('No staff email or notification will be sent.', { exact: true }).waitFor({ state: 'visible' })
    await roleDialog.getByRole('button', { name: 'Cancel' }).click()
    assert.equal(await page.getByText(/token_digest|auth_user_id|fixture-owner-token/i).count(), 0)
    assert.ok(requests.platformAccess.some((request) => request.method === 'GET'))
    await mkdir('output/playwright', { recursive: true })
    await page.screenshot({ path: 'output/playwright/platform-club-access-desktop.png', fullPage: true })
    await context.close()
  })

  await runScenario('existing-club access management remains usable on mobile', async () => {
    const { context, page } = await prepareContext(browser, { viewport: { width: 390, height: 844 } })
    await openPlatformClubs(page)
    await page.getByText('Club access', { exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Replace invitation' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Cancel invitation' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Restore access' }).waitFor({ state: 'visible' })
    await page.getByLabel('Club role for Fixture Coach').selectOption('manager')
    await page.getByRole('button', { name: 'Review role change' }).click()
    await page.locator('[role="dialog"]').filter({ hasText: 'Confirm staff role change' }).waitFor({ state: 'visible' })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(overflow <= 1, `Unexpected mobile horizontal overflow: ${overflow}px`)
    await mkdir('output/playwright', { recursive: true })
    await page.screenshot({ path: 'output/playwright/platform-club-access-mobile.png', fullPage: true })
    await context.close()
  })

  await runScenario('Platform Admin overview is concise and every retained card has a focused destination', async () => {
    const { context, page } = await prepareContext(browser, { viewport: { width: 1440, height: 1000 } })
    await openPlatformRoute(page, '/platform-admin', 'Platform dashboard')

    const expectedCardLabels = [
      'Clubs: View clubs',
      'Teams: View teams',
      'Active players: View player records',
      'Staff accounts: View platform staff',
      'Parent accounts: View parent adoption',
      'Development records: View development analytics',
      'Recent admin activity: View activity context',
      'Open platform issues: View platform feedback',
    ]

    for (const label of expectedCardLabels) {
      await page.getByRole('link', { name: label, exact: true }).waitFor({ state: 'visible' })
    }

    assert.equal(await page.getByRole('heading', { name: 'Platform analytics', exact: true }).count(), 0)
    assert.equal(await page.getByRole('heading', { name: 'Banner controls', exact: true }).count(), 0)
    assert.equal(await page.getByRole('heading', { name: 'Platform admin staff', exact: true }).count(), 0)
    assert.equal(await page.getByText('Shared exports', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Audit events', { exact: true }).count(), 0)

    const staffCard = page.getByRole('link', { name: 'Staff accounts: View platform staff', exact: true })
    await staffCard.focus()
    await Promise.all([
      page.waitForURL('**/platform-staff'),
      page.keyboard.press('Enter'),
    ])
    await page.getByRole('heading', { name: 'Platform Staff', exact: true }).first().waitFor({ state: 'visible' })
    await context.close()
  })

  await runScenario('Platform Admin overview cards provide mobile tap navigation', async () => {
    const { context, page } = await prepareContext(browser, {
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    await openPlatformRoute(page, '/platform-admin', 'Platform dashboard')
    await Promise.all([
      page.waitForURL('**/platform-feedback'),
      page.getByRole('link', { name: 'Open platform issues: View platform feedback', exact: true }).tap(),
    ])
    await page.getByRole('heading', { name: 'Platform Feedback', exact: true }).first().waitFor({ state: 'visible' })
    await context.close()
  })

  await runScenario('focused Platform Admin routes preserve their authoritative controls', async () => {
    const { context, page } = await prepareContext(browser, { viewport: { width: 1440, height: 1000 } })
    await openPlatformRoute(page, '/platform-analytics', 'Platform Analytics')
    await page.getByRole('heading', { name: 'Platform analytics', exact: true }).waitFor({ state: 'visible' })

    await page.goto(`${baseUrl}/platform-banners`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Platform Banners', exact: true }).first().waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Banner controls', exact: true }).waitFor({ state: 'visible' })
    for (const audience of ['Landing pages', 'Logged-in users', 'Parent Portal']) {
      await page.getByRole('button', { name: new RegExp(audience, 'i') }).first().waitFor({ state: 'visible' })
    }

    await page.goto(`${baseUrl}/platform-staff`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Platform Staff', exact: true }).first().waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Staff access context', exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Platform admin staff', exact: true }).waitFor({ state: 'visible' })

    await page.goto(`${baseUrl}/platform-data-hygiene`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Data Hygiene', exact: true }).first().waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Data hygiene', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('button', { name: /delete|clean up|purge/i }).count(), 0)
    await context.close()
  })

  await runScenario('Platform Admin overview and issue reporting use theme tokens on desktop and mobile', async () => {
    for (const fixture of [
      { mode: 'theme-light', width: 1440, height: 1000 },
      { mode: 'theme-dark', width: 1440, height: 1000 },
      { mode: 'theme-light', width: 390, height: 844 },
      { mode: 'theme-dark', width: 390, height: 844 },
    ]) {
      const { context, page } = await prepareContext(browser, { viewport: { width: fixture.width, height: fixture.height } })
      await openPlatformRoute(page, '/platform-admin', 'Platform dashboard')
      await page.addStyleTag({
        content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
      })
      await page.evaluate((mode) => {
        document.documentElement.classList.remove('theme-light', 'theme-dark')
        document.body.classList.remove('theme-light', 'theme-dark')
        document.documentElement.classList.add(mode)
        document.body.classList.add(mode)
      }, fixture.mode)
      await page.waitForTimeout(50)

      const card = page.getByRole('link', { name: 'Clubs: View clubs', exact: true })
      const themeState = await card.evaluate((element) => {
        const styles = getComputedStyle(element)
        const reference = document.createElement('div')
        reference.style.backgroundColor = 'var(--panel-bg)'
        reference.style.color = 'var(--text-primary)'
        document.body.append(reference)
        const referenceStyles = getComputedStyle(reference)
        const expectedBackground = referenceStyles.backgroundColor
        const expectedColor = referenceStyles.color
        reference.remove()
        return {
          background: styles.backgroundColor,
          expectedBackground,
          color: styles.color,
          expectedColor,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          cardPanelVariable: styles.getPropertyValue('--panel-bg').trim(),
          className: element.className,
          bodyClassName: document.body.className,
          htmlClassName: document.documentElement.className,
        }
      })
      assert.equal(themeState.background, themeState.expectedBackground, JSON.stringify(themeState))
      assert.equal(themeState.color, themeState.expectedColor, JSON.stringify(themeState))
      assert.ok(themeState.overflow <= 1, `Unexpected ${fixture.mode} overflow at ${fixture.width}px: ${themeState.overflow}px`)
      await context.close()
    }

    const { context, page } = await prepareContext(browser, { viewport: { width: 1440, height: 1000 } })
    await openPlatformRoute(page, '/platform-feedback', 'Platform Feedback')
    await page.addStyleTag({
      content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
    })
    await page.evaluate(() => {
      document.documentElement.classList.remove('theme-dark')
      document.documentElement.classList.add('theme-light')
      document.body.classList.remove('theme-dark')
      document.body.classList.add('theme-light')
    })
    await page.waitForTimeout(50)
    const reportSection = page.getByRole('heading', { name: 'Production Report Issue submissions', exact: true }).locator('xpath=ancestor::section')
    const reportTheme = await reportSection.evaluate((element) => {
      const reference = document.createElement('div')
      reference.style.backgroundColor = 'var(--panel-bg)'
      document.body.append(reference)
      const expected = getComputedStyle(reference).backgroundColor
      reference.remove()
      return {
        background: getComputedStyle(element).backgroundColor,
        expected,
      }
    })
    assert.equal(reportTheme.background, reportTheme.expected)
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
