import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { before, test } from 'node:test'

import {
  buildFormationBoardDocument,
  renderPdfDocumentHtml,
} from '../src/lib/pdf-document.js'

const REQUEST_ID = '10000000-0000-4000-8000-000000000001'
const BOARD_ID = '20000000-0000-4000-8000-000000000001'
const VERSION_ID = '30000000-0000-4000-8000-000000000001'
const CLUB_ID = '40000000-0000-4000-8000-000000000001'
const TEAM_ID = '50000000-0000-4000-8000-000000000001'

function createPayload(format = 'png') {
  return {
    request: {
      id: REQUEST_ID,
      export_format: format,
    },
    board: {
      id: BOARD_ID,
      club_id: CLUB_ID,
      team_id: TEAM_ID,
      title: 'FP TEST Match Shape',
      description: 'Keep the back line compact.',
      updated_at: '2026-08-02T12:00:00.000Z',
    },
    version: {
      id: VERSION_ID,
      version_number: 4,
      game_format: '7v7',
      formation_preset_key: '7v7-2-3-1',
      pitch_orientation: 'portrait',
      placements: [
        { displayName: 'Alexandra Very Long Player Name', playerId: 'player-private-1', shirtNumber: '99', x: 0.5, y: 0.86 },
        { displayName: 'Casey Two', playerId: 'player-private-2', shirtNumber: '7', x: 0.32, y: 0.58 },
      ],
      bench: [{ displayName: 'Taylor Bench', playerId: 'player-private-3', shirtNumber: '12' }],
      notes: 'Press on the first touch, then recover centrally.',
      created_at: '2026-08-02T12:00:00.000Z',
    },
    club: { id: CLUB_ID, name: 'FP TEST Club', logo_url: '', theme_accent: '#047857' },
    team: { id: TEAM_ID, name: 'FP TEST Team' },
  }
}

function createDatabase() {
  const updates = []
  const uploads = []

  return {
    updates,
    uploads,
    from(table) {
      return {
        update(values) {
          const chain = {
            eq() { return chain },
            then(resolve) {
              updates.push({ table, values })
              resolve({ error: null })
            },
          }
          return chain
        },
      }
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, buffer, options) {
            uploads.push({ bucket, path, buffer, options })
            return { error: null }
          },
        }
      },
    },
  }
}

let createFormationBoardExportHandler

before(async () => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  ;({ createFormationBoardExportHandler } = await import('../netlify/functions/formation-board-export.js'))
})

test('Formation Board document validates and renders only approved public fields', () => {
  const payload = createPayload()
  const document = buildFormationBoardDocument({
    clubName: payload.club.name,
    teamName: payload.team.name,
    reportDate: '02 Aug 2026',
    title: payload.board.title,
    description: payload.board.description,
    gameFormat: payload.version.game_format,
    formation: payload.version.formation_preset_key,
    orientation: payload.version.pitch_orientation,
    placements: payload.version.placements,
    bench: payload.version.bench,
    notes: payload.version.notes,
  })
  const html = renderPdfDocumentHtml(document)

  assert.match(html, /FP TEST Match Shape/)
  assert.match(html, /FP TEST Team/)
  assert.match(html, /Alexandra Very Long Player Name/)
  assert.match(html, />99</)
  assert.match(html, /Press on the first touch/)
  assert.match(html, /A4 landscape/)
  assert.doesNotMatch(html, /player-private/)
  assert.doesNotMatch(html, /@example/)
  assert.throws(
    () => buildFormationBoardDocument({
      clubName: payload.club.name,
      teamName: payload.team.name,
      title: payload.board.title,
      gameFormat: '7v7',
      formation: '7v7-2-3-1',
      placements: [{ ...payload.version.placements[0], x: 1.2 }],
    }),
    /within the pitch/,
  )
})

test('protected export handler returns PNG bytes and completes the audited request', async () => {
  const database = createDatabase()
  const handler = createFormationBoardExportHandler({
    adminFactory: () => database,
    payloadResolver: async () => createPayload('png'),
    pngRenderer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    brandingBuilder: async () => ({}),
  })
  const response = await handler(new Request('https://footballplayer.online/.netlify/functions/formation-board-export', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'download', requestId: REQUEST_ID }),
  }))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.match(response.headers.get('content-disposition'), /fp-test-match-shape-v4\.png/)
  assert.equal(database.updates.length, 1)
  assert.equal(database.updates[0].values.export_state, 'ready')
  assert.equal(database.updates[0].values.output_path, null)
})

test('thumbnail generation stores only the deterministic private version path', async () => {
  const database = createDatabase()
  const handler = createFormationBoardExportHandler({
    adminFactory: () => database,
    payloadResolver: async () => createPayload('png'),
    pngRenderer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    thumbnailConverter: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]),
    brandingBuilder: async () => ({}),
  })
  const response = await handler(new Request('https://footballplayer.online/.netlify/functions/formation-board-export', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'thumbnail', requestId: REQUEST_ID }),
  }))
  const body = await response.json()
  const expectedPath = `${CLUB_ID}/${TEAM_ID}/formation-boards/${BOARD_ID}/versions/${VERSION_ID}/thumbnail.png`

  assert.equal(response.status, 200)
  assert.equal(body.thumbnailPath, expectedPath)
  assert.equal(database.uploads.length, 1)
  assert.equal(database.uploads[0].bucket, 'resource-library')
  assert.equal(database.uploads[0].path, expectedPath)
  assert.equal(database.uploads[0].options.contentType, 'image/png')
  assert.equal(database.updates[0].values.output_path, expectedPath)
})

test('denied payload resolution does not mutate another export request', async () => {
  const database = createDatabase()
  const handler = createFormationBoardExportHandler({
    adminFactory: () => database,
    payloadResolver: async () => { throw Object.assign(new Error('formation_board_export_forbidden'), { statusCode: 403 }) },
  })
  const response = await handler(new Request('https://footballplayer.online/.netlify/functions/formation-board-export', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'download', requestId: REQUEST_ID }),
  }))

  assert.equal(response.status, 403)
  assert.equal(database.updates.length, 0)
  assert.equal(database.uploads.length, 0)
})

test('editor and Team Resource Library expose publication, immutable history, and safe mobile export controls', async () => {
  const [editor, library, clientExport, serverExport] = await Promise.all([
    readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/ResourceLibraryPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/formation-board-export.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/formation-board-export.js', import.meta.url), 'utf8'),
  ])

  assert.match(editor, /Publish to Team Resources/)
  assert.match(editor, /Publish as new resource/)
  assert.match(editor, /Update existing linked resource/)
  assert.match(editor, /Review this preview before publishing/)
  assert.match(editor, />Actions</)
  assert.match(editor, /publishedSnapshotVersion/)
  assert.match(editor, /versionId: parameters\.get\('version'\)/)
  assert.match(library, /Version history/)
  assert.match(library, /Open version/)
  assert.match(library, />PNG</)
  assert.match(library, />PDF</)
  assert.match(library, /Team staff only/)
  assert.match(library, /filter\(\(resource\) => !resource\.currentFormationBoardPublication\)/)
  assert.match(clientExport, /navigator\.canShare/)
  assert.match(clientExport, /downloadFormationBoardExport/)
  assert.match(serverExport, /get_formation_board_export_payload/)
  assert.match(serverExport, /Cache-Control': 'no-store'/)
  assert.doesNotMatch(serverExport, /send-email|send-sms|send-push|create-chat/i)
})
