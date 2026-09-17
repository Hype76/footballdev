import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import { chromium, devices } from 'playwright'

const port = Number(process.env.FORMATION_BOARD_BROWSER_PORT || 4850 + Math.floor(Math.random() * 100))
const baseUrl = `http://127.0.0.1:${port}`
const screenshotDirectory = 'outputs/fp-v1-formation-board-mobile-selection-portrait-27'
const visualConsistencyScreenshotDirectory = 'outputs/fp-v1-formation-gameday-visual-consistency-28'
await mkdir(screenshotDirectory, { recursive: true })
await mkdir(visualConsistencyScreenshotDirectory, { recursive: true })

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

function createMockState({ seedLandscapeBoard = false, seedSharedBoard = false } = {}) {
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

  if (seedSharedBoard || seedLandscapeBoard) {
    const seededBoard = payloadFrom({
      title_value: seedLandscapeBoard ? 'Legacy landscape fixture board' : 'Shared fixture board',
      visibility_value: 'shared',
      pitch_orientation_value: seedLandscapeBoard ? 'landscape' : 'portrait',
      placements_value: seedLandscapeBoard ? [{
        playerId: players[0].id,
        displayName: players[0].player_name,
        shirtNumber: players[0].shirt_number,
        slotId: 'gk',
        x: 0.5,
        y: 0.9,
        state: 'pitch',
      }] : [],
    })
    boards.push(seededBoard)
    versionHistory.push(seededBoard.currentVersion)
  }

  return {
    boards,
    publications,
    versionHistory,
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
      if (path.endsWith('/rpc/get_team_players')) {
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
  await desktopPage.getByRole('button', { name: 'Create Formation Board', exact: true }).click()
  await desktopPage.locator('[data-formation-pitch]').waitFor()
  await desktopPage.getByRole('button', { name: 'Untitled Formation Board', exact: true }).click()
  await desktopPage.getByLabel('Board title').fill('Browser test board')
  assert.equal(await desktopPage.getByLabel('Board title').inputValue(), 'Browser test board')
  assert.equal(await desktopPage.getByLabel('Board title').evaluate((element) => document.activeElement === element), true)
  await desktopPage.getByRole('dialog', { name: 'Board details and options' }).getByRole('button', { name: 'Close' }).click()
  await desktopPage.getByRole('button', { name: 'Formation', exact: true }).first().click()
  await desktopPage.getByLabel('Game format').selectOption('7v7')
  await desktopPage.getByRole('button', { name: 'Change formation', exact: true }).click()
  assert.equal(await desktopPage.getByLabel('Pitch orientation').count(), 0)
  await desktopPage.screenshot({ path: `${screenshotDirectory}/desktop-multi-select.png`, fullPage: true })

  await desktopPage.getByRole('button', { name: 'Players', exact: true }).first().click()
  await desktopPage.getByRole('button', { name: /Synthetic One/ }).click()
  await desktopPage.getByRole('button', { name: /Synthetic Player 2/ }).click()
  await desktopPage.getByText('2 selected', { exact: true }).waitFor()
  await desktopPage.getByPlaceholder('Search squad').fill('Synthetic Player 3')
  assert.equal(await desktopPage.getByPlaceholder('Search squad').inputValue(), 'Synthetic Player 3')
  assert.equal(await desktopPage.getByPlaceholder('Search squad').evaluate((element) => document.activeElement === element), true)
  await desktopPage.getByRole('button', { name: /Synthetic Player 3/ }).click()
  await desktopPage.getByText('3 selected', { exact: true }).waitFor()
  await desktopPage.getByPlaceholder('Search squad').fill('')
  await desktopPage.getByRole('button', { name: /Synthetic Player 2/ }).click()
  await desktopPage.getByText('2 selected', { exact: true }).waitFor()
  await desktopPage.getByRole('button', { name: /Synthetic Player 2/ }).click()
  await desktopPage.getByText('3 selected', { exact: true }).waitFor()
  await desktopPage.getByRole('button', { name: 'Add 3 Players', exact: true }).click()
  await desktopPage.getByRole('region', { name: 'Bench' }).waitFor()
  assert.equal(await desktopPage.getByRole('button', { name: /Synthetic One, shirt 1, Bench/ }).count(), 1)
  assert.equal(await desktopPage.getByRole('button', { name: /Synthetic Player 2, shirt number missing, Bench/ }).count(), 1)

  const desktopPitchBounds = await desktopPage.locator('[data-formation-pitch]').boundingBox()
  assert.ok(desktopPitchBounds)
  await desktopPage.getByRole('button', { name: /Synthetic One, shirt 1, Bench/ }).click()
  await desktopPage.mouse.click(desktopPitchBounds.x + desktopPitchBounds.width * 0.08, desktopPitchBounds.y + desktopPitchBounds.height * 0.35)
  await desktopPage.getByRole('button', { name: /Synthetic One, displayed shirt number 1/ }).waitFor()
  await desktopPage.getByRole('button', { name: /Synthetic Player 2, shirt number missing, Bench/ }).click()
  await desktopPage.mouse.click(desktopPitchBounds.x + desktopPitchBounds.width * 0.92, desktopPitchBounds.y + desktopPitchBounds.height * 0.35)
  await desktopPage.getByRole('button', { name: /Synthetic Player 2, no displayed shirt number/ }).waitFor()

  const dragSource = desktopPage.getByRole('button', { name: /Synthetic Player 3, shirt 3, Bench/ })
  const dragSourceBounds = await dragSource.boundingBox()
  assert.ok(dragSourceBounds && desktopPitchBounds)
  await desktopPage.mouse.move(dragSourceBounds.x + dragSourceBounds.width / 2, dragSourceBounds.y + dragSourceBounds.height / 2)
  await desktopPage.mouse.down()
  await desktopPage.mouse.move(desktopPitchBounds.x + desktopPitchBounds.width * 0.5, desktopPitchBounds.y + desktopPitchBounds.height * 0.9, { steps: 5 })
  await desktopPage.mouse.up()
  await desktopPage.getByRole('button', { name: /Synthetic Player 3, displayed shirt number 3/ }).waitFor()
  const placedMarkerLabels = await desktopPage.locator('[data-formation-player-marker]').evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')))
  assert.equal(placedMarkerLabels.length, 3, JSON.stringify(placedMarkerLabels))
  const leftEdgeMarker = desktopPage.getByRole('button', { name: /Synthetic One, displayed shirt number 1/ })
  const rightEdgeMarker = desktopPage.getByRole('button', { name: /Synthetic Player 3, displayed shirt number 3/ })
  for (let step = 0; step < 4; step += 1) await leftEdgeMarker.press('Shift+ArrowLeft')
  for (let step = 0; step < 10; step += 1) await rightEdgeMarker.press('Shift+ArrowRight')
  const edgeContainment = await desktopPage.locator('[data-formation-pitch]').evaluate((pitch) => {
    const pitchBounds = pitch.getBoundingClientRect()
    return [...pitch.querySelectorAll('[data-formation-player-marker]')].map((marker) => {
      const markerBounds = marker.getBoundingClientRect()
      const nameBounds = marker.querySelector('[title]')?.getBoundingClientRect()
      return {
        markerInside: markerBounds.left >= pitchBounds.left - 1 && markerBounds.right <= pitchBounds.right + 1 && markerBounds.top >= pitchBounds.top - 1 && markerBounds.bottom <= pitchBounds.bottom + 1,
        nameInside: !nameBounds || (nameBounds.left >= pitchBounds.left - 1 && nameBounds.right <= pitchBounds.right + 1 && nameBounds.top >= pitchBounds.top - 1 && nameBounds.bottom <= pitchBounds.bottom + 1),
      }
    })
  })
  assert.ok(edgeContainment.every(({ markerInside, nameInside }) => markerInside && nameInside), JSON.stringify(edgeContainment))

  await desktopPage.getByRole('button', { name: 'Edit lineup', exact: true }).click()
  await desktopPage.getByRole('button', { name: /Synthetic One, displayed shirt number 1.*select to move to Bench/ }).click()
  await desktopPage.getByRole('button', { name: /Synthetic Player 3, displayed shirt number 3.*select to move to Bench/ }).click()
  await desktopPage.getByText('2 selected', { exact: true }).waitFor()
  await desktopPage.screenshot({ path: `${screenshotDirectory}/desktop-lineup-removal.png`, fullPage: true })
  await desktopPage.getByRole('button', { name: 'Move 2 selected to Bench', exact: true }).click()
  assert.equal(await desktopPage.locator('[data-formation-player-marker]').count(), 1)
  await desktopPage.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal(await desktopPage.locator('[data-formation-player-marker]').count(), 3)

  const desktopMarker = desktopPage.getByRole('button', { name: /Synthetic One, displayed shirt number 1/ })
  const markerBounds = await desktopMarker.boundingBox()
  assert.ok(markerBounds)
  await desktopPage.mouse.move(markerBounds.x + markerBounds.width / 2, markerBounds.y + markerBounds.height / 2)
  await desktopPage.mouse.down()
  await desktopPage.mouse.move(markerBounds.x + markerBounds.width / 2 + 90, markerBounds.y + markerBounds.height / 2 + 40, { steps: 4 })
  await desktopPage.mouse.up()
  await desktopMarker.focus()
  await desktopPage.keyboard.press('ArrowRight')
  await desktopPage.getByRole('button', { name: 'Share', exact: true }).last().click()
  const desktopShareActions = desktopPage.getByRole('dialog', { name: 'Formation Board actions' })
  await desktopShareActions.getByRole('button', { name: 'Save to Team', exact: true }).click()
  await desktopPage.getByText('Saved to Team', { exact: true }).waitFor()
  assert.equal(desktopFixture.state.boards.length, 1)
  assert.equal(desktopFixture.state.boards[0].currentVersion.placements.length, 3)
  assert.equal(desktopFixture.state.boards[0].currentVersion.pitch_orientation, 'portrait')
  const firstPublishedVersionId = desktopFixture.state.boards[0].currentVersion.id

  await desktopShareActions.getByRole('button', { name: 'Publish to Team Resources', exact: true }).click()
  await desktopPage.getByRole('dialog', { name: 'Publish to Team Resources' }).waitFor()
  await desktopPage.getByLabel('Team Resource category').selectOption('training')
  await desktopPage.getByText('Review this preview before publishing.', { exact: false }).waitFor()
  await desktopPage.getByRole('button', { name: 'Publish immutable version' }).click()
  await desktopPage.getByText('Published to Team Resources').waitFor()
  assert.equal(desktopFixture.state.publications.length, 1)
  assert.equal(desktopFixture.state.publications[0].board_version_id, firstPublishedVersionId)

  await desktopPage.getByRole('button', { name: 'Share', exact: true }).last().click()
  const pngDownloadPromise = desktopPage.waitForEvent('download')
  await desktopPage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Export PNG', exact: true }).click()
  const pngDownload = await pngDownloadPromise
  assert.match(pngDownload.suggestedFilename(), /browser-test-board-v1\.png/)

  await desktopPage.getByRole('button', { name: 'Share', exact: true }).last().click()
  const pdfDownloadPromise = desktopPage.waitForEvent('download')
  await desktopPage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Export PDF', exact: true }).click()
  const pdfDownload = await pdfDownloadPromise
  assert.match(pdfDownload.suggestedFilename(), /browser-test-board-v1\.pdf/)
  await desktopPage.getByRole('dialog', { name: 'Formation Board actions' }).waitFor({ state: 'hidden' })

  await desktopPage.getByRole('button', { name: /Synthetic One, displayed shirt number 1/ }).click()
  const occupiedSlotDialog = desktopPage.getByRole('dialog').filter({ has: desktopPage.getByText('Position', { exact: true }) })
  await occupiedSlotDialog.getByRole('button', { name: 'Close' }).click()
  await desktopPage.getByRole('button', { name: 'Players', exact: true }).last().click()
  const selectedPlayerInspector = desktopPage.getByTestId('formation-board-player-inspector')
  await selectedPlayerInspector.waitFor({ state: 'visible' })
  await selectedPlayerInspector.screenshot({ path: `${visualConsistencyScreenshotDirectory}/formation-selected-inspector-light.png` })
  await desktopPage.evaluate(() => {
    window.localStorage.setItem('app-theme-mode', 'dark')
    window.dispatchEvent(new CustomEvent('app-theme-changed', { detail: { mode: 'dark' } }))
  })
  await desktopPage.locator('html.theme-dark').waitFor()
  await selectedPlayerInspector.screenshot({ path: `${visualConsistencyScreenshotDirectory}/formation-selected-inspector-dark.png` })
  await desktopPage.evaluate(() => {
    window.localStorage.setItem('app-theme-mode', 'light')
    window.dispatchEvent(new CustomEvent('app-theme-changed', { detail: { mode: 'light' } }))
  })
  await desktopPage.locator('html.theme-light').waitFor()
  await desktopPage.screenshot({ path: `${visualConsistencyScreenshotDirectory}/formation-desktop-selected-inspector-light.png`, fullPage: true })
  await desktopPage.getByRole('button', { name: 'Remove from board', exact: true }).click()
  await desktopPage.getByRole('heading', { name: 'Remove Player from this board?' }).waitFor()
  await desktopPage.getByText('Team membership, Calendar events, and Match events will not change.', { exact: false }).waitFor()
  await desktopPage.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await desktopPage.getByRole('button', { name: /Synthetic One, displayed shirt number 1/ }).count(), 1)
  await desktopPage.getByRole('button', { name: 'Move to Bench' }).click()
  assert.equal(await selectedPlayerInspector.evaluate((element) => document.activeElement === element), true)
  await desktopPage.getByRole('region', { name: 'Bench' }).getByRole('button', { name: /Synthetic One, shirt 1, Bench/ }).waitFor()
  await desktopPage.getByRole('dialog', { name: 'Players' }).getByRole('button', { name: 'Close' }).click()
  await desktopPage.getByRole('button', { name: /Synthetic Player 2, no displayed shirt number/ }).click()
  await occupiedSlotDialog.getByRole('button', { name: 'Close' }).click()
  await desktopPage.getByRole('button', { name: 'Players', exact: true }).last().click()
  await desktopPage.getByRole('button', { name: 'Move to Bench' }).click()
  await desktopPage.getByRole('button', { name: /Synthetic Player 2, shirt number missing, Bench/ }).waitFor()
  await desktopPage.getByRole('dialog', { name: 'Players' }).getByRole('button', { name: 'Close' }).click()
  await desktopPage.getByRole('button', { name: 'More Formation Board options' }).click()
  await desktopPage.getByLabel('Coach notes').fill('Protected local draft')
  await desktopPage.getByRole('dialog', { name: 'Board details and options' }).getByRole('button', { name: 'Close' }).click()
  await wait(700)
  await desktopPage.reload({ waitUntil: 'networkidle' })
  await desktopPage.getByRole('button', { name: 'Restore draft' }).waitFor()
  await desktopPage.getByRole('button', { name: 'Restore draft' }).click()
  await desktopPage.getByRole('button', { name: 'More Formation Board options' }).click()
  assert.equal(await desktopPage.getByLabel('Coach notes').inputValue(), 'Protected local draft')
  await desktopPage.getByRole('dialog', { name: 'Board details and options' }).getByRole('button', { name: 'Close' }).click()
  const restoredTray = desktopPage.getByRole('region', { name: 'Bench' })
  const restoredTrayToggle = restoredTray.getByRole('button', { name: /Subs \(/ })
  if (await restoredTrayToggle.getAttribute('aria-expanded') === 'false') await restoredTrayToggle.click()
  await restoredTray.getByRole('button', { name: /Synthetic Player 2, shirt number missing, Bench/ }).waitFor()

  desktopFixture.state.failNextVersionRefresh()
  await desktopPage.getByRole('button', { name: 'Share', exact: true }).last().click()
  await desktopPage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Save to Team', exact: true }).click()
  await desktopPage.getByText('Saved to Team', { exact: true }).waitFor()
  await desktopPage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Publish to Team Resources', exact: true }).click()
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
  await desktopPage.getByRole('button', { name: 'More Formation Board options' }).click()
  assert.equal(await desktopPage.getByLabel('Board title').isDisabled(), true)
  await desktopPage.getByRole('dialog', { name: 'Board details and options' }).getByRole('button', { name: 'Close' }).click()
  await desktopPage.goto(`${baseUrl}/resources/formation-boards?board=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, { waitUntil: 'networkidle' })
  await desktopPage.locator('[data-formation-pitch]').waitFor()
  await desktopPage.getByRole('button', { name: 'More Formation Board options' }).click()
  await desktopPage.getByLabel('Coach notes').fill('Protected conflict draft')
  await desktopPage.getByRole('dialog', { name: 'Board details and options' }).getByRole('button', { name: 'Close' }).click()
  desktopFixture.state.setConflict()
  await desktopPage.getByRole('button', { name: 'Share', exact: true }).last().click()
  await desktopPage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Save to Team', exact: true }).click()
  await desktopPage.getByRole('heading', { name: 'A newer Team version is available' }).waitFor()
  await desktopPage.getByRole('button', { name: 'Reload latest' }).click()
  await desktopPage.getByText('Saved to Team', { exact: true }).waitFor()
  await desktopPage.screenshot({ path: `${screenshotDirectory}/desktop-editor.png`, fullPage: true })
  assert.deepEqual(consoleErrors.filter((message) => !/favicon|analytics|Failed to load resource/.test(message)), [])
  await desktopFixture.context.close()

  const mobileFixture = await createFixtureContext(browser, 'manager.fixture@footballplayer.test', devices['iPhone 13'], { seedSharedBoard: true })
  const mobilePage = await mobileFixture.context.newPage()
  await mobilePage.goto(`${baseUrl}/resources/formation-boards?board=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, { waitUntil: 'networkidle' })
  await mobilePage.locator('[data-formation-pitch]').waitFor()
  const mobileDock = mobilePage.getByTestId('formation-mobile-action-dock')
  assert.equal(await mobileDock.getAttribute('data-mobile-action-dock'), 'expanded')
  const collapseActions = mobilePage.getByRole('button', { name: 'Collapse actions' })
  const collapseBox = await collapseActions.boundingBox()
  assert.ok(collapseBox && collapseBox.width >= 44 && collapseBox.height >= 44)
  await collapseActions.click()
  const expandActions = mobilePage.getByRole('button', { name: 'Expand actions' })
  await expandActions.waitFor({ state: 'visible' })
  await mobilePage.waitForFunction(() => document.documentElement.dataset.mobileActionDockState === 'collapsed')
  assert.equal(await mobilePage.evaluate(() => window.localStorage.getItem('footballplayer.online:mobile-action-dock:collapsed:v1')), 'true')
  await mobilePage.waitForFunction(() => {
    const handle = document.querySelector('[aria-label^="Expand actions"]')?.getBoundingClientRect()
    const pitch = document.querySelector('[data-formation-pitch]')?.getBoundingClientRect()
    if (!handle || !pitch) return false
    return handle.right <= pitch.left || handle.left >= pitch.right || handle.bottom <= pitch.top || handle.top >= pitch.bottom
  })
  const handleBox = await expandActions.boundingBox()
  const initialPitchBox = await mobilePage.locator('[data-formation-pitch]').boundingBox()
  assert.ok(handleBox && handleBox.width >= 44 && handleBox.height >= 44)
  assert.ok(handleBox.x + handleBox.width <= 390.5)
  assert.ok(
    initialPitchBox && (
      handleBox.x + handleBox.width <= initialPitchBox.x
      || handleBox.x >= initialPitchBox.x + initialPitchBox.width
      || handleBox.y + handleBox.height <= initialPitchBox.y
      || handleBox.y >= initialPitchBox.y + initialPitchBox.height
    ),
    `Collapsed handle ${JSON.stringify(handleBox)} overlapped pitch ${JSON.stringify(initialPitchBox)}`,
  )
  await mobilePage.reload({ waitUntil: 'networkidle' })
  await mobilePage.getByRole('button', { name: 'Expand actions' }).waitFor({ state: 'visible' })
  await mobilePage.getByRole('button', { name: 'Expand actions' }).click()
  assert.equal(await mobilePage.evaluate(() => window.localStorage.getItem('footballplayer.online:mobile-action-dock:collapsed:v1')), 'false')
  await mobilePage.getByRole('button', { name: 'More Formation Board options' }).click()
  await mobilePage.getByLabel('Board title').fill('')
  await mobilePage.getByRole('dialog', { name: 'Board details and options' }).getByRole('button', { name: 'Close' }).click()
  await mobilePage.getByRole('button', { name: 'Collapse actions' }).click()
  await mobilePage.getByRole('button', { name: /Expand actions, unsaved changes/ }).waitFor({ state: 'visible' })
  await mobilePage.getByRole('button', { name: /Expand actions, unsaved changes/ }).click()
  await mobilePage.getByRole('button', { name: 'Share', exact: true }).first().click()
  await mobilePage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Save to Team', exact: true }).click()
  await mobilePage.getByTestId('formation-mobile-action-dock').waitFor({ state: 'visible' })
  assert.equal(await mobilePage.getByTestId('formation-mobile-action-dock').getAttribute('data-mobile-action-dock'), 'expanded')
  const mobileShareDialog = mobilePage.getByRole('dialog', { name: 'Formation Board actions' })
  await mobileShareDialog.getByText('Enter a Formation Board title before saving.', { exact: true }).waitFor({ state: 'visible' })
  await mobilePage.waitForFunction(() => document.activeElement?.matches('[data-formation-dialog-error]'))
  assert.equal(await mobileShareDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true)
  await mobileShareDialog.getByRole('button', { name: 'Close' }).click()
  await mobilePage.getByRole('button', { name: 'More Formation Board options' }).click()
  await mobilePage.getByLabel('Board title').fill('Shared fixture board')
  await mobilePage.getByLabel('Description').fill('Dock browser validation')
  await mobilePage.getByLabel('Description').focus()
  await mobilePage.evaluate(() => {
    window.__fpRealVisualViewport = window.visualViewport
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: window.innerHeight - 240,
        offsetTop: 0,
        addEventListener() {},
        removeEventListener() {},
      },
    })
    window.dispatchEvent(new Event('resize'))
  })
  await mobilePage.waitForFunction(() => document.querySelector('[data-testid="formation-mobile-action-dock"]')?.className.includes('opacity-0'))
  await mobilePage.evaluate(() => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: window.__fpRealVisualViewport,
    })
    document.activeElement?.blur()
    window.dispatchEvent(new Event('resize'))
  })
  await mobilePage.waitForFunction(() => !document.querySelector('[data-testid="formation-mobile-action-dock"]')?.className.includes('opacity-0'))
  await mobilePage.getByRole('dialog', { name: 'Board details and options' }).getByRole('button', { name: 'Close' }).click()
  await mobilePage.getByRole('button', { name: 'Share', exact: true }).first().click()
  await mobilePage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Save to Team', exact: true }).click()
  await mobilePage.getByText('Saved to Team', { exact: true }).waitFor()
  await mobilePage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Close' }).click()
  const portraitOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.ok(portraitOverflow <= 1, `iPhone portrait overflowed by ${portraitOverflow}px`)
  await mobilePage.getByRole('button', { name: 'Share', exact: true }).first().click()
  const mobileActions = mobilePage.getByRole('dialog', { name: 'Formation Board actions' })
  await mobileActions.waitFor()
  await mobileActions.getByRole('button', { name: 'Publish to Team Resources', exact: true }).waitFor()
  await mobileActions.getByRole('button', { name: 'Export PNG', exact: true }).waitFor()
  await mobileActions.getByRole('button', { name: 'Export PDF', exact: true }).waitFor()
  await mobileActions.getByRole('button', { name: 'Close', exact: true }).click()
  await mobilePage.getByRole('button', { name: 'Players', exact: true }).click()
  const mobilePlayersSheet = mobilePage.getByRole('dialog', { name: 'Players' })
  await mobilePlayersSheet.waitFor()
  await mobilePlayersSheet.getByRole('button', { name: /Synthetic One/ }).tap()
  await mobilePlayersSheet.getByText('1 selected', { exact: true }).waitFor()
  await mobilePlayersSheet.getByRole('button', { name: 'Close', exact: true }).click()
  await mobilePlayersSheet.waitFor({ state: 'detached' })
  await mobilePage.getByRole('button', { name: 'Players', exact: true }).click()
  await mobilePlayersSheet.waitFor()
  await mobilePlayersSheet.getByText('0 selected', { exact: true }).waitFor()
  await mobilePlayersSheet.getByRole('button', { name: /Synthetic One/ }).tap()
  await mobilePlayersSheet.getByRole('button', { name: /Synthetic Player 2/ }).tap()
  await mobilePlayersSheet.getByRole('button', { name: /Synthetic Player 3/ }).tap()
  await mobilePlayersSheet.getByText('3 selected', { exact: true }).waitFor()
  await mobilePlayersSheet.getByPlaceholder('Search squad').fill('Synthetic Player 4')
  await mobilePlayersSheet.getByRole('button', { name: /Synthetic Player 4/ }).tap()
  await mobilePlayersSheet.getByText('4 selected', { exact: true }).waitFor()
  await mobilePlayersSheet.getByPlaceholder('Search squad').fill('')
  await mobilePlayersSheet.getByRole('button', { name: 'Add 4 Players', exact: true }).click()
  await mobilePlayersSheet.waitFor({ state: 'detached' })
  const mobileTray = mobilePage.getByRole('region', { name: 'Bench' })
  await mobileTray.waitFor()
  const trayScroll = await mobileTray.locator('.overflow-x-auto').evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
  assert.ok(trayScroll.scrollWidth >= trayScroll.clientWidth)
  await mobilePage.screenshot({ path: `${screenshotDirectory}/iphone-portrait.png`, fullPage: true })

  const touchPlayer = mobilePage.getByRole('button', { name: /Synthetic One, shirt 1, Bench/ })
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
  const mobileMarker = mobilePage.getByRole('button', { name: /Synthetic One, displayed shirt number 1/ })
  await mobileMarker.waitFor()
  await mobileMarker.click()
  await mobilePage.getByRole('dialog').filter({ has: mobilePage.getByText('Position', { exact: true }) }).getByRole('button', { name: 'Close' }).click()
  await mobilePage.getByRole('button', { name: 'Players', exact: true }).first().click()
  await mobilePlayersSheet.waitFor()
  await mobilePlayersSheet.getByTestId('formation-board-player-inspector').waitFor()
  await mobilePlayersSheet.getByRole('button', { name: 'Move to Bench', exact: true }).waitFor()
  await mobilePlayersSheet.getByRole('button', { name: 'Remove from board', exact: true }).waitFor()
  await mobilePlayersSheet.getByRole('button', { name: 'Close', exact: true }).click()
  await mobilePage.getByRole('button', { name: /Synthetic Player 2, shirt number missing, Bench/ }).click()
  await mobilePage.locator('[data-formation-pitch]').click({ position: { x: touchPitchBounds.width * 0.35, y: touchPitchBounds.height * 0.35 } })
  await mobilePage.getByRole('button', { name: /Synthetic Player 2, no displayed shirt number/ }).waitFor()
  await mobilePage.getByRole('button', { name: /Synthetic Player 3, shirt 3, Bench/ }).waitFor()
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
  assert.ok(Math.abs(await mobilePage.evaluate(() => window.scrollY) - scrollBeforeMarkerDrag) <= 1)
  const resumedScrollDistance = await mobilePage.evaluate(() => {
    const scroller = document.scrollingElement
    scroller.scrollTop = 0
    scroller.scrollTop = 120
    return scroller.scrollTop
  })
  assert.ok(resumedScrollDistance > 0)
  for (let step = 0; step < 10; step += 1) await mobileMarker.press('Shift+ArrowLeft')
  await mobilePage.setViewportSize({ width: 320, height: 844 })
  await mobileMarker.scrollIntoViewIfNeeded()
  const mobileEdgeContainment = await mobilePage.locator('[data-formation-pitch]').evaluate((pitch) => {
    const pitchBounds = pitch.getBoundingClientRect()
    const marker = pitch.querySelector('[data-formation-player-marker]')
    const markerBounds = marker?.getBoundingClientRect()
    const nameBounds = marker?.querySelector('[title]')?.getBoundingClientRect()
    return {
      markerInside: Boolean(markerBounds && markerBounds.left >= pitchBounds.left - 1 && markerBounds.right <= pitchBounds.right + 1 && markerBounds.top >= pitchBounds.top - 1 && markerBounds.bottom <= pitchBounds.bottom + 1),
      nameInside: Boolean(nameBounds && nameBounds.left >= pitchBounds.left - 1 && nameBounds.right <= pitchBounds.right + 1 && nameBounds.top >= pitchBounds.top - 1 && nameBounds.bottom <= pitchBounds.bottom + 1),
    }
  })
  assert.deepEqual(mobileEdgeContainment, { markerInside: true, nameInside: true })
  await mobilePage.screenshot({ path: `${screenshotDirectory}/iphone-320-pitch.png`, fullPage: true })
  await mobilePage.setViewportSize({ width: 844, height: 390 })
  assert.equal(await mobilePage.getByRole('button', { name: /Synthetic One, displayed shirt number 1/ }).count(), 1)
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
    await page.locator('[data-formation-pitch]').waitFor()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 1, `${profile.label} overflowed by ${overflow}px`)
    const pitchBounds = await page.locator('[data-formation-pitch]').boundingBox()
    assert.ok(pitchBounds && pitchBounds.height > pitchBounds.width, `${profile.label} did not keep a portrait pitch`)
    await page.screenshot({ path: `${screenshotDirectory}/${profile.label}.png`, fullPage: true })
    await fixture.context.close()
  }

  const capacityFixture = await createFixtureContext(browser, 'manager.fixture@footballplayer.test', { viewport: { width: 1280, height: 900 } })
  const capacityPage = await capacityFixture.context.newPage()
  await capacityPage.goto(`${baseUrl}/resources/formation-boards`, { waitUntil: 'networkidle' })
  await capacityPage.getByRole('button', { name: 'Create Formation Board', exact: true }).click()
  await capacityPage.getByRole('button', { name: 'More Formation Board options' }).click()
  await capacityPage.getByLabel('Board title').fill('Capacity browser board')
  await capacityPage.getByRole('dialog', { name: 'Board details and options' }).getByRole('button', { name: 'Close' }).click()
  await capacityPage.getByRole('button', { name: 'Formation', exact: true }).click()
  await capacityPage.getByLabel('Game format').selectOption('5v5')
  await capacityPage.getByRole('button', { name: 'Change formation', exact: true }).click()
  await capacityPage.getByRole('button', { name: 'Players', exact: true }).click()
  const capacityPlayers = capacityPage.getByRole('dialog', { name: 'Players' })
  for (let index = 1; index <= 6; index += 1) {
    const name = index === 1 ? 'Synthetic One' : `Synthetic Player ${index}`
    await capacityPlayers.getByRole('button', { name: new RegExp(name) }).click()
  }
  await capacityPlayers.getByRole('button', { name: 'Add 6 Players', exact: true }).click()
  const capacityPitch = capacityPage.locator('[data-formation-pitch]')
  const capacityTray = capacityPage.getByRole('region', { name: 'Bench' })
  await capacityTray.getByRole('button', { name: 'Fill empty positions', exact: true }).click()
  assert.equal(await capacityPitch.locator('[data-formation-player-marker]').count(), 5)
  const sixthUnplaced = capacityTray.getByRole('button', { name: /Synthetic Player 6, shirt 6, Bench/ })
  assert.equal(await sixthUnplaced.count(), 1)
  await capacityPage.getByRole('button', { name: 'Formation', exact: true }).click()
  await capacityPage.getByLabel('Game format').selectOption('7v7')
  await capacityPage.getByRole('button', { name: 'Change formation', exact: true }).click()
  await capacityTray.getByRole('button', { name: 'Fill empty positions', exact: true }).click()
  assert.equal(await capacityPitch.locator('[data-formation-player-marker]').count(), 6)
  await capacityPage.getByRole('button', { name: 'Formation', exact: true }).click()
  await capacityPage.getByLabel('Game format').selectOption('5v5')
  await capacityPage.getByRole('button', { name: 'Change formation', exact: true }).click()
  assert.equal(await capacityPitch.locator('[data-formation-player-marker]').count(), 5)
  assert.equal(await capacityTray.getByRole('button', { name: /Synthetic Player 6, shirt 6, Bench/ }).count(), 1)
  await capacityFixture.context.close()

  const legacyFixture = await createFixtureContext(browser, 'manager.fixture@footballplayer.test', { viewport: { width: 1280, height: 800 } }, { seedLandscapeBoard: true })
  const legacyPage = await legacyFixture.context.newPage()
  await legacyPage.goto(`${baseUrl}/resources/formation-boards?board=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, { waitUntil: 'networkidle' })
  await legacyPage.getByText('This board has been adapted to the supported portrait pitch. Review Player positions before saving.', { exact: true }).waitFor()
  await legacyPage.getByText('Saved on this device', { exact: true }).waitFor()
  assert.equal(legacyFixture.state.versionHistory.length, 1)
  assert.equal(legacyFixture.state.versionHistory[0].pitch_orientation, 'landscape')
  assert.equal(await legacyPage.getByLabel('Pitch orientation').count(), 0)
  const legacyPitchBounds = await legacyPage.locator('[data-formation-pitch]').boundingBox()
  assert.ok(legacyPitchBounds && legacyPitchBounds.height > legacyPitchBounds.width)
  await legacyPage.getByRole('button', { name: 'Share', exact: true }).last().click()
  await legacyPage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Save to Team', exact: true }).click()
  await legacyPage.getByText('Saved to Team', { exact: true }).waitFor()
  assert.equal(legacyFixture.state.versionHistory.length, 2)
  assert.equal(legacyFixture.state.versionHistory[0].pitch_orientation, 'landscape')
  assert.equal(legacyFixture.state.versionHistory[1].pitch_orientation, 'portrait')
  await legacyFixture.context.close()

  const assistantFixture = await createFixtureContext(browser, 'assistant.fixture@footballplayer.test', {}, { seedSharedBoard: true })
  const assistantPage = await assistantFixture.context.newPage()
  await assistantPage.goto(`${baseUrl}/resources/formation-boards`, { waitUntil: 'networkidle' })
  await assistantPage.getByRole('main').getByRole('heading', { name: 'Formation Boards', exact: true }).waitFor()
  assert.equal(await assistantPage.getByRole('button', { name: 'Create Formation Board' }).count(), 0)
  await assistantPage.getByRole('button', { name: 'Open', exact: true }).click()
  await assistantPage.getByText('Read-only Team board').waitFor()
  await assistantPage.getByRole('button', { name: 'Share', exact: true }).last().click()
  assert.equal(await assistantPage.getByRole('dialog', { name: 'Formation Board actions' }).getByRole('button', { name: 'Save to Team', exact: true }).count(), 0)
  await assistantFixture.context.close()

  const parentFixture = await createFixtureContext(browser, 'parent.fixture@footballplayer.test')
  const parentPage = await parentFixture.context.newPage()
  await parentPage.goto(`${baseUrl}/resources/formation-boards`, { waitUntil: 'networkidle' })
  assert.equal(await parentPage.getByRole('main').getByRole('heading', { name: 'Formation Boards', exact: true }).count(), 0)
  await parentFixture.context.close()

  console.log('Formation Board browser checks passed for markers, capacity, confirmed removal, publication, immutable history, PNG, PDF, mobile actions, desktop, short desktop, iPhone, Android, tablet, permissions, draft recovery, and conflict protection.')
} catch (error) {
  console.error(error)
  console.error(server.getOutput())
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
