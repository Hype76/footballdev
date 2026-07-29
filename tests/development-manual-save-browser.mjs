import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const actorId = 'user-manager.fixture@footballplayer.test'
const port = Number(process.env.DEVELOPMENT_MANUAL_SAVE_BROWSER_PORT || 5400 + Math.floor(Math.random() * 400))
const baseUrl = `http://127.0.0.1:${port}`
const isMobile = process.env.DEVELOPMENT_MANUAL_SAVE_DEVICE === 'mobile'
const observationMs = Number(process.env.DEVELOPMENT_MANUAL_SAVE_OBSERVATION_MS || 60000)
const formAId = '11111111-1111-4111-8111-111111111111'
const formBId = '22222222-2222-4222-8222-222222222222'

const customForms = [
  {
    id: formAId,
    club_id: 'club-fixture',
    team_id: 'team-u12',
    name: 'Custom A Form',
    status: 'active',
    version: 3,
    updated_at: '2026-07-26T12:00:00.000Z',
    fields: [
      {
        id: 'custom-a-score',
        label: 'Custom A Score',
        type: 'score_1_10',
        required: true,
        is_enabled: true,
        include_in_progress_chart: true,
        order_index: 1,
      },
    ],
  },
  {
    id: formBId,
    club_id: 'club-fixture',
    team_id: 'team-u12',
    name: 'Custom B Form',
    status: 'active',
    version: 2,
    updated_at: '2026-07-26T12:01:00.000Z',
    fields: [
      {
        id: 'custom-b-score',
        label: 'Custom B Score',
        type: 'score_1_10',
        required: true,
        is_enabled: true,
        include_in_progress_chart: true,
        order_index: 1,
      },
    ],
  },
]

const defaultFields = [
  {
    id: 'default-score',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    label: 'Default Score',
    type: 'score_1_10',
    required: false,
    is_enabled: true,
    include_in_progress_chart: true,
    order_index: 1,
  },
]

const teams = [
  {
    id: 'team-u12',
    club_id: 'club-fixture',
    name: 'U12 Fixture Team',
    age_group: 'U12',
    is_active: true,
  },
]

const players = [
  {
    id: 'player-fixture',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    player_name: 'Fixture Player',
    section: 'Squad',
    team: 'U12 Fixture Team',
    status: 'active',
    parent_contacts: [],
  },
  {
    id: 'player-second',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    player_name: 'Second Fixture Player',
    section: 'Squad',
    team: 'U12 Fixture Team',
    status: 'active',
    parent_contacts: [],
  },
]

const evaluations = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    player_id: 'player-fixture',
    player_name: 'Fixture Player',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    team: 'U12 Fixture Team',
    section: 'Squad',
    session: '2026-07-20',
    date: '20/07/2026',
    coach_id: actorId,
    coach: 'Manager Fixture',
    created_at: '2026-07-20T09:00:00.000Z',
    form_responses: {},
    scores: {},
    comments: {},
    status: 'Submitted',
  },
]
const drafts = []
const requests = {
  draftGets: [],
  draftPatches: [],
  draftPosts: [],
  evaluationPosts: [],
  evaluationPatches: [],
  reportFinalizations: [],
  submissionConfirmations: [],
  optionalOutputs: [],
}
let delayNextDraftWrite = false
let refreshMetadataRaceActive = false
let draftReadBeforeFeedbackFormsResolved = false
let failOptionalOutput = false
let nextDraftNumber = 1
let nextEvaluationNumber = 1
let optionalOutputAttempts = 0

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitFor(predicate, message, timeoutMs = 15000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }

    await wait(100)
  }

  throw new Error(message)
}

async function waitForPort(host, nextPort, timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const ready = await new Promise((resolve) => {
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

    if (ready) {
      return
    }

    await wait(100)
  }

  throw new Error(`Timed out waiting for ${host}:${nextPort}`)
}

function startDevServer() {
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
        VITE_SUPABASE_URL: 'http://fixture.supabase.test',
        VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
      },
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

async function stopDevServer(server) {
  if (!server?.child || server.child.exitCode !== null) {
    return
  }

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

function getEqFilter(url, column) {
  const value = new URL(url).searchParams.get(column) || ''
  return value.startsWith('eq.') ? value.slice(3) : ''
}

async function fulfillJson(route, status, payload, extraHeaders = {}) {
  await route.fulfill({
    status,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info, prefer',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      ...extraHeaders,
    },
    contentType: 'application/json',
    body: status === 204 ? '' : JSON.stringify(payload),
  })
}

function wantsSingleObject(request) {
  return String(request.headers().accept || '').includes('application/vnd.pgrst.object+json')
}

function activeDraftsForRequest(url) {
  const contextKey = getEqFilter(url, 'context_key')
  return drafts.filter((draft) => (
    draft.status === 'draft' &&
    (!contextKey || draft.context_key === contextKey)
  ))
}

async function handleDraftRequest(route) {
  const request = route.request()
  const method = request.method()

  if (method === 'GET') {
    requests.draftGets.push(request.url())
    if (refreshMetadataRaceActive) {
      draftReadBeforeFeedbackFormsResolved = true
    }
    const id = getEqFilter(request.url(), 'id')
    const rows = id
      ? drafts.filter((draft) => draft.id === id && draft.status === 'draft')
      : activeDraftsForRequest(request.url())
    await fulfillJson(route, 200, wantsSingleObject(request) ? rows[0] || null : rows)
    return
  }

  if (delayNextDraftWrite) {
    delayNextDraftWrite = false
    await wait(400)
  }

  const payload = request.postDataJSON()

  if (method === 'POST') {
    requests.draftPosts.push({ body: payload, url: request.url() })
    const row = {
      ...payload,
      id: `44444444-4444-4444-8444-${String(nextDraftNumber++).padStart(12, '0')}`,
      created_at: payload.created_at || new Date().toISOString(),
    }
    drafts.push(row)
    await fulfillJson(route, 201, wantsSingleObject(request) ? row : [row], { 'content-range': '0-0/1' })
    return
  }

  if (method === 'PATCH') {
    requests.draftPatches.push({ body: payload, url: request.url() })
    const id = getEqFilter(request.url(), 'id')
    const row = drafts.find((draft) => !id || draft.id === id)

    if (row) {
      Object.assign(row, payload)
    }

    await fulfillJson(route, 200, wantsSingleObject(request) ? row || null : row ? [row] : [], {
      'content-range': row ? '0-0/1' : '*/0',
    })
  }
}

async function preparePage(context) {
  await context.route('**/.netlify/functions/**', async (route) => {
    const payload = route.request().postDataJSON()

    if (payload?.action === 'resolve_development_recipients') {
      await fulfillJson(route, 200, {
        success: true,
        recipients: [{
          linkId: '66666666-6666-4666-8666-666666666666',
          name: 'Synthetic Parent',
          email: 'synthetic-parent@example.test',
          contactSource: 'auth_user',
          communicationsPreferenceExplicit: false,
          type: 'parent',
          primary: true,
          eligible: true,
          unavailableReason: '',
        }],
      })
      return
    }

    if (payload?.action === 'finalize_development_parent_report') {
      requests.reportFinalizations.push(payload)
      await fulfillJson(route, 200, {
        success: true,
        evaluationId: payload.evaluationId,
        reportVersion: 1,
        responseCount: Array.isArray(payload.responses) ? payload.responses.length : 0,
      })
      return
    }

    if (payload?.action === 'confirm_development_submission') {
      requests.submissionConfirmations.push(payload)
      await fulfillJson(route, 200, {
        success: true,
        operationId: payload.operationId,
        evaluationId: payload.evaluationId,
        confirmationHash: 'synthetic-confirmation',
        confirmedAt: new Date().toISOString(),
      })
      return
    }

    requests.optionalOutputs.push(payload)

    if (failOptionalOutput) {
      optionalOutputAttempts += 1
      await fulfillJson(route, 503, { error: 'Synthetic optional output failure' })
      return
    }

    await fulfillJson(route, 200, { success: true })
  })
  await context.route('**/auth/v1/**', async (route) => {
    await fulfillJson(route, 200, {})
  })
  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request()

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, 204, {})
      return
    }

    const tableName = getTableName(request.url())

    if (tableName === 'evaluation_drafts') {
      await handleDraftRequest(route)
      return
    }

    if (tableName === 'feedback_forms' && request.method() === 'GET' && refreshMetadataRaceActive) {
      await wait(1500)
      refreshMetadataRaceActive = false
    }

    if (tableName === 'evaluations' && request.method() === 'POST') {
      const payload = request.postDataJSON()
      const row = {
        ...payload,
        id: `55555555-5555-4555-8555-${String(nextEvaluationNumber++).padStart(12, '0')}`,
        created_at: new Date().toISOString(),
      }
      requests.evaluationPosts.push({ body: payload, url: request.url() })
      evaluations.push(row)
      await fulfillJson(route, 201, wantsSingleObject(request) ? row : [row], { 'content-range': '0-0/1' })
      return
    }

    if (tableName === 'evaluations' && request.method() === 'PATCH') {
      const payload = request.postDataJSON()
      const id = getEqFilter(request.url(), 'id')
      const row = evaluations.find((evaluation) => !id || evaluation.id === id)
      requests.evaluationPatches.push({ body: payload, url: request.url() })

      if (row) {
        Object.assign(row, payload)
      }

      await fulfillJson(route, 200, wantsSingleObject(request) ? row || null : row ? [row] : [], {
        'content-range': row ? '0-0/1' : '*/0',
      })
      return
    }

    if (request.method() === 'POST') {
      const payload = request.postDataJSON()
      const row = { id: crypto.randomUUID(), ...payload }
      await fulfillJson(route, 201, wantsSingleObject(request) ? row : [row], { 'content-range': '0-0/1' })
      return
    }

    const rowsByTable = {
      assessment_sessions: [],
      clubs: [{
        id: 'club-fixture',
        name: 'Fixture United',
        plan_key: 'small_club',
        plan_status: 'active',
      }],
      email_templates: [],
      evaluations,
      feedback_form_starter_preferences: [],
      feedback_form_starter_templates: [],
      feedback_forms: customForms,
      form_fields: defaultFields,
      parent_player_links: [{
        id: '66666666-6666-4666-8666-666666666666',
        club_id: 'club-fixture',
        team_id: 'team-u12',
        player_id: 'player-second',
        guardian_id: null,
        auth_user_id: '77777777-7777-4777-8777-777777777777',
        email: 'synthetic-parent@example.test',
        relationship: 'Parent',
        primary_contact: true,
        receives_communications: false,
        status: 'active',
        created_at: '2026-07-26T12:02:00.000Z',
      }],
      players: request.url().includes('status=eq.archived') ? [] : players,
      scheduled_emails: [],
      teams,
    }
    let rows = rowsByTable[tableName] || []
    const id = getEqFilter(request.url(), 'id')
    const playerName = getEqFilter(request.url(), 'player_name')

    if (id) {
      rows = rows.filter((row) => String(row.id) === id)
    }
    if (playerName) {
      rows = rows.filter((row) => String(row.player_name ?? row.playerName) === playerName)
    }

    await fulfillJson(route, 200, wantsSingleObject(request) ? rows[0] || null : rows, {
      'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
    })
  })

  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message)
  })

  return { page, consoleErrors }
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('you@club.com').fill('manager.fixture@footballplayer.test')
  await page.getByPlaceholder('Enter password').fill(fixturePassword)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL('**/coach', { timeout: 15000 })
}

async function closePreviousPrompt(page, label = 'Keep Closed') {
  const button = page.getByRole('button', { name: label })

  if (await button.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await button.click()
  }
}

function developmentUrl(player, playerId, formId) {
  const params = new URLSearchParams({
    player,
    playerId,
    team: 'U12 Fixture Team',
    section: 'Squad',
    feedbackForm: formId,
  })
  return `${baseUrl}/assess-player/new?${params.toString()}`
}

function scoreSelect(page, label) {
  return page.locator('label').filter({ hasText: label }).locator('select')
}

const server = startDevServer()
let browser

try {
  await waitForPort('127.0.0.1', port)
  browser = await chromium.launch()
  const context = await browser.newContext(
    isMobile
      ? {
          hasTouch: true,
          isMobile: true,
          viewport: { height: 844, width: 390 },
        }
      : {},
  )
  const { page, consoleErrors } = await preparePage(context)
  await signIn(page)

  await page.goto(developmentUrl('Fixture Player', 'player-fixture', formAId), {
    waitUntil: 'domcontentloaded',
  })
  await page.getByRole('heading', { name: 'Development fields' }).waitFor({
    state: 'visible',
    timeout: 15000,
  })
  await closePreviousPrompt(page)
  await page.getByRole('combobox', { name: 'Form' }).waitFor({ state: 'visible' })
  await page.waitForTimeout(1200)

  const quietBaseline = {
    gets: requests.draftGets.filter((url) => new URL(url).searchParams.has('id')).length,
    patches: requests.draftPatches.length,
    posts: requests.draftPosts.length,
  }

  await page.getByLabel('Report date').fill('2026-07-26')
  await scoreSelect(page, 'Custom A Score').selectOption('5')
  await page.getByText('Unsaved changes', { exact: true }).waitFor({ state: 'visible' })
  await page.waitForTimeout(observationMs)

  assert.equal(requests.draftPosts.length, quietBaseline.posts, 'Editing and waiting must not insert a draft.')
  assert.equal(requests.draftPatches.length, quietBaseline.patches, 'Editing and waiting must not update a draft.')
  assert.equal(
    requests.draftGets.filter((url) => new URL(url).searchParams.has('id')).length,
    quietBaseline.gets,
    'Editing and waiting must not reconcile a draft.',
  )

  delayNextDraftWrite = true
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Save Draft')
    button?.click()
    button?.click()
  })
  await page.getByText('Draft saved', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(requests.draftPosts.length, quietBaseline.posts + 1, 'Repeated active Save Draft clicks must create one request.')
  assert.equal(requests.draftPatches.length, quietBaseline.patches)

  const savedDraftId = drafts.find((draft) => draft.status === 'draft' && draft.draft_data?.selectedFeedbackFormId === formAId)?.id
  assert.ok(savedDraftId, 'The custom form draft must exist after explicit save.')

  refreshMetadataRaceActive = true
  await page.reload({ waitUntil: 'domcontentloaded' })
  await closePreviousPrompt(page)
  await page.getByText('Draft saved', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(
    draftReadBeforeFeedbackFormsResolved,
    true,
    'The refresh regression must restore the saved draft before delayed custom-form metadata resolves.',
  )
  assert.equal(await page.getByLabel('Report date').inputValue(), '2026-07-26')
  assert.equal(await page.getByRole('combobox', { name: 'Form' }).inputValue(), formAId)
  assert.equal(await scoreSelect(page, 'Custom A Score').inputValue(), '5')

  const refreshQuietCounts = {
    gets: requests.draftGets.length,
    patches: requests.draftPatches.length,
    posts: requests.draftPosts.length,
  }
  await page.waitForTimeout(1500)
  assert.deepEqual(
    {
      gets: requests.draftGets.length,
      patches: requests.draftPatches.length,
      posts: requests.draftPosts.length,
    },
    refreshQuietCounts,
    'A restored explicit draft must remain network quiet.',
  )

  await scoreSelect(page, 'Custom A Score').selectOption('6')
  await page.getByText('Unsaved changes', { exact: true }).waitFor({ state: 'visible' })
  await closePreviousPrompt(page)
  await page.getByRole('combobox', { name: 'Form' }).selectOption(formBId)
  await page.getByText('You have unsaved changes. Leave without saving?', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Stay and continue editing' }).click()
  assert.equal(await page.getByRole('combobox', { name: 'Form' }).inputValue(), formAId)
  assert.equal(await scoreSelect(page, 'Custom A Score').inputValue(), '6')

  await page.getByRole('button', { name: 'Save Draft' }).click()
  await waitFor(
    () => requests.draftPatches.length === quietBaseline.patches + 1,
    'Timed out waiting for the second explicit save to update the draft.',
  )
  await page.getByText('Draft saved', { exact: true }).first().waitFor({ state: 'visible' })
  assert.equal(requests.draftPatches.length, quietBaseline.patches + 1, 'Saving again must update the same draft.')
  assert.equal(drafts.filter((draft) => draft.id === savedDraftId).length, 1)

  await page.getByRole('combobox', { name: 'Form' }).selectOption(formBId)
  await scoreSelect(page, 'Custom B Score').waitFor({ state: 'visible' })
  assert.equal(await scoreSelect(page, 'Custom B Score').inputValue(), '', 'The new form must not receive the previous form value.')
  assert.equal(await page.getByText('Unsaved changes', { exact: true }).isVisible().catch(() => false), false)

  await scoreSelect(page, 'Custom B Score').selectOption('7')
  const writesBeforeFormBSave = requests.draftPosts.length + requests.draftPatches.length
  await page.getByRole('button', { name: 'Save Draft' }).click()
  await waitFor(
    () => requests.draftPosts.length + requests.draftPatches.length === writesBeforeFormBSave + 1,
    'Timed out waiting for the custom B draft save.',
  )
  await page.getByText('Draft saved', { exact: true }).first().waitFor({ state: 'visible' })
  const formBDraft = drafts.find((draft) => draft.status === 'draft' && draft.draft_data?.selectedFeedbackFormId === formBId)
  assert.ok(formBDraft)

  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Save record without email')
    button?.click()
    button?.click()
  })
  await page.getByRole('heading', { name: 'Final Development submission review' }).waitFor({ timeout: 20000 })
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Save record without email')
    button?.click()
    button?.click()
  })
  await page.getByRole('heading', { name: 'Development record saved' }).waitFor({ timeout: 15000 })

  assert.equal(requests.evaluationPosts.length, 1, 'Repeated submit clicks must create one evaluation.')
  assert.equal(formBDraft.status, 'submitted', 'Final submission must close the matching draft.')
  assert.equal(drafts.filter((draft) => draft.status === 'draft' && draft.id === formBDraft.id).length, 0)
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.goto(developmentUrl('Second Fixture Player', 'player-second', formAId), {
    waitUntil: 'domcontentloaded',
  })
  await scoreSelect(page, 'Custom A Score').waitFor({ state: 'visible' })
  assert.equal(await scoreSelect(page, 'Custom A Score').inputValue(), '')
  assert.equal(await page.getByText('Unsaved changes', { exact: true }).isVisible().catch(() => false), false)

  await page.getByLabel('Report date').fill('2026-07-27')
  await scoreSelect(page, 'Custom A Score').selectOption('4')
  const writesBeforeDiscardDraftSave = requests.draftPosts.length + requests.draftPatches.length
  await page.getByRole('button', { name: 'Save Draft' }).click()
  await waitFor(
    () => requests.draftPosts.length + requests.draftPatches.length === writesBeforeDiscardDraftSave + 1,
    'Timed out waiting for the discard-path draft save.',
  )
  const discardDraft = drafts.find((draft) => (
    draft.status === 'draft' &&
    draft.player_id === 'player-second' &&
    draft.draft_data?.selectedFeedbackFormId === formAId
  ))
  assert.ok(discardDraft)
  await page.getByRole('button', { name: 'Discard Draft' }).click()
  await waitFor(
    () => discardDraft.status === 'discarded',
    'Timed out waiting for explicit draft discard.',
  )
  const writesAfterDiscard = requests.draftPosts.length + requests.draftPatches.length
  await page.waitForTimeout(1500)
  assert.equal(
    requests.draftPosts.length + requests.draftPatches.length,
    writesAfterDiscard,
    'Discard must not recreate a draft.',
  )

  await page.goto(developmentUrl('Fixture Player', 'player-fixture', formBId), {
    waitUntil: 'domcontentloaded',
  })
  await page.getByRole('button', { name: 'Show Previous Scores' }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Show Previous Scores' }).click()
  await page.getByText('Score: 7.0', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  const savedEvaluation = evaluations.at(-1)
  assert.equal(savedEvaluation.feedback_form_name, 'Custom B Form')
  assert.equal(savedEvaluation.feedback_form_version, 2)
  assert.equal(savedEvaluation.feedback_form_snapshot?.fields?.[0]?.label, 'Custom B Score')

  await page.goto(developmentUrl('Second Fixture Player', 'player-second', formBId), {
    waitUntil: 'domcontentloaded',
  })
  await scoreSelect(page, 'Custom B Score').waitFor({ state: 'visible' })
  await page.getByLabel('Report date').fill('2026-07-28')
  await scoreSelect(page, 'Custom B Score').selectOption('8')
  const linkedRecipient = page.getByText('synthetic-parent@example.test', { exact: true })
  await linkedRecipient.waitFor({ state: 'visible', timeout: 15000 })
  await page.getByLabel('Email selected parents').check()
  const evaluationsBeforeOptionalFailure = requests.evaluationPosts.length
  const evaluationPatchesBeforeOptionalFailure = requests.evaluationPatches.length
  const draftsBeforeOptionalFailure = requests.draftPosts.length + requests.draftPatches.length
  failOptionalOutput = true
  await page.getByRole('button', { name: 'Save record and send email' }).click()
  await page.getByRole('heading', { name: 'Default template' }).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Use template and review submission' }).click()
  await page.getByRole('heading', { name: 'Final Development submission review' }).waitFor({ timeout: 20000 })
  await page.getByRole('dialog').getByRole('button', { name: 'Save record and send email' }).click()
  await page.getByRole('heading', {
    name: 'Development record saved with output action needed',
  }).waitFor({ timeout: 15000 })
  assert.equal(
    requests.evaluationPosts.length,
    evaluationsBeforeOptionalFailure + 1,
    'Optional output failure must preserve the saved evaluation.',
  )
  assert.equal(optionalOutputAttempts, 1)
  assert.deepEqual(
    requests.optionalOutputs.at(-1)?.selectedParentLinkIds,
    ['66666666-6666-4666-8666-666666666666'],
    'The failed send must use the selected linked recipient ID.',
  )
  assert.equal(await linkedRecipient.isVisible(), true, 'The linked recipient must remain visible after failure.')
  assert.equal(
    await linkedRecipient.locator('xpath=ancestor::label').locator('input[type="checkbox"]').isChecked(),
    true,
    'The linked recipient must remain selected after failure.',
  )
  failOptionalOutput = false
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('button', { name: 'Save record and send email' }).click()
  await page.getByRole('heading', { name: 'Final Development submission review' }).waitFor({ timeout: 20000 })
  await page.getByRole('dialog').getByRole('button', { name: 'Save record and send email' }).click()
  await page.getByRole('heading', {
    name: 'Development record saved',
  }).waitFor({ timeout: 15000 })

  assert.equal(
    requests.evaluationPosts.length,
    evaluationsBeforeOptionalFailure + 1,
    'Retry must not create another evaluation.',
  )
  assert.equal(
    requests.evaluationPatches.length,
    evaluationPatchesBeforeOptionalFailure,
    'Unchanged retry must not update the saved evaluation.',
  )
  assert.equal(
    requests.draftPosts.length + requests.draftPatches.length,
    draftsBeforeOptionalFailure,
    'Failure and retry must not create or update a draft.',
  )
  assert.equal(requests.optionalOutputs.length, 2, 'Failure plus retry must create exactly two output attempts.')
  assert.deepEqual(
    requests.optionalOutputs.map((payload) => payload.selectedParentLinkIds),
    [
      ['66666666-6666-4666-8666-666666666666'],
      ['66666666-6666-4666-8666-666666666666'],
    ],
    'Retry must preserve the same selected linked recipient ID.',
  )

  const seriousConsoleErrors = consoleErrors.filter(
    (message) => !/favicon|404|Synthetic optional output failure|status of 503|Email failed/.test(message),
  )
  assert.deepEqual(seriousConsoleErrors, [])
  await context.close()

  console.log(
    `ok ${isMobile ? 'mobile' : 'desktop'} manual Development draft journey with ${observationMs} ms quiet observation`,
  )
} catch (error) {
  console.error(JSON.stringify({
    device: isMobile ? 'mobile' : 'desktop',
    draftGetCount: requests.draftGets.length,
    draftPatchCount: requests.draftPatches.length,
    draftPostCount: requests.draftPosts.length,
    evaluationPostCount: requests.evaluationPosts.length,
    reportFinalizationCount: requests.reportFinalizations.length,
  }))
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
