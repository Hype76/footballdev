import assert from 'node:assert/strict'
import test from 'node:test'
import { assertCoachAccountPreparationFinished, coachAccountOfflineLabel, validateCoachAccountOfflineStatus, prepareCoachAccountOffline } from '../apps/coach-mobile/src/coachAccountOfflinePreparation.js'

const contexts = Array.from({ length: 5 }, (_, index) => ({ id: `team:${index}`, clubId: `club:${index % 3}`, teamId: `team:${index}` }))
const ready = context => ({ contextId: context.id, state: 'ready', savedAt: '2026-11-18T17:00:00Z', filesFailed: 0, onlineOnly: [], error: '' })
const finished = () => ({ complete: true, results: contexts.map(ready) })

test('the reported first-badge cancellation cannot be announced as a finished five-team download', () => {
  const result = { cancelled: true, results: [] }
  const statuses = { [contexts[0].id]: { state: 'saving', filesSaved: 1 } }
  assert.equal(coachAccountOfflineLabel(statuses[contexts[0].id]), 'Not ready offline yet, 1 file saved')
  assert.throws(() => assertCoachAccountPreparationFinished(result, contexts, statuses), /Download paused/)
})

test('completion requires each of the five teams, including when an incorrect complete flag is supplied', () => {
  for (const mutate of [
    result => { result.results = result.results.slice(0, 1) },
    result => { result.results[4] = { ...result.results[0] } },
    result => { result.results[4].state = 'saving' },
    result => { result.results[4].savedAt = '' },
    result => { result.results[4].filesFailed = 1 },
    result => { result.results[4].state = 'partial'; result.results[4].error = 'Storage full'; result.results[4].onlineOnly = [{ id: 'link' }] },
    result => { result.results[4].state = 'partial' },
  ]) {
    const result = finished()
    mutate(result)
    assert.throws(() => assertCoachAccountPreparationFinished(result, contexts), /Download incomplete/)
  }
  assert.deepEqual(assertCoachAccountPreparationFinished(finished(), contexts), { complete: true, onlineOnlyCount: 0 })
})

test('external-link wording is allowed only after every team record and uploaded file has finished', () => {
  const result = finished()
  result.complete = false
  result.results[2] = { ...result.results[2], state: 'partial', onlineOnly: [{ id: 'video' }, { id: 'website' }] }
  assert.deepEqual(assertCoachAccountPreparationFinished(result, contexts), { complete: false, onlineOnlyCount: 2 })
  result.results[4].state = 'saving'
  assert.throws(() => assertCoachAccountPreparationFinished(result, contexts), /Download incomplete/)
})

test('actual retained statuses override a successful run when any team was evicted or has disappeared', () => {
  const result = finished()
  const statuses = Object.fromEntries(result.results.map(status => [status.contextId, status]))
  assert.deepEqual(assertCoachAccountPreparationFinished(result, contexts, statuses), { complete: true, onlineOnlyCount: 0 })
  const last = contexts[4].id
  statuses[last] = validateCoachAccountOfflineStatus({ ...statuses[last], schemaVersion: 1, resources: { players: 'saved-players' } }, { resources: {}, resourceMetadata: {} })
  assert.throws(() => assertCoachAccountPreparationFinished(result, contexts, statuses), /Download incomplete/)
  delete statuses[last]
  assert.throws(() => assertCoachAccountPreparationFinished(result, contexts, statuses), /Download incomplete/)
})


test('a refresh identifies the previous file count without presenting it as the current scan', async () => {
  const context = contexts[0]
  const written = []
  await prepareCoachAccountOffline({
    user: { id: 'coach' }, contexts: [context], selectedContextId: context.id,
    readPreviousStatus: async () => ({ savedAt: '2026-11-18T17:00:00Z', filesSaved: 10 }),
    createSaver: () => async () => ({ resourceMetadata: { offlineMediaInventory: { fingerprint: 'inventory' } } }),
    saveStatus: async (_user, _context, status) => written.push(structuredClone(status)),
    loadContext: async () => ({ complete: true }),
  })
  assert.equal(written[0].filesSaved, 0)
  assert.equal(coachAccountOfflineLabel(written[0]), 'Checking files, 10 files saved at last download')
  assert.equal(written.at(-1).state, 'ready')
  assert.equal(written.at(-1).filesSaved, 0)
})


test('automatic preparation yields between resource, match and file processing', async () => {
  const context = contexts[0], events = []
  const result = await prepareCoachAccountOffline({
    user: { id: 'coach' }, contexts: [context], selectedContextId: context.id,
    createSaver: () => async values => ({ resourceMetadata: Object.fromEntries(Object.keys(values).map(key => [key, { fingerprint: key }])) }),
    saveStatus: async () => {}, saveMatches: async () => { events.push('fixtures saved') },
    prepareMedia: async () => { events.push('file transfer'); return { bytes: 1 } },
    yieldControl: async () => { events.push('yield') },
    loadContext: async (_user, _context, options) => {
      await options.onResource({ cacheKey: 'players', value: [], complete: true }); events.push('resource')
      await options.onMatch({ id: 'match' }); events.push('match')
      await options.onMedia({ id: 'file' }); events.push('file')
      return { complete: true }
    },
  })
  assert.deepEqual(events, ['yield', 'resource', 'yield', 'match', 'file', 'fixtures saved', 'yield', 'file transfer', 'yield'])
  assert.equal(result.complete, true)
})
