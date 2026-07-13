import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const port = Number(process.env.PARENT_CALENDAR_BROWSER_PORT || 4800 + Math.floor(Math.random() * 300))
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

  throw new Error(`Timed out waiting for local Vite port ${port}`)
}

function startDevServer() {
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`], {
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
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })

  return { child, getOutput: () => output }
}

async function stopDevServer(server) {
  if (server.child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.child.kill()
  }

  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

function dateAtOffset(offset, hour = 10) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

function invitationRow({
  id,
  offset,
  responseState,
  canRespond = false,
  invitationType = 'match_attendance',
  invitationState = 'active',
  roleType = '',
  selectionState = 'not_applicable',
  title,
}) {
  return {
    invitation_id: id,
    invitation_type: invitationType,
    source_record_id: id,
    source_type: 'match_day',
    source_event_type: 'match_day',
    event_id: `event-${id}`,
    event_type: 'match-day',
    event_title: title,
    event_start: dateAtOffset(offset),
    event_end: dateAtOffset(offset, 12),
    event_location: 'Fixture Ground',
    team_name: 'U12 Fixture Team',
    child_id: 'player-fixture',
    child_name: 'Fixture Child',
    parent_link_id: 'parent-link-fixture',
    role_type: roleType,
    invitation_state: invitationState,
    response_state: responseState,
    selection_state: selectionState,
    can_respond: canRespond,
    can_change_response: canRespond,
  }
}

const invitationRows = [
  invitationRow({ id: 'accepted', offset: 1, responseState: 'available', title: 'Accepted fixture' }),
  invitationRow({ id: 'declined', offset: 2, responseState: 'unavailable', title: 'Declined fixture' }),
  invitationRow({ id: 'pending', offset: 3, responseState: 'awaiting_response', canRespond: true, title: 'Response fixture' }),
  invitationRow({ id: 'info', offset: 4, responseState: 'not_required', title: 'Information fixture' }),
  invitationRow({
    id: 'selected',
    offset: 5,
    responseState: 'yes',
    invitationType: 'match_role',
    roleType: 'linesman',
    selectionState: 'selected',
    title: 'Confirmed role fixture',
  }),
  invitationRow({ id: 'past', offset: -1, responseState: 'available', title: 'Past accepted fixture' }),
  invitationRow({ id: 'cancelled', offset: 6, responseState: 'not_required', invitationState: 'cancelled', title: 'Cancelled fixture' }),
]

const matchRows = invitationRows.map((row) => ({
  id: row.event_id,
  club_id: 'club-fixture',
  team_id: 'team-u12',
  team_name: 'U12 Fixture Team',
  opponent: row.event_title,
  match_date: row.event_start.slice(0, 10),
  kickoff_time: '10:00',
  arrival_time: '09:30',
  home_away: 'home',
  venue_name: 'Fixture Ground',
  venue_address: '1 Fixture Road',
  parent_visible: true,
  parent_audience: 'involved_players',
  status: row.invitation_state === 'cancelled' ? 'cancelled' : 'scheduled',
}))

async function preparePage(context) {
  await context.route('**/rest/v1/**', (route) => {
    const requestUrl = route.request().url()
    const data = requestUrl.includes('/rpc/get_parent_portal_invitation_state')
      ? invitationRows
      : requestUrl.includes('/rpc/get_parent_portal_match_days')
        ? matchRows
        : []
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    })
  })
  await context.route('**/auth/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }))
  await context.route('**/.netlify/functions/**', (route) => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, message: 'Fixture function stub.' }),
  }))

  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  return { page, consoleErrors, pageErrors }
}

async function signInAndOpenCalendar(page) {
  await page.goto(`${baseUrl}/sign-in?tab=parent`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').fill('parent.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/parent-portal', { timeout: 15000 })
  await page.goto(`${baseUrl}/parent-portal?section=calendar`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('heading', { name: 'Activity' }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByLabel('Calendar status key').waitFor({ state: 'visible', timeout: 15000 })
}

function eventButton(page, status) {
  return page.locator(`button[aria-label*="Status: ${status}"]`).first()
}

const server = startDevServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ headless: true })

  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const desktop = await preparePage(desktopContext)
  await signInAndOpenCalendar(desktop.page)

  const accepted = eventButton(desktop.page, 'Accepted')
  const declined = eventButton(desktop.page, 'Declined')
  const pending = eventButton(desktop.page, 'Response needed')
  const information = eventButton(desktop.page, 'Information')
  const confirmed = eventButton(desktop.page, 'Confirmed')
  const past = eventButton(desktop.page, 'Past, Accepted')
  const cancelled = eventButton(desktop.page, 'Cancelled')

  for (const locator of [accepted, declined, pending, information, confirmed, past, cancelled]) {
    await locator.waitFor({ state: 'visible', timeout: 15000 })
  }

  assert.match(await accepted.getAttribute('class'), /bg-\[#f0fdf4\]/)
  assert.match(await declined.getAttribute('class'), /bg-\[#fef2f2\]/)
  assert.match(await pending.getAttribute('class'), /bg-\[#fffbeb\]/)
  assert.match(await information.getAttribute('class'), /bg-\[#eff6ff\]/)
  assert.match(await past.getAttribute('class'), /bg-\[#f8fafc\]/)
  assert.match(await cancelled.getAttribute('class'), /border-dashed/)

  await past.click()
  const modal = desktop.page.getByRole('dialog')
  await modal.waitFor({ state: 'visible' })
  await modal.getByText('Accepted', { exact: true }).waitFor({ state: 'visible' })
  await modal.getByRole('button', { name: 'Close' }).click()

  await desktop.page.getByRole('button', { name: 'Agenda' }).click()
  await eventButton(desktop.page, 'Response needed').waitFor({ state: 'visible' })
  assert.equal(await desktop.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.deepEqual(desktop.pageErrors, [])
  assert.deepEqual(desktop.consoleErrors, [])
  await desktopContext.close()

  const mobileContext = await browser.newContext({ isMobile: true, viewport: { width: 390, height: 844 } })
  const mobile = await preparePage(mobileContext)
  await signInAndOpenCalendar(mobile.page)
  await eventButton(mobile.page, 'Response needed').waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await mobile.page.getByRole('button', { name: 'Agenda' }).click()
  await mobile.page.getByText('Response needed', { exact: true }).first().waitFor({ state: 'visible' })
  await eventButton(mobile.page, 'Confirmed').click()
  await mobile.page.getByRole('dialog').waitFor({ state: 'visible' })
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.deepEqual(mobile.pageErrors, [])
  assert.deepEqual(mobile.consoleErrors, [])
  await mobileContext.close()

  console.log('Parent Calendar status browser checks passed on desktop and mobile month and agenda views.')
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
