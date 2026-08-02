import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium, devices } from 'playwright'

const port = Number(process.env.FORMATION_BOARD_BROWSER_PORT || 4850 + Math.floor(Math.random() * 100))
const baseUrl = `http://127.0.0.1:${port}`
const screenshotDirectory = 'outputs/fp-v1-formation-board-editor-25b'
await mkdir(screenshotDirectory, { recursive: true })

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForPort(timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      const timeout = setTimeout(() => { socket.destroy(); resolve(false) }, 250)
      socket.once('connect', () => { clearTimeout(timeout); socket.destroy(); resolve(true) })
      socket.once('error', () => { clearTimeout(timeout); socket.destroy(); resolve(false) })
    })
    if (connected) return
    await wait(200)
  }
  throw new Error(`Timed out waiting for Vite on port ${port}`)
}

function startServer() {
  const environment = {
    ...process.env,
    BROWSER: 'none',
    VITE_APP_URL: baseUrl,
    VITE_AUTH_ACCESS_BROWSER_FIXTURES: 'true',
    VITE_PARENT_APP_URL: `http://parent.footballplayer.online:${port}`,
    VITE_SUPABASE_ANON_KEY: 'fixture-anon-key',
    VITE_SUPABASE_URL: 'http://fixture.supabase.test',
  }
  const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run dev -- --host 0.0.0.0 --port ${port} --strictPort`], {
    cwd: process.cwd(),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  return { child, getOutput: () => output }
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${server.child.pid} /T /F`], { stdio: 'ignore' })
  } else {
    server.child.kill()
  }
  await Promise.race([once(server.child, 'exit'), wait(3000)])
  if (server.child.exitCode === null) server.child.kill('SIGKILL')
}

const presets = [
  {
    registry_version: 1,
    preset_key: '5v5-1-2-1',
    display_name: '1-2-1',
    game_format: '5v5',
    player_count: 5,
    readiness_state: 'ready',
    sort_order: 10,
    slots: [
      { id: 'gk', group: 'goalkeeper', x: 0.5, y: 0.9 },
      { id: 'def-left', group: 'defender', x: 0.3, y: 0.68 },
      { id: 'def-right', group: 'defender', x: 0.7, y: 0.68 },
      { id: 'mid', group: 'midfielder', x: 0.5, y: 0.45 },
      { id: 'forward', group: 'forward', x: 0.5, y: 0.2 },
    ],
  },
  {
    registry_version: 1,
    preset_key: '7v7-2-3-1',
    display_name: '2-3-1',
    game_format: '7v7',
    player_count: 7,
    readiness_state: 'ready',
    sort_order: 20,
    slots: [
      { id: 'gk', group: 'goalkeeper', x: 0.5, y: 0.92 },
      { id: 'def-left', group: 'defender', x: 0.3, y: 0.72 },
      { id: 'def-right', group: 'defender', x: 0.7, y: 0.72 },
      { id: 'mid-left', group: 'midfielder', x: 0.2, y: 0.48 },
      { id: 'mid-centre', group: 'midfielder', x: 0.5, y: 0.5 },
      { id: 'mid-right', group: 'midfielder', x: 0.8, y: 0.48 },
      { id: 'forward', group: 'forward', x: 0.5, y: 0.2 },
    ],
  },
  {
    registry_version: 1,
    preset_key: '7v7-custom',
    display_name: 'Custom',
    game_format: '7v7',
    player_count: 7,
    readiness_state: 'ready',
    sort_order: 90,
    slots: [],
  },
  {
    registry_version: 1,
    preset_key: '9v9-3-3-2',
    display_name: '3-3-2',
    game_format: '9v9',
    player_count: 9,
    readiness_state: 'ready',
    sort_order: 30,
    slots: Array.from({ length: 9 }, (_, index) => ({ id: `slot-${index}`, group: index === 0 ? 'goalkeeper' : index < 4 ? 'defender' : index < 7 ? 'midfielder' : 'forward', x: 0.2 + (index % 3) * 0.3, y: 0.9 - Math.floor(index / 3) * 0.32 })),
  },
  {
    registry_version: 1,
    preset_key: '11v11-4-4-2',
    display_name: '4-4-2',
    game_format: '11v11',
    player_count: 11,
    readiness_state: 'ready',
    sort_order: 40,
    slots: Array.from({ length: 11 }, (_, index) => ({ id: `slot-${index}`, group: index === 0 ? 'goalkeeper' : index < 5 ? 'defender' : index < 9 ? 'midfielder' : 'forward', x: 0.14 + (index % 4) * 0.24, y: 0.92 - Math.floor(index / 4) * 0.34 })),
  },
]

const players = Array.from({ length: 14 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  club_id: 'club-fixture',
  team_id: 'team-u12',
  player_name: index === 0 ? 'Synthetic One' : `Synthetic Player ${index + 1}`,
  shirt_number: index === 1 ? '' : String(index + 1),
  section: index === 2 ? 'Trial' : 'Squad',
  status: 'active',
}))

function createMockState({ seedSharedBoard = false } = {}) {
  let versionNumber = 1
  let shouldConflict = false
  let shouldFailVersionRefresh = false
  let exportRequestNumber = 0
  let publicationNumber = 0
  const boardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const boards = []
  const versionHistory = []
  const publications = []
  const exportRequests = new Map()

  function payloadFrom(parameters, existing = null) {
    const currentVersion = {
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(versionNumber).padStart(12, '0')}`,
      board_id: boardId,
      club_id: 'club-fixture',
      team_id: 'team-u12',
      version_number: versionNumber,
      game_format: parameters.game_format_value || existing?.currentVersion?.game_format || '7v7',
      formation_preset_key: parameters.preset_key_value || existing?.currentVersion?.formation_preset_key || '7v7-2-3-1',
      preset_registry_version: 1,
      pitch_orientation: parameters.pitch_orientation_value || existing?.currentVersion?.pitch_orientation || 'portrait',
      placements: parameters.placements_value || existing?.currentVersion?.placements || [],
      bench: parameters.bench_value || existing?.currentVersion?.bench || [],
      notes: parameters.notes_value || existing?.currentVersion?.notes || '',
      created_by_profile_id: 'user-manager.fixture@footballplayer.test',
      created_at: new Date().toISOString(),
      version_reason: 'save',
    }
    const board = {
      id: boardId,
      club_id: 'club-fixture',
      team_id: 'team-u12',
      title: parameters.title_value || existing?.board?.title || 'Shared fixture board',
      description: parameters.description_value ?? existing?.board?.description ?? '',
      game_format: currentVersion.game_format,
      formation_preset_key: currentVersion.formation_preset_key,
      preset_registry_version: 1,
      visibility_state: parameters.visibility_value || existing?.board?.visibility_state || 'draft',
      created_by_profile_id: 'user-manager.fixture@footballplayer.test',
      current_version_id: currentVersion.id,
      current_version_number: versionNumber,
      current_publication_id: null,
      archived_at: null,
      created_at: existing?.board?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    return { board, currentVersion, currentPublication: null }
  }

  if (seedSharedBoard) {
    const seededBoard = payloadFrom({ title_value: 'Shared fixture board', visibility_value: 'shared' })
    boards.push(seededBoard)
    versionHistory.push(seededBoard.currentVersion)
  }

  return {
    boards,
    publications,
    setConflict() { shouldConflict = true },
    failNextVersionRefresh() { shouldFailVersionRefresh = true },
    async handle(route) {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      let parameters = {}
      try { parameters = request.postDataJSON() || {} } catch { parameters = {} }

      if (path.endsWith('/formation_board_presets')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(presets) })
      }
      if (path.endsWith('/players')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(players) })
      }
      if (path.endsWith('/resource_library_items')) {
        const currentPublication = publications[0]
        const resource = currentPublication ? [{
          id: currentPublication.resource_id,
          club_id: 'club-fixture',
          team_id: 'team-u12',
          title: currentPublication.board_title_snapshot,
          description: currentPublication.board_description_snapshot,
          category: currentPublication.resource_category,
          storage_bucket: 'resource-library',
          storage_path: 'synthetic-formation-board',
          original_filename: 'formation-board',
          mime_type: 'application/vnd.footballplayer.formation-board+json',
          file_size_bytes: 1,
          uploaded_by_profile_id: 'user-manager.fixture@footballplayer.test',
          uploaded_by_name: 'Fixture Manager',
          uploaded_by_email: 'manager.fixture@footballplayer.test',
          archived_at: null,
          created_at: currentPublication.published_at,
          updated_at: currentPublication.published_at,
          teams: { id: 'team-u12', name: 'U12' },
          resource_library_links: [],
          resource_library_external_links: [{ external_url: `${baseUrl}/resources/formation-boards?board=${boardId}&version=${currentPublication.board_version_id}` }],
          formation_board_publications: publications.map((publication) => ({
            ...publication,
            thumbnail_bucket: null,
            thumbnail_path: null,
            formation_board_versions: versionHistory.find((version) => version.id === publication.board_version_id),
          })),
        }] : []
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resource) })
      }
      if (path.endsWith('/rpc/list_formation_boards')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(boards) })
      }
      if (path.endsWith('/rpc/get_formation_board')) {
        const board = boards.find((item) => item.board.id === parameters.target_board_id) || boards[0] || null
        return route.fulfill({ status: board ? 200 : 404, contentType: 'application/json', body: JSON.stringify(board || { message: 'formation_board_not_found' }) })
      }
      if (path.endsWith('/rpc/create_formation_board')) {
        versionNumber = 1
        const board = payloadFrom(parameters)
        boards.splice(0, boards.length, board)
        versionHistory.splice(0, versionHistory.length, board.currentVersion)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) })
      }
      if (path.endsWith('/rpc/save_formation_board_editor')) {
        if (shouldConflict) {
          shouldConflict = false
          return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'formation_board_version_conflict' }) })
        }
        versionNumber += 1
        const board = payloadFrom(parameters, boards[0])
        boards.splice(0, boards.length, board)
        versionHistory.push(board.currentVersion)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) })
      }
      if (path.endsWith('/rpc/list_formation_board_versions')) {
        if (shouldFailVersionRefresh) {
          shouldFailVersionRefresh = false
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'temporary_refresh_failure' }) })
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(versionHistory) })
      }
      if (path.endsWith('/rpc/list_formation_board_publications')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(publications) })
      }
      if (path.endsWith('/rpc/request_formation_board_export')) {
        exportRequestNumber += 1
        const requestId = `eeeeeeee-eeee-4eee-8eee-${String(exportRequestNumber).padStart(12, '0')}`
        exportRequests.set(requestId, parameters.export_format_value)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            request: { id: requestId, export_format: parameters.export_format_value, export_state: 'pending' },
            snapshot: boards[0]?.currentVersion,
          }),
        })
      }
      if (path.endsWith('/rpc/publish_formation_board_version')) {
        publicationNumber += 1
        const publication = {
          id: `ffffffff-ffff-4fff-8fff-${String(publicationNumber).padStart(12, '0')}`,
          board_id: boardId,
          board_version_id: parameters.target_version_id,
          club_id: 'club-fixture',
          team_id: 'team-u12',
          resource_id: parameters.target_resource_id || 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          resource_category: parameters.category_value,
          publication_number: publicationNumber,
          publication_action: parameters.publication_action_value,
          previous_publication_id: publications[0]?.id || null,
          published_by_profile_id: 'user-manager.fixture@footballplayer.test',
          published_by_name: 'Fixture Manager',
          published_at: new Date().toISOString(),
          board_title_snapshot: boards[0]?.board.title,
          board_description_snapshot: boards[0]?.board.description,
          thumbnail_bucket: parameters.thumbnail_path_value ? 'resource-library' : null,
          thumbnail_path: parameters.thumbnail_path_value,
          publication_state: parameters.thumbnail_path_value ? 'published' : 'export_failed',
        }
        publications.unshift(publication)
        boards[0].board.current_publication_id = publication.id
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            protectedUrl: `${baseUrl}/resources/formation-boards?board=${boardId}&version=${parameters.target_version_id}`,
            publication,
            resource: { id: publication.resource_id },
          }),
        })
      }
      if (path.endsWith('/rpc/archive_formation_board') || path.endsWith('/rpc/restore_formation_board') || path.endsWith('/rpc/duplicate_formation_board') || path.endsWith('/rpc/restore_formation_board_version')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(boards[0]) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    },
    async handleExport(route) {
      const body = route.request().postDataJSON()
      const format = exportRequests.get(body.requestId) || 'png'

      if (body.purpose === 'thumbnail') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ thumbnailPath: `club-fixture/team-u12/formation-boards/${boardId}/versions/${boards[0]?.currentVersion.id}/thumbnail.png` }),
        })
      }

      return route.fulfill({
        status: 200,
        contentType: format === 'pdf' ? 'application/pdf' : 'image/png',
        headers: { 'Content-Disposition': `attachment; filename="browser-test-board-v${boards[0]?.board.current_version_number || 1}.${format}"` },
        body: format === 'pdf' ? '%PDF-1.7\n%%EOF' : Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      })
    },
  }
}

async function createFixtureContext(browser, fixtureEmail, contextOptions = {}, stateOptions = {}) {
  const context = await browser.newContext(contextOptions)
  const state = createMockState(stateOptions)
  await context.addInitScript((email) => {
    window.sessionStorage.setItem('auth-access-browser-fixture-email', email)
    window.localStorage.setItem('selected-team-id', 'team-u12')
    window.localStorage.setItem('sb-fixture-auth-token', JSON.stringify({
      access_token: 'fixture-access-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      refresh_token: 'fixture-refresh-token',
      token_type: 'bearer',
      user: { id: email, email },
    }))
  }, fixtureEmail)
  await context.route('http://fixture.supabase.test/**', (route) => state.handle(route))
  await context.route('**/.netlify/functions/formation-board-export', (route) => state.handleExport(route))
  return { context, state }
}

const server = startServer()
let browser

try {
  await waitForPort()
  browser = await chromium.launch({ headless: true })

  const desktopFixture = await createFixtureContext(browser, 'manager.fixture@footballplayer.test', { viewport: { width: 1440, height: 1000 } })
  const desktopPage = await desktopFixture.context.newPage()
  const consoleErrors = []
  desktopPage.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await desktopPage.goto(`${baseUrl}/resources/formation-boards`, { waitUntil: 'networkidle' })
  await desktopPage.getByRole('main').getByRole('heading', { name: 'Formation Boards', exact: true }).waitFor()
  await desktopPage.getByRole('button', { name: 'Open quick actions' }).click()
  await desktopPage.getByRole('link', { name: /Formation Board/ }).click()
  await desktopPage.getByLabel('Board title').fill('Browser test board')
  for (const gameFormat of ['5v5', '9v9', '11v11', '7v7']) {
    await desktopPage.getByLabel('Game format').selectOption(gameFormat)
    await desktopPage.getByRole('button', { name: 'Change formation', exact: true }).click()
    assert.equal(await desktopPage.getByLabel('Game format').inputValue(), gameFormat)
  }
  await desktopPage.getByLabel('Formation').selectOption('7v7-custom')
  await desktopPage.getByRole('button', { name: 'Change formation', exact: true }).click()
  assert.equal(await desktopPage.getByLabel('Formation').inputValue(), '7v7-custom')
  await desktopPage.getByLabel('Formation').selectOption('7v7-2-3-1')
  await desktopPage.getByRole('button', { name: 'Change formation', exact: true }).click()
  await desktopPage.getByRole('button', { name: /Synthetic One/ }).click()
  await desktopPage.locator('[data-formation-pitch]').click({ position: { x: 220, y: 260 } })
  const desktopMarker = desktopPage.getByRole('button', { name: /Synthetic One, shirt 1/ })
  const markerBounds = await desktopMarker.boundingBox()
  assert.ok(markerBounds)
  await desktopPage.mouse.move(markerBounds.x + markerBounds.width / 2, markerBounds.y + markerBounds.height / 2)
  await desktopPage.mouse.down()
  await desktopPage.mouse.move(markerBounds.x + markerBounds.width / 2 + 90, markerBounds.y + markerBounds.height / 2 + 40, { steps: 4 })
  await desktopPage.mouse.up()
  await desktopMarker.focus()
  await desktopPage.keyboard.press('ArrowRight')
  await desktopPage.getByRole('button', { name: 'Save', exact: true }).click()
  await desktopPage.getByText('Saved', { exact: true }).waitFor()
  assert.equal(desktopFixture.state.boards.length, 1)
  assert.equal(desktopFixture.state.boards[0].currentVersion.placements.length, 1)
  const firstPublishedVersionId = desktopFixture.state.boards[0].currentVersion.id

  await desktopPage.getByRole('button', { name: 'Publish to Team Resources', exact: true }).click()
  await desktopPage.getByRole('dialog', { name: 'Publish to Team Resources' }).waitFor()
  await desktopPage.getByLabel('Team Resource category').selectOption('training')
  await desktopPage.getByText('Review this preview before publishing.', { exact: false }).waitFor()
  await desktopPage.getByRole('button', { name: 'Publish immutable version' }).click()
  await desktopPage.getByText('Published to Team Resources').waitFor()
  assert.equal(desktopFixture.state.publications.length, 1)
  assert.equal(desktopFixture.state.publications[0].board_version_id, firstPublishedVersionId)

  const pngDownloadPromise = desktopPage.waitForEvent('download')
  await desktopPage.getByRole('button', { name: 'Export PNG', exact: true }).click()
  const pngDownload = await pngDownloadPromise
  assert.match(pngDownload.suggestedFilename(), /browser-test-board-v1\.png/)

  const pdfDownloadPromise = desktopPage.waitForEvent('download')
  await desktopPage.getByRole('button', { name: 'Export PDF', exact: true }).click()
  const pdfDownload = await pdfDownloadPromise
  assert.match(pdfDownload.suggestedFilename(), /browser-test-board-v1\.pdf/)

  await desktopPage.getByRole('button', { name: /Synthetic One, shirt 1/ }).click()
  await desktopPage.getByRole('button', { name: 'Move to bench' }).click()
  await desktopPage.getByText('No Players on the bench.').waitFor({ state: 'detached' })
  await desktopPage.getByLabel('Staff notes').fill('Protected local draft')
  await wait(700)
  await desktopPage.reload({ waitUntil: 'networkidle' })
  await desktopPage.getByRole('button', { name: 'Restore draft' }).waitFor()
  await desktopPage.getByRole('button', { name: 'Restore draft' }).click()
  assert.equal(await desktopPage.getByLabel('Staff notes').inputValue(), 'Protected local draft')

  desktopFixture.state.failNextVersionRefresh()
  await desktopPage.getByRole('button', { name: 'Save', exact: true }).click()
  await desktopPage.getByText('Saved', { exact: true }).waitFor()
  await desktopPage.getByRole('button', { name: 'Publish to Team Resources', exact: true }).click()
  await desktopPage.getByLabel('Publication action').selectOption('update_resource')
  await desktopPage.getByLabel('Linked Team Resource').selectOption('dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  await desktopPage.getByRole('button', { name: 'Publish immutable version' }).click()
  await desktopPage.getByText('Published to Team Resources').waitFor()
  assert.equal(desktopFixture.state.publications.length, 2)
  assert.equal(desktopFixture.state.publications[1].board_version_id, firstPublishedVersionId)

  await desktopPage.goto(`${baseUrl}/resources`, { waitUntil: 'networkidle' })
  await desktopPage.getByRole('heading', { name: 'Team Resource Library' }).waitFor()
  const formationResourceCard = desktopPage.getByRole('article').filter({ hasText: 'Browser test board' })
  await formationResourceCard.getByText('Browser test board', { exact: true }).waitFor()
  await formationResourceCard.getByText('7v7 | 2-3-1 | Version 2', { exact: true }).waitFor()
  await desktopPage.screenshot({ path: `${screenshotDirectory}/resource-library.png`, fullPage: true })
  await formationResourceCard.getByText(/Version history \(2\)/).click()
  const historyLinks = formationResourceCard.getByRole('link', { name: 'Open version' })
  assert.equal(await historyLinks.count(), 2)
  await historyLinks.last().click()
  await desktopPage.getByText('Published snapshot, version 1').waitFor()
  assert.equal(await desktopPage.getByLabel('Board title').isDisabled(), true)
  await desktopPage.goto(`${baseUrl}/resources/formation-boards?board=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, { waitUntil: 'networkidle' })
  await desktopPage.getByRole('heading', { name: 'Pitch' }).waitFor()
  await desktopPage.getByLabel('Staff notes').fill('Protected conflict draft')
  desktopFixture.state.setConflict()
  await desktopPage.getByRole('button', { name: 'Save', exact: true }).click()
  await desktopPage.getByRole('heading', { name: 'A newer Team version is available' }).waitFor()
  await desktopPage.getByRole('button', { name: 'Reload latest' }).click()
  await desktopPage.getByText('Saved', { exact: true }).waitFor()
  await desktopPage.screenshot({ path: `${screenshotDirectory}/desktop-editor.png`, fullPage: true })
  assert.deepEqual(consoleErrors.filter((message) => !/favicon|analytics|Failed to load resource/.test(message)), [])
  await desktopFixture.context.close()

  const mobileFixture = await createFixtureContext(browser, 'manager.fixture@footballplayer.test', devices['iPhone 13'], { seedSharedBoard: true })
  const mobilePage = await mobileFixture.context.newPage()
  await mobilePage.goto(`${baseUrl}/resources/formation-boards?board=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, { waitUntil: 'networkidle' })
  await mobilePage.getByRole('heading', { name: 'Pitch' }).waitFor()
  const portraitOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.ok(portraitOverflow <= 1, `iPhone portrait overflowed by ${portraitOverflow}px`)
  await mobilePage.getByRole('button', { name: 'Actions', exact: true }).click()
  const mobileActions = mobilePage.getByRole('dialog', { name: 'Formation Board actions' })
  await mobileActions.waitFor()
  await mobileActions.getByRole('button', { name: 'Publish to Team Resources', exact: true }).waitFor()
  await mobileActions.getByRole('button', { name: 'Export PNG', exact: true }).waitFor()
  await mobileActions.getByRole('button', { name: 'Export PDF', exact: true }).waitFor()
  await mobileActions.getByRole('button', { name: 'Close', exact: true }).click()
  await mobilePage.getByRole('button', { name: 'Players', exact: true }).click()
  await mobilePage.getByRole('dialog', { name: 'Formation Board Players and bench' }).waitFor()
  const touchPlayer = mobilePage.getByRole('button', { name: /Synthetic One/ })
  const touchPlayerBounds = await touchPlayer.boundingBox()
  const touchPitchBounds = await mobilePage.locator('[data-formation-pitch]').boundingBox()
  assert.ok(touchPlayerBounds && touchPitchBounds)
  await touchPlayer.dispatchEvent('pointerdown', {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: touchPlayerBounds.x + touchPlayerBounds.width / 2,
    clientY: touchPlayerBounds.y + touchPlayerBounds.height / 2,
    pointerId: 17,
    pointerType: 'touch',
  })
  await mobilePage.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y, pointerId: 17, pointerType: 'touch' }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y, pointerId: 17, pointerType: 'touch' }))
  }, { x: touchPitchBounds.x + touchPitchBounds.width / 2, y: touchPitchBounds.y + touchPitchBounds.height / 2 })
  const mobileMarker = mobilePage.getByRole('button', { name: /Synthetic One, shirt 1/ })
  await mobileMarker.waitFor()
  await mobileMarker.scrollIntoViewIfNeeded()
  const scrollBeforeMarkerDrag = await mobilePage.evaluate(() => window.scrollY)
  const mobileMarkerBounds = await mobileMarker.boundingBox()
  assert.ok(mobileMarkerBounds)
  await mobileMarker.dispatchEvent('pointerdown', {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: mobileMarkerBounds.x + mobileMarkerBounds.width / 2,
    clientY: mobileMarkerBounds.y + mobileMarkerBounds.height / 2,
    pointerId: 23,
    pointerType: 'touch',
  })
  await mobileMarker.dispatchEvent('pointermove', {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: mobileMarkerBounds.x + mobileMarkerBounds.width / 2 + 35,
    clientY: mobileMarkerBounds.y + mobileMarkerBounds.height / 2 + 15,
    pointerId: 23,
    pointerType: 'touch',
  })
  await mobileMarker.dispatchEvent('pointerup', {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: mobileMarkerBounds.x + mobileMarkerBounds.width / 2 + 35,
    clientY: mobileMarkerBounds.y + mobileMarkerBounds.height / 2 + 15,
    pointerId: 23,
    pointerType: 'touch',
  })
  assert.equal(await mobilePage.evaluate(() => window.scrollY), scrollBeforeMarkerDrag)
  const resumedScrollDistance = await mobilePage.evaluate(() => {
    const scroller = document.scrollingElement
    scroller.scrollTop = 0
    scroller.scrollTop = 120
    return scroller.scrollTop
  })
  assert.ok(resumedScrollDistance > 0)
  await mobilePage.setViewportSize({ width: 844, height: 390 })
  assert.equal(await mobilePage.getByRole('button', { name: /Synthetic One, shirt 1/ }).count(), 1)
  const landscapeOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.ok(landscapeOverflow <= 1, `iPhone landscape overflowed by ${landscapeOverflow}px`)
  await mobilePage.screenshot({ path: `${screenshotDirectory}/iphone-landscape.png`, fullPage: true })
  await mobileFixture.context.close()

  for (const profile of [
    { label: 'android-portrait', viewport: { width: 412, height: 915 } },
    { label: 'android-landscape', viewport: { width: 915, height: 412 } },
    { label: 'tablet', viewport: { width: 820, height: 1180 } },
    { label: 'short-desktop', viewport: { width: 1280, height: 560 } },
  ]) {
    const fixture = await createFixtureContext(browser, 'manager.fixture@footballplayer.test', { viewport: profile.viewport }, { seedSharedBoard: true })
    const page = await fixture.context.newPage()
    await page.goto(`${baseUrl}/resources/formation-boards?board=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Pitch' }).waitFor()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 1, `${profile.label} overflowed by ${overflow}px`)
    await fixture.context.close()
  }

  const assistantFixture = await createFixtureContext(browser, 'assistant.fixture@footballplayer.test', {}, { seedSharedBoard: true })
  const assistantPage = await assistantFixture.context.newPage()
  await assistantPage.goto(`${baseUrl}/resources/formation-boards`, { waitUntil: 'networkidle' })
  await assistantPage.getByRole('main').getByRole('heading', { name: 'Formation Boards', exact: true }).waitFor()
  assert.equal(await assistantPage.getByRole('button', { name: 'Create Formation Board' }).count(), 0)
  await assistantPage.getByRole('button', { name: 'Open', exact: true }).click()
  await assistantPage.getByText('Read-only Team board').waitFor()
  assert.equal(await assistantPage.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true)
  await assistantFixture.context.close()

  const parentFixture = await createFixtureContext(browser, 'parent.fixture@footballplayer.test')
  const parentPage = await parentFixture.context.newPage()
  await parentPage.goto(`${baseUrl}/resources/formation-boards`, { waitUntil: 'networkidle' })
  assert.equal(await parentPage.getByRole('main').getByRole('heading', { name: 'Formation Boards', exact: true }).count(), 0)
  await parentFixture.context.close()

  console.log('Formation Board browser checks passed for publication, immutable history, PNG, PDF, mobile actions, desktop, short desktop, iPhone, Android, tablet, permissions, draft recovery, and conflict protection.')
} catch (error) {
  console.error(error)
  console.error(server.getOutput())
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
