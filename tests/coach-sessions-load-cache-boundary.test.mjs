import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { getCoachFriendlyError } from '../apps/coach-mobile/src/coachFriendlyErrors.js'
import { normalizeCoachSession } from '../apps/mobile-core/src/coachSessionsCore.js'

const source = await readFile(new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url), 'utf8')
const screen = source.slice(source.indexOf('export function CoachSessionsScreen('), source.indexOf('function SessionPlayerNotes'))
const loadStart = screen.indexOf('  const load = useCallback(async ')
const loadEnd = screen.indexOf('  }, [context, user])', loadStart)
const loadSource = screen.slice(loadStart, loadEnd)
  .replace('  const load = useCallback(async ', 'async function load')
  .replace(' = {}) => {', ' = {}) {') + '}'
const liveSessions = [{ id: 'FP TEST session', status: 'open', sessionDate: '2026-09-16' }]
const savedSessions = [{ id: 'FP TEST old session', status: 'open', sessionDate: '2026-09-15' }]

function controller({ cached = null, loadError = null, cacheError = null } = {}) {
  const state = {}
  const calls = []
  const config = { loadError, cacheError }
  const scope = {
    user: { id: 'FP TEST coach' }, context: { id: 'team:FP TEST' },
    readCoachOfflineResources: async () => cached,
    getCoachSessionList: async () => { calls.push('live read'); if (config.loadError) throw config.loadError; return liveSessions },
    getCoachPlayerList: async () => [], getCoachCalendarResources: async () => [],
    readMobileResource: (_user, _key, loader) => loader(),
    withMobileAsyncTimeout: loader => loader(),
    filterCoachCalendarEvents: rows => rows, getSavedLocationOptions: () => [],
    saveCoachOfflineResources: async (_user, _context, resources) => {
      calls.push('save cache')
      assert.equal(resources.sessions, liveSessions)
      if (config.cacheError) throw config.cacheError
    },
    message: getCoachFriendlyError,
  }
  for (const field of ['Error', 'CacheWarning', 'Loading', 'Sessions', 'Players', 'TrainingEvents', 'TrainingLocations', 'Stale']) {
    scope[`set${field}`] = value => { state[field] = value }
  }
  vm.createContext(scope)
  vm.runInContext(loadSource, scope)
  return { state, calls, config, load: scope.load }
}

for (const code of ['offline_profile_scope_mismatch', 'offline_context_scope_mismatch', 'offline_cache_payload_too_large', 'offline_storage_readback_failed']) {
  test(`successful Sessions read survives ${code} with a visible offline warning`, async () => {
    const run = controller({ cacheError: new Error(code) })
    await run.load()
    assert.equal(run.state.Sessions, liveSessions)
    assert.equal(run.state.Error, '')
    assert.equal(run.state.Stale, false)
    assert.equal(run.state.Loading, false)
    assert.match(run.state.CacheWarning, /Sessions are up to date/)
    assert.match(run.state.CacheWarning, /could not save an offline copy/)
    assert.doesNotMatch(run.state.CacheWarning, /scope_mismatch|readback|payload/)
    assert.deepEqual(run.calls, ['live read', 'save cache'])
    assert.match(screen, /cacheWarning && !error[\s\S]*accessibilityLiveRegion="polite"[\s\S]*Try saving offline again/)
  })
}

test('retry clears the offline warning only after another successful live read and cache save', async () => {
  const run = controller({ cacheError: new Error('offline_profile_scope_mismatch') })
  await run.load()
  assert.ok(run.state.CacheWarning)
  run.config.cacheError = null
  await run.load()
  assert.equal(run.state.Error, '')
  assert.equal(run.state.CacheWarning, '')
  assert.equal(run.state.Sessions, liveSessions)
  assert.deepEqual(run.calls, ['live read', 'save cache', 'live read', 'save cache'])
})

for (const cached of [null, { resources: { sessions: savedSessions } }]) {
  test(`real Sessions permission failure remains visible with ${cached ? 'saved rows' : 'no cache'}`, async () => {
    const run = controller({ cached, loadError: new Error('permission denied for relation assessment_sessions') })
    await run.load()
    assert.match(run.state.Error, /current access does not allow these Sessions/)
    assert.equal(run.state.CacheWarning, '')
    assert.equal(run.state.Loading, false)
    assert.deepEqual(run.calls, ['live read'])
    assert.equal(run.state.Sessions.length, 0)
    assert.equal(run.state.Players.length, 0)
    assert.equal(run.state.Stale, true)
  })
}

test('Sessions loader keeps club/team filtering and refuses missing or insufficient Coach context', async () => {
  const data = await readFile(new URL('../apps/mobile-core/src/coachSessionsData.js', import.meta.url), 'utf8')
  const guards = await readFile(new URL('../apps/mobile-core/src/coachOperationalData.js', import.meta.url), 'utf8')
  const guard = guards.slice(guards.indexOf('export function assertCoachOperationalRead('), guards.indexOf('export function assertCoachOperationalMutation(')).replace('export ', '')
  const list = data.slice(data.indexOf('export async function getCoachSessionList('), data.indexOf('export async function getCoachSessionDetail(')).replace('export ', '')
  const calls = []
  let failure = null
  const query = {
    select: value => { calls.push(['select', value]); return query },
    eq: (key, value) => { calls.push(['eq', key, value]); return query },
    order: () => query, limit: () => query,
    then: resolve => resolve({ data: [{ id: 'FP TEST session' }], error: failure }),
  }
  const scope = { normalizeCoachSession, supabase: { from: table => { calls.push(['from', table]); return query } } }
  vm.createContext(scope)
  vm.runInContext(guard + list, scope)
  const user = { id: 'FP TEST coach', clubId: 'FP TEST club', activeTeamId: 'FP TEST team', role: 'team_admin', roleRank: 70 }
  assert.equal((await scope.getCoachSessionList(user))[0].id, 'FP TEST session')
  assert.ok(calls.some(item => item[0] === 'eq' && item[1] === 'club_id' && item[2] === user.clubId))
  assert.ok(calls.some(item => item[0] === 'eq' && item[1] === 'team_id' && item[2] === user.activeTeamId))
  failure = new Error('permission denied')
  await assert.rejects(scope.getCoachSessionList(user), /permission denied/)
  calls.length = 0
  await assert.rejects(scope.getCoachSessionList({ ...user, activeTeamId: '' }), /active Team/)
  await assert.rejects(scope.getCoachSessionList({ ...user, roleRank: 0 }), /active operational Coach/)
  assert.equal(calls.length, 0)
})


test('network refresh failure keeps saved Sessions visibly stale and never calls the cache writer', async () => {
  const run = controller({ cached: { resources: { sessions: savedSessions } }, loadError: new Error('Network request failed') })
  await run.load()
  assert.match(run.state.Error, /could not connect/)
  assert.equal(run.state.Sessions, savedSessions)
  assert.equal(run.state.Stale, true)
  assert.equal(run.state.CacheWarning, '')
  assert.deepEqual(run.calls, ['live read'])
})
