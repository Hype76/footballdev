import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildCoachHomeOperationalSnapshot, preserveCoachDevelopmentSummary, updateCoachHomeSourceState } from '../apps/mobile-core/src/coachPhase31GCore.js'
import { mergeUnfinishedDevelopmentDrafts } from '../apps/mobile-core/src/developmentOfflineCore.js'
import { isMobileRouteAllowed } from '../apps/mobile-core/src/matchdayPolicyCore.js'

const source = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
const loadSource = source.slice(source.indexOf('async ({ refresh = false, chatOnly = false, availabilityOnly = false'), source.indexOf('\n  }, [activeContext, selectedMobileUser, user?.id])') + 4)
const draft = (id, playerId = id, extra = {}) => ({ id, playerId, formId: 'form', status: 'draft', values: { score: 5 }, ...extra })

test('Home counts only unfinished scoped drafts, including local edits once and excluding completion intent', () => {
  const snapshot = buildCoachHomeOperationalSnapshot({
    development: { records: [{ id: 'completed-history' }], recordCount: 13, drafts: [draft('saved'), draft('sending'), draft('completed', 'completed', { status: 'sent' })] },
    localDevelopmentDrafts: [draft('saved', 'saved', { status: 'pending' }), draft('local', 'local', { status: 'pending' }), draft('sending', 'sending', { finalisation: { requestedAt: 'now' } })],
  })
  assert.equal(snapshot.developmentRecords, 2)
  assert.deepEqual(snapshot.developmentDrafts.map(item => item.id), ['saved', 'local'])
  assert.equal(buildCoachHomeOperationalSnapshot({ development: { records: [{ id: 'submitted' }], recordCount: 13 } }).developmentRecords, 0)
})

test('Home draft summary queries current user and team drafts instead of completed evaluations', async () => {
  const data = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  const body = data.slice(data.indexOf('export async function getCoachDevelopmentSummary'), data.indexOf('export async function getCoachDevelopmentWorkspace')).replace('export ', '')
  const calls = []
  const query = {
    select(value) { calls.push(['select', value]); return this },
    eq(field, value) { calls.push([field, value]); return this },
    then(resolve) { resolve({ data: [{ id: 'draft', player_id: 'player', status: 'draft', draft_data: { selectedFeedbackFormId: 'form', responseValues: { score: 4 } } }] }) },
  }
  let asserted
  const load = new Function('supabase', 'assertCoachOperationalRead', 'normalize', `${body}; return getCoachDevelopmentSummary`)(
    { from(table) { calls.push(['from', table]); return query } },
    (user, options) => { asserted = { user, options } }, value => String(value ?? '').trim(),
  )
  const user = { id: 'coach', clubId: 'club', activeTeamId: 'team' }
  const summary = await load(user)
  assert.deepEqual(asserted, { user, options: { requiresTeam: true } })
  assert.deepEqual(calls.filter(([key]) => key !== 'select'), [['from', 'evaluation_drafts'], ['club_id', 'club'], ['team_id', 'team'], ['created_by_user_id', 'coach'], ['status', 'draft'], ['report_type', 'development_record']])
  assert.equal(summary.drafts[0].formId, 'form')
  assert.equal(summary.drafts[0].status, 'draft')
})

function harness() {
  let state = { developmentRecords: 13, developmentDrafts: [draft('saved')], errors: [] }
  const saves = [], calls = []
  const dependencies = {
    selectedMobileUser: { id: 'coach', clubId: 'club', activeTeamId: 'team', planKey: 'team' },
    user: { id: 'coach' }, activeContext: { id: 'team:team', clubId: 'club', teamId: 'team' },
    requestIdRef: { current: 1 }, developmentRefreshIdRef: { current: 0 },
    homeStateRef: { get current() { return state } },
    setHomeState: update => { state = typeof update === 'function' ? update(state) : update },
    readMobileResource: async (_user, key, load) => { calls.push(key); return load() },
    readCoachDevelopmentDrafts: async () => ({ saved: draft('saved', 'saved', { status: 'synced' }), local: draft('local', 'local', { status: 'pending' }) }),
    getCoachDevelopmentSummary: async () => ({ drafts: [draft('saved')] }),
    saveCoachOfflineResources: async (_id, _context, value) => { saves.push(value) },
    isMobileRouteAllowed, mergeUnfinishedDevelopmentDrafts, updateCoachHomeSourceState,
  }
  return { dependencies, calls, saves, state: () => state, load: () => new Function(...Object.keys(dependencies), `return (${loadSource})`)(...Object.values(dependencies)) }
}

test('actual targeted Home refresh deduplicates local drafts and saves the changed count for offline reopening', async () => {
  const h = harness()
  await h.load()({ developmentOnly: true })
  assert.equal(h.state().developmentRecords, 2)
  assert.equal(h.saves[0].home.developmentRecords, 2)
  assert.deepEqual(h.calls, ['coach:development-open-summary'])
  h.dependencies.selectedMobileUser.isOfflineProfile = true
  h.dependencies.readCoachDevelopmentDrafts = async () => ({ saved: draft('saved', 'saved', { finalisation: { requestedAt: 'now' } }) })
  await h.load()({ developmentOnly: true })
  assert.equal(h.state().developmentRecords, 1)
  assert.equal(h.calls.length, 1)
})

test('targeted draft reads fail closed and ignore a response from an earlier context', async () => {
  const h = harness()
  h.dependencies.readCoachDevelopmentDrafts = async () => { throw new Error('Authority changed') }
  await h.load()({ developmentOnly: true })
  assert.deepEqual(h.state().errors, ['development:unavailable'])
  let resolve
  h.dependencies.readCoachDevelopmentDrafts = () => new Promise(done => { resolve = done })
  const pending = h.load()({ developmentOnly: true })
  h.dependencies.requestIdRef.current++
  resolve({})
  await pending
  assert.equal(h.state().developmentRecords, 13)
  assert.equal(h.saves.length, 0)
})

test('newer Development count and source health survive delayed primary or attention snapshots', () => {
  const current = { developmentRecords: 2, developmentDrafts: [draft('saved'), draft('local')], errors: ['development:unavailable'] }
  const snapshot = preserveCoachDevelopmentSummary({ developmentRecords: 0, developmentDrafts: [], errors: ['polls:unavailable'] }, current)
  assert.equal(snapshot.developmentRecords, 2)
  assert.deepEqual(snapshot.errors, ['polls:unavailable', 'development:unavailable'])
})
