import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatestThemeSave } from '../src/lib/latest-theme-save.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('success waits for persistence; a failed save produces only an error', async () => {
  for (const fail of [false, true]) {
    const saver = createLatestThemeSave()
    const response = deferred()
    const notices = []
    const saving = saver.save({ persist: () => response.promise, onSuccess: () => notices.push('saved'), onError: () => notices.push('error') })
    await Promise.resolve()
    assert.deepEqual(notices, [])
    if (fail) response.reject(new Error('offline'))
    else response.resolve({ themeMode: 'dark' })
    await saving
    assert.deepEqual(notices, [fail ? 'error' : 'saved'])
  }
})

test('rapid changes serialize writes, coalesce waiting selections and ignore stale outcomes', async () => {
  for (const fail of [false, true]) {
    const saver = createLatestThemeSave()
    const first = deferred()
    const final = deferred()
    const finalStarted = deferred()
    const writes = [], updates = [], notices = []
    let stored = 'system'
    const save = (mode, response) => saver.save({
      persist: async () => { writes.push(mode); if (mode === 'system') finalStarted.resolve(); await response.promise; stored = mode; return { themeMode: mode } },
      onSuccess: profile => { updates.push(profile.themeMode); notices.push('saved') },
      onError: () => notices.push('error'),
    })
    const dark = save('dark', first)
    await Promise.resolve()
    const light = save('light', deferred())
    const system = save('system', final)
    assert.deepEqual(writes, ['dark'])
    if (fail) first.reject(new Error('stale failure'))
    else first.resolve()
    await dark
    await light
    await finalStarted.promise
    assert.deepEqual(notices, [])
    assert.deepEqual(updates, [])
    assert.deepEqual(writes, ['dark', 'system'])
    final.resolve()
    await system
    assert.equal(stored, 'system')
    assert.deepEqual(updates, ['system'])
    assert.deepEqual(notices, ['saved'])
  }
})

test('account change or unmount cancels old completions and queued writes', async () => {
  for (const fail of [false, true]) {
    const saver = createLatestThemeSave()
    const old = deferred()
    const updates = [], writes = []
    const save = (account, response) => saver.save({
      persist: () => { writes.push(account); return response.promise },
      onSuccess: () => updates.push(account), onError: () => updates.push(account),
    })
    const pending = save('old', old)
    await Promise.resolve()
    const queued = save('old-queued', deferred())
    saver.cancel()
    const current = save('new', { promise: Promise.resolve({ themeMode: 'light' }) })
    if (fail) old.reject(new Error('old account failure'))
    else old.resolve({ themeMode: 'dark' })
    await Promise.all([pending, queued, current])
    assert.deepEqual(writes, ['old', 'new'])
    assert.deepEqual(updates, ['new'])
  }
})
