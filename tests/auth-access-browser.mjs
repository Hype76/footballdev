import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.AUTH_BROWSER_PORT || 4300 + Math.floor(Math.random() * 500))
const mainBaseUrl = `http://127.0.0.1:${port}`
const parentBaseUrl = `http://parent.footballplayer.online:${port}`
const parentThemeScreenshotDirectory = 'outputs/fp-v1-parent-portal-themes-release-04e'
await mkdir(parentThemeScreenshotDirectory, { recursive: true })
const parentThemeMatrix = [
  { accent: 'green', label: 'light-default', mode: 'light' },
  { accent: 'green', label: 'dark-default', mode: 'dark' },
  { accent: 'purple', label: 'light-custom', mode: 'light' },
  { accent: 'purple', label: 'dark-custom', mode: 'dark' },
]
const parentThemeRoutes = [
  { label: 'overview', path: '/parent-portal?section=overview', scopeTestId: 'parent-portal-page' },
  { label: 'calendar', path: '/parent-portal?section=calendar', scopeTestId: 'parent-portal-page' },
  { label: 'invites', path: '/parent-portal?section=invites', scopeTestId: 'parent-portal-page' },
  { label: 'matches', path: '/parent-portal?section=matches', scopeTestId: 'parent-portal-page' },
  { label: 'results', path: '/parent-portal?section=results', scopeTestId: 'parent-portal-page' },
  { label: 'resources', path: '/parent-portal?section=resources', scopeTestId: 'parent-portal-page' },
  { label: 'settings', path: '/parent-portal?section=settings', scopeTestId: 'parent-portal-page' },
  { label: 'chat', path: '/parent-chat', scopeTestId: 'parent-portal-route-shell' },
  { label: 'polls', path: '/parent-polls', scopeTestId: 'parent-portal-route-shell' },
  { label: 'friends-family', path: '/friends-family', scopeTestId: 'parent-portal-route-shell' },
]

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
    VITE_APP_URL: mainBaseUrl,
    VITE_PARENT_APP_URL: parentBaseUrl,
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

async function prepareClubAccentPage(context) {
  const prepared = await preparePage(context)
  const requests = []
  let themeAccent = 'green'

  await context.route('**/rest/v1/clubs**', async (route) => {
    const request = route.request()

    if (request.method() === 'PATCH') {
      const payload = request.postDataJSON()
      themeAccent = String(payload?.theme_accent ?? themeAccent)
      requests.push({
        method: request.method(),
        payload,
        url: request.url(),
      })
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'club-fixture',
        name: 'Fixture United',
        logo_url: '',
        contact_email: 'club.fixture@footballplayer.test',
        contact_phone: '',
        require_approval: true,
        theme_accent: themeAccent,
        status: 'active',
        suspended_at: null,
        plan_key: 'small_club',
        plan_status: 'active',
        is_plan_comped: true,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_price_id: null,
        current_period_end: null,
        plan_updated_at: null,
        tester_access_code_id: null,
        tester_access_code: null,
        tester_access_email: null,
        tester_access_redeemed_at: null,
        tester_access_expires_at: null,
        onboarding_enabled: true,
        onboarding_completed_steps: [],
        onboarding_dismissed_at: null,
        onboarding_reset_at: null,
      }),
    })
  })

  return {
    ...prepared,
    getAccentRequests: () => requests,
    getThemeAccent: () => themeAccent,
  }
}

async function prepareParentInvitePage(context) {
  const prepared = await preparePage(context)
  let acceptanceCallCount = 0

  await context.route('**/.netlify/functions/get-parent-invite**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        invite: {
          email: 'parent.fixture@footballplayer.test',
          playerName: 'Fixture Child',
          teamName: 'U12 Fixture Team',
          clubName: 'Fixture United',
        },
      }),
    })
  })
  await context.route('**/rest/v1/rpc/accept_parent_player_link', async (route) => {
    acceptanceCallCount += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'parent-link-fixture' }]),
    })
  })
  await context.route('**/rest/v1/parent_player_links**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'parent-link-fixture',
        club_id: 'club-fixture',
        team_id: 'team-u12',
        player_id: 'player-fixture',
        link_type: 'parent',
        email: 'parent.fixture@footballplayer.test',
        status: 'active',
        players: {
          player_name: 'Fixture Child',
          section: 'Squad',
          team: 'U12 Fixture Team',
        },
        teams: {
          name: 'U12 Fixture Team',
          theme_mode: 'system',
          theme_accent: 'green',
          theme_button_style: 'solid',
        },
        clubs: {
          name: 'Fixture United',
        },
      }),
    })
  })

  return {
    ...prepared,
    getAcceptanceCallCount: () => acceptanceCallCount,
  }
}

async function prepareParentInviteStatePage(context, {
  invite = null,
  message = '',
  status = 200,
} = {}) {
  const prepared = await preparePage(context)

  await context.route('**/.netlify/functions/get-parent-invite**', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(invite
        ? { success: true, invite }
        : { success: false, message }),
    })
  })

  return prepared
}

async function prepareDemoPage(context, response = { status: 200, body: { success: true } }) {
  const prepared = await preparePage(context)
  const resetRequests = []

  await context.route('**/.netlify/functions/reset-demo-account', async (route) => {
    const request = route.request()
    resetRequests.push({
      method: request.method(),
      headers: request.headers(),
      body: request.postDataJSON(),
    })
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })

  return {
    ...prepared,
    getResetRequests: () => resetRequests,
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
  await page.goto(`${baseUrl}/sign-in?tab=parent`, { waitUntil: 'commit', timeout: 60000 })
  await page.getByPlaceholder('you@club.com').waitFor({ state: 'visible', timeout: 60000 })
  await page.getByRole('button', { name: 'Parent' }).waitFor({ state: 'visible', timeout: 60000 })
  await page.getByRole('button', { name: 'Parent' }).click()
  await page.getByPlaceholder('you@club.com').fill(email)
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
}

async function assertVisibleText(page, text) {
  await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
}

async function assertVisibleTextContaining(page, text) {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout: 15000 })
}

async function assertLoginAccessStateCleared(page) {
  const accessState = await page.evaluate(() => ({
    selectedAccessMode: window.sessionStorage.getItem('selected-access-mode'),
    selectedAccessModeExplicit: window.sessionStorage.getItem('selected-access-mode-explicit'),
    selectedTeamId: window.sessionStorage.getItem('selected-team-id'),
    loginAccessIntent: window.sessionStorage.getItem('login-access-intent'),
  }))

  assert.deepEqual(accessState, {
    selectedAccessMode: null,
    selectedAccessModeExplicit: null,
    selectedTeamId: null,
    loginAccessIntent: null,
  })
}

async function assertSidebarFooterContract(page, { reportIssueExpected = true } = {}) {
  const sidebar = page.locator('aside')

  await assertNoSetupGuideTrigger(page)
  await sidebar.getByRole('link', { name: 'Settings' }).waitFor({ state: 'visible', timeout: 15000 })
  await sidebar.getByRole('button', { name: 'Sign out' }).waitFor({ state: 'visible', timeout: 15000 })

  if (reportIssueExpected) {
    await sidebar.getByText('Report issue', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
  }
}

async function assertHeaderContextPanelRemoved(page) {
  const header = page.locator('header')

  await header.waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(await header.getByText('View', { exact: true }).count(), 0)
  assert.equal(await header.getByText('Focus', { exact: true }).count(), 0)
  assert.equal(await header.getByText('Team tools', { exact: true }).count(), 0)
  assert.equal(await header.getByLabel('Access view').count(), 0)
  assert.equal(await header.getByRole('link', { name: 'Settings' }).count(), 0)
  assert.equal(await header.getByRole('button', { name: /Sign out/ }).count(), 0)
}

async function assertSidebarWorkspaceControls(page, { accessViewExpected = true } = {}) {
  const sidebar = page.locator('aside')

  if (accessViewExpected) {
    await sidebar.getByLabel('Access view').waitFor({ state: 'visible', timeout: 15000 })
  }

  await sidebar.getByRole('link', { name: 'Settings' }).waitFor({ state: 'visible', timeout: 15000 })
  await sidebar.getByRole('button', { name: 'Sign out' }).waitFor({ state: 'visible', timeout: 15000 })
}

async function assertNoSetupGuideTrigger(page) {
  assert.equal(await page.getByText('Open setup guide', { exact: true }).count(), 0)
}

async function closeOnboardingDialog(page) {
  const onboardingDialog = page.getByRole('dialog', { name: /Club setup|Setup/i })

  if (await onboardingDialog.count() > 0) {
    await onboardingDialog.getByRole('button', { name: 'Close' }).click()
    await onboardingDialog.waitFor({ state: 'detached', timeout: 15000 })
  }
}

async function openMobileNavigation(page) {
  await closeOnboardingDialog(page)
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

async function waitForPathname(page, pathname) {
  await page.waitForFunction((expectedPathname) => window.location.pathname === expectedPathname, pathname, {
    timeout: 15000,
  })
}

async function seedSelectedAccessMode(page, mode) {
  await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
  await page.evaluate((nextMode) => {
    window.sessionStorage.setItem('selected-access-mode', nextMode)
  }, mode)
}

async function applyTheme(page, { accent, mode }) {
  await page.evaluate(({ nextAccent, nextMode }) => {
    const modeClasses = ['theme-light', 'theme-dark']
    const accentClasses = ['accent-yellow', 'accent-blue', 'accent-green', 'accent-red', 'accent-purple']
    const buttonClasses = ['button-style-solid', 'button-style-gradient']
    const elements = [document.documentElement, document.body]

    window.localStorage.setItem('app-theme-mode', nextMode)
    window.localStorage.setItem('app-theme-accent', nextAccent)
    window.localStorage.setItem('app-theme-button-style', 'solid')
    for (const element of elements) {
      element.classList.remove(...modeClasses, ...accentClasses, ...buttonClasses)
      element.classList.add(`theme-${nextMode}`, `accent-${nextAccent}`, 'button-style-solid')
    }
    document.documentElement.dataset.themeAccent = nextAccent
    document.documentElement.dataset.buttonStyle = 'solid'
    window.dispatchEvent(new CustomEvent('app-theme-changed', {
      detail: {
        accent: nextAccent,
        buttonStyle: 'solid',
        mode: nextMode,
      },
    }))
  }, { nextAccent: accent, nextMode: mode })
  await page.waitForFunction(({ nextAccent, nextMode }) => (
    document.documentElement.classList.contains(`theme-${nextMode}`)
    && document.documentElement.classList.contains(`accent-${nextAccent}`)
    && document.body.classList.contains(`theme-${nextMode}`)
    && document.body.classList.contains(`accent-${nextAccent}`)
    && document.documentElement.dataset.themeAccent === nextAccent
  ), { nextAccent: accent, nextMode: mode })
  await page.waitForTimeout(350)
  await page.waitForFunction(({ nextAccent, nextMode }) => (
    document.documentElement.classList.contains(`theme-${nextMode}`)
    && document.documentElement.classList.contains(`accent-${nextAccent}`)
    && document.documentElement.dataset.themeAccent === nextAccent
  ), { nextAccent: accent, nextMode: mode })
}

async function auditParentTheme(page, { accent, label, mode, scopeTestId }) {
  const audit = await page.evaluate(({ expectedScopeTestId }) => {
    function parseRgb(value) {
      const channels = String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number)
      return channels?.length === 3 ? channels : null
    }

    function luminance(rgb) {
      const channels = rgb.map((value) => {
        const normalized = value / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
    }

    function contrastRatio(foreground, background) {
      const foregroundRgb = parseRgb(foreground)
      const backgroundRgb = parseRgb(background)
      if (!foregroundRgb || !backgroundRgb) return 0
      const foregroundLuminance = luminance(foregroundRgb)
      const backgroundLuminance = luminance(backgroundRgb)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    function inheritedBackground(element) {
      let current = element
      while (current) {
        const background = getComputedStyle(current).backgroundColor
        if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') {
          return background
        }
        current = current.parentElement
      }
      return getComputedStyle(document.body).backgroundColor
    }

    function resolveColor(value) {
      const probe = document.createElement('span')
      probe.style.color = value
      probe.style.position = 'fixed'
      probe.style.visibility = 'hidden'
      document.body.append(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      return resolved
    }

    function sample(selector) {
      const element = document.querySelector(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      const background = inheritedBackground(element)
      return {
        background,
        foreground: style.color,
        ratio: contrastRatio(style.color, background),
      }
    }

    function mappedColor(scope, selector, property) {
      const element = scope.querySelector(selector)
      return element ? getComputedStyle(element)[property] : null
    }

    const scope = document.querySelector(`[data-testid="${expectedScopeTestId}"]`)
    const root = getComputedStyle(document.documentElement)
    if (!scope) {
      return { scopePresent: false }
    }

    const tokens = {
      accent: resolveColor(root.getPropertyValue('--accent').trim()),
      accentSoft: resolveColor(root.getPropertyValue('--accent-soft').trim()),
      buttonPrimary: resolveColor(root.getPropertyValue('--button-primary').trim()),
      buttonPrimaryText: resolveColor(root.getPropertyValue('--button-primary-text').trim()),
      panelAlt: resolveColor(root.getPropertyValue('--panel-alt').trim()),
      panelBackground: resolveColor(root.getPropertyValue('--panel-bg').trim()),
      textMuted: resolveColor(root.getPropertyValue('--text-muted').trim()),
      textPrimary: resolveColor(root.getPropertyValue('--text-primary').trim()),
      textSecondary: resolveColor(root.getPropertyValue('--text-secondary').trim()),
    }

    return {
      accent: document.documentElement.dataset.themeAccent,
      documentOverflows: document.documentElement.scrollWidth > window.innerWidth,
      mapped: {
        accentBackground: mappedColor(
          scope,
          '[class~="bg-[#ecfdf5]"]:not([class~="bg-white"]):not([class~="bg-[#f7faf8]"]), [class~="bg-[#bbf7d0]"]:not([class~="bg-white"]):not([class~="bg-[#f7faf8]"])',
          'backgroundColor',
        ),
        accentButton: mappedColor(scope, '[class~="bg-[#047857]"]', 'backgroundColor'),
        accentButtonText: mappedColor(scope, '[class~="bg-[#047857]"]', 'color'),
        accentText: mappedColor(scope, '[class~="text-[#047857]"]', 'color'),
        mutedText: mappedColor(scope, '[class~="text-[#4b5f55]"]', 'color'),
        panelAlt: mappedColor(
          scope,
          '[class~="bg-[#f7faf8]"]:not([class~="bg-white"]):not([class~="bg-[#ecfdf5]"])',
          'backgroundColor',
        ),
        panelBackground: mappedColor(
          scope,
          '[class~="bg-white"]:not([class~="bg-[#f7faf8]"]):not([class~="bg-[#ecfdf5]"])',
          'backgroundColor',
        ),
        primaryText: mappedColor(scope, '[class~="text-[#101828]"]', 'color'),
      },
      samples: {
        accent: sample(`[data-testid="${expectedScopeTestId}"] [class~="text-[#047857]"]`),
        button: sample(`[data-testid="${expectedScopeTestId}"] [class~="bg-[#047857]"]`),
        heading: sample(`[data-testid="${expectedScopeTestId}"] h1, [data-testid="${expectedScopeTestId}"] h2`),
        muted: sample(`[data-testid="${expectedScopeTestId}"] [class~="text-[#4b5f55]"]`),
      },
      scopePresent: true,
      tokens,
    }
  }, { expectedScopeTestId: scopeTestId })

  assert.equal(audit.scopePresent, true, `${label} has the Parent theme scope`)
  assert.equal(audit.accent, accent, `${label} applies ${accent}`)
  assert.equal(audit.documentOverflows, false, `${label} stays within the viewport`)

  const mappingPairs = [
    ['accentBackground', 'accentSoft'],
    ['accentButton', 'buttonPrimary'],
    ['accentButtonText', 'buttonPrimaryText'],
    ['accentText', 'textSecondary'],
    ['mutedText', 'textMuted'],
    ['panelAlt', 'panelAlt'],
    ['panelBackground', 'panelBackground'],
    ['primaryText', 'textPrimary'],
  ]
  for (const [mappedName, tokenName] of mappingPairs) {
    if (audit.mapped[mappedName]) {
      assert.equal(audit.mapped[mappedName], audit.tokens[tokenName], `${label} maps ${mappedName}`)
    }
  }

  for (const [sampleName, sample] of Object.entries(audit.samples)) {
    if (sample) {
      assert.ok(sample.ratio >= 4.5, `${label} ${sampleName} contrast ${sample.ratio.toFixed(2)} is at least 4.5`)
    }
  }

  return audit
}

async function auditStandaloneTheme(page, { label }) {
  const audit = await page.evaluate(() => {
    function parseRgb(value) {
      const channels = String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number)
      return channels?.length === 3 ? channels : null
    }

    function luminance(rgb) {
      const channels = rgb.map((value) => {
        const normalized = value / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
    }

    function contrastRatio(foreground, background) {
      const foregroundRgb = parseRgb(foreground)
      const backgroundRgb = parseRgb(background)
      if (!foregroundRgb || !backgroundRgb) return 0
      const foregroundLuminance = luminance(foregroundRgb)
      const backgroundLuminance = luminance(backgroundRgb)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    const heading = document.querySelector('main h1, main h2')
    const panel = heading?.closest('section, div')
    const button = document.querySelector('main button:not([disabled])')
    return {
      buttonRatio: button
        ? contrastRatio(getComputedStyle(button).color, getComputedStyle(button).backgroundColor)
        : null,
      documentOverflows: document.documentElement.scrollWidth > window.innerWidth,
      headingRatio: heading && panel
        ? contrastRatio(getComputedStyle(heading).color, getComputedStyle(panel).backgroundColor)
        : null,
    }
  })

  assert.equal(audit.documentOverflows, false, `${label} stays within the viewport`)
  if (audit.headingRatio) {
    assert.ok(audit.headingRatio >= 4.5, `${label} heading contrast is at least 4.5`)
  }
  if (audit.buttonRatio) {
    assert.ok(audit.buttonRatio >= 4.5, `${label} button contrast is at least 4.5`)
  }
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
    await assertHeaderContextPanelRemoved(page)
    await assertSidebarWorkspaceControls(page)
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
    await assertHeaderContextPanelRemoved(page)
    await assertSidebarWorkspaceControls(page)
    await assertSidebarFooterContract(page)
    await context.close()
  })

  for (const viewport of [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    await runScenario(`${viewport.name} club accent saves, reloads, survives sign-in, and does not leak`, async () => {
      const context = await browser.newContext(viewport.options)
      const { getAccentRequests, getThemeAccent, page } = await prepareClubAccentPage(context)
      await signIn(page, 'club.fixture@footballplayer.test')
      await page.waitForURL('**/coach', { timeout: 15000 })
      await page.goto(`${mainBaseUrl}/user-settings`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.getByLabel('Accent colour').waitFor({ state: 'visible', timeout: 15000 })
      await page.getByLabel('Accent colour').selectOption('purple')
      await assertVisibleText(page, 'The club accent colour has been saved.')

      assert.equal(getThemeAccent(), 'purple')
      assert.equal(getAccentRequests().length, 1)
      assert.deepEqual(getAccentRequests()[0].payload, { theme_accent: 'purple' })
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-purple')), true)
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--button-primary').trim()),
        '#7c3aed',
      )

      await page.getByLabel('Theme').selectOption('dark')
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-dark')), true)
      await page.getByLabel('Theme').selectOption('light')
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-light')), true)

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.getByLabel('Accent colour').waitFor({ state: 'visible', timeout: 15000 })
      await assertSelectedOption(page, 'Accent colour', 'Purple')
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-purple')), true)

      await page.getByLabel('Access view').selectOption({ label: 'Team: U12 Fixture Team' })
      await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-purple')), true)

      await closeOnboardingDialog(page)
      if (viewport.name === 'mobile') {
        await openMobileNavigation(page)
      }
      await page.locator('aside').getByRole('button', { name: 'Sign out' }).click()
      await waitForPathname(page, '/sign-in')
      await signIn(page, 'club.fixture@footballplayer.test')
      await page.waitForURL('**/coach', { timeout: 15000 })
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-purple')), true)

      await closeOnboardingDialog(page)
      if (viewport.name === 'mobile') {
        await openMobileNavigation(page)
      }
      await page.locator('aside').getByRole('button', { name: 'Sign out' }).click()
      await waitForPathname(page, '/sign-in')
      await signIn(page, 'manager.fixture@footballplayer.test')
      await page.waitForURL('**/coach', { timeout: 15000 })
      await page.waitForFunction(() => document.documentElement.classList.contains('accent-green'), null, {
        timeout: 15000,
      })
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('accent-green')), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await context.close()
    })
  }

  await runScenario('coach login opens team view', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'coach.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'U12 Fixture Team')
    await assertVisibleText(page, 'Team tools')
    assert.equal(await page.getByRole('option', { name: 'Platform admin' }).count(), 0)
    await assertHeaderContextPanelRemoved(page)
    await assertSidebarWorkspaceControls(page, { accessViewExpected: false })
    await assertSidebarFooterContract(page, { reportIssueExpected: false })
    await context.close()
  })

  for (const viewport of [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    await runScenario(`${viewport.name} demo login authenticates without a browser reset request`, async () => {
      const context = await browser.newContext(viewport.options)
      const { getResetRequests, page } = await prepareDemoPage(context)
      await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      const demoButton = page.getByRole('button', { name: /^Open demo account$/i })
      await demoButton.waitFor({ state: 'visible', timeout: 15000 })
      await demoButton.click()
      await page.waitForURL('**/coach', { timeout: 15000 })
      await assertVisibleText(page, 'Club-wide view')

      const resetRequests = getResetRequests()
      assert.equal(resetRequests.length, 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await context.close()
    })
  }

  await runScenario('stale parent mode staff session at root opens team view', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
    await page.evaluate(() => {
      window.sessionStorage.setItem('auth-access-browser-fixture-email', 'coach.fixture@footballplayer.test')
      window.sessionStorage.setItem('selected-access-mode', 'parent')
      window.sessionStorage.removeItem('login-access-intent')
    })
    await page.goto(`${mainBaseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'U12 Fixture Team')
    await assertVisibleText(page, 'Team tools')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Parent portal', { exact: true }).count(), 0)
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

  for (const viewport of [
    {
      evidenceTheme: 'dark-custom',
      name: 'desktop',
      options: { viewport: { width: 1440, height: 900 } },
    },
    {
      evidenceTheme: 'light-custom',
      name: 'tablet',
      options: { viewport: { width: 820, height: 1180 } },
    },
    {
      evidenceTheme: 'dark-default',
      name: 'mobile',
      options: { isMobile: true, viewport: { width: 390, height: 844 } },
    },
  ]) {
    await runScenario(`${viewport.name} Parent route and theme audit matrix`, async () => {
      const context = await browser.newContext(viewport.options)
      const { page } = await preparePage(context)
      const consoleErrors = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })

      await parentSignIn(page, 'parent-multiple.fixture@footballplayer.test', mainBaseUrl)
      await page.waitForURL('**/parent-portal', { timeout: 15000 })
      await assertVisibleTextContaining(page, 'Fixture Child')
      await page.getByRole('option', { name: /Second Fixture Child/ }).waitFor({ state: 'attached', timeout: 15000 })
      assert.equal(await page.getByRole('option', { name: /Second Fixture Child/ }).count(), 1)

      for (const route of parentThemeRoutes) {
        await page.goto(`${mainBaseUrl}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.getByTestId(route.scopeTestId).waitFor({ state: 'visible', timeout: 15000 })
        await page.waitForTimeout(150)

        for (const theme of parentThemeMatrix) {
          await applyTheme(page, theme)
          await auditParentTheme(page, {
            ...theme,
            label: `${viewport.name} ${route.label} ${theme.label}`,
            scopeTestId: route.scopeTestId,
          })

          const shouldCapture = theme.label === viewport.evidenceTheme
            || (route.label === 'overview' && ['light-default', 'dark-custom'].includes(theme.label))
          if (shouldCapture) {
            await page.screenshot({
              path: `${parentThemeScreenshotDirectory}/parent-${viewport.name}-${route.label}-${theme.label}.png`,
              fullPage: true,
            })
          }
        }
      }

      assert.deepEqual(consoleErrors, [])
      await context.close()
    })
  }

  for (const viewport of [
    { evidenceTheme: 'dark-custom', name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { evidenceTheme: 'light-custom', name: 'tablet', options: { viewport: { width: 820, height: 1180 } } },
    { evidenceTheme: 'dark-default', name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    for (const inviteState of [
      {
        invite: {
          email: 'parent.fixture@footballplayer.test',
          playerName: 'Fixture Child',
          teamName: 'U12 Fixture Team',
          clubName: 'Fixture United',
        },
        label: 'valid',
        message: '',
        status: 200,
        visibleText: 'Create your family portal login',
      },
      {
        invite: null,
        label: 'expired',
        message: 'This parent invite has expired. Please ask the club to send a new invite.',
        status: 410,
        visibleText: 'This parent invite has expired.',
      },
      {
        invite: null,
        label: 'invalid',
        message: 'This access link is not available. Please ask the club to send a new invite.',
        status: 404,
        visibleText: 'This access link is not available.',
      },
    ]) {
      await runScenario(`${viewport.name} ${inviteState.label} Parent invite theme matrix`, async () => {
        const context = await browser.newContext(viewport.options)
        const { page } = await prepareParentInviteStatePage(context, inviteState)
        await page.goto(`${mainBaseUrl}/parent-invite/theme-audit-token`, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        })
        await page.getByTestId('parent-invite-shell').waitFor({ state: 'visible', timeout: 15000 })
        await assertVisibleTextContaining(page, inviteState.visibleText)

        for (const theme of parentThemeMatrix) {
          await applyTheme(page, theme)
          await auditParentTheme(page, {
            ...theme,
            label: `${viewport.name} ${inviteState.label} invite ${theme.label}`,
            scopeTestId: 'parent-invite-shell',
          })
          if (theme.label === viewport.evidenceTheme) {
            await page.screenshot({
              path: `${parentThemeScreenshotDirectory}/parent-invite-${viewport.name}-${inviteState.label}-${theme.label}.png`,
              fullPage: true,
            })
          }
        }

        await context.close()
      })
    }
  }

  for (const viewport of [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', options: { viewport: { width: 820, height: 1180 } } },
    { name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    await runScenario(`${viewport.name} Parent sign-in continuation remains readable in every theme`, async () => {
      const context = await browser.newContext(viewport.options)
      const { page } = await preparePage(context)
      await page.goto(`${mainBaseUrl}/sign-in?tab=parent&parentInvite=theme-audit-token`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      await page.getByRole('heading', { name: 'Sign in to parent access' }).waitFor({ state: 'visible', timeout: 15000 })
      assert.equal(new URL(page.url()).searchParams.get('parentInvite'), 'theme-audit-token')

      for (const theme of parentThemeMatrix) {
        await applyTheme(page, theme)
        await auditStandaloneTheme(page, { label: `${viewport.name} Parent sign-in ${theme.label}` })
        if (['light-default', 'dark-custom'].includes(theme.label)) {
          await page.screenshot({
            path: `${parentThemeScreenshotDirectory}/parent-sign-in-${viewport.name}-${theme.label}.png`,
            fullPage: true,
          })
        }
      }

      await context.close()
    })
  }

  await runScenario('main parent tab resolves dual-access user to parent portal only', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test', mainBaseUrl, 'parent')
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await assertVisibleText(page, 'Family portal')
    await assertVisibleTextContaining(page, 'Fixture Child')
    assert.equal(await page.getByText(/sign-in is for club staff/i).count(), 0)
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

  await runScenario('parent-only account using club login returns safely to club sign-in', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl, 'club')
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), null)
    await page.getByRole('button', { name: 'Club' }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Choose where to continue', { exact: true }).count(), 0)
    await context.close()
  })

  await runScenario('staff-only account using parent login returns safely to parent sign-in', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'coach.fixture@footballplayer.test', mainBaseUrl)
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    await page.getByRole('button', { name: 'Parent' }).waitFor({ state: 'visible', timeout: 15000 })
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

  await runScenario('failed club login clears stale parent access intent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await seedSelectedAccessMode(page, 'parent')
    await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
    await page.getByRole('button', { name: 'Club' }).click()
    await page.getByPlaceholder('you@club.com').fill('coach.fixture@footballplayer.test')
    await page.getByPlaceholder('Enter password').fill('WrongFixturePass123!')
    await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
    await assertVisibleText(page, 'Fixture login failed.')
    await waitForPathname(page, '/sign-in')
    assert.equal(await page.getByText('Login again before creating your club').count(), 0)
    await assertLoginAccessStateCleared(page)
    await context.close()
  })

  await runScenario('failed parent login clears stale team access intent', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await seedSelectedAccessMode(page, 'team')
    await page.goto(`${mainBaseUrl}/sign-in?tab=parent`, { waitUntil: 'commit', timeout: 60000 })
    await page.getByRole('button', { name: 'Parent' }).click()
    await page.getByPlaceholder('you@club.com').fill('parent.fixture@footballplayer.test')
    await page.getByPlaceholder('Enter password').fill('WrongFixturePass123!')
    await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
    await assertVisibleText(page, 'Fixture login failed.')
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    assert.equal(await page.getByText('Login again before creating your club').count(), 0)
    await assertLoginAccessStateCleared(page)
    await context.close()
  })

  await runScenario('legacy parent login routes redirect to unified parent sign-in', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await page.goto(`${mainBaseUrl}/parent-login?parentInvite=fixture-token&confirmed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    assert.equal(new URL(page.url()).searchParams.get('parentInvite'), 'fixture-token')
    await page.getByRole('button', { name: 'Parent' }).waitFor({ state: 'visible', timeout: 15000 })
    await context.close()
  })

  await runScenario('signed-out existing parent login accepts the invite once before opening the portal', async () => {
    const context = await browser.newContext()
    const { getAcceptanceCallCount, page } = await prepareParentInvitePage(context)
    await page.goto(`${mainBaseUrl}/sign-in?tab=parent&parentInvite=fixture-parent-invite`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.getByPlaceholder('you@club.com').fill('parent.fixture@footballplayer.test')
    await page.getByPlaceholder('Enter password').fill(fixturePassword)
    await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
    await page.waitForURL('**/parent-portal?*', { timeout: 15000 })
    const finalUrl = new URL(page.url())

    assert.equal(finalUrl.origin, mainBaseUrl)
    assert.equal(finalUrl.searchParams.get('linked'), '1')
    assert.equal(finalUrl.searchParams.get('parentLinkId'), 'parent-link-fixture')
    assert.equal(getAcceptanceCallCount(), 1)
    await assertVisibleText(page, 'Child linked')
    await assertVisibleTextContaining(page, 'Fixture Child is now available')
    await context.close()
  })

  await runScenario('authenticated parent invite stays higher priority on mobile and accepts once', async () => {
    const context = await browser.newContext({
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    const { getAcceptanceCallCount, page } = await prepareParentInvitePage(context)
    await parentSignIn(page, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.goto(`${mainBaseUrl}/parent-invite/fixture-parent-invite`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForURL('**/parent-portal?*', { timeout: 15000 })
    const finalUrl = new URL(page.url())

    assert.equal(finalUrl.origin, mainBaseUrl)
    assert.equal(finalUrl.searchParams.get('linked'), '1')
    assert.equal(finalUrl.searchParams.get('parentLinkId'), 'parent-link-fixture')
    assert.equal(getAcceptanceCallCount(), 1)
    await assertVisibleText(page, 'Child linked')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await context.close()
  })

  await runScenario('stale parent mode preserves the session and recovers to team workspace', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
    await page.evaluate(() => {
      window.sessionStorage.setItem('auth-access-browser-fixture-email', 'fallback-dual.fixture@footballplayer.test')
      window.sessionStorage.setItem('selected-access-mode', 'parent')
      window.sessionStorage.removeItem('login-access-intent')
    })
    await page.goto(`${mainBaseUrl}/parent-portal`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await assertVisibleText(page, 'Choose an available workspace')
    await assertVisibleText(page, 'Your session is still active')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Fixture Child').count(), 0)
    await page.getByRole('button', { name: 'Open Team / Coach' }).click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    await context.close()
  })

  await runScenario('stale parent recovery does not show a stale family label', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await page.goto(`${mainBaseUrl}/sign-in`, { waitUntil: 'commit', timeout: 60000 })
    await page.evaluate(() => {
      window.sessionStorage.setItem('auth-access-browser-fixture-email', 'stale-label-dual.fixture@footballplayer.test')
      window.sessionStorage.setItem('selected-access-mode', 'parent')
      window.sessionStorage.removeItem('login-access-intent')
    })
    await page.goto(`${mainBaseUrl}/parent-portal`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await assertVisibleText(page, 'Choose an available workspace')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('U17 Green').count(), 0)
    assert.equal(await page.getByLabel('Access view').count(), 0)
    await page.getByRole('button', { name: 'Open Team / Coach' }).click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'U17 Green')
    await assertVisibleText(page, 'Team tools')
    await context.close()
  })

  await runScenario('parent-link lookup failure is not treated as confirmed no-link', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'lookup-failed-dual.fixture@footballplayer.test', mainBaseUrl)
    await assertVisibleText(page, 'Parent access could not be confirmed')
    await assertVisibleText(page, 'A temporary Parent-link lookup problem is not treated as proof that the link is missing.')
    assert.equal(await page.getByText(/sign-in is for parent access/i).count(), 0)
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Open Team / Coach' }).click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    await context.close()
  })

  await runScenario('confirmed no-link parent intent stays strict and returns to Parent sign-in', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'fallback-dual.fixture@footballplayer.test', mainBaseUrl)
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    await page.getByRole('button', { name: 'Parent' }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByText('Choose an available workspace', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Open Team / Coach' }).count(), 0)
    await context.close()
  })

  await runScenario('parent-only unavailable fallback redirects to unified parent sign-in without exposing data', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'parent-unlinked.fixture@footballplayer.test', mainBaseUrl)
    await waitForPathname(page, '/sign-in')
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'parent')
    assert.equal(await page.getByText('Account details unavailable', { exact: true }).count(), 0)
    assert.equal(await page.getByText('What this means', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Next step', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Switch to Staff Platform' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Retry' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Sign in again' }).count(), 0)
    assert.equal(await page.getByText('Fixture Child').count(), 0)
    await assertNoSetupGuideTrigger(page)
    await context.close()
  })

  await runScenario('parent portal sign out is visible and clears the fixture session', async () => {
    const desktopContext = await browser.newContext()
    const { page: desktopPage } = await preparePage(desktopContext)
    await parentSignIn(desktopPage, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await desktopPage.waitForURL('**/parent-portal', { timeout: 15000 })
    const mainAccountActions = desktopPage.getByLabel('Parent account actions').first()
    await mainAccountActions.getByRole('button', { name: /Sign out/ }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await desktopPage.getByRole('button', { name: /Sign out/ }).count(), 1)
    assert.equal(await desktopPage.getByRole('button', { name: 'Switch to Staff Platform' }).count(), 0)
    await desktopPage.goto(`${mainBaseUrl}/parent-portal?section=settings`, { waitUntil: 'domcontentloaded' })
    await assertVisibleText(desktopPage, 'Parent settings')
    await desktopPage.getByRole('button', { name: /Sign out/ }).first().waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await desktopPage.getByRole('button', { name: 'Switch to Staff Platform' }).count(), 0)
    await desktopPage.getByRole('button', { name: /Sign out/ }).first().click()
    await waitForPathname(desktopPage, '/sign-in')
    assert.equal(new URL(desktopPage.url()).searchParams.get('tab'), 'parent')
    assert.equal(await desktopPage.evaluate(() => window.sessionStorage.getItem('auth-access-browser-fixture-email')), null)
    await desktopContext.close()

    const mobileContext = await browser.newContext({
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    const { page: mobilePage } = await preparePage(mobileContext)
    await parentSignIn(mobilePage, 'parent.fixture@footballplayer.test', mainBaseUrl)
    await mobilePage.waitForURL('**/parent-portal', { timeout: 15000 })
    await mobilePage.getByLabel('Parent account actions').first().getByRole('button', { name: /Sign out/ }).waitFor({ state: 'visible', timeout: 15000 })
    await mobilePage.goto(`${mainBaseUrl}/parent-portal?section=settings`, { waitUntil: 'domcontentloaded' })
    await assertVisibleText(mobilePage, 'Parent settings')
    await mobilePage.getByLabel('Parent account actions').first().getByRole('button', { name: /Sign out/ }).waitFor({ state: 'visible', timeout: 15000 })
    await mobileContext.close()
  })

  await runScenario('dual-access parent can switch to staff without a new login', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test', mainBaseUrl, 'parent')
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.getByRole('button', { name: 'Switch to Staff Platform' }).first().click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await assertVisibleText(page, 'Club-wide view')
    assert.equal(
      await page.evaluate(() => window.sessionStorage.getItem('auth-access-browser-fixture-email')),
      'multi.fixture@footballplayer.test',
    )
    await context.close()
  })

  await runScenario('dual-access switch restores the last valid staff team', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await page.getByLabel('Access view').selectOption({ label: 'Team: U12 Fixture Team' })
    await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
    await page.getByLabel('Access view').selectOption({ label: 'Family portal' })
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.getByRole('button', { name: 'Switch to Staff Platform' }).first().click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team: U12 Fixture Team')
    await assertVisibleText(page, 'Team tools')
    await context.close()
  })

  await runScenario('dual-access switch with no saved team opens safe club-wide staff access', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test')
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await page.getByLabel('Access view').selectOption({ label: 'Family portal' })
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.getByRole('button', { name: 'Switch to Staff Platform' }).first().click()
    await page.waitForURL('**/coach', { timeout: 15000 })
    await assertSelectedOption(page, 'Access view', 'Team access')
    await assertVisibleText(page, 'Club-wide view')
    await context.close()
  })

  await runScenario('dual-access switch is visible in the mobile parent shell', async () => {
    const context = await browser.newContext({
      isMobile: true,
      viewport: { width: 390, height: 844 },
    })
    const { page } = await preparePage(context)
    await signIn(page, 'multi.fixture@footballplayer.test', mainBaseUrl, 'parent')
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    const accountActions = page.getByLabel('Parent account actions').first()
    const switchButton = accountActions.getByRole('button', { name: 'Switch to Staff Platform' })
    const signOutButton = accountActions.getByRole('button', { name: /Sign out/ })
    await switchButton.waitFor({ state: 'visible', timeout: 15000 })
    await signOutButton.waitFor({ state: 'visible', timeout: 15000 })
    const [switchBox, signOutBox] = await Promise.all([switchButton.boundingBox(), signOutButton.boundingBox()])
    assert.ok(switchBox && signOutBox)
    assert.ok(switchBox.y + switchBox.height <= signOutBox.y)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await context.close()
  })

  await runScenario('parent host transfers the same session to the staff platform securely', async () => {
    const context = await browser.newContext()
    const { page } = await preparePage(context)
    await parentSignIn(page, 'multi.fixture@footballplayer.test', parentBaseUrl)
    await page.waitForURL('**/parent-portal', { timeout: 15000 })
    await page.getByRole('button', { name: 'Switch to Staff Platform' }).first().click()
    await page.waitForURL(`${mainBaseUrl}/coach`, { timeout: 15000 })
    await assertVisibleText(page, 'Club-wide view')
    assert.equal(
      await page.evaluate(() => window.sessionStorage.getItem('auth-access-browser-fixture-email')),
      'multi.fixture@footballplayer.test',
    )
    await context.close()
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
    await assertVisibleTextContaining(page, 'Fixture Child')
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
    await assertHeaderContextPanelRemoved(page)
    await openMobileNavigation(page)
    await assertSidebarWorkspaceControls(page)
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
