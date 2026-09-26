import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
const handlerSource = app.slice(app.indexOf('  async function handleScorerAction('), app.indexOf('  async function handleDisplayThemeChange('))
const match = { id: 'FP TEST match', isScorer: true, status: 'full_time' }

function controller({ offline = true, saveError = null } = {}) {
  const notices = []
  const calls = []
  let finishSave
  const pendingSave = new Promise(resolve => { finishSave = resolve })
  let outboxes = {}
  const scorerActionInFlightRef = { current: false }
  const context = {
    activeActionId: '', isOffline: offline, scorerActionInFlightRef,
    selectedMobileUser: { id: 'FP TEST parent' }, selectedLink: { id: 'FP TEST link' },
    setActiveActionId: () => {}, setNotice: value => notices.push(value),
    setScorerOutboxes: change => { outboxes = change(outboxes) },
    queueParentScorerAction: async (...args) => {
      calls.push(args)
      await pendingSave
      if (saveError) throw saveError
      return { journal: { pending: [{ id: 'saved' }] } }
    },
    getParentFriendlyError: error => error.message,
    runParentSync: async () => { calls.push('sync') },
  }
  vm.createContext(context)
  vm.runInContext(handlerSource, context)
  return { context, calls, finishSave, notices, outboxes: () => outboxes, scorerActionInFlightRef }
}

test('offline handover persists before success and blocks overlapping presses', async () => {
  const h = controller()
  const pending = h.context.handleScorerAction(match, 'request-review')
  assert.equal(await h.context.handleScorerAction(match, 'request-review'), false)
  h.finishSave()
  assert.equal(await pending, true)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0][3], 'request-review')
  assert.equal(h.outboxes()[match.id].pending.length, 1)
  assert.equal(h.notices.at(-1).tone, 'success')
  assert.equal(h.scorerActionInFlightRef.current, false)
})

test('failed encrypted save cannot report success or trigger sync', async () => {
  const h = controller({ offline: false, saveError: new Error('Disk full') })
  const pending = h.context.handleScorerAction(match, 'request-review')
  h.finishSave()
  const result = await pending
  assert.equal(result.saved, false)
  assert.match(result.message, /Disk full/)
  assert.equal(h.calls.length, 1)
  assert.equal(h.notices.at(-1).tone, 'error')
})

test('online action queues first and then triggers ordered sync', async () => {
  const h = controller({ offline: false })
  const pending = h.context.handleScorerAction(match, 'timer', 'resume')
  h.finishSave()
  assert.equal(await pending, true)
  assert.deepEqual(Array.from(Object.entries(h.calls[0][4])), [['action', 'resume']])
  assert.equal(h.calls[1], 'sync')
})
