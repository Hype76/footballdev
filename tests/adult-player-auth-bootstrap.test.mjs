import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('invite bootstrap preserves a same-account session and clears stale scope when account changes', async () => {
  const source = await readFile(new URL('../src/lib/auth.js', import.meta.url), 'utf8')
  const start = source.indexOf("      if (window.location.pathname.replace(/\\/+$/, '') === '/player-invite') {")
  const end = source.indexOf('      const syncId =', start)
  assert.ok(start >= 0 && end > start)
  const code = source.slice(start, end)
  for (const [nextId, same] of [['account-a', true], ['account-b', false]]) {
    const storage = new Map([['club', 'club-a'], ['team', 'team-a'], ['mode', 'team'], ['explicit', 'true']])
    const state = { user: 'account-a', cleared: [], session: null, done: false }
    const deps = {
      window: { location: { pathname: '/player-invite' }, sessionStorage: { removeItem: key => storage.delete(key) } },
      activeSyncIdRef: { current: 8 }, userRef: { current: { id: 'account-a' } }, nextSession: { user: { id: nextId } },
      setUser: value => { state.user = value }, setClubOptions: () => state.cleared.push('clubs'),
      setAccessModeOptions: () => state.cleared.push('modes'), setTeamOptions: () => state.cleared.push('teams'),
      setHasPlatformAdminAccess: () => state.cleared.push('platform'), setAccessRouteMismatch: () => state.cleared.push('route'),
      SELECTED_CLUB_STORAGE_KEY: 'club', SELECTED_TEAM_STORAGE_KEY: 'team', SELECTED_ACCESS_MODE_STORAGE_KEY: 'mode',
      SELECTED_ACCESS_MODE_EXPLICIT_KEY: 'explicit', clearLoginAccessIntent: () => state.cleared.push('intent'),
      setSession: value => { state.session = value }, setAuthUser: () => {}, setIsProfileLoading: () => {}, finishBootstrap: () => { state.done = true },
    }
    new Function(...Object.keys(deps), code)(...Object.values(deps))
    assert.equal(deps.activeSyncIdRef.current, 9)
    assert.equal(state.user, same ? 'account-a' : null)
    assert.equal(storage.size, same ? 4 : 0)
    assert.equal(state.session.user.id, nextId)
    assert.equal(state.done, true)
  }
})
