import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { acceptDurableMobileAction, releaseCancelledParentLoads } from '../apps/mobile-core/src/durableMobileAction.js'

const source = readFileSync(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function fixture(name, { persist = async () => ({ commandId: 'command', createdAt: 'now' }) } = {}) {
  const remote = deferred()
  const state = { active: '', notices: [], loads: 0, reads: 0, resources: {
    messages: { loading: true, items: [{ id: 'message', readAt: '' }] },
    polls: { loading: true, items: [{ id: 'poll', allowMultiple: false, currentOptionIds: [] }] },
    development: { loading: true, items: [] },
  } }
  const refs = { currentAccountRef: { current: 'parent' }, parentSyncScopeRef: { current: 'parent:player' },
    parentActionScopeRef: { current: 0 }, parentFeedbackSequenceRef: { current: 0 }, requestIdRef: { current: 0 } }
  const dependencies = {
    ...refs, acceptDurableMobileAction, releaseCancelledParentLoads, activeActionId: '', selectedMobileUser: { id: 'parent' }, selectedLink: { id: 'player' },
    isOffline: false, pollDrafts: {}, normalizeText: value => String(value || '').trim(),
    requiresWatchedMatch: () => false, getPollDraftOption: () => 'option', canSubmitParentPoll: () => true,
    setActiveActionId: value => { state.active = value }, setSelectedMessageId: () => {},
    setNotice: value => { state.notices.push(value) }, setSyncSummary: () => {},
    setResources: change => { state.resources = change(state.resources) },
    queueParentPollVote: persist, queueParentMessageRead: persist,
    readParentOfflineView: async () => { state.reads += 1; return { sync: {} } },
    runParentSync: () => remote.promise,
    loadParentData: async () => { state.loads += 1 },
    getParentFriendlyError: error => error.message,
  }
  const start = source.indexOf(`  async function ${name}(`)
  const end = source.indexOf('\n  async function ', start + 1)
  assert.ok(start >= 0 && end > start)
  const handler = new Function(...Object.keys(dependencies), `return (${source.slice(start, end)})`)(...Object.values(dependencies))
  return { handler, state, refs, remote }
}

for (const [name, item, option] of [
  ['handlePollSubmit', { id: 'poll' }, 'option'],
  ['handleOpenMessage', { id: 'message' }, undefined],
]) {
  test(`${name}: actual screen handler unlocks after durable save, without waiting for remote sync`, async () => {
    const f = fixture(name)
    const start = performance.now()
    await f.handler(item, option)
    assert.ok(performance.now() - start < 1000)
    assert.equal(f.state.active, '')
    assert.ok(f.state.notices.some(value => value?.message.includes('saved on this phone')))
    assert.equal(f.state.loads, 0)
    assert.ok(Object.values(f.state.resources).every(resource => !resource.loading))
    assert.match(f.state.resources.development.error, /Refresh this section/)
    if (name === 'handlePollSubmit') assert.equal(f.state.resources.polls.items[0].currentOptionId, 'option')
    else assert.equal(f.state.resources.messages.items[0].readAt, 'now')
    f.remote.resolve({ waiting: 0, results: [{ commandId: 'command', status: 'succeeded' }] })
    await new Promise(resolve => setImmediate(resolve))
  })

  test(`${name}: storage failure is visible and leaves the displayed response unchanged`, async () => {
    const f = fixture(name, { persist: async () => { throw new Error('phone storage failed') } })
    await f.handler(item, option)
    assert.equal(f.state.active, '')
    assert.equal(f.state.loads, 0)
    assert.ok(f.state.notices.some(value => value?.message === 'phone storage failed'))
    if (name === 'handlePollSubmit') assert.deepEqual(f.state.resources.polls.items[0].currentOptionIds, [])
    else assert.equal(f.state.resources.messages.items[0].readAt, '')
  })

  test(`${name}: switching player while storing cannot project the old action into the new player`, async () => {
    const disk = deferred()
    const f = fixture(name, { persist: () => disk.promise })
    const action = f.handler(item, option)
    assert.notEqual(f.state.active, '')
    f.refs.parentSyncScopeRef.current = 'parent:other-player'
    f.state.active = 'new-player-action'
    disk.resolve({ commandId: 'old', createdAt: 'old' })
    await action
    assert.equal(f.state.active, 'new-player-action')
    assert.equal(f.state.notices.filter(Boolean).length, 0)
    if (name === 'handlePollSubmit') assert.deepEqual(f.state.resources.polls.items[0].currentOptionIds, [])
    else assert.equal(f.state.resources.messages.items[0].readAt, '')
  })

  test(`${name}: late server rejection cannot refresh or notify a different account`, async () => {
    const f = fixture(name)
    await f.handler(item, option)
    const notices = f.state.notices.length
    f.refs.currentAccountRef.current = 'other-parent'
    f.remote.resolve({ waiting: 0, results: [{ commandId: 'command', status: 'permanently_rejected' }] })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.state.loads, 0)
    assert.equal(f.state.notices.length, notices)
  })
}
