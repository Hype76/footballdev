import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const port = 5700 + Math.floor(Math.random() * 200)
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
        VITE_SUPABASE_URL: 'http://fixture.supabase.test',
        VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, output: () => output }
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`],
      { stdio: 'ignore' },
    )
  } else {
    server.child.kill()
  }
  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

async function signIn(page, email, access = 'club') {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: access === 'parent' ? 'Parent' : 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill(email)
  await page.getByPlaceholder('Enter password').fill('FixturePass123!')
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
}

function buildMetricField({
  categoryKey = 'attacking',
  categoryLabel = 'Striking and Attacking',
  label,
  metricKey,
  score,
}) {
  return {
    id: `metric-${metricKey.replaceAll('.', '-')}`,
    label,
    type: 'score_1_10',
    options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    required: false,
    orderIndex: 1,
    isEnabled: true,
    includeInProgressChart: true,
    parentVisible: false,
    metricKey,
    categoryKey,
    categoryLabel,
    value: score,
  }
}

const player = {
  id: '11111111-1111-4111-8111-111111111111',
  club_id: 'club-fixture',
  team_id: 'team-u12',
  player_name: 'Fixture Player',
  section: 'Squad',
  team: 'U12 Fixture Team',
  status: 'active',
  parent_name: 'Parent Fixture',
  parent_email: 'parent.fixture@footballplayer.test',
  parent_contacts: [{ name: 'Parent Fixture', email: 'parent.fixture@footballplayer.test' }],
}

const evaluations = [
  {
    id: '22222222-2222-4222-8222-222222222221',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    player_id: player.id,
    player_name: player.player_name,
    team: player.team,
    section: 'Squad',
    coach_id: 'manager-fixture',
    coach: 'Manager Fixture',
    date: '10/07/2026',
    session: 'Elite review',
    scores: { Finishing: 6, Composure: 5 },
    average_score: 5.5,
    comments: {},
    form_responses: { Finishing: 6, Composure: 5 },
    feedback_form_id: '33333333-3333-4333-8333-333333333333',
    feedback_form_name: 'Elite Attacking Review',
    feedback_form_version: 1,
    feedback_form_snapshot: {
      formId: '33333333-3333-4333-8333-333333333333',
      formName: 'Elite Attacking Review',
      formVersion: 1,
      fields: [
        buildMetricField({ label: 'Finishing', metricKey: 'attacking.finishing', score: 6 }),
        buildMetricField({ label: 'Composure', metricKey: 'attacking.composure', score: 5 }),
      ],
    },
    status: 'Submitted',
    created_at: '2026-07-10T12:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    player_id: player.id,
    player_name: player.player_name,
    team: player.team,
    section: 'Squad',
    coach_id: 'manager-fixture',
    coach: 'Manager Fixture',
    date: '20/07/2026',
    session: 'Elite review',
    scores: { 'Finishing quality': 8, Composure: 7 },
    average_score: 7.5,
    comments: {},
    form_responses: { 'Finishing quality': 8, Composure: 7 },
    feedback_form_id: '33333333-3333-4333-8333-333333333333',
    feedback_form_name: 'Elite Attacking Review',
    feedback_form_version: 2,
    feedback_form_snapshot: {
      formId: '33333333-3333-4333-8333-333333333333',
      formName: 'Elite Attacking Review',
      formVersion: 2,
      fields: [
        buildMetricField({ label: 'Finishing quality', metricKey: 'attacking.finishing', score: 8 }),
        buildMetricField({ label: 'Composure', metricKey: 'attacking.composure', score: 7 }),
      ],
    },
    status: 'Submitted',
    created_at: '2026-07-20T12:00:00.000Z',
  },
]

async function prepareContext(browser, options) {
  const context = await browser.newContext(options)
  const pageErrors = []
  const consoleErrors = []
  const failedRequests = []
  const routedTables = []
  const installedForms = []
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
  await context.route('**/rest/v1/players?**', (route) => {
    const isArchivedQuery = route.request().url().includes('status=eq.archived')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...corsHeaders, 'content-range': isArchivedQuery ? '0-0/0' : '0-0/1' },
      body: JSON.stringify(isArchivedQuery ? [] : [player]),
    })
  })
  await context.route('**/rest/v1/evaluations?**', (route) => {
    routedTables.push(route.request().url())
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...corsHeaders, 'content-range': '0-1/2' },
      body: JSON.stringify(evaluations),
    })
  })
  await context.route('**/rest/v1/form_fields?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { ...corsHeaders, 'content-range': '0-0/0' },
    body: '[]',
  }))
  await context.route('**/rest/v1/feedback_forms?**', async (route) => {
    const request = route.request()
    const wantsSingleObject = String(request.headers().accept ?? '').includes('application/vnd.pgrst.object+json')
    if (request.method() === 'POST') {
      const requestBody = request.postDataJSON()
      const payload = Array.isArray(requestBody) ? requestBody[0] : requestBody
      const created = {
        ...payload,
        id: '55555555-5555-4555-8555-555555555555',
        created_at: '2026-07-27T20:00:00.000Z',
        updated_at: '2026-07-27T20:00:00.000Z',
      }
      installedForms.push(created)
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: { ...corsHeaders, 'content-range': '0-0/1' },
        body: JSON.stringify(wantsSingleObject ? created : [created]),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        ...corsHeaders,
        'content-range': installedForms.length ? `0-${installedForms.length - 1}/${installedForms.length}` : '0-0/0',
      },
      body: JSON.stringify(wantsSingleObject ? installedForms[0] ?? null : installedForms),
    })
  })
  await context.route('**/rest/v1/feedback_form_starter_templates?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { ...corsHeaders, 'content-range': '0-0/1' },
    body: JSON.stringify([{
      template_key: 'elite-attacking-review',
      version: 1,
      age_band: 'All ages',
      age_min: 1,
      age_max: 99,
      name: 'Elite Attacking Review',
      description: 'A focused elite attacking review.',
      fields: [
        buildMetricField({ label: 'Finishing', metricKey: 'attacking.finishing', score: '' }),
        {
          id: 'written-parent-visible-summary',
          label: 'Parent-visible summary',
          type: 'textarea',
          options: [],
          required: false,
          orderIndex: 2,
          isEnabled: true,
          includeInProgressChart: false,
          parentVisible: true,
        },
      ],
      is_current: true,
    }]),
  }))
  await context.route('**/rest/v1/feedback_form_starter_preferences?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { ...corsHeaders, 'content-range': '0-0/0' },
    body: '[]',
  }))
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
  await context.route('**/rest/v1/rpc/record_security_audit_event', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: corsHeaders,
    body: 'null',
  }))

  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`)
    }
  })

  return { consoleErrors, context, failedRequests, installedForms, page, pageErrors, routedTables }
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
    await signIn(fixture.page, 'manager.fixture@footballplayer.test')
    await fixture.page.waitForURL('**/coach')
    await fixture.page.goto(`${baseUrl}/feedback-forms`, { waitUntil: 'domcontentloaded' })
    await fixture.page.getByRole('heading', { name: 'Elite Player Development' }).waitFor()
    await fixture.page.getByRole('button', { name: 'Add to team' }).click()
    await fixture.page.getByRole('button', { name: 'Already added' }).waitFor()
    assert.equal(fixture.installedForms.length, 1)
    assert.equal(fixture.installedForms[0].starter_template_key, 'elite-attacking-review')
    assert.equal(fixture.installedForms[0].fields[0].metricKey, 'attacking.finishing')
    assert.equal(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await fixture.page.goto(
      `${baseUrl}/player/Fixture%20Player?source=squad&playerId=${player.id}&teamId=team-u12&clubId=club-fixture`,
      { waitUntil: 'domcontentloaded' },
    )
    await fixture.page.getByRole('heading', { name: 'Elite development trends' }).waitFor()
    await fixture.page.getByLabel('Metric progress').selectOption('attacking.finishing')
    await fixture.page.getByRole('img', { name: 'Finishing quality score over assessment date' }).waitFor()
    await fixture.page.getByRole('img', { name: /latest metric profile/i }).waitFor()
    await fixture.page.getByText('Finishing quality:', { exact: true }).waitFor()
    assert.equal(await fixture.page.getByText('6 to 8', { exact: false }).count() > 0, true)
    assert.equal(await fixture.page.getByRole('table').count() >= 2, true)
    assert.equal(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.deepEqual(fixture.pageErrors, [])
    assert.deepEqual(fixture.consoleErrors, [])
    assert.deepEqual(fixture.failedRequests, [])
    await fixture.context.close()
    process.stdout.write(`PASS ${viewport.name}: elite install, metric, category, radar, comparison, accessible tables and no page overflow\n`)

    const parentFixture = await prepareContext(browser, viewport.options)
    await signIn(parentFixture.page, 'parent.fixture@footballplayer.test', 'parent')
    await parentFixture.page.waitForURL('**/parent-portal')
    await parentFixture.page.goto(
      `${baseUrl}/player/Fixture%20Player?source=squad&playerId=${player.id}&teamId=team-u12&clubId=club-fixture`,
      { waitUntil: 'domcontentloaded' },
    )
    await parentFixture.page.waitForURL('**/parent-portal')
    assert.equal(await parentFixture.page.getByRole('heading', { name: 'Elite development trends' }).count(), 0)
    await parentFixture.context.close()
    process.stdout.write(`PASS ${viewport.name}: parent cannot open the staff player profile or private elite scores\n`)
  }
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n${server.output()}\n`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
