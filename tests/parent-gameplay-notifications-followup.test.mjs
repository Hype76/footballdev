import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
const actionSource = source.slice(source.indexOf('async function handleScorerAction'), source.indexOf('async function handleDisplayThemeChange'))
const names = ['isOffline','activeActionId','selectedMobileUser','scorerHandoversRef','setActiveActionId','setNotice','startParentScorerMatch','setParentScorerTimer','setParentScorerExtendedState','updateParentScorerScore','addParentScorerGoal','correctParentScorerGoal','voidParentScorerGoal','recordParentScorerShootoutKick','voidParentScorerShootoutKick','sendParentScorerMatchDayPush','loadParentData','getParentFriendlyError','scorerActionGenerationRef','parentActionScopeRef']
const makeAction = new Function(...names, 'addParentScorerEvent', `return (${actionSource.trim()})`)

function createAction({ load = async () => {}, notify = async () => ({ success: true }), save = async () => ({ id: 'event-1', status: 'live' }) } = {}) {
  const notices = []
  const activeActions = []
  let currentNotice = null
  const generations = { current: 0 }
  const actionScope = { current: 0 }
  const setNotice = (notice) => {
    currentNotice = typeof notice === 'function' ? notice(currentNotice) : notice
    notices.push(currentNotice)
  }
  const fn = makeAction(false, '', { id: 'parent-1' }, { current: {} }, (id) => activeActions.push(id), setNotice, save, save, save, save, save, save, save, save, save, notify, load, (error) => error.message, generations, actionScope, save)
  return { actionScope, activeActions, fn, generations, notices, setNotice }
}

test('Parent gameplay sends notifications only after saved changes, including all clock phases', async () => {
  for (const [action,value,status,expected] of [
    ['start',null,'live','live'], ['timer','half_time','half_time','half_time'],
    ['timer','resume','second_half','second_half'], ['timer','full_time','full_time','full_time'],
    ['extended','start_extra_time','extra_time','extra_time'], ['extended','start_penalties','penalties','penalties'],
    ['timer','pause','live',''], ['goal',{},'live','goal'], ['score',{homeScore:1,awayScore:0},'live','score_correction'],
    ['event',{eventType:'red_card'},'live','red_card'],
  ]) {
    const calls = []
    const save = async () => { calls.push('saved'); return {id:'event-1',status} }
    const { fn } = createAction({
      load: async () => { calls.push('refresh') },
      notify: async (_user, _match, type, eventId) => { calls.push({ type, eventId }); return { success: true } },
      save,
    })
    assert.equal(await fn({id:'match-1',isScorer:true,status:'live'},action,value),true)
    assert.equal(calls[0],'saved')
    assert.equal(calls.filter((call) => call === 'saved').length, 1)
    assert.equal(calls.includes('refresh'), true)
    assert.deepEqual(calls.filter((call) => typeof call === 'object'), expected ? [{type:expected,eventId:['goal','score_correction','red_card'].includes(expected)?'event-1':''}] : [])
  }
})

test('failed Parent saves send no success notification and keep the form open', async () => {
  const fail = async () => { throw new Error('Database rejected save') }
  let notified = false
  const { fn } = createAction({ notify: async () => { notified = true }, save: fail })
  assert.deepEqual(await fn({id:'match-1',isScorer:true},'goal',{}),{saved:false,message:'Database rejected save'})
  assert.equal(notified,false)
})

test('Parent scorer confirms a committed save without waiting for push delivery or global refresh', async () => {
  let releasePush
  let releaseRefresh
  let saves = 0
  let pushCalls = 0
  let refreshCalls = 0
  const push = new Promise((resolve) => { releasePush = resolve })
  const refresh = new Promise((resolve) => { releaseRefresh = resolve })
  const { activeActions, fn, notices } = createAction({
    load: async () => { refreshCalls += 1; await refresh },
    notify: async () => { pushCalls += 1; await push; return { success: true } },
    save: async () => { saves += 1; return { id: 'event-1', status: 'live' } },
  })

  assert.equal(await fn({ id: 'match-1', isScorer: true, status: 'live' }, 'goal', {}), true)
  assert.equal(saves, 1)
  assert.equal(pushCalls, 1)
  assert.equal(refreshCalls, 1)
  assert.equal(notices.at(-1).tone, 'success')
  assert.equal(activeActions.at(-1), '', 'Saving indicator clears before background work completes')
  releasePush()
  releaseRefresh()
})

test('scorer keeps saving active until the authoritative save resolves', async () => {
  let resolveSave
  const save = new Promise(resolve => { resolveSave = resolve })
  let followups = 0
  const { activeActions, fn, notices } = createAction({
    save: () => save,
    notify: async () => { followups += 1; return true },
    load: async () => { followups += 1 },
  })
  const result = fn({ id: 'match-1', isScorer: true, status: 'live' }, 'goal', {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(activeActions.at(-1), 'scorer:match-1:goal')
  assert.equal(notices.at(-1), null)
  assert.equal(followups, 0)
  resolveSave({ id: 'saved-event' })
  assert.equal(await result, true)
  assert.equal(activeActions.at(-1), '')
  assert.equal(followups, 2)
})

test('older scorer background failures cannot replace a newer action notice', async () => {
  let resolveFirstPush
  const firstPush = new Promise((resolve) => { resolveFirstPush = resolve })
  let notifyCalls = 0
  const { fn, notices } = createAction({
    load: async () => {},
    notify: async () => {
      notifyCalls += 1
      if (notifyCalls === 1) return firstPush
      return { success: true }
    },
  })
  const match = { id: 'match-1', isScorer: true, status: 'live' }

  assert.equal(await fn(match, 'goal', {}), true)
  assert.equal(await fn(match, 'goal', {}), true)
  resolveFirstPush(null)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(notices.at(-1).tone, 'success')
})

test('scorer background warnings preserve a newer unrelated notice', async () => {
  let resolvePush
  const push = new Promise((resolve) => { resolvePush = resolve })
  const { fn, notices, setNotice } = createAction({
    load: async () => {},
    notify: async () => push,
  })

  assert.equal(await fn({ id: 'match-1', isScorer: true, status: 'live' }, 'goal', {}), true)
  const newerNotice = { message: 'A newer action has completed.', tone: 'success' }
  setNotice(newerNotice)
  resolvePush(null)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(notices.at(-1), newerNotice)
})
