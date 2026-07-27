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
const screenshotDirectory = 'outputs/fp-v1-data-transfer-themes-release-04d'
await mkdir(screenshotDirectory, { recursive: true })

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function applyTheme(page, { accent, mode }) {
  await page.evaluate(({ nextAccent, nextMode }) => {
    window.localStorage.setItem('app-theme-mode', nextMode)
    window.localStorage.setItem('app-theme-accent', nextAccent)
    window.localStorage.setItem('app-theme-button-style', 'solid')
    window.dispatchEvent(new CustomEvent('app-theme-changed', {
      detail: {
        accent: nextAccent,
        buttonStyle: 'solid',
        mode: nextMode,
      },
    }))
  }, { nextAccent: accent, nextMode: mode })
  await page.waitForFunction(({ nextAccent, nextMode }) => (
    document.body.classList.contains(`theme-${nextMode}`)
    && document.body.classList.contains(`accent-${nextAccent}`)
  ), { nextAccent: accent, nextMode: mode })
}

async function auditTheme(page, { accent, label, mode }) {
  const audit = await page.evaluate(() => {
    function parseRgb(value) {
      const channels = String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number)
      return channels?.length === 3 ? channels : null
    }

    function luminance(rgb) {
      const channels = rgb.map((value) => {
        const normalized = value / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
    }

    function contrastRatio(foreground, background) {
      const foregroundRgb = parseRgb(foreground)
      const backgroundRgb = parseRgb(background)
      if (!foregroundRgb || !backgroundRgb) return 0
      const foregroundLuminance = luminance(foregroundRgb)
      const backgroundLuminance = luminance(backgroundRgb)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    function colorsFor(selector, backgroundSelector = selector) {
      const element = document.querySelector(selector)
      const backgroundElement = document.querySelector(backgroundSelector)
      if (!element || !backgroundElement) return null
      const foreground = getComputedStyle(element).color
      const background = getComputedStyle(backgroundElement).backgroundColor
      return { background, foreground, ratio: contrastRatio(foreground, background) }
    }

    function inheritedBackground(element) {
      let current = element
      while (current) {
        const background = getComputedStyle(current).backgroundColor
        if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)') return background
        current = current.parentElement
      }
      return getComputedStyle(document.body).backgroundColor
    }

    const root = getComputedStyle(document.documentElement)
    const section = document.querySelector('[data-testid="data-transfer-page"] section')
    const control = document.querySelector('[data-testid="data-transfer-page"] select')
    const primaryButton = document.querySelector('[data-testid="data-transfer-page"] button:not([disabled])')
    const status = document.querySelector('[data-testid="data-transfer-page"] span.inline-flex.rounded-full, [data-testid="data-transfer-page"] [role="status"]')
    const tableHeading = document.querySelector('[data-testid="data-transfer-page"] thead th')

    return {
      accent: document.documentElement.dataset.themeAccent,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      buttonBackground: primaryButton ? getComputedStyle(primaryButton).backgroundColor : null,
      buttonText: primaryButton ? getComputedStyle(primaryButton).color : null,
      controlBackground: control ? getComputedStyle(control).backgroundColor : null,
      controlText: control ? getComputedStyle(control).color : null,
      documentOverflows: document.documentElement.scrollWidth > window.innerWidth,
      panelBackground: section ? getComputedStyle(section).backgroundColor : null,
      samples: {
        button: primaryButton ? {
          background: getComputedStyle(primaryButton).backgroundColor,
          foreground: getComputedStyle(primaryButton).color,
          ratio: contrastRatio(getComputedStyle(primaryButton).color, getComputedStyle(primaryButton).backgroundColor),
        } : null,
        control: control ? {
          background: getComputedStyle(control).backgroundColor,
          foreground: getComputedStyle(control).color,
          ratio: contrastRatio(getComputedStyle(control).color, getComputedStyle(control).backgroundColor),
        } : null,
        heading: colorsFor('[data-testid="data-transfer-page"] section h2', '[data-testid="data-transfer-page"] section'),
        status: status ? {
          background: getComputedStyle(status).backgroundColor,
          foreground: getComputedStyle(status).color,
          ratio: contrastRatio(getComputedStyle(status).color, getComputedStyle(status).backgroundColor),
        } : null,
        tableHeading: tableHeading ? {
          background: inheritedBackground(tableHeading),
          foreground: getComputedStyle(tableHeading).color,
          ratio: contrastRatio(getComputedStyle(tableHeading).color, inheritedBackground(tableHeading)),
        } : null,
      },
      tokens: {
        accent: root.getPropertyValue('--accent').trim(),
        appBackground: root.getPropertyValue('--app-bg').trim(),
        buttonPrimary: root.getPropertyValue('--button-primary').trim(),
        panelAlt: root.getPropertyValue('--panel-alt').trim(),
        panelBackground: root.getPropertyValue('--panel-bg').trim(),
      },
    }
  })

  assert.equal(audit.accent, accent)
  assert.equal(audit.documentOverflows, false)
  assert.notEqual(audit.bodyBackground, audit.panelBackground)
  assert.notEqual(audit.controlBackground, audit.controlText)
  assert.notEqual(audit.buttonBackground, audit.buttonText)
  for (const [sampleName, sample] of Object.entries(audit.samples)) {
    assert.ok(sample, `${label} ${sampleName} sample is present`)
    assert.ok(sample.ratio >= 4.5, `${label} ${sampleName} contrast ${sample.ratio.toFixed(2)} is at least 4.5`)
  }
  assert.ok(audit.tokens.accent)
  assert.ok(audit.tokens.appBackground)
  assert.ok(audit.tokens.buttonPrimary)
  assert.ok(audit.tokens.panelAlt)
  assert.ok(audit.tokens.panelBackground)
  return audit
}

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
  const { fixtureRole = 'admin', ...contextOptions } = options
  const context = await browser.newContext({ acceptDownloads: true, ...contextOptions })
  let confirmCalls = 0
  let blankCalls = 0
  let ordinaryExportCalls = 0
  let sourceInspectCalls = 0
  let rawCalls = 0
  let inspectedTeamIds = []
  let lastInspectBody = null
  let lastOrdinaryExportBody = null
  await context.route('**/.netlify/functions/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  await context.route('**/.netlify/functions/data-transfer', async (route) => {
    const body = route.request().postDataJSON()
    if (body.operation === 'blank' || body.operation === 'export' || body.operation === 'simple-template') {
      if (body.operation === 'blank') blankCalls += 1
      await route.fulfill({ status: 200, contentType: DATA_TRANSFER_MIME, body: workbookBuffer })
      return
    }
    if (body.operation === 'ordinary-export') {
      ordinaryExportCalls += 1
      lastOrdinaryExportBody = body
      await route.fulfill({ status: 200, contentType: body.format === 'csv' ? 'text/csv;charset=utf-8' : DATA_TRANSFER_MIME, body: body.format === 'csv' ? Buffer.from('\uFEFFPlayer First Name\r\nAlex\r\n', 'utf8') : workbookBuffer })
      return
    }
    if (body.operation === 'scope') {
      if (!body.clubId) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, role: 'super_admin', requiresClubSelection: true, clubs: [{ id: 'club-fixture', name: 'Fixture United', status: 'active' }], teams: [] }) })
        return
      }
      const coachTeams = [
        { id: 'team-u12', name: 'U12 Fixture Team', season: '2026/27' },
        { id: 'team-u14', name: 'U14 Fixture Team', season: '2026/27' },
      ]
      const teams = fixtureRole === 'coach' ? coachTeams : coachTeams.slice(0, 1)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          role: fixtureRole,
          club: { id: 'club-fixture', name: 'Fixture United', season: '2026/27' },
          teams,
          authorizedTeamIds: teams.map((team) => team.id),
          canManageClub: fixtureRole === 'admin',
          canManageTeams: fixtureRole === 'admin',
          requiresSingleTeamSelection: fixtureRole === 'coach',
          canExportGuardianContacts: fixtureRole !== 'coach',
          canExportGuardianPostalFields: fixtureRole === 'admin',
        }),
      })
      return
    }
    if (body.operation === 'history') {
      const exportHistory = ordinaryExportCalls ? [{ id: 'batch-export', actor_name: 'Fixture Admin', actor_role: 'admin', scope_label: 'Selected teams', transfer_type: 'export', state: 'completed', template_version: 'FP-V1-READABLE-EXPORT-1', workbook_name: lastOrdinaryExportBody.dataset === 'players_and_guardians' ? `footballplayer-online-players-and-parents.${lastOrdinaryExportBody.format}` : `footballplayer-online-players.${lastOrdinaryExportBody.format}`, counts: { exported: 1 }, warnings: [], error_summary: [], created_at: '2026-07-23T07:00:00.000Z', raw_available: false }] : []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, history: [...exportHistory, { id: 'batch-history', actor_name: 'Fixture Admin', actor_role: 'admin', scope_label: 'Club-wide', transfer_type: 'import', state: 'completed', template_version: 'FP-V1-ONBOARDING-1', workbook_name: 'fixture-upload.xlsx', counts: { create: 3, link: 1, unchanged: 1 }, warnings: [], error_summary: [], created_at: '2026-07-17T09:00:00.000Z', raw_expires_at: '2099-07-24T09:00:00.000Z', raw_available: true }] }) })
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
  return { context, blankCalls: () => blankCalls, confirmCalls: () => confirmCalls, inspectedTeamIds: () => inspectedTeamIds, lastInspectBody: () => lastInspectBody, lastOrdinaryExportBody: () => lastOrdinaryExportBody, ordinaryExportCalls: () => ordinaryExportCalls, rawCalls: () => rawCalls, sourceInspectCalls: () => sourceInspectCalls }
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
    const consoleErrors = []
    page.on('pageerror', (pageError) => pageErrors.push(pageError.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
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

    await page.getByRole('button', { name: 'Download support-assisted blank structure' }).click()
    await page.getByText('Support-assisted portable structure downloaded.').waitFor()
    assert.equal(fixture.blankCalls(), 1)

    const ordinaryDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download CSV' }).click()
    const ordinaryFile = await ordinaryDownload
    assert.equal(ordinaryFile.suggestedFilename(), 'footballplayer-online-players.csv')
    await page.getByText('Players CSV export downloaded.').waitFor()
    assert.equal(fixture.ordinaryExportCalls(), 1)
    assert.equal(fixture.lastOrdinaryExportBody().dataset, 'players')
    assert.equal(fixture.lastOrdinaryExportBody().format, 'csv')
    assert.equal(fixture.lastOrdinaryExportBody().recordStatus, 'active')
    assert.equal(fixture.lastOrdinaryExportBody().season, 'all')
    await page.getByText('footballplayer-online-players.csv').waitFor()
    await page.getByText('Exported 1').waitFor()

    await page.getByLabel('Players and parent contacts').check()
    await page.getByLabel('Excel').check()
    await page.getByLabel('Record status').selectOption('all')
    await page.locator('#data-transfer-export-season').selectOption('2026/27')
    const parentExportDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download XLSX' }).click()
    const parentExportFile = await parentExportDownload
    assert.equal(parentExportFile.suggestedFilename(), 'footballplayer-online-players-and-parents.xlsx')
    assert.equal(fixture.lastOrdinaryExportBody().dataset, 'players_and_guardians')
    assert.equal(fixture.lastOrdinaryExportBody().recordStatus, 'all')
    assert.equal(fixture.lastOrdinaryExportBody().season, '2026/27')

    await page.locator('input[type=file]').setInputFiles({ name: 'footballplayer-online-portable-transfer-v1.xlsx', mimeType: DATA_TRANSFER_MIME, buffer: workbookBuffer })
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
    const desktopThemeMatrix = [
      { accent: 'green', label: 'light-default', mode: 'light' },
      { accent: 'green', label: 'dark-default', mode: 'dark' },
      { accent: 'purple', label: 'light-custom', mode: 'light' },
      { accent: 'purple', label: 'dark-custom', mode: 'dark' },
    ]
    for (const theme of desktopThemeMatrix) {
      await applyTheme(page, theme)
      await auditTheme(page, theme)
      await page.screenshot({ path: `${screenshotDirectory}/data-transfer-desktop-${theme.label}.png`, fullPage: true })
    }
    assert.equal(fixture.confirmCalls(), 1)
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(consoleErrors, [])
    await fixture.context.close()
    console.log('ok club admin flow and desktop light, dark, default-accent, and custom-accent matrix')
  }

  {
    const fixture = await prepareContext(browser, workbookBuffer)
    const page = await fixture.context.newPage()
    const pageErrors = []
    const consoleErrors = []
    page.on('pageerror', (pageError) => pageErrors.push(pageError.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await signIn(page, 'club.fixture@footballplayer.test')
    await page.goto(`${baseUrl}/data-transfer`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Data Transfer' }).waitFor()
    await page.getByLabel('Selected teams', { exact: true }).check()
    await page.getByLabel('U12 Fixture Team', { exact: true }).check()
    await page.getByLabel('Confirmed season').fill('2026/27')
    const csv = Buffer.from('\uFEFFPlayer First Name,Player Last Name,Date of Birth,Team\r\nAlex,Example,01/02/2014,U12 Fixture Team\r\n', 'utf8')
    await page.locator('input[type=file]').setInputFiles({ name: 'players.csv', mimeType: 'text/csv', buffer: csv })
    await page.getByRole('button', { name: 'Read columns and worksheets' }).click()
    await page.getByRole('heading', { name: '5. Map columns and defaults' }).waitFor()
    assert.equal(await page.getByLabel('Map Player First Name').inputValue(), 'player_first_name')
    assert.equal(await page.getByLabel('Map Player Last Name').inputValue(), 'player_last_name')
    await page.getByLabel('Day / Month / Year').check()
    const mappingTheme = { accent: 'purple', label: 'dark-custom-mapping', mode: 'dark' }
    await applyTheme(page, mappingTheme)
    await auditTheme(page, mappingTheme)
    await page.screenshot({ path: `${screenshotDirectory}/data-transfer-desktop-${mappingTheme.label}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Prepare read-only preview' }).click()
    await page.getByText('Preview is ready. No records have been written.').waitFor()
    assert.equal(fixture.lastInspectBody().mapping.sheetName, 'CSV Data')
    assert.equal(fixture.lastInspectBody().mapping.dateConvention, 'dmy')
    assert.ok(fixture.lastInspectBody().mapping.columns.some((entry) => entry.targetField === 'date_of_birth' && entry.transformation === 'parse_date'))
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(consoleErrors, [])
    await fixture.context.close()
    console.log('ok ordinary CSV mapping and dark custom-accent warning state')
  }

  {
    const fixture = await prepareContext(browser, workbookBuffer, { fixtureRole: 'coach' })
    const page = await fixture.context.newPage()
    await signIn(page, 'coach.fixture@footballplayer.test')
    await page.goto(`${baseUrl}/data-transfer`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Data Transfer' }).waitFor()
    await page.getByLabel('U12 Fixture Team', { exact: true }).check()
    assert.equal(await page.getByLabel('U12 Fixture Team', { exact: true }).isChecked(), true)
    await page.getByLabel('U14 Fixture Team', { exact: true }).check()
    assert.equal(await page.getByLabel('U12 Fixture Team', { exact: true }).isChecked(), false)
    assert.equal(await page.getByLabel('U14 Fixture Team', { exact: true }).isChecked(), true)
    assert.equal(await page.getByRole('button', { name: 'Select all' }).count(), 0)
    assert.equal(await page.getByLabel('Players and parent contacts').isDisabled(), true)
    await fixture.context.close()
    console.log('ok coach route allows exactly one explicitly selected assigned team and blocks guardian contacts')
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
    const pageErrors = []
    const consoleErrors = []
    page.on('pageerror', (pageError) => pageErrors.push(pageError.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await signIn(page, 'club.fixture@footballplayer.test')
    await page.goto(`${baseUrl}/data-transfer`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Data Transfer' }).waitFor()
    await page.getByRole('button', { name: 'Simple XLSX' }).waitFor()
    const responsiveThemeMatrix = [
      { accent: 'green', label: `${label}-light-default`, mode: 'light' },
      { accent: 'green', label: `${label}-dark-default`, mode: 'dark' },
      { accent: 'purple', label: `${label}-light-custom`, mode: 'light' },
      { accent: 'purple', label: `${label}-dark-custom`, mode: 'dark' },
    ]
    for (const theme of responsiveThemeMatrix) {
      await applyTheme(page, theme)
      await auditTheme(page, theme)
      await page.screenshot({ path: `${screenshotDirectory}/data-transfer-${theme.label}.png`, fullPage: true })
    }
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(consoleErrors, [])
    await fixture.context.close()
    console.log(`ok ${label} light, dark, default-accent, and custom-accent matrix`)
  }
} catch (error) {
  console.error(server.output())
  throw error
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
