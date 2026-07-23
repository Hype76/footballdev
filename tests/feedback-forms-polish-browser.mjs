import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const port = 5100 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const open = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 250)
      socket.once('connect', () => {
        clearTimeout(timeout)
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
    if (open) return
    await wait(100)
  }
  throw new Error('Timed out waiting for the Vite test server.')
}

function startServer() {
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 0.0.0.0 --port ${port} --strictPort`], {
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
  return { child, output: () => output }
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.child.kill()
  }
  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill('manager.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill('FixturePass123!')
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
}

const starterTemplates = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    template_key: 'u11-u12-game-understanding-review',
    version: 1,
    age_band: 'U11-U12',
    age_min: 11,
    age_max: 12,
    name: 'U11-U12 Game Understanding Review',
    description: 'Technique under pressure, scanning, movement and decisions.',
    fields: [
      {
        id: 'observation-1',
        label: 'Scans before receiving',
        type: 'select',
        options: ['Not observed', 'Emerging', 'Developing', 'Consistent', 'Strong'],
        required: false,
        orderIndex: 1,
      },
    ],
    is_current: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    template_key: 'u13-u14-player-development-review',
    version: 1,
    age_band: 'U13-U14',
    age_min: 13,
    age_max: 14,
    name: 'U13-U14 Player Development Review',
    description: 'Technique under pressure, positional understanding and responsibility.',
    fields: [
      {
        id: 'observation-1',
        label: 'Scans consistently before receiving',
        type: 'select',
        options: ['Not observed', 'Emerging', 'Developing', 'Consistent', 'Strong'],
        required: false,
        orderIndex: 1,
      },
    ],
    is_current: true,
  },
]

async function prepareContext(browser, options) {
  const context = await browser.newContext(options)
  const consoleErrors = []
  const customForms = []
  const pageErrors = []
  const failedRequests = []
  const hiddenTemplateKeys = new Set()
  const auditRequests = []

  await context.route('**/.netlify/functions/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authorized: false, success: true }),
  }))
  await context.route('**/auth/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }))
  await context.route('**/rest/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }))
  await context.route('**/rest/v1/rpc/record_security_audit_event', async (route) => {
    const payload = route.request().postDataJSON() || {}
    auditRequests.push({
      action: payload.p_action,
      entityId: payload.p_entity_id ?? null,
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: 'null',
    })
  })
  await context.route('**/rest/v1/feedback_forms?**', async (route) => {
    if (route.request().method() === 'POST') {
      const requestBody = route.request().postDataJSON()
      const payload = Array.isArray(requestBody) ? requestBody[0] : requestBody
      const createdForm = {
        ...payload,
        id: '44444444-4444-4444-8444-444444444444',
        created_at: '2026-07-23T15:00:00.000Z',
        updated_at: '2026-07-23T15:00:00.000Z',
      }
      customForms.splice(0, customForms.length, createdForm)
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: { 'content-range': '0-0/1' },
        body: JSON.stringify([createdForm]),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': customForms.length ? '0-0/1' : '0-0/0' },
      body: JSON.stringify(customForms),
    })
  })
  await context.route('**/rest/v1/feedback_form_starter_templates?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': `0-${starterTemplates.length - 1}/${starterTemplates.length}` },
    body: JSON.stringify(starterTemplates),
  }))
  await context.route('**/rest/v1/feedback_form_starter_preferences?**', async (route) => {
    if (route.request().method() === 'POST') {
      const requestBody = route.request().postDataJSON()
      const payload = Array.isArray(requestBody) ? requestBody[0] : requestBody
      if (payload.hidden) hiddenTemplateKeys.add(payload.template_key)
      else hiddenTemplateKeys.delete(payload.template_key)
      await route.fulfill({ status: 201, contentType: 'application/json', body: '' })
      return
    }
    const rows = [...hiddenTemplateKeys].map((templateKey) => ({
      template_key: templateKey,
      hidden: true,
    }))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '0-0/0' },
      body: JSON.stringify(rows),
    })
  })
  await context.route('**/rest/v1/teams?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': '0-0/1' },
    body: JSON.stringify([{
      id: 'team-u12',
      club_id: 'club-fixture',
      name: 'U12 Fixture Team',
      age_group: 'U12',
      status: 'active',
    }]),
  }))
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`)
    }
  })

  return { auditRequests, consoleErrors, context, failedRequests, page, pageErrors }
}

const server = startServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ headless: true })

  for (const viewport of [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', options: { isMobile: true, viewport: { width: 390, height: 844 } } },
  ]) {
    const fixture = await prepareContext(browser, viewport.options)
    await signIn(fixture.page)
    await fixture.page.goto(`${baseUrl}/feedback-forms`, { waitUntil: 'domcontentloaded' })
    await fixture.page.getByRole('heading', { name: 'Create reusable team feedback forms.' }).waitFor()
    await fixture.page.getByText('U11-U12 Game Understanding Review', { exact: true }).waitFor()
    assert.equal(await fixture.page.getByText('Recommended', { exact: true }).count(), 1)
    assert.equal(await fixture.page.getByRole('button', { name: 'Archive' }).count(), 0)
    assert.equal(await fixture.page.getByRole('button', { name: 'Hide' }).count(), 2)
    assert.equal(await fixture.page.getByRole('button', { name: 'Duplicate and customise' }).count(), 2)

    const formName = fixture.page.getByLabel('Form name')
    await formName.pressSequentially('Match day  feedback')
    assert.equal(await formName.inputValue(), 'Match day  feedback')
    assert.equal(await formName.evaluate((element) => document.activeElement === element), true)

    const fieldLabel = fixture.page.getByLabel('Field label').first()
    await fieldLabel.pressSequentially('Overall feedback')
    assert.equal(await fieldLabel.inputValue(), 'Overall feedback')
    assert.equal(await fieldLabel.evaluate((element) => document.activeElement === element), true)

    await fixture.page.getByLabel('Type').first().selectOption('select')
    const optionsInput = fixture.page.getByLabel('Dropdown options').first()
    await optionsInput.pressSequentially('First Touch, Decision Making')
    assert.equal(await optionsInput.inputValue(), 'First Touch, Decision Making')
    assert.equal(await optionsInput.evaluate((element) => document.activeElement === element), true)
    assert.equal(await fixture.page.getByText('Feedback form updated').count(), 0)

    const addFieldButton = fixture.page.getByRole('button', { name: 'Add field' })
    await addFieldButton.focus()
    await addFieldButton.press('Space')
    assert.equal(await fixture.page.getByLabel('Field label').count(), 2)

    const recommendedCard = fixture.page.locator('article').filter({ hasText: 'U11-U12 Game Understanding Review' })
    await recommendedCard.getByRole('button', { name: 'Duplicate and customise' }).click()
    await fixture.page.getByText('U11-U12 Game Understanding Review custom', { exact: true }).first().waitFor()
    assert.equal(await fixture.page.getByRole('button', { name: 'Edit' }).count(), 1)

    const refreshedRecommendedCard = fixture.page.locator('article').filter({ hasText: 'U11-U12 Game Understanding Review' })
    await refreshedRecommendedCard.getByRole('button', { name: 'Hide' }).click()
    await fixture.page.getByRole('button', { name: 'Show hidden templates (1)' }).waitFor()
    assert.equal(await fixture.page.getByText('U11-U12 Game Understanding Review', { exact: true }).count(), 0)
    await fixture.page.getByRole('button', { name: 'Show hidden templates (1)' }).click()
    const hiddenCard = fixture.page.locator('article').filter({ hasText: 'U11-U12 Game Understanding Review' })
    await hiddenCard.getByRole('button', { name: 'Show' }).click()
    await fixture.page.getByText('U11-U12 Game Understanding Review shown for this team.', { exact: true }).waitFor()
    await fixture.page.getByText('Recommended', { exact: true }).waitFor()
    assert.equal(await fixture.page.getByRole('button', { name: 'Show hidden templates (1)' }).count(), 0)
    const visibilityAudits = fixture.auditRequests.filter((request) => (
      ['starter_feedback_form_hidden', 'starter_feedback_form_shown'].includes(request.action)
    ))
    assert.equal(visibilityAudits.length, 2, JSON.stringify(fixture.auditRequests))
    assert.ok(visibilityAudits.some((request) => request.entityId === '11111111-1111-4111-8111-111111111111'))
    assert.equal(visibilityAudits.some((request) => request.entityId === 'u11-u12-game-understanding-review'), false)

    assert.equal(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    const visibleRecommendedCard = fixture.page.locator('article').filter({ hasText: 'U11-U12 Game Understanding Review' })
    await visibleRecommendedCard.getByRole('button', { name: 'Use form' }).click()
    await fixture.page.waitForURL(/\/assess-player\/new\?feedbackForm=platform-starter%3Au11-u12-game-understanding-review%3A1/)
    assert.equal(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(fixture.consoleErrors, [])
    assert.deepEqual(fixture.pageErrors, [])
    assert.deepEqual(fixture.failedRequests, [])
    await fixture.context.close()
    process.stdout.write(`PASS ${viewport.name}: spaces, focus, no submit, starter recommendation, Hide and Show, direct use, duplicate and customise, keyboard and no overflow\n`)
  }
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n${server.output()}\n`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
