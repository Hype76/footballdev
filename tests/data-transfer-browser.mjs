import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium } from 'playwright'
import { buildTransferWorkbook, DATA_TRANSFER_MIME } from '../netlify/functions/lib/_data-transfer-workbook.js'

const port = 4700 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const password = 'FixturePass123!'
const screenshotDirectory = 'outputs/fp-v1-data-transfer-import-rework-03a'
await mkdir(screenshotDirectory, { recursive: true })

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const open = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const timeout = setTimeout(() => { socket.destroy(); resolve(false) }, 250)
      socket.once('connect', () => { clearTimeout(timeout); socket.destroy(); resolve(true) })
      socket.once('error', () => { clearTimeout(timeout); resolve(false) })
    })
    if (open) return
    await wait(100)
  }
  throw new Error('Timed out waiting for the Vite test server.')
}

function startServer() {
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 0.0.0.0 --port ${port} --strictPort`], {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER: 'none', VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true', VITE_APP_URL: baseUrl, VITE_PARENT_APP_URL: baseUrl, VITE_SUPABASE_URL: 'http://fixture.supabase.test', VITE_SUPABASE_ANON_KEY: 'fixture-anon-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, output: () => output }
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return
  if (process.platform === 'win32') spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  else server.child.kill()
  await Promise.race([once(server.child, 'exit'), wait(3000)])
}

async function signIn(page, email) {
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Club' }).click()
  await page.getByPlaceholder('you@club.com').fill(email)
  await page.getByPlaceholder('Enter password').fill(password)
  await page.locator('form').getByRole('button', { name: /^Log in$/i }).click()
}

async function prepareContext(browser, workbookBuffer, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true, ...options })
  let confirmCalls = 0
  let blankCalls = 0
  let sourceInspectCalls = 0
  let rawCalls = 0
  let inspectedTeamIds = []
  let lastInspectBody = null
  await context.route('**/.netlify/functions/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  await context.route('**/.netlify/functions/data-transfer', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'blank' || body.operation === 'export' || body.operation === 'simple-template') {
      if (body.operation === 'blank') blankCalls += 1
      await route.fulfill({ status: 200, contentType: DATA_TRANSFER_MIME, body: workbookBuffer })
      return
    }
    if (body.operation === 'scope') {
      if (!body.clubId) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, role: 'super_admin', requiresClubSelection: true, clubs: [{ id: 'club-fixture', name: 'Fixture United', status: 'active' }], teams: [] }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, role: 'admin', club: { id: 'club-fixture', name: 'Fixture United' }, teams: [{ id: 'team-u12', name: 'U12 Fixture Team' }], authorizedTeamIds: ['team-u12'], canManageClub: true, canManageTeams: true }) })
      return
    }
    if (body.operation === 'history') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, history: [{ id: 'batch-history', actor_name: 'Fixture Admin', actor_role: 'admin', scope_label: 'Club-wide', transfer_type: 'import', state: 'completed', template_version: 'FP-V1-ONBOARDING-1', workbook_name: 'fixture-upload.xlsx', counts: { create: 3, link: 1, unchanged: 1 }, warnings: [], error_summary: [], created_at: '2026-07-17T09:00:00.000Z', raw_expires_at: '2099-07-24T09:00:00.000Z', raw_available: true }] }) })
      return
    }
    if (body.operation === 'raw-workbook') {
      rawCalls += 1
      await route.fulfill({ status: 200, contentType: DATA_TRANSFER_MIME, body: workbookBuffer })
      return
    }
    if (body.operation === 'source-inspect') {
      sourceInspectCalls += 1
      if (String(body.fileName || '').endsWith('.csv')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          success: true,
          format: 'csv',
          fields: [
            { key: 'player_first_name', label: 'Player First Name', transformation: 'trim' },
            { key: 'player_last_name', label: 'Player Last Name', transformation: 'trim' },
            { key: 'date_of_birth', label: 'Date of Birth', transformation: 'parse_date' },
            { key: 'team_name', label: 'Team', transformation: 'trim' },
          ],
          portable: false,
          sheets: [{
            name: 'CSV Data',
            headers: ['Player First Name', 'Player Last Name', 'Date of Birth', 'Team'],
            rowCount: 1,
            mappings: [
              { sourceColumn: 'Player First Name', samples: ['Alex'], suggestedField: 'player_first_name', suggestedLabel: 'Player First Name', confidence: 'high', transformation: 'trim' },
              { sourceColumn: 'Player Last Name', samples: ['Example'], suggestedField: 'player_last_name', suggestedLabel: 'Player Last Name', confidence: 'high', transformation: 'trim' },
              { sourceColumn: 'Date of Birth', samples: ['01/02/2014'], suggestedField: 'date_of_birth', suggestedLabel: 'Date of Birth', confidence: 'high', transformation: 'parse_date' },
              { sourceColumn: 'Team', samples: ['U12 Fixture Team'], suggestedField: 'team_name', suggestedLabel: 'Team', confidence: 'high', transformation: 'trim' },
            ],
            ambiguousDateSamples: ['01/02/2014'],
            teamValues: ['U12 Fixture Team'],
            mappingScore: 4,
          }],
          suggestedSheet: 'CSV Data',
          teams: [{ id: 'team-u12', name: 'U12 Fixture Team' }],
          workbookSha256: 'c'.repeat(64),
        }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, format: 'xlsx', fields: [], portable: true, sheets: [{ name: 'Instructions', headers: ['Topic', 'Guidance'], rowCount: 8, mappings: [], teamValues: [], ambiguousDateSamples: [] }, { name: 'Club Details', headers: ['Transfer Reference'], rowCount: 1, mappings: [], teamValues: [], ambiguousDateSamples: [] }, { name: 'Teams', headers: ['Transfer Reference'], rowCount: 1, mappings: [], teamValues: [], ambiguousDateSamples: [] }, { name: 'Players', headers: ['Transfer Reference'], rowCount: 1, mappings: [], teamValues: [], ambiguousDateSamples: [] }, { name: 'Guardians', headers: ['Transfer Reference'], rowCount: 1, mappings: [], teamValues: [], ambiguousDateSamples: [] }, { name: 'Player-Guardian Links', headers: ['Player Reference'], rowCount: 1, mappings: [], teamValues: [], ambiguousDateSamples: [] }, { name: 'Lists', headers: ['Category'], rowCount: 1, mappings: [], teamValues: [], ambiguousDateSamples: [] }], suggestedSheet: 'Players', teams: [{ id: 'team-u12', name: 'U12 Fixture Team' }], workbookSha256: 'b'.repeat(64) }) })
      return
    }
    if (body.operation === 'inspect') {
      lastInspectBody = body
      inspectedTeamIds = body.teamIds || []
      const ordinary = String(body.fileName || '').endsWith('.csv')
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, batch: { id: 'batch-fixture', state: 'ready_for_review', workbookSha256: 'a'.repeat(64), templateVersion: ordinary ? 'FP-V1-PLAYER-PARENT-2' : 'FP-V1-ONBOARDING-1', format: ordinary ? 'csv' : 'xlsx', portable: !ordinary, counts: { total: 5, create: 3, update: 1, skip: 1 } }, confirmationToken: 'confirm-fixture', errors: [], warnings: [], preview: [{ sheet: 'Players', row: 2, entityType: 'player', reference: 'PLAYER-1', outcome: 'create', codes: [], explanation: 'Create player.', proposedChanges: { first_name: 'Alex' } }] }) })
      return
    }
    if (body.operation === 'confirm') {
      confirmCalls += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, result: { batchId: 'batch-fixture', state: 'completed', idempotent: false, counts: { players: 1 } } }) })
      return
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Unexpected fixture operation.' }) })
  })
  await context.route('**/rest/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await context.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  return { context, blankCalls: () => blankCalls, confirmCalls: () => confirmCalls, inspectedTeamIds: () => inspectedTeamIds, lastInspectBody: () => lastInspectBody, rawCalls: () => rawCalls, sourceInspectCalls: () => sourceInspectCalls }
}

const workbookBuffer = await buildTransferWorkbook({
  data: {
    'Club Details': [{ transfer_reference: 'CLUB-1', name: 'Fixture United' }],
    Teams: [{ transfer_reference: 'TEAM-1', name: 'U12 Fixture Team', status: 'active' }],
    Players: [{ transfer_reference: 'PLAYER-1', team_reference: 'TEAM-1', first_name: 'Alex', last_name: 'Example', section: 'Squad', status: 'active' }],
    Guardians: [{ transfer_reference: 'GUARDIAN-1', first_name: 'Pat', last_name: 'Example', status: 'active' }],
    'Player-Guardian Links': [{ player_reference: 'PLAYER-1', guardian_reference: 'GUARDIAN-1', relationship: 'Parent' }],
  },
})
const server = startServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ headless: true })

  {
    const fixture = await prepareContext(browser, workbookBuffer)
    const page = await fixture.context.newPage()
    const pageErrors = []
    page.on('pageerror', (pageError) => pageErrors.push(pageError.message))
    await signIn(page, 'club.fixture@footballplayer.test')
    await page.goto(`${baseUrl}/data-transfer`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Data Transfer' }).waitFor()
    await page.getByText('Fixture United', { exact: true }).first().waitFor()
    assert.equal(await page.getByLabel('U12 Fixture Team', { exact: true }).isChecked(), false)
    await page.getByLabel('Selected teams', { exact: true }).check()
    await page.getByLabel('U12 Fixture Team', { exact: true }).check()
    await page.getByLabel('Confirmed season').fill('2026/27')
    assert.equal(await page.getByLabel('Allow team creation').isDisabled(), true)
    await page.getByLabel('Fill approved blanks').check()
    await page.getByLabel('Use reviewed spreadsheet values').check()

    const rawDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Raw workbook' }).click()
    await rawDownload
    assert.equal(fixture.rawCalls(), 1)

    await page.getByRole('button', { name: 'Blank portable workbook' }).click()
    await page.getByText('Blank onboarding template downloaded.').waitFor()
    assert.equal(fixture.blankCalls(), 1)

    await page.locator('input[type=file]').setInputFiles({ name: 'footballplayer-online-onboarding-v1.xlsx', mimeType: DATA_TRANSFER_MIME, buffer: workbookBuffer })
    await page.getByRole('button', { name: 'Read columns and worksheets' }).click()
    await page.getByText('Advanced portable structure verified.').waitFor()
    assert.equal(fixture.sourceInspectCalls(), 1)
    await page.getByRole('button', { name: 'Prepare read-only preview' }).click()
    await page.getByText('Preview is ready. No records have been written.').waitFor()
    assert.deepEqual(fixture.inspectedTeamIds(), ['team-u12'])
    assert.equal(await page.getByRole('button', { name: 'Confirm and import' }).isDisabled(), true)
    await page.getByLabel('I reviewed the scope and row-level preview').check()
    await page.getByLabel('Type IMPORT to confirm').fill('IMPORT')
    await page.getByRole('button', { name: 'Confirm and import' }).click()
    await page.getByText('The confirmed import completed.').waitFor()
    await page.screenshot({ path: `${screenshotDirectory}/data-transfer-desktop.png`, fullPage: true })
    assert.equal(fixture.confirmCalls(), 1)
    assert.deepEqual(pageErrors, [])
    await fixture.context.close()
    console.log('ok club admin download, inspect, preview, and separate confirmation flow')
  }

  {
    const fixture = await prepareContext(browser, workbookBuffer)
    const page = await fixture.context.newPage()
    await signIn(page, 'club.fixture@footballplayer.test')
    await page.goto(`${baseUrl}/data-transfer`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Data Transfer' }).waitFor()
    await page.getByLabel('Selected teams', { exact: true }).check()
    await page.getByLabel('U12 Fixture Team', { exact: true }).check()
    await page.getByLabel('Confirmed season').fill('2026/27')
    const csv = Buffer.from('\uFEFFPlayer First Name,Player Last Name,Date of Birth,Team\r\nAlex,Example,01/02/2014,U12 Fixture Team\r\n', 'utf8')
    await page.locator('input[type=file]').setInputFiles({ name: 'players.csv', mimeType: 'text/csv', buffer: csv })
    await page.getByRole('button', { name: 'Read columns and worksheets' }).click()
    await page.getByRole('heading', { name: '4. Map columns and defaults' }).waitFor()
    assert.equal(await page.getByLabel('Map Player First Name').inputValue(), 'player_first_name')
    assert.equal(await page.getByLabel('Map Player Last Name').inputValue(), 'player_last_name')
    await page.getByLabel('Day / Month / Year').check()
    await page.screenshot({ path: `${screenshotDirectory}/data-transfer-csv-mapping-desktop.png`, fullPage: true })
    await page.getByRole('button', { name: 'Prepare read-only preview' }).click()
    await page.getByText('Preview is ready. No records have been written.').waitFor()
    assert.equal(fixture.lastInspectBody().mapping.sheetName, 'CSV Data')
    assert.equal(fixture.lastInspectBody().mapping.dateConvention, 'dmy')
    assert.ok(fixture.lastInspectBody().mapping.columns.some((entry) => entry.targetField === 'date_of_birth' && entry.transformation === 'parse_date'))
    await fixture.context.close()
    console.log('ok ordinary CSV worksheet mapping and explicit ambiguous-date confirmation flow')
  }

  {
    const fixture = await prepareContext(browser, workbookBuffer)
    const page = await fixture.context.newPage()
    await signIn(page, 'coach.fixture@footballplayer.test')
    await page.goto(`${baseUrl}/data-transfer`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.location.pathname !== '/data-transfer')
    const deniedHeading = page.getByRole('heading', { name: 'Data Transfer' })
    if (await deniedHeading.count()) await deniedHeading.waitFor({ state: 'detached' })
    assert.equal(await deniedHeading.count(), 0)
    await fixture.context.close()
    console.log('ok coach route access fails closed')
  }

  {
    const fixture = await prepareContext(browser, workbookBuffer)
    const page = await fixture.context.newPage()
    await signIn(page, 'platform.fixture@footballplayer.test')
    await page.goto(`${baseUrl}/data-transfer`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Data Transfer' }).waitFor()
    const scopeSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '1. Confirm authorized scope' }) })
    await scopeSection.locator('select').selectOption('club-fixture')
    await page.getByLabel('Support or audit reason').fill('short')
    assert.equal(await page.getByRole('button', { name: 'Confirm platform scope' }).isDisabled(), true)
    await page.getByLabel('Support or audit reason').fill('Synthetic QA onboarding review')
    await page.getByRole('button', { name: 'Confirm platform scope' }).click()
    await page.getByLabel('Entire club', { exact: true }).check()
    await page.getByText('Entire club scope with 1 existing team').waitFor()
    await page.getByRole('group', { name: 'Select import and export teams' }).waitFor()
    await fixture.context.close()
    console.log('ok platform admin requires explicit club scope and audit reason')
  }

  for (const [label, viewport] of [['tablet', { width: 820, height: 1180 }], ['mobile', { width: 390, height: 844 }]]) {
    const fixture = await prepareContext(browser, workbookBuffer, { viewport })
    const page = await fixture.context.newPage()
    await signIn(page, 'club.fixture@footballplayer.test')
    await page.goto(`${baseUrl}/data-transfer`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Data Transfer' }).waitFor()
    await page.getByRole('button', { name: 'Simple XLSX' }).waitFor()
    const documentOverflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    assert.equal(documentOverflows, false)
    await page.screenshot({ path: `${screenshotDirectory}/data-transfer-${label}.png`, fullPage: true })
    await fixture.context.close()
    console.log(`ok ${label} Data Transfer layout remains within the viewport`)
  }
} catch (error) {
  console.error(server.output())
  throw error
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
