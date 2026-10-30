import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createParentConnectivityMonitor, parentConnectivityScope } from '../apps/parent-mobile/src/parentConnectivityCore.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('a successful authenticated Chat read corrects a false reachability report', async () => {
  const states = []
  let resolveProbe
  const monitor = createParentConnectivityMonitor({ onChange: (state) => states.push(state), probe: () => new Promise((resolve) => { resolveProbe = resolve }) })
  monitor.update({ isConnected: true, isInternetReachable: false })
  assert.deepEqual(states, [true])
  await flush()
  resolveProbe([])
  await flush()
  assert.deepEqual(states, [true, false])
})

test('connection and access failures retain the offline block', async () => {
  for (const error of [new Error('network unavailable'), Object.assign(new Error('access denied'), { status: 403 })]) {
    const states = []
    const monitor = createParentConnectivityMonitor({ onChange: (state) => states.push(state), probe: async () => { throw error } })
    monitor.update({ isConnected: true, isInternetReachable: false })
    await flush()
    assert.deepEqual(states, [true])
  }
})

test('a late successful probe cannot override a newer disconnection or a disposed scope', async () => {
  for (const dispose of [false, true]) {
    const states = []
    let resolveProbe
    const monitor = createParentConnectivityMonitor({ onChange: (state) => states.push(state), probe: () => new Promise((resolve) => { resolveProbe = resolve }) })
    monitor.update({ isConnected: true, isInternetReachable: false })
    await flush()
    if (dispose) monitor.dispose()
    else monitor.update({ isConnected: false, isInternetReachable: false })
    resolveProbe([])
    await flush()
    assert.equal(states.at(-1), true)
  }
})

test('definite offline and ordinary online reports do not probe', async () => {
  let probes = 0
  const states = []
  const monitor = createParentConnectivityMonitor({ onChange: (state) => states.push(state), probe: async () => { probes += 1 } })
  monitor.update({ isConnected: false, isInternetReachable: false })
  monitor.update({ isConnected: true, isInternetReachable: true })
  await flush()
  assert.equal(probes, 0)
  assert.deepEqual(states, [true, false])
})

test('a response for an old account or child cannot change the current connection state', async () => {
  for (const nextScope of ['account-b:child-a', 'account-a:child-b']) {
    let scope = 'account-a:child-a'
    const originalScope = scope
    const states = []
    let resolveProbe
    const monitor = createParentConnectivityMonitor({
      onChange: (offline) => { if (scope === originalScope) states.push(offline) },
      probe: () => new Promise((resolve) => { resolveProbe = resolve }),
    })
    monitor.update({ isConnected: true, isInternetReachable: false })
    await flush()
    scope = nextScope
    resolveProbe([])
    await flush()
    assert.deepEqual(states, [true])
  }
})

test('metadata-only rerenders keep the monitor scope stable while authority changes reset it', async () => {
  const link = { id: 'link', clubId: 'club', teamId: 'team', playerId: 'player', linkType: 'parent' }
  const user = { id: 'account', selectedParentLinkId: 'link', selectedPlayerId: 'player', accountStatus: 'active', parentPortalLinks: [link] }
  const original = parentConnectivityScope(user, link)
  const updatedLink = { ...link, playerName: 'Updated name' }
  const updatedUser = { ...user, displayName: 'Updated parent', parentPortalLinks: [updatedLink] }
  assert.equal(parentConnectivityScope(updatedUser, updatedLink), original)
  assert.notEqual(parentConnectivityScope({ ...updatedUser, id: 'different-account' }, updatedLink), original)
  const movedLink = { ...updatedLink, teamId: 'different-team' }
  assert.notEqual(parentConnectivityScope({ ...updatedUser, parentPortalLinks: [movedLink] }, movedLink), original)
  assert.notEqual(parentConnectivityScope({ ...updatedUser, isOfflineProfile: true }, updatedLink), original)
  const source = await readFile('apps/parent-mobile/App.js', 'utf8')
  const monitorEffect = source.slice(source.indexOf('const monitor = createParentConnectivityMonitor'), source.indexOf('const wasOffline = previousOfflineRef.current'))
  assert.match(monitorEffect, /\}, \[connectivityScope\]\)/)
  assert.match(monitorEffect, /connectivityUserRef\.current/)
  assert.doesNotMatch(monitorEffect, /\}, \[connectivityScope,.*selectedMobileUser/)
})
