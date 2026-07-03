import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.AUTH_BROWSER_PORT || 4300 + Math.floor(Math.random() * 500))
const mainBaseUrl = `http://127.0.0.1:${port}`
const parentBaseUrl = `http://parent.footballplayer.online:${port}`

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForPort(host, port, timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const result = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port })
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

    if (result) {
      return
    }
  }

  throw new Error(`Timed out waiting for ${host}:${port}`)
}

async function waitForHttpOk(url, timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)

      if (response.ok) {
        return
      }
    } catch {
      // Vite can accept the port before the SPA route is ready.
    }

    await wait(250)
  }

  throw new Error(`Timed out waiting for ${url} to return HTTP 200`)
}

function startDevServer() {
  const env = {
    ...process.env,
    BROWSER: 'none',
    VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
    VITE_SUPABASE_URL: 'http://fixture.supabase.test',
    VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
  }
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 0.0.0.0 --port ${port} --strictPort`], {
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

async function preparePage(context) {
  let platformProbeCount = 0

  await context.route('**/.netlify/functions/platform-admin-access**', async (route) => {
    platformProbeCount += 1
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Fixture tests must not call platform admin access.' }),
    })
  })
  await context.route('**/.netlify/functions/**', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Fixture function stub.' }),
    })
  })
  await context.route('**/rest/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    })
  })
  await context.route('**/auth/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    })
  })

  const page = await context.newPage()

  page.on('pageerror', (error) => {
    throw error
  })

  return {
    page,
    getPlatformProbeCount: () => platformProbeCount,
  }
}

async function signIn(page, email, baseUrl = mainBaseUrl, access = 'club') {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 60000 })
  if (access === 'parent') {
    await page.getByRole('button', { name: 'Parent' }).click()
  } else {
    await page.getByRole('button', { name: 'Club' }).click()
  }
  await page.getByPlaceholder('you@club.com').fill(email)
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
}

async function parentSignIn(page, email, baseUrl = parentBaseUrl) {
  await page.goto(`${baseUrl}/parent-login`, { waitUntil: 'commit', timeout: 60000 })
  await page.getByPlaceholder('you@example.com').waitFor({ state: 'visible', timeout: 60000 })
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.getByRole('button', { name: /^Login$/ }).click()
}

async function assertVisibleText(page, text) {
  await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
}

async function assertVisibleTextContaining(page, text) {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout: 15000 })
}

async function assertSidebarFooterContract(page, { reportIssueExpected = true } = {}) {
  const sidebar = page.locator('aside')

  await assertNoSetupGuideTrigger(page)
  await sidebar.getByRole('button', { name: 'Sign out' }).waitFor({ state: 'visible', timeout: 15000 })

  if (reportIssueExpected) {
    await sidebar.getByText('Report issue', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
  }
}

async function assertNoSetupGuideTrigger(page) {
  assert.equal(await page.getByText('Open setup guide', { exact: true }).count(), 0)
}

async function openMobileNavigation(page) {
  const onboardingDialog = page.getByRole('dialog', { name: /Club setup|Setup/i })

  if (await onboardingDialog.count() > 0) {
    await onboardingDialog.getByRole('button', { name: 'Close' }).click()
    await onboardingDialog.waitFor({ state: 'detached', timeout: 15000 })
  }

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Close navigation' }).waitFor({ state: 'visible', timeout: 15000 })
}

async function assertSelectedOption(page, label, expectedText) {
  const value = await page.getByLabel(label).evaluate((select) => {
    const option = select.options[select.selectedIndex]
    return option ? option.textContent.trim() : ''
  })

  assert.equal(value, expectedText)
}

async function seedSelectedAccessMode(page, mode) {
  await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
  await page.evaluate((nextMode) => {
    window.sessionStorage.setItem('selected-access-mode', nextMode)
  }, mode)
}

async function runScenario(name, callback) {
  await callback()
  console.log(`ok ${name}`)
}

const server = startDevServer()
let browser

try {
  await waitForPort('127.0.0.1', port)
  await waitForHttpOk(`${mainBaseUrl}/sign-in`)

  browser = await chromium.launch({
    args: [
      '--host-resolver-rules=MAP parent.footballplayer.online 127.0.0.1',
    ],
  })

  await runScenario('platform admin login opens platform admin view', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'platform.fixture@footballplayer.test')
    await page.waitForURL('**/platform-admin', { timeout: 15000 })
    await assertVisibleText(page, 'Platform control')
    await assertVisibleText(page, 'Platform tools')
    await assertSelectedOption(page, 'Access view', 'Platform admin')
    await assertSidebarFooterContract(page)
    await context.close()
  })

  await runScenario('club admin login opens club-wide view', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'club.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    await assertVisibleText(page, 'Club tools')
    await assertSelectedOption(page, 'Access view', 'Club admin view')
    assert.equal(await page.getByRole('option', { name: 'Platform admin' }).count(), 0)
    await assertSidebarFooterContract(page)
    await context.close()
  })

  await runScenario('coach login opens team view', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'coach.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'U12 Fixture Team')
    await assertVisibleText(page, 'Team tools')
    assert.equal(await page.getByRole('option', { name: 'Platform admin' }).count(), 0)
    await assertSidebarFooterContract(page, { reportIssueExpected: false })
    await context.close()
  })

  await runScenario('parent portal login opens family view', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Family portal')
    await assertVisibleTextContaining(page, 'Fixture Child')
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('main parent tab resolves dual-access user to parent portal only', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test', mainBaseUrl, 'parent')
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Family portal')
    await assertVisibleTextContaining(page, 'Fixture Child')
    assert.equal(await page.getByText('This sign-in is for club staff', { exact: true }).count(), 0)
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('club tab resolves dual-access user to team workspace only', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test', mainBaseUrl, 'club')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    await assertVisibleText(page, 'Club tools')
    await assertSelectedOption(page, 'Access view', 'Team access')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Team workspace unavailable', { exact: true }).count(), 0)
    await assertSidebarFooterContract(page)
    await context.close()
  })

  await runScenario('parent-only account using club login sees club-specific guidance', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl, 'club')
    await assertVisibleText(page, 'This sign-in is for club staff')
    await assertVisibleText(page, "This sign-in is for club staff. Use Parent login to view your child's updates.")
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Choose where to continue', { exact: true }).count(), 0)
    await context.close()
  })

  await runScenario('staff-only account using parent login sees parent-specific guidance', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'coach.fixture@footballplayer.test', mainBaseUrl)
    await assertVisibleText(page, 'This sign-in is for parent access')
    await assertVisibleText(page, 'This sign-in is for parent access. Use Club login to manage your team workspace.')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Team workspace unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Choose where to continue', { exact: true }).count(), 0)
    await context.close()
  })

  await runScenario('stale parent mode does not override club login intent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await seedSelectedAccessMode(page, 'parent')
    await signIn(page, 'coach.fixture@footballplayer.test', mainBaseUrl, 'club')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Team tools')
    await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
    await context.close()
  })

  await runScenario('stale team mode does not override parent login intent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await seedSelectedAccessMode(page, 'team')
    await parentSignIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Family portal')
    await assertVisibleTextContaining(page, 'Fixture Child')
    await context.close()
  })

  await runScenario('dual-access parent fallback can recover to team workspace', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'fallback-dual.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Account details unavailable')
    await assertVisibleText(page, 'What this means')
    await assertVisibleText(page, 'Next step')
    await page.getByRole('button', { name: 'Open team workspace' }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'Open team workspace' }).click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Club admin view')
    await assertVisibleText(page, 'Club-wide view')
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('dual-access fallback recovery shows current team instead of stale family label', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'stale-label-dual.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Account details unavailable')
    await page.getByRole('button', { name: 'Open team workspace' }).click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'U17 Green')
    await assertSelectedOption(page, 'Access view', 'Team: U17 Green')
    assert.notEqual(await page.getByLabel('Access view').inputValue(), '__parent_portal__')
    await assertVisibleText(page, 'Team tools')
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('parent-only unavailable fallback does not expose team recovery', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'parent-unlinked.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Account details unavailable')
    await assertVisibleText(page, 'What this means')
    assert.equal(await page.getByRole('button', { name: 'Open team workspace' }).count(), 0)
    await page.getByRole('button', { name: 'Retry' }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'Sign in again' }).waitFor({ state: 'visible', timeout: 15000 })
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('parent portal sign out is visible and clears the fixture session', async () => {
    const desktopContext = await browser.newContext()
    const { page: desktopPage } = await preparePage(desktopContext)
    await parentSignIn(desktopPage, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await desktopPage.waitForURL('**/parent-portal', { timeout: 15000 })
    await desktopPage.getByRole('button', { name: /Sign out/ }).first().waitFor({ state: 'visible', timeout: 15000 })
    assert.ok(await desktopPage.getByRole('button', { name: /Sign out/ }).count() >= 2)
    assert.equal(await desktopPage.getByRole('button', { name: 'Open team workspace' }).count(), 0)
    await desktopPage.goto(`${mainBaseUrl}/parent-portal?section=settings`, { waitUntil: 'domcontentloaded' })
    await assertVisibleText(desktopPage, 'Parent settings')
    await desktopPage.getByRole('button', { name: /Sign out/ }).first().waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await desktopPage.getByRole('button', { name: 'Open team workspace' }).count(), 0)
    await desktopPage.getByRole('button', { name: /Sign out/ }).first().click()
    await desktopPage.waitForURL('**/parent-login', { timeout: 15000 })
    assert.equal(await desktopPage.evaluate(() => window.sessionStorage.getItem('auth-access-browser-fixture-email')), null)
    await desktopContext.close()

    const mobileContext = await browser.newContext({
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    const { page: mobilePage } = await preparePage(mobileContext)
    await parentSignIn(mobilePage, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await mobilePage.waitForURL('**/parent-portal', { timeout: 15000 })
    await mobilePage.locator('div.fixed').getByRole('button', { name: /Sign out/ }).waitFor({ state: 'visible', timeout: 15000 })
    await mobilePage.goto(`${mainBaseUrl}/parent-portal?section=settings`, { waitUntil: 'domcontentloaded' })
    await assertVisibleText(mobilePage, 'Parent settings')
    await mobilePage.locator('div.fixed').getByRole('button', { name: /Sign out/ }).waitFor({ state: 'visible', timeout: 15000 })
    await mobileContext.close()
  })

  await runScenario('multi-context user can switch between platform team and parent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await assertVisibleText(page, 'Club-wide view')

    await page.getByLabel('Access view').selectOption({ label: 'Team: U12 Fixture Team' })
    await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
    await assertVisibleText(page, 'Team tools')

    await page.getByLabel('Access view').selectOption({ label: 'Family portal' })
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Family portal')
    await page.getByLabel('Access view').waitFor({ state: 'detached', timeout: 15000 })
    assert.equal(await page.getByLabel('Access view').count(), 0)
    await page.getByRole('button', { name: 'Open team workspace' }).click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await assertVisibleText(page, 'Club-wide view')
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('team context with no active team shows Team access', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'teamless.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await assertVisibleText(page, 'Club-wide view')
    await assertSidebarFooterContract(page)
    await context.close()
  })

  await runScenario('parent host isolation prevents platform exposure and probing', async () => {
    const context = await browser.newContext()
    const { page, getPlatformProbeCount } = await preparePage(context)
    await parentSignIn(page, 'multi.fixture@footballplayer.test', parentBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleTextContaining(page, 'Fixture Child')
    assert.equal(await page.getByText('Platform admin', { exact: true }).count(), 0)
    assert.equal(getPlatformProbeCount(), 0)
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('mobile drawer omits setup guide and keeps footer actions', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const { page } = await preparePage(context)
    await signIn(page, 'platform.fixture@footballplayer.test')
    await page.waitForURL('**/platform-admin', { timeout: 15000 })
    await openMobileNavigation(page)
    await assertSidebarFooterContract(page)
    await context.close()
  })
} catch (error) {
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
