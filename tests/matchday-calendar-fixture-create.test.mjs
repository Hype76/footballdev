import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getCoachQuickActions } from '../apps/coach-mobile/src/coachQuickActionsCore.js'
import { getCoachRouteState, resolveCoachRoute } from '../apps/coach-mobile/src/coachNavigationCore.js'
import { isMatchdayPlan } from '../apps/mobile-core/src/matchdayPolicyCore.js'
import { createCoachFixtureForm, initializeCoachFixtureForm, validateCoachFixtureForm } from '../apps/mobile-core/src/coachFixtureCore.js'
import { buildCoachCalendarEvents } from '../apps/mobile-core/src/coachCalendarCore.js'
import { MATCHDAY_DEFAULT_FLAGS } from '../src/lib/matchday-policy.js'

const context = { planKey: 'matchday', role: 'head_manager', roleRank: 70, teamId: 'team', paymentAccess: { canMutate: true } }
const config = { flags: MATCHDAY_DEFAULT_FLAGS }
const normalizeCoachMatchDay = row => ({ ...row, matchDate: row.match_date || row.matchDate })

test('App navigation preserves existing fixture and edit targets alongside Calendar creation', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
  const body = source.match(/const navigate = useCallback\(\(route, navigationTarget = null\) => \{([^]*?)\n  \}, \[/)[1]
  const targets = []
  const dependencies = { Keyboard: { dismiss() {} }, scrollContentToTop: () => {}, setChatNotificationTarget: () => {}, resolveCoachRoute, activeContext: context, matchdayPlanConfig: config, getCoachRouteState, activeRoute: 'calendar', moreRoute: '', formationReturnRef: { current: null }, setNotice: () => {}, setCalendarTarget: () => {}, setMatchDayTarget: value => targets.push(value), setActiveRoute: () => {}, setMoreRoute: () => {}, normalizeText: value => String(value || '').trim() }
  const navigate = new Function(...Object.keys(dependencies), `return (route, navigationTarget = null) => {${body}}`)(...Object.values(dependencies))
  assert.equal(navigate('matchday', { fixtureId: 'existing-fixture' }), true)
  assert.equal(targets.at(-1).fixtureId, 'existing-fixture')
  const returnCalendarTarget = { sourceId: 'existing-fixture', sourceType: 'match_day' }
  assert.equal(navigate('matchday', { fixtureId: 'existing-fixture', intent: 'edit-fixture', returnCalendarTarget }), true)
  assert.equal(targets.at(-1).intent, 'edit-fixture')
  assert.equal(targets.at(-1).returnCalendarTarget, returnCalendarTarget)
  assert.equal(navigate('matchday', { intent: 'create-fixture', matchDate: '2099-10-15' }), true)
  assert.equal(targets.at(-1).fixtureId, '')
  assert.equal(targets.at(-1).intent, 'create-fixture')
  assert.equal(targets.at(-1).matchDate, '2099-10-15')
  const count = targets.length
  assert.equal(navigate('sessions'), false)
  assert.equal(targets.length, count)
  assert.equal(navigate('home'), true)
  assert.equal(targets.at(-1), null)
})

test('Matchday quick actions use plan access as well as role and Team authority', () => {
  assert.deepEqual(getCoachQuickActions(context, config).map(action => action.id), ['add-player', 'add-match', 'game-day', 'formation-board'])
  assert.deepEqual(getCoachQuickActions(context), [])
  assert.deepEqual(getCoachQuickActions(context, { flags: {} }), [])
  assert.deepEqual(getCoachQuickActions({ ...context, teamId: '' }, config), [])
  assert.deepEqual(getCoachQuickActions({ ...context, roleRank: 10 }, config), [])
  assert.equal(getCoachQuickActions({ ...context, roleRank: 30 }, config).some(action => action.id === 'add-player'), false)
  assert.deepEqual(getCoachQuickActions(context, { flags: { ...MATCHDAY_DEFAULT_FLAGS, matchDay: false } }).map(action => action.id), ['add-player'])
  assert.deepEqual(getCoachQuickActions({ ...context, paymentAccess: { canMutate: false } }, config).map(action => action.id), ['game-day', 'formation-board'])
})

test('paid and legacy teams retain allowed quick actions', () => {
  for (const planKey of ['team', 'club', 'legacy']) {
    const actions = getCoachQuickActions({ ...context, planKey })
    assert.equal(actions.some(action => action.id === 'add-session'), true)
    assert.equal(actions.some(action => action.id === 'add-assessment'), true)
    assert.equal(actions.some(action => action.id === 'create-poll'), true)
  }
})

test('Calendar date seeds a new fixture without changing an existing fixture or later edits', () => {
  assert.equal(createCoachFixtureForm({ defaultMatchDate: '2099-10-15' }).matchDate, '15-10-2099')
  assert.equal(createCoachFixtureForm({ defaultMatchDate: 'invalid' }).matchDate, createCoachFixtureForm().matchDate)
  assert.equal(createCoachFixtureForm({ defaultMatchDate: '2099-10-15', match: { id: 'fixture', matchDate: '2099-10-20' } }).matchDate, '20-10-2099')
  const edited = { ...createCoachFixtureForm({ defaultMatchDate: '2099-10-15' }), matchDate: '21-10-2099', opponentName: 'Visitors' }
  assert.equal(initializeCoachFixtureForm(edited, { defaultMatchDate: '2099-10-15' }), edited)
})

test('a stale Matchday Calendar form cannot create a generic event, before any write', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachCalendarData.js', import.meta.url), 'utf8')
  const body = source.match(/export async function saveCoachCalendarEvent\([^]*?\n\}/)[0].replace(/^export /, '')
  let payloadCalls = 0
  const save = new Function('assertCoachOperationalMutation', 'isMatchdayPlan', 'buildCoachCalendarPayload', `return (${body})`)(
    () => {}, isMatchdayPlan, () => { payloadCalls++; throw new Error('reached existing event path') },
  )
  for (const plan of [{ planKey: 'matchday' }, { plan_key: 'matchday' }]) {
    for (const eventType of ['match', 'training', 'general']) {
      await assert.rejects(save(plan, { eventType }), /Match Day fixture form/)
    }
  }
  assert.equal(payloadCalls, 0)
  await assert.rejects(save(context, {}, { sourceId: 'existing', sourceType: 'calendar_event' }), /reached existing event path/)
  await assert.rejects(save({ planKey: 'team' }, {}), /reached existing event path/)
  await assert.rejects(save(context, {}, { sourceType: 'match_day' }), /authoritative Match Day/)
})

test('Calendar creation waits for the fresh read rather than consuming the cached loading state', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
  const body = source.match(/useEffect\(\(\) => \{(\s+if \(matchDayTarget\?\.intent !== 'create-fixture'[^]*?)\n  \}, \[/)[1]
  const keys = ['context', 'loading', 'matchDayTarget', 'loadInFlight', 'stale', 'user', 'setError', 'setFixtureFormMatch', 'setFixtureFormDate', 'setFixtureReturnTarget', 'setFixtureFormOpen', 'setNotice', 'onRequestScrollTop', 'onMatchDayTargetHandled']
  const effect = new Function(...keys, body)
  const calls = []
  const run = (overrides = {}) => {
    const inputs = { context, loading: false, matchDayTarget: { intent: 'create-fixture', matchDate: '2099-10-15' }, loadInFlight: { current: false }, stale: false, user: {} }
    for (const key of keys.slice(6)) inputs[key] = value => calls.push([key, value])
    effect(...keys.map(key => ({ ...inputs, ...overrides })[key]))
  }
  run({ loadInFlight: { current: true }, stale: true })
  assert.deepEqual(calls, [], 'cached data must not discard the request during the fresh read')
  run()
  assert.ok(calls.some(([key, value]) => key === 'setFixtureFormDate' && value === '2099-10-15'))
  assert.ok(calls.some(([key, value]) => key === 'setFixtureFormOpen' && value === true))
  assert.equal(calls.filter(([key]) => key === 'onMatchDayTargetHandled').length, 1)
  calls.length = 0
  run({ stale: true })
  assert.equal(calls.some(([key]) => key === 'setFixtureFormOpen'), false)
  assert.equal(calls.some(([key]) => key === 'setError'), true)
  calls.length = 0
  run({ context: { ...context, paymentAccess: { canMutate: false } } })
  assert.equal(calls.some(([key]) => key === 'setFixtureFormOpen'), false)
})

test('the fixture save path persists a real match and supplies the Calendar match-day projection', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachMatchDayData.js', import.meta.url), 'utf8')
  const body = source.match(/export async function createCoachMatchDayFixture\([^]*?\n\}/)[0].replace(/^export /, '')
  const writes = []
  const supabase = {
    rpc: async () => ({ data: null, error: null }),
    from: table => ({ insert(payload) {
      writes.push({ table, payload })
      const query = { select: () => query, single: async () => ({ data: { id: 'fixture', ...payload }, error: null }), then: handler => Promise.resolve({ error: null }).then(handler) }
      return query
    } }),
  }
  const dependencies = { assertCoachOperationalMutation: () => {}, validateCoachFixtureForm, normalize: value => String(value || '').trim(), saveCoachTeamNotificationDisplayName: async () => {}, supabase, normalizeTeamNotificationDisplayName: value => value, LIST_SELECT: '*', normalizeCoachMatchDay, recordCoachOperationalAudit: async () => {}, sendCoachFixtureInvitations: async () => { throw new Error('test must not send invitations') } }
  const create = new Function(...Object.keys(dependencies), `return (${body})`)(...Object.values(dependencies))
  const form = { ...createCoachFixtureForm({ defaultMatchDate: '2099-10-15' }), opponent: 'Visitors', fixtureType: 'friendly', rememberNotificationTeamName: false, parentVisible: false }
  const result = await create({ id: 'coach', clubId: 'club', activeTeamId: 'team' }, form)
  assert.equal(result.match.id, 'fixture')
  const record = writes.find(write => write.table === 'match_days')
  assert.ok(record)
  assert.equal(record.payload.match_date, '2099-10-15')
  assert.equal(record.payload.team_id, 'team')
  assert.equal(writes.some(write => ['calendar_events', 'assessment_sessions'].includes(write.table)), false)
  const calendar = buildCoachCalendarEvents({ matches: [{ id: 'fixture', ...record.payload }] })
  assert.equal(calendar.length, 1)
  assert.equal(calendar[0].sourceType, 'match_day')
  assert.equal(calendar[0].sourceId, result.match.id)
})

test('created fixtures become the selected match and invalidate Calendar before its next read', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
  const handler = source.match(/const handleFixtureCreated = async \(result\) => \{([^]*?)\n  \}/)[1]
  const invalidated = []
  const selectedMatchId = { current: 'previous-fixture' }
  const matchRef = { current: { id: 'previous-fixture' } }
  const dependencies = { setFixtureFormOpen: () => {}, onRequestScrollTop: () => {}, setNotice: () => {}, normalizeCoachMatchDay, selectedMatchId, matchRef, invalidateMobileResource: (_user, key) => invalidated.push(key), user: {}, setMatches: () => {}, getCoachMatchDayDetail: async () => { assert.equal(selectedMatchId.current, 'fixture'); return { id: 'fixture' } }, setMatch: () => {}, setPanel: () => {}, setScoreDraft: () => {} }
  const created = new Function(...Object.keys(dependencies), `return async (result) => {${handler}}`)(...Object.values(dependencies))
  await created({ match: { id: 'fixture', matchDate: '2099-10-15' } })
  assert.deepEqual(invalidated, ['coach:calendar', 'coach:match-list'])
  assert.equal(selectedMatchId.current, 'fixture')
  assert.equal(matchRef.current.id, 'fixture')
})
