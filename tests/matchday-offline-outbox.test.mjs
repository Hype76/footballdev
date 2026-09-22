import assert from 'node:assert/strict'
import test from 'node:test'
import { appendMatchDayCommand, createMatchDayOutbox, mergeMatchDayCommandSnapshot, projectMatchDayOutbox } from '../apps/mobile-core/src/matchDayOutboxCore.js'
import { getCoachMatchDayActions } from '../apps/mobile-core/src/coachMatchDayCore.js'
import { canCorrectMatchDayCommand } from '../apps/mobile-core/src/matchDayOutboxCore.js'
import { validateCoachMatchDayEventParticipants, validateCoachMatchDayEventForm } from '../apps/mobile-core/src/coachMatchDayCore.js'
import { getMatchTimerElapsedSeconds } from '../src/lib/matchday-timer.js'
import { buildMatchDayNativeMessage } from '../netlify/functions/lib/_match-day-native-message.js'
import { sendExpoPushMessages } from '../netlify/functions/lib/_expo-push.js'
import { deliverCoachMatchDayCommands } from '../netlify/functions/lib/_coach-match-day-command-notifications.js'

const at = Date.now() - 3600000
const iso = minutes => new Date(at + minutes * 60000).toISOString()
const match = { id: 'fixture', clubId: 'club', teamId: 'team', updatedAt: iso(0), status: 'live', currentMatchPhase: 'first_half',
  timerStatus: 'running', timerStartedAt: iso(0), timerElapsedSeconds: 0, homeAway: 'away', homeScore: 0, awayScore: 0, matchDurationMinutes: 70, clockMode: 'fixed', events: [] }
const initial = () => ({ baseMatch: structuredClone(match), pending: [], verifiedAt: iso(0), error: '' })
const goal = (id, minute = 5) => ({ id, kind: 'event', capturedAt: iso(minute), payload: { eventType: 'goal', teamSide: 'club', minute, scorerName: 'FP TEST' } })

test('definitively rejected substitution can be corrected without losing later full time or captured times', async () => {
  let journal = appendMatchDayCommand(initial(), { id:'bad-sub', kind:'event', capturedAt:iso(3), payload:{eventType:'substitution',teamSide:'club',minute:3,playerName:'Paul',playerOnName:'Other: Pat',notes:'Keep note'} })
  for (const [index, action] of ['resume','hydration','resume','full_time'].entries()) journal = appendMatchDayCommand(journal,{id:`timer-${index}`,kind:'timer',payload:{action},capturedAt:iso(4+index)})
  const original = structuredClone(journal.pending)
  const sent = []
  const box = createMatchDayOutbox({read:async()=>journal,update:async fn=>(journal=fn(journal)),send:async(command,base)=>{
    if(command.id==='bad-sub') throw Object.assign(new Error('Choose one selected Match squad Player from this fixture Team.'),{code:'22023'})
    sent.push(command);return {...projectMatchDayOutbox({baseMatch:base,pending:[command]}),updatedAt:command.capturedAt}
  }})
  await box.sync()
  assert.equal(canCorrectMatchDayCommand(journal),true)
  for (const errorCode of ['', '42501', '40001']) assert.equal(canCorrectMatchDayCommand({...journal,errorCode}),false)
  await box.correctRejected({commandId:'bad-sub',id:'fixed-sub',payload:{...original[0].payload,playerName:'Other: Paul',participantType:'other'}})
  assert.equal(journal.pending[1].previousCommandId,'fixed-sub')
  assert.deepEqual(journal.pending.slice(2),original.slice(2))
  assert.equal(journal.pending[0].capturedAt,original[0].capturedAt)
  assert.equal(journal.pending[0].payload.notes,'Keep note')
  assert.deepEqual(journal.corrections[0].original,original[0])
  await box.sync()
  assert.equal(journal.pending.length,0)
  assert.equal(journal.baseMatch.status,'full_time')
  assert.equal(journal.baseMatch.events.length,1)
  assert.equal(sent.length,5)
})

test('uncertain transport errors cannot be rewritten and invalid roster names are caught before saving', async () => {
  let journal = appendMatchDayCommand(initial(),{id:'card',kind:'event',capturedAt:iso(3),payload:{eventType:'red_card',teamSide:'club',playerName:'Coach: Dave'}})
  const box = createMatchDayOutbox({read:async()=>journal,update:async fn=>(journal=fn(journal)),send:async()=>{throw new Error('Response lost')}})
  await box.sync()
  await assert.rejects(box.correctRejected({commandId:'card',id:'new',payload:journal.pending[0].payload}),/Sync saved actions first/)
  assert.equal(journal.pending[0].id,'card')
  assert.throws(()=>validateCoachMatchDayEventParticipants({eventType:'substitution',teamSide:'club',playerName:'Paul'},[]),/selected squad player/)
  const card = validateCoachMatchDayEventForm({eventType:'red_card',teamSide:'club',participantType:'coach',playerName:'Dave',minute:3})
  assert.equal(validateCoachMatchDayEventParticipants(card,[]).playerName,'Coach: Dave')
})

test('server notification retries retain failure and preserve the recorded score and recipient scope', async () => {
  const calls = []
  const command = { id: 'command', match: { id: 'fixture', home_score: 1, away_score: 0 }, type: 'goal', eventId: 'event' }
  const client = {
    async rpc(name, args) {
      calls.push({ name, args })
      return { data: name.startsWith('claim_') ? [command] : name.startsWith('get_') ? ['parent-1', 'parent-1', 'parent-2'] : null }
    },
    from() { return { select() { return this }, eq() { return this }, is() { return this }, async maybeSingle() { return { data: { teams: {name:'FP TEST'}, clubs: {name:'FP TEST',status:'active'} } } } } },
  }
  let first = true
  const deliver = async input => {
    assert.equal(input.match.home_score,1)
    assert.equal(input.eventId,'event')
    assert.deepEqual(input.targetParentLinkIds,['parent-1','parent-2'])
    const result = { mobileFailed: first ? 1 : 0, webFailed: 0 }
    first = false
    return result
  }
  assert.deepEqual(await deliverCoachMatchDayCommands('command','coach',{client,deliver}),{completed:0,failed:1})
  assert.match(calls.at(-1).args.error_value,/not accepted/)
  assert.deepEqual(calls[0].args,{command_id_value:'command',actor_user_id_value:'coach'})
  assert.deepEqual(await deliverCoachMatchDayCommands('command','coach',{client,deliver}),{completed:1,failed:0})
  assert.equal(calls.at(-1).args.error_value,'')
})

test('Coach can record goals offline only with a prepared fixture and active mutation authority', () => {
  const context = { role: 'coach', roleRank: 30, paymentAccess: { canMutate: true } }
  assert.equal(getCoachMatchDayActions({ context, match, stale: true }).canRecordEvents, false)
  const actions = getCoachMatchDayActions({ context, match, stale: true, offlineReady: true })
  assert.equal(actions.canRecordEvents, true)
  assert.ok(actions.timerActions.some(item => item.action === 'half_time'))
  assert.equal(actions.canSaveFinalReport, false)
  assert.equal(actions.canSelectVolunteers, false)
  assert.equal(getCoachMatchDayActions({ context: { ...context, paymentAccess: { canMutate: false } }, match, stale: true, offlineReady: true }).canRecordEvents, false)
  assert.equal(getCoachMatchDayActions({ context: { ...context, role: 'parent_portal' }, match, stale: true, offlineReady: true }).canRecordEvents, false)
  assert.equal(getCoachMatchDayActions({ context, match: { ...match, status: 'full_time', timerStatus: 'full_time' }, stale: true, offlineReady: true }).canRecordEvents, false)
})

test('server clock clears replace earlier local clock anchors after sync', () => {
  const merged = mergeMatchDayCommandSnapshot({ ...match, timerPausedAt: iso(10), fullTimeResumeStatus: 'live', requestScorer: true },
    { timer_started_at: null, timer_paused_at: null, full_time_resume_status: null, request_scorer: false })
  assert.equal(merged.timer_started_at ?? merged.timerStartedAt ?? '', '')
  assert.equal(merged.timer_paused_at ?? merged.timerPausedAt ?? '', '')
  assert.equal(merged.full_time_resume_status ?? merged.fullTimeResumeStatus ?? '', '')
  assert.equal(merged.request_scorer === true || merged.requestScorer === true, false)
  assert.equal(merged.teamId, match.teamId)
})

test('screen and app sync share a lock and preserve pending actions when the screen closes', async () => {
  let release
  let calls = 0
  const h = harness(async () => { calls += 1; if (calls === 1) await new Promise(resolve => { release = resolve }); return { ...match, awayScore: 1 } })
  const screen = createMatchDayOutbox({ ...h.options, key: 'same-fixture' })
  const app = createMatchDayOutbox({ ...h.options, key: 'same-fixture' })
  await screen.enqueue(goal('goal-1'))
  const first = screen.sync()
  await new Promise(resolve => setImmediate(resolve))
  await app.sync()
  assert.equal(calls, 1)
  screen.stop()
  release()
  await first
  assert.equal(h.get().pending.length, 1)
  await app.sync()
  assert.equal(h.get().pending.length, 0)
})

test('offline goal, pause, restart and half time preserve the recorded clock across a restart', () => {
  let journal = appendMatchDayCommand(initial(), goal('goal-1'))
  journal = appendMatchDayCommand(journal, { id: 'pause', kind: 'timer', payload: { action: 'pause' }, capturedAt: iso(10) })
  assert.equal(getMatchTimerElapsedSeconds(projectMatchDayOutbox(journal), at + 15 * 60000), 600)
  journal = appendMatchDayCommand(journal, { id: 'resume', kind: 'timer', payload: { action: 'resume' }, capturedAt: iso(15) })
  journal = appendMatchDayCommand(journal, { id: 'half', kind: 'timer', payload: { action: 'half_time' }, capturedAt: iso(40) })
  const restored = JSON.parse(JSON.stringify(journal))
  const projected = projectMatchDayOutbox(restored)
  assert.equal(projected.awayScore, 1)
  assert.equal(projected.timerElapsedSeconds, 2100)
  assert.equal(projected.status, 'half_time')
  assert.equal(projected.events[0].minute, 5)
  assert.equal(restored.pending[1].previousCommandId, 'goal-1')
})

function harness(send) {
  let journal = initial()
  const changes = []
  const options = { read: async () => structuredClone(journal), update: async change => { journal = change(journal); return structuredClone(journal) }, send,
    onChange: value => changes.push(value) }
  return { controller: createMatchDayOutbox(options), get: () => journal, options, changes }
}

test('lost acknowledgement retries the same ID and never duplicates an accepted goal', async () => {
  const accepted = new Map()
  let loseResponse = true
  const h = harness(async command => {
    if (!accepted.has(command.id)) accepted.set(command.id, { ...match, awayScore: accepted.size + 1, updatedAt: iso(20) })
    if (loseResponse) { loseResponse = false; throw new Error('Connection lost') }
    return accepted.get(command.id)
  })
  await h.controller.enqueue(goal('goal-1'))
  await h.controller.sync()
  assert.equal(h.get().pending.length, 1)
  h.controller.stop()
  const restarted = createMatchDayOutbox(h.options)
  await restarted.sync()
  assert.equal(accepted.size, 1)
  assert.equal(h.get().pending.length, 0)
  assert.equal(h.get().baseMatch.awayScore, 1)
  await restarted.refresh(match)
  assert.equal(h.get().baseMatch.awayScore, 1, 'an old poll cannot replace the acknowledged score')
})

test('new actions recorded during sync survive acknowledgement of the first action', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const sent = []
  const h = harness(async command => { sent.push(command.id); if (sent.length === 1) await gate; return { ...match, awayScore: sent.length, updatedAt: iso(20 + sent.length) } })
  await h.controller.enqueue(goal('one'))
  const syncing = h.controller.sync()
  await new Promise(resolve => setTimeout(resolve, 0))
  await h.controller.enqueue(goal('two', 6))
  release()
  await syncing
  assert.deepEqual(sent, ['one', 'two'])
  assert.equal(h.get().pending.length, 0)
  assert.equal(h.get().baseMatch.awayScore, 2)
})

test('conflicts retain every action and storage failure is never shown as a saved goal', async () => {
  const h = harness(async () => { throw new Error('Match changed on another device') })
  await h.controller.enqueue(goal('one'))
  await h.controller.enqueue(goal('two', 6))
  await h.controller.sync()
  assert.equal(h.get().pending.length, 2)
  assert.match(h.get().error, /another device/)
  const broken = createMatchDayOutbox({ ...h.options, update: async () => { throw new Error('Disk full') } })
  await assert.rejects(broken.enqueue(goal('three')), /Disk full/)
  assert.equal(h.get().pending.length, 2)
})

test('expired preparation and invalid corrections are rejected before enqueue', () => {
  assert.throws(() => appendMatchDayCommand({ ...initial(), verifiedAt: new Date(at - 86400001).toISOString() }, goal('one')), /24 hours/)
  assert.throws(() => appendMatchDayCommand(initial(), { id: 'score', kind: 'score', capturedAt: iso(1), payload: { homeScore: -1, awayScore: 0 } }), /valid whole/)
})

test('time-critical match pushes use high priority without collapsing pending updates', () => {
  const message = buildMatchDayNativeMessage({ device: { expo_push_token: 'ExpoPushToken[synthetic]', parent_link_id: 'link', detail_level: 'minimal' },
    notificationCopy: { tag: 'match-day-fixture' }, nativePayload: { title: 'Match', minimalBody: 'Goal', detailedBody: 'FP TEST scored', data: { matchDayId: 'fixture' } } })
  assert.equal(message.priority, 'high')
  assert.equal(message.collapseId, undefined)
  assert.equal(message.threadId, 'match-day-fixture')
  assert.equal(message.body, 'Goal')
  assert.equal(message.data.parentLinkId, 'link')
  assert.ok(message.ttl > 0)
})

test('missing provider tickets cannot be counted as successful delivery', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [{ status: 'ok' }] }) })
  try {
    const result = await sendExpoPushMessages([{ to: 'ExpoPushToken[one]' }, { to: 'ExpoPushToken[two]' }])
    assert.equal(result.sent, 1)
    assert.equal(result.failed, 1)
  } finally { globalThis.fetch = original }
})

test('review after a confirmed conflict preserves command identity and uses the latest match version', async () => {
  let conflict = true
  const h = harness(async (command, base) => {
    if (conflict) throw Object.assign(new Error('Changed on another device'), { code: '40001' })
    assert.equal(command.id, 'goal-review')
    assert.equal(command.expectedUpdatedAt, iso(10))
    return { ...base, awayScore: 3, updatedAt: iso(11) }
  })
  await h.controller.enqueue(goal('goal-review'))
  const original = structuredClone(h.get().pending[0])
  await assert.rejects(h.controller.reviewAgainstLatest({ ...match, updatedAt: iso(10) }), /Sync saved/)
  await h.controller.sync()
  await assert.rejects(h.controller.reviewAgainstLatest({ ...match, id: 'other', updatedAt: iso(10) }), /Refresh/)
  await assert.rejects(h.controller.reviewAgainstLatest({ ...match, status: 'full_time', updatedAt: iso(10) }), /Refresh/)
  await h.controller.reviewAgainstLatest({ ...match, awayScore: 2, updatedAt: iso(10) })
  assert.deepEqual(h.get().pending[0].payload, original.payload)
  assert.equal(h.get().pending[0].capturedAt, original.capturedAt)
  assert.equal(h.get().pending[0].id, original.id)
  conflict = false
  await h.controller.sync()
  assert.equal(h.get().pending.length, 0)
  assert.equal(h.get().baseMatch.awayScore, 3)
})

test('an uncertain timeout cannot rebase a command that might already have been accepted', async () => {
  const h = harness(async () => { throw new Error('Request timed out') })
  await h.controller.enqueue(goal('uncertain'))
  await h.controller.sync()
  await assert.rejects(h.controller.reviewAgainstLatest({ ...match, updatedAt: iso(10) }), /Sync saved/)
  assert.equal(h.get().pending[0].expectedUpdatedAt, match.updatedAt)
})

test('Coach can conclude a parent-scored full time match only after saved actions are resolved', () => {
  const context = { role: 'coach', roleRank: 30, paymentAccess: { canMutate: true } }
  const finished = { ...match, status: 'full_time', timerStatus: 'full_time', currentMatchPhase: 'full_time', isScorer: false }
  assert.ok(getCoachMatchDayActions({ context, match: finished }).timerActions.some(item => item.action === 'conclude'))
  assert.ok(!getCoachMatchDayActions({ context, match: finished, stale: true, offlineReady: true }).timerActions.some(item => item.action === 'conclude'))
})
