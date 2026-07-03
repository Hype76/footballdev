import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function loadFreshCacheStore() {
  const url = new URL('../src/lib/domain/cache-store.js', import.meta.url)
  url.search = `cache-store-test=${Date.now()}-${Math.random()}`
  return import(url.href)
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

test('invalidated in-flight resource cannot repopulate memory cache with a stale snapshot', async () => {
  const { getCachedResource, invalidateMemoryCacheByPrefix } = await loadFreshCacheStore()
  const staleRead = createDeferred()

  const firstRead = getCachedResource('players:club-a:list', () => staleRead.promise)
  invalidateMemoryCacheByPrefix('players:club-a:')
  staleRead.resolve([{ id: 'old-player' }])

  assert.deepEqual(await firstRead, [{ id: 'old-player' }])

  const freshRead = await getCachedResource('players:club-a:list', async () => [{ id: 'fresh-player' }])
  assert.deepEqual(freshRead, [{ id: 'fresh-player' }])
})

test('in-flight resource requests still dedupe and cache when they are not invalidated', async () => {
  const { getCachedResource } = await loadFreshCacheStore()
  const pendingRead = createDeferred()
  let calls = 0

  const firstRead = getCachedResource('calendar-events:club-a:list', () => {
    calls += 1
    return pendingRead.promise
  })
  const secondRead = getCachedResource('calendar-events:club-a:list', () => {
    calls += 1
    return Promise.resolve([{ id: 'should-not-run' }])
  })

  pendingRead.resolve([{ id: 'shared-calendar-event' }])

  assert.deepEqual(await Promise.all([firstRead, secondRead]), [
    [{ id: 'shared-calendar-event' }],
    [{ id: 'shared-calendar-event' }],
  ])
  assert.equal(calls, 1)

  const cachedRead = await getCachedResource('calendar-events:club-a:list', () => {
    calls += 1
    return Promise.resolve([{ id: 'should-still-not-run' }])
  })

  assert.deepEqual(cachedRead, [{ id: 'shared-calendar-event' }])
  assert.equal(calls, 1)
})

test('assessment session mutations clear restored view caches before later refetches', async () => {
  const source = await readFile(new URL('../src/lib/domain/sessions.js', import.meta.url), 'utf8')
  const mutationNames = [
    'createAssessmentSession',
    'updateAssessmentSession',
    'completeAssessmentSession',
    'deleteAssessmentSession',
    'addPlayersToAssessmentSession',
    'updateAssessmentSessionPlayer',
    'clearAssessmentSessionPlayers',
  ]

  assert.match(source, /import\s+\{[\s\S]*clearViewCaches[\s\S]*\}\s+from '\.\/cache-store\.js'/)

  for (const mutationName of mutationNames) {
    const start = source.indexOf(`export async function ${mutationName}`)
    assert.notEqual(start, -1, `${mutationName} should exist`)

    const nextExport = source.indexOf('\nexport async function ', start + 1)
    const body = source.slice(start, nextExport === -1 ? source.length : nextExport)
    assert.match(body, /clearViewCaches\(\)/, `${mutationName} should clear restored view caches`)
  }
})
