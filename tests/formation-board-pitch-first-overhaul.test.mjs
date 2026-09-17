import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { test } from 'node:test'

const pageUrl = new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url)
const pitchUrl = new URL('../src/components/formation-board/FormationBoardPitch.jsx', import.meta.url)
const markerUrl = new URL('../src/components/formation-board/FormationPlayerMarkerVisual.jsx', import.meta.url)

test('Formation Board opens into the pitch-first hierarchy with three labelled dock controls', async () => {
  const page = await readFile(pageUrl, 'utf8')
  const editorStart = page.indexOf('<header className="mx-auto')
  const pitchStart = page.indexOf('aria-label="Formation pitch workspace"', editorStart)
  const dockStart = page.indexOf('<MobileActionDock', pitchStart)
  const detailsStart = page.indexOf('title="Board details and options"', dockStart)

  assert.ok(editorStart > 0)
  assert.ok(pitchStart > editorStart)
  assert.ok(dockStart > pitchStart)
  assert.ok(detailsStart > dockStart)
  assert.match(page, /Untitled Formation Board/)
  assert.match(page, /\sFormation\s+<\/button>/)
  assert.match(page, /\sPlayers\s+<\/button>/)
  assert.match(page, /\sShare\s+<\/button>/)
  assert.match(page, /title="Formation"/)
  assert.match(page, /title="Players"/)
})

test('local draft status is truthful and storage failures keep an explicit Team save path', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /setLocalDraftState\('saving'\)/)
  assert.match(page, /localStorage\.setItem[\s\S]*setLocalDraftState\('saved'\)/)
  assert.match(page, /catch \(error\)[\s\S]*setLocalDraftState\('failed'\)/)
  assert.match(page, /Saved on this device/)
  assert.match(page, /Not saved on this device/)
  assert.match(page, /Save to Team/)
})

test('supplied white and goalkeeper shirt assets render with editable number overlays', async () => {
  const [pitch, marker, white, gold] = await Promise.all([
    readFile(pitchUrl, 'utf8'),
    readFile(markerUrl, 'utf8'),
    stat(new URL('../public/formation-shirt-white.png', import.meta.url)),
    stat(new URL('../public/formation-shirt-gold.png', import.meta.url)),
  ])

  assert.ok(white.size > 0)
  assert.ok(gold.size > 0)
  assert.match(marker, /formation-shirt-white\.png/)
  assert.match(marker, /formation-shirt-gold\.png/)
  assert.match(marker, /normalizedNumber/)
  assert.match(pitch, /positionGroup === 'goalkeeper'/)
})

test('advanced capabilities remain reachable without changing permission or publication gates', async () => {
  const page = await readFile(pageUrl, 'utf8')

  for (const capability of [
    'Team visibility',
    'Description',
    'Coach notes',
    'Match plan',
    'Save and link to match',
    'Publish to parents',
    'Version history',
    'Publish to Team Resources',
    'Export PNG',
    'Export PDF',
  ]) assert.match(page, new RegExp(capability))

  assert.match(page, /canEditFormationBoard/)
  assert.match(page, /canCreateFormationBoard/)
  assert.match(page, /formation_board_version_conflict/)
  assert.match(page, /publishedSnapshotVersion[\s\S]*false/)
  assert.match(page, /hasUnsavedChanges[\s\S]*Publish to Team Resources/)
})
