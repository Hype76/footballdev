import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { withParentMatchReportBranding } from '../apps/parent-mobile/src/parentMatchReportBranding.js'

const source = await readFile('apps/parent-mobile/App.js', 'utf8')
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
function findHandler(node) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'FunctionDeclaration' && node.id?.name === 'handleDownloadMatchReport') return node
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = findHandler(child)
      if (found) return found
    }
  }
  return null
}
const handlerNode = findHandler(ast)
assert.ok(handlerNode, 'Actual match report download handler exists')
const handlerSource = source.slice(handlerNode.start, handlerNode.end)

const link = { id: 'parent-link', clubId: 'club-one', teamId: 'team-one', planKey: 'club', planStatus: 'active', themeAccent: 'blue' }
function harness({ busy = '', saved = false, error = null, save = null } = {}) {
  const state = { notices: [], actions: [], saves: [] }
  state.scope = { current: 'account:parent-link' }
  state.inFlight = { current: false }
  const create = new Function('activeActionId', 'setActiveActionId', 'setNotice', 'saveParentMobileMatchReportPdf', 'getParentFriendlyError', 'Platform', 'reportInFlightRef', 'reportScopeRef', 'selectedLink', 'matchdayPlanConfig', 'withParentMatchReportBranding', 'config', `${handlerSource}; return handleDownloadMatchReport`)
  state.run = create(busy, value => state.actions.push(value), value => state.notices.push(value), async match => {
    state.saves.push(match)
    if (save) return save(match)
    if (error) throw error
    return { filename: 'synthetic-report.pdf', saved }
  }, (failure, fallback) => failure.message || fallback, { OS: 'ios' }, state.inFlight, state.scope, link, null, withParentMatchReportBranding, { supabaseUrl: 'https://storage.example' })
  return state
}

const fixture = { id: 'synthetic-result', status: 'full_time', clubId: link.clubId, teamId: link.teamId }

test('Download ignores repeated presses while an action is busy', async () => {
  const state = harness({ busy: 'match-report:synthetic-result' })
  await state.run(fixture)
  assert.deepEqual(state.saves, [])
  assert.deepEqual(state.actions, [])
  assert.deepEqual(state.notices, [])
})

test('Download ignores a missing match', async () => {
  const state = harness()
  await state.run(null)
  assert.deepEqual(state.saves, [])
  assert.deepEqual(state.actions, [])
  assert.deepEqual(state.notices, [])
})

test('A confirmed save produces compact success and releases the action', async () => {
  const state = harness({ saved: true })
  await state.run(fixture)
  assert.deepEqual(state.saves, [withParentMatchReportBranding(fixture, link)])
  assert.deepEqual(state.actions, ['match-report:synthetic-result', ''])
  assert.deepEqual(state.notices, [null, { message: 'Match report PDF saved to your selected folder.', tone: 'success', compact: true }])
})

test('Closing the iPhone sheet without a confirmed save adds no post-sheet instructions', async () => {
  const state = harness({ saved: false })
  await state.run(fixture)
  assert.deepEqual(state.saves, [withParentMatchReportBranding(fixture, link)])
  assert.deepEqual(state.notices, [null])
  assert.deepEqual(state.actions, ['match-report:synthetic-result', ''])
})

test('Download failure produces compact warning and releases the action', async () => {
  const state = harness({ error: new Error('The prepared PDF could not be read.') })
  await state.run(fixture)
  assert.deepEqual(state.notices, [null, { message: 'The prepared PDF could not be read.', tone: 'warning', compact: true }])
  assert.deepEqual(state.actions, ['match-report:synthetic-result', ''])
})

test('An error without a readable message uses the download fallback', async () => {
  const state = harness({ error: {} })
  await state.run(fixture)
  assert.deepEqual(state.notices.at(-1), { message: 'The match report PDF could not be prepared.', tone: 'warning', compact: true })
  assert.equal(state.actions.at(-1), '')
})

test('Download ignores a match from a previously selected club or team', async () => {
  const state = harness()
  await state.run({ ...fixture, clubId: 'club-two' })
  await state.run({ ...fixture, teamId: 'team-two' })
  assert.deepEqual(state.saves, [])
})

test('Immediate repeated taps start only one save and context switches suppress old success', async () => {
  let finish
  const state = harness({ save: () => new Promise(resolve => { finish = resolve }) })
  const pending = state.run(fixture)
  await state.run(fixture)
  assert.equal(state.saves.length, 1)
  state.scope.current = 'other-account:other-link'
  finish({ saved: true })
  await pending
  assert.deepEqual(state.notices, [null])
  assert.equal(state.inFlight.current, false)
})
