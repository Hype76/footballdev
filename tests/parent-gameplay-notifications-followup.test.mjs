import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { deliverParentScorerCommands } from '../netlify/functions/lib/_parent-scorer-command-notifications.js'

const source = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
const actionSource = source.slice(source.indexOf('async function handleScorerAction'), source.indexOf('async function handleDisplayThemeChange'))
const names = ['activeActionId', 'scorerActionInFlightRef', 'selectedMobileUser', 'selectedLink', 'setActiveActionId',
  'setNotice', 'queueParentScorerAction', 'setScorerOutboxes', 'isOffline', 'runParentSync', 'getParentFriendlyError']
const makeAction = new Function(...names, `return (${actionSource.trim()})`)

function createAction({ offline = false, queue = async () => ({ journal: { pending: [{ id: 'saved' }] } }), sync = async () => {} } = {}) {
  const notices = []
  const activeActions = []
  const savedOutboxes = []
  const fn = makeAction('', { current: false }, { id: 'parent-1' }, { id: 'link-1' }, id => activeActions.push(id),
    notice => notices.push(notice), queue, update => savedOutboxes.push(update({})), offline, sync,
    error => error.message)
  return { activeActions, fn, notices, savedOutboxes }
}

const match = { id: 'match-1', isScorer: true, status: 'live' }

test('Parent scorer saves locally before sync and includes each action payload', async () => {
  for (const [action, value, expected] of [
    ['start', null, {}], ['timer', 'half_time', { action: 'half_time' }],
    ['extended', 'start_extra_time', { action: 'start_extra_time' }],
    ['goal', { teamSide: 'club' }, { teamSide: 'club' }],
    ['score', { homeScore: 1, awayScore: 0 }, { homeScore: 1, awayScore: 0 }],
    ['event', { eventType: 'red_card' }, { eventType: 'red_card' }],
    ['correct-goal', { event: { id: 'goal-1' }, goal: { scorerName: 'Player' }, reason: 'Correction' },
      { eventId: 'goal-1', goal: { scorerName: 'Player' }, reason: 'Correction' }],
    ['shootout', { outcome: 'scored' }, { outcome: 'scored' }],
    ['request-review', null, {}],
  ]) {
    const calls = []
    const { fn, savedOutboxes } = createAction({ queue: async (_user, _link, _match, kind, payload) => {
      calls.push(['saved', kind, payload]); return { journal: { pending: [{ id: 'saved' }] } }
    }, sync: async () => { calls.push(['sync']) } })
    assert.equal(await fn(match, action, value), true)
    assert.deepEqual(calls[0], ['saved', action, expected])
    assert.deepEqual(calls[1], ['sync'])
    assert.equal(savedOutboxes[0]['match-1'].pending.length, 1)
  }
})

test('offline save waits for reconnection and failed local save sends nothing', async () => {
  let synced = 0
  const offline = createAction({ offline: true, sync: async () => { synced += 1 } })
  assert.equal(await offline.fn(match, 'goal', {}), true)
  assert.equal(synced, 0)
  assert.match(offline.notices.at(-1).message, /Saved on this phone/)
  const rejected = createAction({ queue: async () => { throw new Error('Encrypted save failed') },
    sync: async () => { synced += 1 } })
  assert.deepEqual(await rejected.fn(match, 'goal', {}), { saved: false, message: 'Encrypted save failed' })
  assert.equal(rejected.savedOutboxes.length, 0)
  assert.equal(synced, 0)
})

test('saving indicator remains active until local persistence finishes', async () => {
  let release
  const queued = new Promise(resolve => { release = resolve })
  const { activeActions, fn, notices } = createAction({ queue: () => queued })
  const result = fn(match, 'goal', {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(activeActions.at(-1), 'scorer:match-1:goal')
  assert.equal(notices.at(-1), null)
  release({ journal: { pending: [{ id: 'saved' }] } })
  assert.equal(await result, true)
  assert.equal(activeActions.at(-1), '')
})

test('server notification failure retries after the recorded match action', async () => {
  let attempts = 0
  const command = { id: 'command', match: { id: 'match-1', home_score: 1 }, type: 'goal', eventId: 'event' }
  const completions = []
  const client = {
    async rpc(name, args) {
      if (name.startsWith('claim_')) return { data: [command] }
      if (name.startsWith('get_')) return { data: ['link-1'] }
      completions.push(args.error_value)
      return { data: null }
    },
    from() { return { select() { return this }, eq() { return this }, is() { return this },
      async maybeSingle() { return { data: { teams: { name: 'Team' }, clubs: { name: 'Club', status: 'active' } } } } } },
  }
  const deliver = async ({ match: savedMatch }) => {
    assert.equal(savedMatch.home_score, 1)
    return { mobileFailed: attempts++ === 0 ? 1 : 0 }
  }
  assert.deepEqual(await deliverParentScorerCommands('command', 'parent-1', { client, deliver }), { completed: 0, failed: 1 })
  assert.deepEqual(await deliverParentScorerCommands('command', 'parent-1', { client, deliver }), { completed: 1, failed: 0 })
  assert.match(completions[0], /retried/)
  assert.equal(completions[1], '')
})
