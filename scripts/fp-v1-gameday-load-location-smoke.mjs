import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = String(process.env.FPTEST_BASE_URL || '').trim()
const email = String(process.env.FPTEST_EMAIL || '').trim()
const password = String(process.env.FPTEST_PASSWORD || '')

if (!baseUrl || !email || !password) {
  throw new Error('FPTEST_BASE_URL, FPTEST_EMAIL and FPTEST_PASSWORD are required.')
}

async function clickFirstVisible(locator) {
  const count = await locator.count()

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)

    if (await candidate.isVisible()) {
      await candidate.click()
      return
    }
  }

  throw new Error('No visible matching control was found.')
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const consoleErrors = []
const failedRequests = []
const matchDayRequests = []
let activeListRequests = 0
let maxActiveListRequests = 0

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text())
  }
})

page.on('requestfailed', (request) => {
  failedRequests.push({
    method: request.method(),
    reason: request.failure()?.errorText || 'Unknown',
    url: request.url(),
  })
})

page.on('request', (request) => {
  const decodedUrl = decodeURIComponent(request.url())

  if (!decodedUrl.includes('/rest/v1/match_days?')) {
    return
  }

  const isListRequest = decodedUrl.includes('select=id,')
    && decodedUrl.includes('opponent,')
    && !decodedUrl.includes('match_day_scorer_interest')

  matchDayRequests.push({
    durationMs: 0,
    isListRequest,
    method: request.method(),
    startedAt: Date.now(),
    status: 0,
    url: decodedUrl,
  })

  if (isListRequest) {
    activeListRequests += 1
    maxActiveListRequests = Math.max(maxActiveListRequests, activeListRequests)
  }
})

page.on('response', (response) => {
  const decodedUrl = decodeURIComponent(response.url())

  if (response.status() >= 400) {
    failedRequests.push({
      method: response.request().method(),
      reason: `HTTP ${response.status()}`,
      url: response.url(),
    })
  }

  if (!decodedUrl.includes('/rest/v1/match_days?')) {
    return
  }

  const record = [...matchDayRequests].reverse().find((request) => request.url === decodedUrl && request.status === 0)

  if (record) {
    record.durationMs = Date.now() - record.startedAt
    record.status = response.status()

    if (record.isListRequest) {
      activeListRequests = Math.max(0, activeListRequests - 1)
    }
  }
})

try {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20000 })
  await page.waitForTimeout(3000)
  consoleErrors.length = 0
  failedRequests.length = 0

  await page.goto(`${baseUrl}/match-day`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Active fixtures', exact: true }).waitFor({ timeout: 20000 })
  await page.getByText('Loading match day...', { exact: true }).waitFor({ state: 'hidden', timeout: 20000 })
  await page.waitForTimeout(1000)
  failedRequests.length = 0

  assert.equal(await page.getByText('Match Day could not be loaded.', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Match Day action failed', { exact: true }).count(), 0)
  assert.ok(await page.getByRole('heading', { name: 'Previous games', exact: true }).count() > 0)

  await clickFirstVisible(page.getByRole('button', { name: /Manage fixture|Manage/, exact: true }))
  await page.getByRole('heading', { name: 'Availability and final squad', exact: true }).waitFor({ timeout: 20000 })

  await page.waitForTimeout(16000)
  assert.equal(maxActiveListRequests, 1)

  await clickFirstVisible(page.getByRole('button', { name: 'Create fixture', exact: true }))
  const dialog = page.getByRole('dialog', { name: 'Create fixture' })
  await dialog.waitFor({ timeout: 10000 })

  const locationSelect = dialog.locator('label').filter({ hasText: /^Reuse location/ }).locator('select')
  await locationSelect.locator('option').nth(1).waitFor({ state: 'attached', timeout: 20000 })
  const optionCount = await locationSelect.locator('option').count()
  assert.ok(optionCount > 1, 'At least one saved location must be available.')
  await locationSelect.selectOption({ index: 1 })

  const venueInput = dialog.locator('label').filter({ hasText: /^Venue$/ }).locator('input')
  const addressInput = dialog.locator('label').filter({ hasText: /^Address$/ }).locator('input')
  const selectedVenue = await venueInput.inputValue()
  const selectedAddress = await addressInput.inputValue()
  assert.ok(selectedVenue.trim())
  assert.ok(selectedAddress.trim())

  await locationSelect.selectOption('')
  assert.equal(await venueInput.inputValue(), '')
  assert.equal(await addressInput.inputValue(), '')
  await venueInput.fill('FP TEST Manual Smoke Venue')
  await addressInput.fill('FP TEST Manual Smoke Address')
  assert.equal(await locationSelect.inputValue(), '')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await clickFirstVisible(page.getByRole('button', { name: 'Create fixture', exact: true }))
  const mobileDialog = page.getByRole('dialog', { name: 'Create fixture' })
  await mobileDialog.waitFor({ timeout: 10000 })
  assert.ok((await mobileDialog.boundingBox())?.width <= 390)
  const mobileLocationSelect = mobileDialog.locator('label').filter({ hasText: /^Reuse location/ }).locator('select')
  assert.ok(await mobileLocationSelect.locator('option').count() > 1)
  await mobileDialog.getByRole('button', { name: 'Close', exact: true }).click()

  const heavyRequests = matchDayRequests.filter((request) => request.url.includes('match_day_scorer_interest'))
  const listRequests = matchDayRequests.filter((request) => request.isListRequest)
  const abortedRequests = failedRequests.filter((request) => request.reason === 'net::ERR_ABORTED')
  const failureSummary = failedRequests.filter((request) => request.reason !== 'net::ERR_ABORTED').map((request) => ({
    method: request.method,
    path: new URL(request.url).pathname,
    reason: request.reason,
  }))

  assert.ok(listRequests.length >= 2, 'Initial load and one controlled refresh must use the lightweight list query.')
  assert.ok(heavyRequests.length >= 1, 'One active or requested match must load its related detail.')
  assert.ok(heavyRequests.every((request) => request.url.includes('id=eq.')))
  assert.ok(matchDayRequests.every((request) => request.status >= 200 && request.status < 300))
  assert.deepEqual(failureSummary, [])
  assert.equal(consoleErrors.length, 0)

  console.log(JSON.stringify({
    addressPopulated: Boolean(selectedAddress),
    abortedRequests: abortedRequests.length,
    consoleErrors: consoleErrors.length,
    failedRequests: failureSummary.length,
    heavyDetailRequests: heavyRequests.length,
    listRequests: listRequests.length,
    maxHeavyDetailDurationMs: Math.max(...heavyRequests.map((request) => request.durationMs)),
    maxListDurationMs: Math.max(...listRequests.map((request) => request.durationMs)),
    maxConcurrentListRequests: maxActiveListRequests,
    mobile: 'passed',
    optionCount,
    venuePopulated: Boolean(selectedVenue),
  }))
} finally {
  await browser.close()
}
