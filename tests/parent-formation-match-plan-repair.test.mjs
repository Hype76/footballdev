import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@babel/parser'
import { normalizePersonName } from '../src/lib/person-name.js'

const dataPath = new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url)
const screenPath = new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url)
const dataSource = await readFile(dataPath, 'utf8')
const screenSource = await readFile(screenPath, 'utf8')

function declarationSource(source, name) {
  const declarations = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
    .map((node) => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
  const declaration = declarations.find((node) => node?.type === 'FunctionDeclaration' && node.id.name === name)
  assert.ok(declaration, `Expected ${name} declaration`)
  return source.slice(declaration.start, declaration.end)
}

const normalizeParentMatchFormationPlan = new Function('normalizePersonName', `
  const normalizeText = (value) => String(value ?? '').trim()
  ${declarationSource(dataSource, 'normalizeParentFormationPlayer')}
  ${declarationSource(dataSource, 'normalizeParentFormationPlayers')}
  ${declarationSource(dataSource, 'normalizeParentMatchFormationPlan')}
  return normalizeParentMatchFormationPlan
`)(normalizePersonName)

test('Parent fixture formation normalizer keeps only shared pitch and Bench data', () => {
  const plan = normalizeParentMatchFormationPlan({
    publication_id: 'publication-1',
    board_title_snapshot: 'Saturday plan',
    game_format: '11v11',
    formation_preset_key: '11v11-4-4-2',
    notes: 'Coach-only note',
    placements: [
      { player_id: 'player-1', display_name: 'A Player', x: 0.5, y: 0.9, private_note: 'secret' },
      { player_id: 'player-2', display_name: '', x: 0.4, y: 0.4 },
    ],
    bench: [{ player_id: 'player-3', player_name: 'B Player', x: 0.2, y: 0.2 }],
    unselected_players: [{ player_id: 'player-4', display_name: 'Should stay hidden' }],
  })

  assert.deepEqual(plan.placements, [{ displayName: 'A Player', playerId: 'player-1', shirtNumber: '', x: 0.5, y: 0.9 }])
  assert.deepEqual(plan.bench, [{ displayName: 'B Player', playerId: 'player-3', shirtNumber: '', x: 0.2, y: 0.2 }])
  assert.equal(plan.notes, undefined)
  assert.equal(plan.unselectedPlayers, undefined)
})

test('Parent match loader uses the canonical published-plan RPC and clears unavailable plans', () => {
  assert.match(dataSource, /get_parent_portal_match_formation_plans/)
  assert.match(dataSource, /formationPlanResult\.error \? \[\]/)
  assert.match(dataSource, /const formationPlanError = formationPlanResult\.error \? 'The match plan could not be refreshed\./)
  assert.match(dataSource, /formationPlan: formationPlanByMatchId\.get\(String\(row\.id\)\) \|\| null/)
  assert.match(dataSource, /formationPlanError,/)
  assert.equal(normalizeParentMatchFormationPlan({ match_day_id: 'withdrawn-match' }), null)
})

test('Parent match screen renders the plan inline and excludes coach notes from the plan component', () => {
  const start = screenSource.indexOf('function ParentMatchFormationPlan')
  const end = screenSource.indexOf('export function MatchdayScreen', start)
  assert.ok(start >= 0 && end > start)
  const component = screenSource.slice(start, end)
  assert.match(component, /formationPitch/)
  assert.match(component, /formationPlanBench/)
  assert.match(component, /Match plan unavailable/)
  assert.doesNotMatch(component, /\.notes/)
})
