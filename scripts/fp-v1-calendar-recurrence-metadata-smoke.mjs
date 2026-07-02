import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const baseUrl = String(process.env.FP_SMOKE_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const email = String(process.env.FPTEST_EMAIL || '').trim()
const password = String(process.env.FPTEST_PASSWORD || '')
const keepBrowser = process.env.FP_SMOKE_HEADFUL === 'true'
const artifactDir = 'output/playwright/fp-v1-calendar-recurrence-metadata-10'
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
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDateTime(dateValue, timeValue) {
  return new Date(`${dateValue}T${timeValue}:00`).toISOString()
}

function getDateOnly(value) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  return toDateInput(parsed)
}

function getTimeOnly(value) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function loadSupabaseConfig() {
  const envFile = parseEnv(await readFile('.env.production', 'utf8'))
  const supabaseUrl = process.env.VITE_SUPABASE_URL || envFile.VITE_SUPABASE_URL
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || envFile.VITE_SUPABASE_PUBLISHABLE_KEY
    || envFile.VITE_SUPABASE_ANON_KEY

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
  const team = fpTestTeams.find((entry) => String(entry.id) === activeTeamId) || fpTestTeams[0]

  if (!team?.id) {
    throw new Error('No FP TEST team was available. Refusing to use real team data.')
  }

  return { authUser, clubId, profile, team }
}

async function countQueuedEmails(supabase, clubId, startedAt) {
  const { count, error } = await supabase
    .from('scheduled_email_queue')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .gte('created_at', startedAt)

  if (error) {
    throw error
  }

  return count || 0
}

async function prepareSmokeData(supabase, context) {
  const today = new Date()
  const baseDate = toDateInput(addDays(today, 7))
  const occurrenceDate = toDateInput(addDays(today, 14))
  const untilDate = toDateInput(addDays(today, 28))
  const shiftedOccurrenceDate = toDateInput(addDays(today, 15))
  const shiftedBaseDate = toDateInput(addDays(today, 8))
  const oneOffDate = toDateInput(addDays(today, 9))
  const recurringTitle = `FP TEST Recurrence Metadata 10 ${stamp}`
  const oneOffTitle = `FP TEST One Off Metadata 10 ${stamp}`

  const { data: recurringEvent, error: recurringError } = await supabase
    .from('calendar_events')
    .insert({
      club_id: context.clubId,
      team_id: context.team.id,
      event_type: 'training',
      title: recurringTitle,
      starts_at: toDateTime(baseDate, '09:00'),
      ends_at: toDateTime(baseDate, '10:00'),
      location: 'FP TEST Training Ground',
      notes: 'FP TEST recurring metadata smoke.',
      recurrence_frequency: 'weekly',
      recurrence_until: untilDate,
      parent_visible: false,
      parent_audience: 'none',
      created_by: context.authUser.id,
      updated_by: context.authUser.id,
    })
    .select('*')
    .single()

  if (recurringError) {
    throw recurringError
  }

  const { data: oneOffEvent, error: oneOffError } = await supabase
    .from('calendar_events')
    .insert({
      club_id: context.clubId,
      team_id: context.team.id,
      event_type: 'training',
      title: oneOffTitle,
      starts_at: toDateTime(oneOffDate, '11:00'),
      ends_at: toDateTime(oneOffDate, '12:00'),
      location: 'FP TEST Training Ground',
      notes: 'FP TEST one-off metadata smoke.',
      recurrence_frequency: 'none',
      recurrence_until: null,
      parent_visible: false,
      parent_audience: 'none',
      created_by: context.authUser.id,
      updated_by: context.authUser.id,
    })
    .select('*')
    .single()

  if (oneOffError) {
    throw oneOffError
  }

  return {
    baseDate,
    oneOffDate,
    oneOffEvent,
    oneOffTitle,
    occurrenceDate,
    recurringEvent,
    recurringTitle,
    shiftedBaseDate,
    shiftedOccurrenceDate,
    untilDate,
  }
}

async function cleanupSmokeData(supabase, context, data) {
  const ids = [data?.recurringEvent?.id, data?.oneOffEvent?.id].filter(Boolean)

  if (ids.length > 0) {
    await supabase
      .from('calendar_events')
      .delete()
      .eq('club_id', context.clubId)
      .in('id', ids)
  }
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
    for (const route of ['/calendar', '/resources', '/staff-chat']) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
      await page.waitForURL((url) => url.pathname === '/sign-in', { timeout: 15000 })
    }
  } finally {
    await context.close()
  }
}

async function assertPublicRoutesLoad(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    for (const route of ['/', '/features', '/pricing']) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
      await page.locator('body').waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 15000 })
    }
  } finally {
    await context.close()
  }
}

async function openMonthGrid(page) {
  await page.goto(`${baseUrl}/calendar`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Month' }).click()
}

async function openCalendarButton(page, title) {
  await page.getByRole('button', { name: new RegExp(escapeRegExp(title)) }).first().click()
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15000 })
}

async function runBrowserSmoke(data) {
  await mkdir(artifactDir, { recursive: true })
  const browser = await chromium.launch({ headless: !keepBrowser })
  const consoleErrors = []
  const pageErrors = []

  try {
    await assertProtectedRouteRedirects(browser)
    await assertPublicRoutesLoad(browser)

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    await signIn(page)
    await openMonthGrid(page)
    assert.equal(await page.getByText('Development Fields', { exact: true }).count(), 0)

    await openCalendarButton(page, `${data.recurringTitle} repeats`)
    await page.getByText('This is a repeating event. What do you want to delete?', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    await page.getByRole('button', { name: 'Move or reschedule' }).click()
    await page.getByText('This is a repeating event. How should this date/time change be applied?', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.locator('select[name="recurrenceFrequency"]').inputValue(), 'weekly')
    assert.equal(await page.getByLabel('Date', { exact: true }).inputValue(), data.occurrenceDate)
    assert.equal(await page.getByLabel('Start time', { exact: true }).inputValue(), '09:00')
    assert.equal(await page.getByLabel('End time', { exact: true }).inputValue(), '10:00')
    await page.screenshot({ path: `${artifactDir}/recurring-occurrence-modal-weekly.png`, fullPage: true })

    await page.getByLabel('Date', { exact: true }).fill(data.shiftedOccurrenceDate)
    await page.getByLabel('Start time', { exact: true }).fill('09:15')
    await page.getByLabel('End time', { exact: true }).fill('10:15')
    await page.locator('select[name="repeatUpdateScope"]').selectOption('entire_series')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 })

    await openMonthGrid(page)
    await openCalendarButton(page, data.oneOffTitle)
    await page.getByRole('button', { name: 'Move or reschedule' }).click()
    assert.equal(await page.locator('select[name="recurrenceFrequency"]').inputValue(), 'none')
    assert.equal(await page.locator('select[name="repeatUpdateScope"]').count(), 0)
    await page.screenshot({ path: `${artifactDir}/one-off-modal-still-none.png`, fullPage: true })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 })

    const relevantConsoleErrors = consoleErrors.filter((message) => !/favicon|404|Failed to load resource|TypeError: Failed to fetch/.test(message))
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(relevantConsoleErrors, [])
  } finally {
    await browser.close()
  }
}

async function deleteRecurringSeriesInBrowser(data) {
  const browser = await chromium.launch({ headless: !keepBrowser })

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    await signIn(page)
    await openMonthGrid(page)
    await openCalendarButton(page, `${data.recurringTitle} repeats`)
    await page.locator('select[name="deleteRepeatScope"]').selectOption('entire_series')
    page.once('dialog', async (dialog) => {
      assert.match(dialog.message(), /entire repeat series/i)
      await dialog.accept()
    })
    await page.getByRole('button', { name: 'Delete event' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 })
  } finally {
    await browser.close()
  }
}

async function verifyDatabaseState(supabase, context, data) {
  const { data: shiftedEvent, error: shiftedError } = await supabase
    .from('calendar_events')
    .select('id, starts_at, ends_at, recurrence_frequency, recurrence_until')
    .eq('id', data.recurringEvent.id)
    .eq('club_id', context.clubId)
    .single()

  if (shiftedError) {
    throw shiftedError
  }

  assert.equal(shiftedEvent.recurrence_frequency, 'weekly')
  assert.equal(shiftedEvent.recurrence_until, data.untilDate)
  assert.equal(getDateOnly(shiftedEvent.starts_at), data.shiftedBaseDate)
  assert.equal(getTimeOnly(shiftedEvent.starts_at), '09:15')
  assert.equal(getTimeOnly(shiftedEvent.ends_at), '10:15')
}

async function verifyDeletedSeries(supabase, context, data) {
  const { data: remaining, error } = await supabase
    .from('calendar_events')
    .select('id')
    .eq('id', data.recurringEvent.id)
    .eq('club_id', context.clubId)

  if (error) {
    throw error
  }

  assert.equal((remaining || []).length, 0)
}

const startedAt = new Date().toISOString()
const { authUser, supabase } = await getSignedInClient()
const context = await getSmokeContext(supabase, authUser)
const data = await prepareSmokeData(supabase, context)

try {
  const queuedEmailsBefore = await countQueuedEmails(supabase, context.clubId, startedAt)
  await runBrowserSmoke(data)
  await verifyDatabaseState(supabase, context, data)
  await deleteRecurringSeriesInBrowser(data)
  await verifyDeletedSeries(supabase, context, data)
  const queuedEmailsAfter = await countQueuedEmails(supabase, context.clubId, startedAt)
  assert.equal(queuedEmailsAfter, queuedEmailsBefore)

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    queuedEmailsCreated: queuedEmailsAfter - queuedEmailsBefore,
    recurringTitle: data.recurringTitle,
    team: context.team.name,
    screenshots: [
      `${artifactDir}/recurring-occurrence-modal-weekly.png`,
      `${artifactDir}/one-off-modal-still-none.png`,
    ],
  }, null, 2))
} finally {
  await cleanupSmokeData(supabase, context, data)
  await supabase.auth.signOut()
}
