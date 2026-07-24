import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = String(process.env.FPTEST_BASE_URL || '').trim()
const email = String(process.env.FPTEST_EMAIL || '').trim()
const password = String(process.env.FPTEST_PASSWORD || '')

if (!baseUrl || !email || !password) {
  throw new Error('FPTEST_BASE_URL, FPTEST_EMAIL and FPTEST_PASSWORD are required.')
}

async function openFixtureDialog(page) {
  const buttons = page.getByRole('button', { name: 'Create fixture', exact: true })

  for (let index = 0; index < await buttons.count(); index += 1) {
    if (await buttons.nth(index).isVisible()) {
      await buttons.nth(index).click()
      break
    }
  }

  const dialog = page.getByRole('dialog', { name: 'Create fixture' })
  await dialog.waitFor({ timeout: 10000 })
  return dialog
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const communicationRequests = []
const consoleErrors = []
const failedResponses = []

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

page.on('request', (request) => {
  const url = request.url()
  if (
    request.method() !== 'GET'
    && (
      url.includes('send-match-day-availability-requests')
      || url.includes('scheduled_email_queue')
      || url.includes('notification')
      || url.includes('push')
      || url.includes('sms')
    )
  ) {
    communicationRequests.push({ method: request.method(), url })
  }
})

page.on('response', (response) => {
  if (response.status() >= 400) {
    failedResponses.push({
      method: response.request().method(),
      path: new URL(response.url()).pathname,
      status: response.status(),
    })
  }
})

try {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 20000 })
  await page.goto(`${baseUrl}/match-day`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Active fixtures', exact: true }).waitFor({ timeout: 20000 })
  await page.getByText('Loading match day...', { exact: true }).waitFor({ state: 'hidden', timeout: 20000 })

  consoleErrors.length = 0
  failedResponses.length = 0
  const desktopDialog = await openFixtureDialog(page)
  assert.equal(await desktopDialog.getByText('Scorer request message', { exact: true }).count(), 0)

  const desktopMessages = {}
  for (const role of ['scorer', 'linesman', 'referee']) {
    const checkbox = desktopDialog.locator(`#matchday-request-${role}`)
    await checkbox.check()
    assert.equal(await checkbox.isChecked(), true)
    const message = desktopDialog.locator(`[data-volunteer-request-message="${role}"]`)
    await message.waitFor({ state: 'visible' })
    desktopMessages[role] = (await message.textContent())?.trim()
    assert.ok(desktopMessages[role])
    await checkbox.uncheck()
    assert.equal(await checkbox.isChecked(), false)
  }

  for (const role of ['scorer', 'linesman', 'referee']) {
    await desktopDialog.locator(`#matchday-request-${role}`).check()
  }
  assert.equal(await desktopDialog.locator('[data-volunteer-request-message]').count(), 3)
  assert.equal(communicationRequests.length, 0)
  await desktopDialog.getByRole('button', { name: 'Close', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileDialog = await openFixtureDialog(page)
  assert.ok((await mobileDialog.boundingBox())?.width <= 390)
  assert.equal(await mobileDialog.getByText('Scorer request message', { exact: true }).count(), 0)
  for (const role of ['scorer', 'linesman', 'referee']) {
    const checkbox = mobileDialog.locator(`#matchday-request-${role}`)
    await checkbox.check()
    assert.equal(await checkbox.isChecked(), true)
    assert.ok((await mobileDialog.locator(`[data-volunteer-request-message="${role}"]`).textContent())?.trim())
  }
  assert.equal(communicationRequests.length, 0)
  await mobileDialog.getByRole('button', { name: 'Close', exact: true }).click()

  assert.deepEqual(failedResponses, [])
  assert.equal(consoleErrors.length, 0)

  console.log(JSON.stringify({
    communicationRequests: communicationRequests.length,
    consoleErrors: consoleErrors.length,
    desktop: 'passed',
    failedResponses: failedResponses.length,
    messageLengths: Object.fromEntries(Object.entries(desktopMessages).map(([role, message]) => [role, message.length])),
    mobile: 'passed',
    scorerFieldPresent: false,
  }))
} finally {
  await browser.close()
}
