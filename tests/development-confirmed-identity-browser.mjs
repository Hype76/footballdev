import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { chromium } from 'playwright'

const fixturePassword = 'FixturePass123!'
const port = Number(process.env.DEVELOPMENT_CONFIRMED_IDENTITY_BROWSER_PORT || 5300 + Math.floor(Math.random() * 500))
const baseUrl = `http://127.0.0.1:${port}`
const isMobile = process.env.DEVELOPMENT_CONFIRMED_IDENTITY_DEVICE === 'mobile'
const defaultFormId = '__default_development_form__'
const actorId = 'user-manager.fixture@footballplayer.test'

const formFields = [
  {
    id: 'field-distribution',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    label: 'Distribution',
    type: 'score_1_10',
    options: [],
    required: false,
    is_enabled: true,
    include_in_progress_chart: true,
    is_default: false,
    order_index: 1,
  },
]

const teams = [
  {
    id: 'team-u12',
    club_id: 'club-fixture',
    name: 'U12 Fixture Team',
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
]

const previousEvaluations = [
  {
    id: 'evaluation-previous',
    player_id: 'player-fixture',
    player_name: 'Fixture Player',
    club_id: 'club-fixture',
    team_id: 'team-u12',
    team: 'U12 Fixture Team',
    section: 'Squad',
    session: '2026-06-20',
    date: '20/06/2026',
    coach_id: actorId,
    coach: 'Manager Fixture',
    created_at: '2026-06-20T09:00:00.000Z',
    form_responses: {},
    scores: {},
    comments: {},
    status: 'Submitted',
  },
]

let storedDraft = {
  id: 'draft-fixture',
  club_id: 'club-fixture',
  team_id: 'team-u12',
  player_id: 'player-fixture',
  created_by_user_id: actorId,
  report_type: 'development_record',
  context_key: 'fixture-context',
  client_save_version: 1,
  draft_data: {
    formData: {
      playerId: 'player-fixture',
      playerName: 'Fixture Player',
      teamId: 'team-u12',
      team: 'U12 Fixture Team',
      section: 'Squad',
      session: '2026-07-26',
      coachName: 'Manager Fixture',
      parentName: '',
      parentEmail: '',
      parentContacts: [],
    },
    responseValues: {
      'field-distribution': '',
    },
    selectedFeedbackFormId: defaultFormId,
    lastUsedSession: '2026-07-26',
    previewMode: 'scored',
    emailTemplateKey: '',
    selectedParentContactIndexes: [0],
    inviteDate: '',
    offlineDraftId: 'offline-fixture',
    isPdfAttachmentApproved: false,
    includeAttendanceSummary: true,
    emailSendMode: 'now',
    scheduledEmailDateTime: '',
    selectedExportLabels: null,
    archiveAfterNoPlace: false,
    draftMeta: {
      clientSaveVersion: 1,
      clientSavedAt: '2026-07-26T12:00:00.000Z',
    },
    draftContext: {
      clubId: 'club-fixture',
      createdByUserId: actorId,
      teamId: 'team-u12',
      teamName: 'U12 Fixture Team',
      playerId: 'player-fixture',
      playerName: 'Fixture Player',
      formId: defaultFormId,
      formVersion: 1,
      formType: 'development_record',
      section: 'Squad',
      session: '2026-07-26',
    },
  },
  status: 'draft',
  last_saved_at: '2026-07-26T12:00:00.000Z',
  created_at: '2026-07-26T12:00:00.000Z',
  updated_at: '2026-07-26T12:00:00.000Z',
}

const requests = {
  draftGets: [],
  draftPatches: [],
  draftPosts: [],
}
let simulatedZeroRowPatch = false

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
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
    VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
    VITE_SUPABASE_URL: 'http://fixture.supabase.test',
    VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
  }
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`],
    {
      cwd: process.cwd(),
      env,
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

function applyDraftWrite(writePayload) {
  const now = new Date().toISOString()
  storedDraft = {
    ...storedDraft,
    ...writePayload,
    id: storedDraft.id,
    draft_data: writePayload.draft_data,
    last_saved_at: writePayload.last_saved_at || now,
    updated_at: writePayload.updated_at || now,
  }
}

async function preparePage(context) {
  await context.route('**/.netlify/functions/**', async (route) => {
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
      if (request.method() === 'GET') {
        requests.draftGets.push(request.url())
        await fulfillJson(route, 200, [storedDraft])
        return
      }

      if (request.method() === 'POST') {
        requests.draftPosts.push({
          body: request.postDataJSON(),
          url: request.url(),
        })
        applyDraftWrite(request.postDataJSON())
        await fulfillJson(route, 201, [storedDraft], { 'content-range': '0-0/1' })
        return
      }

      if (request.method() === 'PATCH') {
        const writePayload = request.postDataJSON()
        const requestVersion = Number(writePayload.client_save_version || 0)
        requests.draftPatches.push({
          body: writePayload,
          url: request.url(),
        })

        if (!simulatedZeroRowPatch) {
          simulatedZeroRowPatch = true
          applyDraftWrite(writePayload)
          await fulfillJson(route, 200, [], { 'content-range': '*/0' })
          return
        }

        if (requestVersion <= Number(storedDraft.client_save_version || 0)) {
          await fulfillJson(route, 200, [], { 'content-range': '*/0' })
          return
        }

        applyDraftWrite(writePayload)
        await fulfillJson(route, 200, [storedDraft], { 'content-range': '0-0/1' })
        return
      }
    }

    const payloadByTable = {
      assessment_sessions: [],
      email_templates: [],
      evaluations: previousEvaluations,
      feedback_forms: [],
      form_fields: formFields,
      parent_player_links: [],
      players: request.url().includes('status=eq.archived') ? [] : players,
      scheduled_emails: [],
      teams,
    }

    await fulfillJson(route, 200, payloadByTable[tableName] || [])
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

async function waitForCount(getCount, expected, timeoutMs = 15000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (getCount() >= expected) {
      return
    }

    await wait(100)
  }

  throw new Error(`Timed out waiting for request count ${expected}. Current count: ${getCount()}`)
}

async function forceParentRerenders(page) {
  const keepClosedButton = page.getByRole('button', { name: 'Keep Closed' })

  if (await keepClosedButton.isVisible().catch(() => false)) {
    await keepClosedButton.click()
  }

  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: 'View previous records' }).click()
    await page.getByRole('button', { name: 'Hide previous records' }).click()
  }
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
  const query = new URLSearchParams({
    player: 'Fixture Player',
    playerId: 'player-fixture',
    team: 'U12 Fixture Team',
    section: 'Squad',
    session: '2026-07-26',
    feedbackForm: defaultFormId,
  })
  await page.goto(`${baseUrl}/assess-player/new?${query.toString()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Development fields' }).waitFor({ state: 'visible', timeout: 15000 })
  await page.getByText(/Private database draft loaded|Draft ready/, { exact: true }).waitFor({
    state: 'visible',
    timeout: 15000,
  })
  await page.waitForTimeout(1500)

  assert.equal(requests.draftPosts.length, 0, 'Hydration must not insert a blank draft.')
  assert.equal(requests.draftPatches.length, 0, 'Hydration must not update a draft.')

  await page.evaluate(() => {
    window.__developmentDraftStatusTransitions = []
    const statuses = new Set([
      'Draft ready',
      'Unsaved changes',
      'Saving draft...',
      'Retrying...',
      'Draft could not be saved',
      'Draft saved',
      'Working offline',
    ])
    const recordStatuses = () => {
      const texts = [...document.querySelectorAll('h1, h2, h3, p, span')]
        .map((element) => element.textContent?.trim())
        .filter((value) => statuses.has(value))
      texts.forEach((value) => {
        if (window.__developmentDraftStatusTransitions.at(-1) !== value) {
          window.__developmentDraftStatusTransitions.push(value)
        }
      })
    }
    recordStatuses()
    window.__developmentDraftStatusObserver = new MutationObserver(recordStatuses)
    window.__developmentDraftStatusObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  })

  const distributionSelect = page
    .locator('label')
    .filter({ hasText: 'Distribution' })
    .locator('select')

  await distributionSelect.selectOption('5')
  await waitForCount(() => requests.draftPatches.length, 1)
  await waitForCount(
    () => requests.draftGets.filter((url) => new URL(url).searchParams.has('id')).length,
    1,
  )
  await page.getByText('Draft saved', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })

  const confirmedCounts = {
    gets: requests.draftGets.length,
    patches: requests.draftPatches.length,
    posts: requests.draftPosts.length,
    version: storedDraft.client_save_version,
  }

  await forceParentRerenders(page)
  await page.waitForTimeout(35500)

  assert.equal(requests.draftGets.length, confirmedCounts.gets, 'Confirmed identity must not trigger another readback GET.')
  assert.equal(requests.draftPatches.length, confirmedCounts.patches, 'Confirmed identity must not trigger another PATCH.')
  assert.equal(requests.draftPosts.length, confirmedCounts.posts, 'Confirmed identity must not trigger another insert.')
  assert.equal(storedDraft.client_save_version, confirmedCounts.version, 'Confirmed identity must not increment the server version.')

  const firstQuietTransitions = await page.evaluate(() => window.__developmentDraftStatusTransitions)
  const savedTransitionIndex = firstQuietTransitions.lastIndexOf('Draft saved')
  assert.ok(savedTransitionIndex >= 0, 'Draft saved must be observed after reconciliation.')
  assert.equal(
    firstQuietTransitions.slice(savedTransitionIndex + 1).includes('Unsaved changes'),
    false,
    'Status must not return to Unsaved changes without a genuine edit.',
  )

  await distributionSelect.evaluate((select) => {
    select.value = '5'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(1500)
  assert.equal(requests.draftPatches.length, confirmedCounts.patches, 'Equivalent value assignment must not save again.')

  await distributionSelect.selectOption('6')
  await waitForCount(() => requests.draftPatches.length, confirmedCounts.patches + 1)
  await page.getByText('Draft saved', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(storedDraft.client_save_version, confirmedCounts.version + 1, 'Second genuine edit must increment once.')
  await page.waitForTimeout(2500)
  assert.equal(requests.draftPatches.length, confirmedCounts.patches + 1, 'Second genuine edit must save exactly once.')
  assert.equal(requests.draftPosts.length, 0)
  assert.equal(storedDraft.id, 'draft-fixture')

  const seriousConsoleErrors = consoleErrors.filter((message) => !/favicon|404/.test(message))
  assert.deepEqual(seriousConsoleErrors, [])
  await context.close()

  console.log(`ok ${isMobile ? 'mobile' : 'desktop'} confirmed draft identity survives page rerenders and a 35 second quiet period`)
} catch (error) {
  console.error(JSON.stringify({
    draftGetCount: requests.draftGets.length,
    draftPatchCount: requests.draftPatches.length,
    draftPostCount: requests.draftPosts.length,
    storedVersion: storedDraft.client_save_version,
  }))
  console.error(server.getOutput())
  throw error
} finally {
  if (browser) {
    await browser.close()
  }
  await stopDevServer(server)
}
