import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const password = 'FixturePass123!'
const port = 4800 + Math.floor(Math.random() * 100)
const baseUrl = `http://127.0.0.1:${port}`

const roles = [
  ['role-admin', 'admin', 'Club Admin', 90],
  ['role-team-admin', 'head_manager', 'Team Admin', 70],
  ['role-manager', 'manager', 'Manager', 50],
  ['role-coach', 'coach', 'Coach', 30],
  ['role-assistant', 'assistant_coach', 'Assistant Coach', 20],
].map(([id, role_key, role_label, role_rank]) => ({
  id,
  club_id: 'club-fixture',
  role_key,
  role_label,
  role_rank,
  is_system: true,
}))

const users = [
  ['user-club.fixture@footballplayer.test', 'club.fixture@footballplayer.test', 'Club Fixture', 'admin', 'Club Admin', 90],
  ['user-team-admin.fixture@footballplayer.test', 'team-admin.fixture@footballplayer.test', 'Team Admin Fixture', 'head_manager', 'Team Admin', 70],
  ['user-manager.fixture@footballplayer.test', 'manager.fixture@footballplayer.test', 'Manager Fixture', 'manager', 'Manager', 50],
  ['user-coach-target', 'coach-target.fixture@footballplayer.test', 'Coach Target', 'coach', 'Coach', 30],
].map(([id, email, name, role, role_label, role_rank]) => ({
  id,
  email,
  username: name,
  name,
  display_name: name,
  role,
  role_label,
  role_rank,
  club_id: 'club-fixture',
  status: 'active',
  force_password_change: false,
  onboarding_enabled: false,
  onboarding_completed_steps: [],
}))

const teams = [
  { id: 'team-u12', club_id: 'club-fixture', name: 'U12 Fixture Team', status: 'active' },
  { id: 'team-u14', club_id: 'club-fixture', name: 'U14 Fixture Team', status: 'active' },
]

const assignments = [
  ['assignment-manager-u12', 'team-u12', 'user-manager.fixture@footballplayer.test', 'manager', 'Manager', 50],
  ['assignment-admin-u12', 'team-u12', 'user-team-admin.fixture@footballplayer.test', 'head_manager', 'Team Admin', 70],
  ['assignment-coach-u12', 'team-u12', 'user-coach-target', 'coach', 'Coach', 30],
  ['assignment-coach-u14', 'team-u14', 'user-coach-target', 'assistant_coach', 'Assistant Coach', 20],
].map(([id, team_id, user_id, role_key, role_label, role_rank]) => ({
  id,
  team_id,
  user_id,
  role_key,
  role_label,
  role_rank,
  created_at: '2026-07-31T12:00:00.000Z',
  updated_at: '2026-07-31T12:00:00.000Z',
}))

function startServer() {
  const output = []
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run dev -- --host 0.0.0.0 --port ${port} --strictPort`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
        VITE_APP_URL: baseUrl,
        VITE_PARENT_APP_URL: baseUrl,
      },
      windowsHide: true,
    },
  )
  child.stdout.on('data', (chunk) => output.push(chunk.toString()))
  child.stderr.on('data', (chunk) => output.push(chunk.toString()))
  return { child, output }
}

async function waitForServer(timeoutMs = 60000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const timer = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 250)
      socket.once('connect', () => {
        clearTimeout(timer)
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the Phase 13B browser server.')
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return
  const killer = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`],
    { windowsHide: true },
  )
  await once(killer, 'exit').catch(() => {})
}

async function preparePage(browser, contextOptions = {}) {
  const context = await browser.newContext(contextOptions)
  await context.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let body = []
    if (url.pathname.endsWith('/club_roles')) body = roles
    if (url.pathname.endsWith('/teams')) body = teams
    if (url.pathname.endsWith('/team_staff')) body = assignments
    if (url.pathname.endsWith('/users')) {
      body = url.searchParams.get('email')?.startsWith('in.') ? [] : users
    }
    if (url.pathname.endsWith('/club_user_invites')) body = []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await context.route('**/auth/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  const page = await context.newPage()
  return { context, page }
}

async function signIn(page, email) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 60000 })
  await page.getByRole('button', { name: 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill(email)
  await page.getByPlaceholder('Enter password').fill(password)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/coach', { timeout: 30000 })
  await page.goto(`${baseUrl}/user-access`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('heading', { name: 'Active users' }).waitFor({ state: 'visible', timeout: 30000 })
}

async function optionLabels(locator) {
  return locator.locator('option').allTextContents()
}

const server = startServer()
let browser

try {
  await waitForServer()
  browser = await chromium.launch()

  {
    const { context, page } = await preparePage(browser)
    await signIn(page, 'manager.fixture@footballplayer.test')
    const selector = page.getByLabel('Team role for Coach Target in U12 Fixture Team')
    await selector.waitFor({ state: 'visible' })
    assert.deepEqual(await optionLabels(selector), ['Manager', 'Coach', 'Assistant Coach'])
    assert.equal(await page.getByText('U14 Fixture Team', { exact: true }).count(), 0)
    assert.equal(await page.getByLabel('Club role for Coach Target').count(), 0)
    await selector.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Confirm team role change' }).waitFor({ state: 'visible' })
    assert.match(await page.getByRole('dialog').innerText(), /New role\s+Manager/i)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await context.close()
    console.log('ok Manager normal Team User Access ceiling and keyboard confirmation')
  }

  {
    const { context, page } = await preparePage(browser)
    await signIn(page, 'team-admin.fixture@footballplayer.test')
    const selector = page.getByLabel('Team role for Coach Target in U12 Fixture Team')
    await selector.waitFor({ state: 'visible' })
    assert.deepEqual(await optionLabels(selector), ['Team Admin', 'Manager', 'Coach', 'Assistant Coach'])
    assert.equal((await optionLabels(selector)).includes('Club Admin'), false)
    await context.close()
    console.log('ok Team Admin normal Team User Access ceiling')
  }

  {
    const { context, page } = await preparePage(browser)
    await signIn(page, 'club.fixture@footballplayer.test')
    const clubSelector = page.getByLabel('Club role for Coach Target')
    await clubSelector.waitFor({ state: 'visible' })
    assert.equal((await optionLabels(clubSelector)).includes('Platform Admin'), false)
    const firstTeamSelector = page.getByLabel('Team role for Coach Target in U12 Fixture Team')
    const secondTeamSelector = page.getByLabel('Team role for Coach Target in U14 Fixture Team')
    await firstTeamSelector.waitFor({ state: 'visible' })
    await secondTeamSelector.waitFor({ state: 'visible' })
    assert.equal(await firstTeamSelector.inputValue(), 'coach')
    assert.equal(await secondTeamSelector.inputValue(), 'assistant_coach')
    await clubSelector.selectOption('manager')
    await page.locator('button:not([disabled])', { hasText: 'Review club role change' }).click()
    await page.getByRole('heading', { name: 'Confirm club role change' }).waitFor({ state: 'visible' })
    assert.match(await page.getByRole('dialog').innerText(), /Team assignments\s+Existing team roles remain unchanged\./i)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await context.close()
    console.log('ok Club Admin club and independent team assignment controls')
  }

  {
    const { context, page } = await preparePage(browser, {
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    await signIn(page, 'manager.fixture@footballplayer.test')
    await page.getByLabel('Team role for Coach Target in U12 Fixture Team').waitFor({ state: 'visible' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await context.close()
    console.log('ok mobile Team User Access has no horizontal overflow')
  }
} catch (error) {
  console.error(server.output.join(''))
  throw error
} finally {
  await browser?.close()
  await stopServer(server)
}
