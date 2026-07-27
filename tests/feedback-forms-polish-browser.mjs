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

async function signIn(page, email = 'manager.fixture@footballplayer.test', access = 'club') {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: access === 'parent' ? 'Parent' : 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill(email)
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
  let nextCustomFormId = 1
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type, prefer, x-client-info',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  }

  await context.route('**/.netlify/functions/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authorized: false, success: true }),
  }))
  await context.route('**/auth/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: corsHeaders,
    body: '{}',
  }))
  await context.route('**/rest/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: corsHeaders,
    body: '[]',
  }))
  await context.route('**/rest/v1/rpc/record_security_audit_event', async (route) => {
    const payload = route.request().postDataJSON() || {}
    if (route.request().method() === 'POST') {
      auditRequests.push({
        action: payload.p_action,
        entityId: payload.p_entity_id ?? null,
      })
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: 'null',
    })
  })
  await context.route('**/rest/v1/feedback_forms?**', async (route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    const formId = String(requestUrl.searchParams.get('id') ?? '').replace(/^eq\./, '')
    const wantsSingleObject = String(request.headers().accept ?? '').includes('application/vnd.pgrst.object+json')

    if (request.method() === 'POST') {
      const requestBody = route.request().postDataJSON()
      const payload = Array.isArray(requestBody) ? requestBody[0] : requestBody
      const createdForm = {
        ...payload,
        id: `44444444-4444-4444-8444-${String(nextCustomFormId).padStart(12, '0')}`,
        created_at: '2026-07-23T15:00:00.000Z',
        updated_at: '2026-07-23T15:00:00.000Z',
      }
      nextCustomFormId += 1
      customForms.push(createdForm)
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: { ...corsHeaders, 'content-range': `${customForms.length - 1}-${customForms.length - 1}/${customForms.length}` },
        body: JSON.stringify(wantsSingleObject ? createdForm : [createdForm]),
      })
      return
    }

    if (request.method() === 'PATCH') {
      const payload = request.postDataJSON() || {}
      const targets = formId
        ? customForms.filter((form) => form.id === formId)
        : customForms
      for (const form of targets) {
        Object.assign(form, payload)
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ...corsHeaders, 'content-range': targets.length ? `0-${targets.length - 1}/${targets.length}` : '0-0/0' },
        body: JSON.stringify(wantsSingleObject ? targets[0] ?? null : targets),
      })
      return
    }

    const visibleForms = formId
      ? customForms.filter((form) => form.id === formId)
      : customForms
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...corsHeaders, 'content-range': visibleForms.length ? `0-${visibleForms.length - 1}/${visibleForms.length}` : '0-0/0' },
      body: JSON.stringify(wantsSingleObject ? visibleForms[0] ?? null : visibleForms),
    })
  })
  await context.route('**/rest/v1/feedback_form_starter_templates?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { ...corsHeaders, 'content-range': `0-${starterTemplates.length - 1}/${starterTemplates.length}` },
    body: JSON.stringify(starterTemplates),
  }))
  await context.route('**/rest/v1/feedback_form_starter_preferences?**', async (route) => {
    if (route.request().method() === 'POST') {
      const requestBody = route.request().postDataJSON()
      const payload = Array.isArray(requestBody) ? requestBody[0] : requestBody
      if (payload.hidden) hiddenTemplateKeys.add(payload.template_key)
      else hiddenTemplateKeys.delete(payload.template_key)
      await route.fulfill({ status: 201, contentType: 'application/json', headers: corsHeaders, body: '' })
      return
    }
    const rows = [...hiddenTemplateKeys].map((templateKey) => ({
      template_key: templateKey,
      hidden: true,
    }))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...corsHeaders, 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '0-0/0' },
      body: JSON.stringify(rows),
    })
  })
  await context.route('**/rest/v1/teams?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { ...corsHeaders, 'content-range': '0-0/1' },
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

  return { auditRequests, consoleErrors, context, customForms, failedRequests, page, pageErrors }
}

async function openMobileNavigation(page, isMobile) {
  if (!isMobile) return
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Close navigation' }).waitFor({ state: 'visible' })
}

async function assertCleanBrowserSignals(fixture) {
  assert.deepEqual(fixture.consoleErrors, [])
  assert.deepEqual(fixture.pageErrors, [])
  assert.deepEqual(fixture.failedRequests, [])
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
    for (const allowedRole of [
      { email: 'team-admin.fixture@footballplayer.test', label: 'Team Admin' },
      { email: 'manager.fixture@footballplayer.test', label: 'Manager' },
    ]) {
      const fixture = await prepareContext(browser, viewport.options)
      await signIn(fixture.page, allowedRole.email)
      await fixture.page.waitForURL('**/coach')
      await openMobileNavigation(fixture.page, viewport.options.isMobile)
      await fixture.page.getByRole('link', { name: /Development Forms/ }).waitFor({ state: 'visible' })
      await fixture.page.goto(`${baseUrl}/feedback-forms`, { waitUntil: 'domcontentloaded' })
      await fixture.page.getByRole('heading', { name: 'Create reusable team feedback forms.' }).waitFor()
      assert.equal(fixture.consoleErrors.some((message) => message.includes('same key')), false)
      await fixture.context.close()
      process.stdout.write(`PASS ${viewport.name}: ${allowedRole.label} navigation and direct route allowed\n`)
    }

    for (const deniedRole of [
      { email: 'coach.fixture@footballplayer.test', label: 'Coach' },
      { email: 'assistant.fixture@footballplayer.test', label: 'Assistant Coach' },
    ]) {
      const fixture = await prepareContext(browser, viewport.options)
      await signIn(fixture.page, deniedRole.email)
      await fixture.page.waitForURL('**/coach')
      await openMobileNavigation(fixture.page, viewport.options.isMobile)
      assert.equal(await fixture.page.getByRole('link', { name: /Development Forms/ }).count(), 0)
      await fixture.page.goto(`${baseUrl}/feedback-forms`, { waitUntil: 'domcontentloaded' })
      await fixture.page.getByRole('heading', { name: 'Feedback forms are managed by Managers and Team Admins.' }).waitFor()
      await fixture.context.close()
      process.stdout.write(`PASS ${viewport.name}: ${deniedRole.label} navigation hidden and direct route denied\n`)
    }

    const parentFixture = await prepareContext(browser, viewport.options)
    await signIn(parentFixture.page, 'parent.fixture@footballplayer.test', 'parent')
    await parentFixture.page.waitForURL('**/parent-portal')
    assert.equal(await parentFixture.page.getByRole('link', { name: /Development Forms/ }).count(), 0)
    await parentFixture.page.goto(`${baseUrl}/feedback-forms`, { waitUntil: 'domcontentloaded' })
    await parentFixture.page.waitForURL('**/parent-portal')
    assert.equal(await parentFixture.page.getByRole('heading', { name: 'Create reusable team feedback forms.' }).count(), 0)
    await parentFixture.context.close()
    process.stdout.write(`PASS ${viewport.name}: Parent navigation hidden and direct route denied\n`)

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

    await fixture.page.getByRole('button', { name: 'Create form' }).click()
    const createSuccess = fixture.page.getByText('Match day feedback saved.', { exact: true })
    const createFailure = fixture.page.getByText('Feedback form action failed', { exact: true })
    await createSuccess.or(createFailure).waitFor()
    if (await createFailure.count()) {
      throw new Error(await createFailure.locator('..').innerText())
    }
    assert.equal(fixture.customForms.length, 1)
    assert.equal(fixture.customForms[0].club_id, 'club-fixture')
    assert.equal(fixture.customForms[0].team_id, 'team-u12')

    const createdFormCard = fixture.page.locator('article').filter({ hasText: 'Match day  feedback' })
    await createdFormCard.getByRole('button', { name: 'Edit' }).click()
    await formName.fill('Manager lifecycle form')
    await fixture.page.getByRole('button', { name: 'Save changes' }).click()
    await fixture.page.getByText('Manager lifecycle form saved.', { exact: true }).waitFor()
    assert.equal(fixture.customForms[0].name, 'Manager lifecycle form')
    assert.equal(fixture.customForms[0].version, 2)

    const updatedFormCard = fixture.page.locator('article').filter({ hasText: 'Manager lifecycle form' })
    await updatedFormCard.getByRole('button', { name: 'Duplicate' }).click()
    await fixture.page.getByText('Manager lifecycle form copy duplicated.', { exact: true }).waitFor()
    assert.equal(fixture.customForms.length, 2)
    assert.equal(fixture.customForms[1].duplicated_from_id, fixture.customForms[0].id)
    await fixture.page.getByRole('button', { name: 'Clear editor' }).click()

    const originalFormCard = fixture.page.locator('article').filter({
      has: fixture.page.getByText('Manager lifecycle form', { exact: true }),
    }).filter({
      has: fixture.page.getByRole('button', { name: 'Archive' }),
    })
    await originalFormCard.getByRole('button', { name: 'Archive' }).click()
    await fixture.page.getByText('Manager lifecycle form archived. Historical responses stay readable.', { exact: true }).waitFor()
    assert.equal(fixture.customForms[0].status, 'archived')
    await fixture.page.getByRole('heading', { name: '1 archived' }).waitFor()

    const recommendedCard = fixture.page.locator('article').filter({ hasText: 'U11-U12 Game Understanding Review' })
    await recommendedCard.getByRole('button', { name: 'Duplicate and customise' }).click()
    await fixture.page.getByText('U11-U12 Game Understanding Review custom', { exact: true }).first().waitFor()
    assert.ok(await fixture.page.getByRole('button', { name: 'Edit' }).count() >= 2)

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
    for (const action of [
      'feedback_form_created',
      'feedback_form_edited',
      'feedback_form_duplicated',
      'feedback_form_archived',
      'starter_feedback_form_duplicated',
    ]) {
      assert.ok(fixture.auditRequests.some((request) => request.action === action), `${action} audit missing`)
    }

    assert.equal(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    const visibleRecommendedCard = fixture.page.locator('article').filter({ hasText: 'U11-U12 Game Understanding Review' })
    await visibleRecommendedCard.getByRole('button', { name: 'Use form' }).click()
    await fixture.page.waitForURL(/\/assess-player\/new\?feedbackForm=platform-starter%3Au11-u12-game-understanding-review%3A1/)
    assert.equal(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await assertCleanBrowserSignals(fixture)
    await fixture.context.close()
    process.stdout.write(`PASS ${viewport.name}: Manager create, edit, duplicate, archive, starter actions, keyboard and no overflow\n`)
  }
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n${server.output()}\n`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
