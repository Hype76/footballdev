import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const baseUrl = String(process.env.FP_SMOKE_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const email = String(process.env.FPTEST_EMAIL || '').trim()
const password = String(process.env.FPTEST_PASSWORD || '')
const keepBrowser = process.env.FP_SMOKE_HEADFUL === 'true'
const artifactDir = 'output/playwright/fp-v1-calendar-legacy-resource-picker-08'
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)

function parseEnv(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        const key = line.slice(0, index).trim()
        const value = line.slice(index + 1).trim().replace(/^"|"$/g, '')
        return [key, value]
      }),
  )
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(date.getDate() + days)
  return next
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10)
}

async function loadSupabaseConfig() {
  const envFile = parseEnv(await readFile('.env.production', 'utf8'))
  const supabaseUrl = process.env.VITE_SUPABASE_URL || envFile.VITE_SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || envFile.VITE_SUPABASE_PUBLISHABLE_KEY || envFile.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Production Supabase URL and publishable key are required.')
  }

  return { supabaseUrl, supabaseKey }
}

async function getSignedInClient() {
  if (!email || !password) {
    throw new Error('FPTEST_EMAIL and FPTEST_PASSWORD are required.')
  }

  const { supabaseUrl, supabaseKey } = await loadSupabaseConfig()
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    throw error
  }

  return { authUser: data.user, supabase }
}

async function requireSingle(result, message) {
  if (result.error) {
    throw result.error
  }

  if (!result.data) {
    throw new Error(message)
  }

  return result.data
}

async function getSmokeContext(supabase, authUser) {
  const profile = await requireSingle(
    await supabase.from('users').select('*').eq('id', authUser.id).single(),
    'Could not load FP TEST staff profile.',
  )
  const clubId = profile.club_id || profile.clubId

  if (!clubId) {
    throw new Error('FP TEST staff profile has no club_id.')
  }

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('*')
    .eq('club_id', clubId)
    .order('name', { ascending: true })

  if (teamsError) {
    throw teamsError
  }

  const fpTestTeams = (teams || []).filter((team) => /fp\s*test/i.test(String(team.name || '')))
  const activeTeamId = String(profile.active_team_id || profile.activeTeamId || '').trim()
  const teamA = fpTestTeams.find((team) => String(team.id) === activeTeamId) || fpTestTeams[0]
  const teamB = fpTestTeams.find((team) => String(team.id) !== String(teamA?.id || ''))

  if (!teamA?.id) {
    throw new Error('No FP TEST team was available. Refusing to use real team data.')
  }

  return {
    authUser,
    clubId,
    profile,
    teamA,
    teamB: teamB || null,
  }
}

async function insertResource(supabase, { clubId, team, title, uploadedBy }) {
  const resourceId = randomUUID()
  const storagePath = `${clubId}/${team.id}/${resourceId}/fp-test-smoke.txt`
  const { data, error } = await supabase
    .from('resource_library_items')
    .insert({
      id: resourceId,
      club_id: clubId,
      team_id: team.id,
      title,
      description: 'FP TEST browser smoke resource.',
      category: 'training',
      storage_bucket: 'resource-library',
      storage_path: storagePath,
      original_filename: 'fp-test-smoke.txt',
      mime_type: 'text/plain',
      file_size_bytes: 32,
      uploaded_by_profile_id: uploadedBy,
    })
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

async function prepareSmokeData(supabase, context) {
  const now = new Date()
  const firstDate = addDays(now, 2)
  const legacyTitle = `FP TEST Legacy Repeat 08 ${stamp}`
  const resourceTitle = `FP TEST Picker Resource 08 ${stamp}`
  const wrongTeamResourceTitle = `FP TEST Wrong Team Resource 08 ${stamp}`
  const eventTitle = `FP TEST Picker Event 08 ${stamp}`
  const sessionsToInsert = [0, 7, 14].map((offset) => ({
    club_id: context.clubId,
    team_id: context.teamA.id,
    team: context.teamA.name,
    session_type: 'training',
    session_date: toDateInput(addDays(firstDate, offset)),
    start_time: '18:00',
    end_time: '19:00',
    location: 'FP TEST Pitch',
    notes: 'FP TEST legacy recurring smoke.',
    title: legacyTitle,
    status: 'open',
    created_by: context.authUser.id,
  }))

  const { data: sessions, error: sessionError } = await supabase
    .from('assessment_sessions')
    .insert(sessionsToInsert)
    .select('*')

  if (sessionError) {
    throw sessionError
  }

  const sameTeamResource = await insertResource(supabase, {
    clubId: context.clubId,
    team: context.teamA,
    title: resourceTitle,
    uploadedBy: context.authUser.id,
  })
  const wrongTeamResource = context.teamB
    ? await insertResource(supabase, {
      clubId: context.clubId,
      team: context.teamB,
      title: wrongTeamResourceTitle,
      uploadedBy: context.authUser.id,
    })
    : null

  return {
    eventTitle,
    firstDate: toDateInput(firstDate),
    legacyTitle,
    resourceTitle,
    sameTeamResource,
    sessions,
    shiftedFirstDate: toDateInput(addDays(firstDate, 1)),
    wrongTeamResource,
    wrongTeamResourceTitle,
  }
}

async function cleanupSmokeData(supabase, context, data) {
  const createdSessionIds = new Set((data.sessions || []).map((session) => session.id))

  if (createdSessionIds.size > 0) {
    await supabase
      .from('assessment_sessions')
      .delete()
      .eq('club_id', context.clubId)
      .in('id', [...createdSessionIds])
  }

  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, team_id')
    .eq('club_id', context.clubId)
    .eq('title', data.eventTitle)

  for (const event of events || []) {
    const { data: links } = await supabase
      .from('resource_library_links')
      .select('id')
      .eq('club_id', context.clubId)
      .eq('linked_type', 'calendar_event')
      .eq('linked_id', event.id)
      .is('removed_at', null)

    for (const link of links || []) {
      await supabase.rpc('remove_resource_library_link', {
        target_link_id: link.id,
        target_club_id: context.clubId,
        target_team_id: event.team_id,
      })
    }

    await supabase.from('calendar_events').delete().eq('club_id', context.clubId).eq('id', event.id)
  }

  for (const resource of [data.sameTeamResource, data.wrongTeamResource].filter(Boolean)) {
    await supabase.rpc('archive_resource_library_item', {
      target_resource_id: resource.id,
      target_club_id: context.clubId,
      target_team_id: resource.team_id,
    })
  }

  const { data: cantLoginResources } = await supabase
    .from('resource_library_items')
    .select('id, title, team_id, archived_at')
    .eq('club_id', context.clubId)
    .eq('team_id', context.teamA.id)
    .ilike('title', 'Cant login')
    .is('archived_at', null)

  for (const resource of cantLoginResources || []) {
    await supabase.rpc('archive_resource_library_item', {
      target_resource_id: resource.id,
      target_club_id: context.clubId,
      target_team_id: context.teamA.id,
    })
  }

  return { cantLoginArchived: (cantLoginResources || []).length }
}

async function signIn(page) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /^Log in$/i }).click()
  await page.waitForURL((url) => url.pathname !== '/sign-in', { timeout: 30000 })
}

async function assertProtectedRouteRedirects(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    for (const route of ['/resources', '/staff-chat']) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
      await page.waitForURL((url) => url.pathname === '/sign-in', { timeout: 15000 })
    }
  } finally {
    await context.close()
  }
}

async function openCalendar(page) {
  await page.goto(`${baseUrl}/calendar`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Agenda' }).click()
}

async function openCalendarItem(page, title) {
  await page.getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
  await page.getByRole('dialog').getByText(title, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
}

async function selectIfPresent(page, label, optionLabel) {
  const field = label === 'Team'
    ? page.locator('select[name="teamId"]')
    : page.getByLabel(label, { exact: true })

  if (await field.count() === 0) {
    return false
  }

  const option = field.locator('option', { hasText: optionLabel })

  if (await option.count() === 0) {
    return false
  }

  await field.selectOption({ label: optionLabel })
  return true
}

async function runBrowserSmoke(data, context) {
  await mkdir(artifactDir, { recursive: true })
  const browser = await chromium.launch({ headless: !keepBrowser })
  const consoleErrors = []
  const pageErrors = []

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    await assertProtectedRouteRedirects(browser)
    await signIn(page)
    await openCalendar(page)
    assert.equal(await page.getByText('Development Fields', { exact: true }).count(), 0)
    await openCalendarItem(page, data.legacyTitle)
    await page.getByText('This is a repeating event. What do you want to delete?', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'Move or reschedule' }).click()
    await page.getByText('This is a repeating event. How should this date/time change be applied?', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByLabel('Date', { exact: true }).fill(data.shiftedFirstDate)
    await page.getByLabel('Start time', { exact: true }).fill('18:30')
    await page.getByLabel('End time', { exact: true }).fill('19:30')
    await page.locator('select[name="repeatUpdateScope"]').selectOption('entire_series')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 })

    await openCalendar(page)
    await openCalendarItem(page, data.legacyTitle)
    await page.locator('select[name="deleteRepeatScope"]').selectOption('entire_series')
    page.once('dialog', async (dialog) => {
      assert.match(dialog.message(), /repeat series|session/i)
      await dialog.accept()
    })
    await page.getByRole('button', { name: 'Delete event' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 })

    await page.goto(`${baseUrl}/calendar?action=add-event`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('dialog').getByText('Add calendar event', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByLabel('Title').fill(data.eventTitle)
    await selectIfPresent(page, 'Team', context.teamA.name)
    await page.getByText('Attached resources', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'Choose from Team Resource Library' }).click()
    await page.getByLabel('Search resources').fill(data.resourceTitle)
    await page.getByText('Category', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByText(data.resourceTitle, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByText(data.wrongTeamResourceTitle, { exact: true }).count(), 0)
    await page.locator('label').filter({ hasText: data.resourceTitle }).getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Apply' }).click()
    await page.getByText(data.resourceTitle, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 })

    await openCalendar(page)
    await openCalendarItem(page, data.eventTitle)
    await page.getByText('Attached resources', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByText(data.resourceTitle, { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot({ path: `${artifactDir}/desktop-resource-picker-proof.png`, fullPage: true })

    const mobilePage = await browser.newPage({ isMobile: true, viewport: { width: 390, height: 844 } })
    mobilePage.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(`mobile: ${message.text()}`)
      }
    })
    await signIn(mobilePage)
    await mobilePage.goto(`${baseUrl}/calendar?action=add-event`, { waitUntil: 'domcontentloaded' })
    await mobilePage.getByRole('dialog').getByText('Add calendar event', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await mobilePage.getByRole('button', { name: 'Choose from Team Resource Library' }).waitFor({ state: 'visible', timeout: 15000 })
    await mobilePage.screenshot({ path: `${artifactDir}/mobile-add-event-picker-proof.png`, fullPage: true })

    const relevantConsoleErrors = consoleErrors.filter((message) => !/favicon|404|Failed to load resource/.test(message))
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(relevantConsoleErrors, [])
  } finally {
    await browser.close()
  }
}

async function verifyDatabaseState(supabase, context, data) {
  const { data: shiftedSessions, error: shiftedError } = await supabase
    .from('assessment_sessions')
    .select('id, session_date, start_time, end_time, status')
    .eq('club_id', context.clubId)
    .eq('title', data.legacyTitle)

  if (shiftedError) {
    throw shiftedError
  }

  assert.equal((shiftedSessions || []).length, 0, 'Legacy repeat sessions should be removed after delete smoke.')

  const { data: events, error: eventError } = await supabase
    .from('calendar_events')
    .select('id, team_id')
    .eq('club_id', context.clubId)
    .eq('title', data.eventTitle)
    .is('cancelled_at', null)

  if (eventError) {
    throw eventError
  }

  assert.equal((events || []).length, 1)
  assert.equal(events[0].team_id, context.teamA.id)

  const { data: links, error: linkError } = await supabase
    .from('resource_library_links')
    .select('id, resource_id, team_id, linked_type, linked_id')
    .eq('club_id', context.clubId)
    .eq('team_id', context.teamA.id)
    .eq('linked_type', 'calendar_event')
    .eq('linked_id', events[0].id)
    .is('removed_at', null)

  if (linkError) {
    throw linkError
  }

  assert.equal((links || []).length, 1)
  assert.equal(links[0].resource_id, data.sameTeamResource.id)
}

const { authUser, supabase } = await getSignedInClient()
const context = await getSmokeContext(supabase, authUser)
const data = await prepareSmokeData(supabase, context)
let cleanupResult = { cantLoginArchived: 0 }

try {
  await runBrowserSmoke(data, context)
  await verifyDatabaseState(supabase, context, data)
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    team: context.teamA.name,
    wrongTeam: context.teamB?.name || '',
    legacyTitle: data.legacyTitle,
    eventTitle: data.eventTitle,
    resourceTitle: data.resourceTitle,
    screenshots: [
      `${artifactDir}/desktop-resource-picker-proof.png`,
      `${artifactDir}/mobile-add-event-picker-proof.png`,
    ],
  }, null, 2))
} finally {
  cleanupResult = await cleanupSmokeData(supabase, context, data)
  console.log(JSON.stringify({ cleanup: cleanupResult }, null, 2))
  await supabase.auth.signOut()
}
