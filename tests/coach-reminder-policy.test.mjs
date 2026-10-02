import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_COACH_REMINDER_POLICY, normalizeCoachReminderPolicy, calendarDaysBefore,
  planAvailabilityAutomation, planSquadAutomation, evaluateCoachReminderJob, projectCoachAvailability, validateCoachReminderNotification,
  buildTeamCoachReminderConfiguration, isCoachReminderSquadPicked, coachReminderLocalStart,
} from '../src/lib/coach-reminder-policy.js'
import { processCoachReminderJob, deliverCoachReminderNotification } from '../netlify/functions/lib/_coach-reminder-worker.js'

test('local kickoff conversion rejects invalid, ambiguous and nonexistent times across London DST',()=>{
  assert.equal(coachReminderLocalStart('2026-10-10','13:00:00'),'2026-10-10T12:00:00.000Z')
  assert.equal(coachReminderLocalStart('2026-12-10','13:00'),'2026-12-10T13:00:00.000Z')
  for(const [date,time] of [['2026-10-25','01:30'],['2026-03-29','01:30'],['2026-02-30','12:00'],['2026-10-10','24:00'],['','']]) {
    assert.equal(coachReminderLocalStart(date,time),'')
  }
})

function fixture() {
  const policy = { id: 'policy', revision: 'p1', clubId: 'club', teamId: 'team', optedIn: true, configuredAt: '2026-10-01T09:00:00Z', effectiveFrom: '2026-10-01T09:00:00Z',
    options: { ...DEFAULT_COACH_REMINDER_POLICY, reminderEnabled: true, reminderAfterHours: 24, deadlineMode: 'automatic_not_attending', deadlineAfterHours: 48, squadReminderEnabled: true, squadDaysBefore: 2 } }
  const event = { id: 'event', revision: 'e1', clubId: 'club', teamId: 'team', kind: 'MATCH', status: 'scheduled',
    startsAt: '2026-10-08T14:00:00Z', timeZone: 'Europe/London', createdAt: '2026-10-01T10:00:00Z' }
  const invitation = { id: 'invite', revision: 'i1', responseRevision: 'r1', clubId: 'club', teamId: 'team', eventId: 'event',
    playerId: 'player', memberActive: true, parentResponderActive:true, createdAt: '2026-10-01T10:00:00Z', deliveredAt: '2026-10-01T12:00:00Z', responseStatus: 'pending' }
  const recipients = [{ id: 'parent', clubId: 'club', teamId: 'team', playerId: 'player', audience: 'availability', active: true, authorized: true, notificationsEnabled: true }]
  return { policy, event, invitation, recipients, now: '2026-10-04T12:00:00Z', authorityActive: true, squadSelected: false }
}
const planned = context => planAvailabilityAutomation(context)
const reminder = context => planned(context).find(job => job.action === 'availability_reminder')
const deadline = context => planned(context).find(job => job.action === 'availability_deadline')

test('automatic deadlines require linked Parent authority independently of notification preferences',()=>{
  const f=fixture(),job=deadline(f)
  const effect=evaluateCoachReminderJob({...f,job}).effect
  f.recipients=[]
  assert.equal(evaluateCoachReminderJob({...f,job}).effect.status,'unavailable')
  for(const active of [false,undefined]){
    f.invitation.parentResponderActive=active
    assert.equal(evaluateCoachReminderJob({...f,job}).reason,'no_linked_parent')
    assert.deepEqual(projectCoachAvailability({...f,effect}),{status:'pending',provenance:'no_response',planningExcluded:false,automatic:false})
  }
  for(const status of ['available','unavailable']){
    f.invitation.responseStatus=status;f.invitation.responseSource='coach'
    const projection=projectCoachAvailability({...f,effect})
    assert.equal(projection.status,status);assert.equal(projection.provenance,'coach');assert.equal(projection.automatic,false)
  }
})

test('all automation starts off; configuration is strict and offers all three modes', () => {
  const f = fixture()
  f.policy.options = normalizeCoachReminderPolicy()
  assert.deepEqual(planned(f), [])
  assert.deepEqual(planSquadAutomation(f), [])
  for (const patch of [{ reminderEnabled: 'false' }, { squadReminderEnabled: 1 }, { deadlineMode: 'hard' },
    { reminderEnabled: true, reminderAfterHours: '' }, { reminderAfterHours: false }, { reminderAfterHours: 1.5 },
    { deadlineAfterHours: 0 }, { squadDaysBefore: 31 }, { reminderAfterHours: 721 },
    { reminderEnabled: true, deadlineMode: 'exclude_from_planning', reminderAfterHours: 48, deadlineAfterHours: 48 }]) {
    assert.throws(() => normalizeCoachReminderPolicy(patch))
  }
  for (const deadlineMode of ['reminders_only', 'exclude_from_planning', 'automatic_not_attending']) {
    assert.equal(normalizeCoachReminderPolicy({ deadlineMode, deadlineAfterHours: 48 }).deadlineMode, deadlineMode)
  }
  assert.equal(normalizeCoachReminderPolicy({ reminderAfterHours: '24' }).reminderAfterHours, 24)
})

test('blank timings cannot activate any option, and explicit opt-in is required for every job', () => {
  assert.equal(DEFAULT_COACH_REMINDER_POLICY.reminderAfterHours,null)
  for(const options of [{ reminderEnabled:true },{ deadlineMode:'automatic_not_attending' },{ squadReminderEnabled:true }]) {
    assert.throws(()=>buildTeamCoachReminderConfiguration({ options,optedIn:true }))
  }
  assert.throws(()=>buildTeamCoachReminderConfiguration({ options:DEFAULT_COACH_REMINDER_POLICY,optedIn:true }),/Choose at least one/)
  for(const patch of [{ optedIn:false },{ configuredAt:null },{ effectiveFrom:null },{ configuredAt:'2027-01-01T00:00:00Z' }]) {
    const f=fixture(),job=deadline(f);Object.assign(f.policy,patch)
    assert.deepEqual(planned(f),[]);assert.deepEqual(planSquadAutomation(f),[])
    assert.equal(evaluateCoachReminderJob({ ...f,job }).reason,'not_configured_or_opted_in')
  }
  const f=fixture();f.event.kickoffTimeTbc=true
  assert.deepEqual(planned(f),[]);assert.deepEqual(planSquadAutomation(f),[])
})

test('a saved picked squad stops team reminders; each response leaving awaiting stops individual reminders', () => {
  assert.equal(isCoachReminderSquadPicked([]),false)
  assert.equal(isCoachReminderSquadPicked([{ status:'undecided' },{ status:'not_selected' }]),false)
  assert.equal(isCoachReminderSquadPicked([{ status:'selected' }]),true)
  const f=fixture(),job=planSquadAutomation(f)[0]
  f.now=job.dueAt;f.squadSelected=isCoachReminderSquadPicked([{ status:'selected' }])
  assert.equal(evaluateCoachReminderJob({ ...f,job }).reason,'squad_selected')
})

test('immutable first confirmed delivery starts the elapsed clock; queue creation does not', () => {
  const f = fixture()
  assert.deepEqual(planned(f).map(job => [job.action, job.dueAt]), [
    ['availability_reminder', '2026-10-02T12:00:00.000Z'], ['availability_deadline', '2026-10-03T12:00:00.000Z'],
  ])
  assert.deepEqual(planned(f), planned(f), 'Repeat enrolment and retries have identical keys')
  f.invitation.latestResentAt = '2026-10-03T12:00:00Z'
  assert.equal(reminder(f).dueAt, '2026-10-02T12:00:00.000Z')
  f.invitation.deliveredAt = ''
  assert.deepEqual(planned(f), [])
})

test('only MATCH and occurrence-specific TRAINING invitations can enrol, never account joining', () => {
  for (const kind of ['ACCOUNT_JOIN', 'assessment', 'MATCHDAY', '', undefined]) {
    const f = fixture(); f.event.kind = kind
    assert.deepEqual(planned(f), [])
  }
  const f = fixture(); f.event.kind = 'TRAINING'
  assert.deepEqual(planned(f), [], 'Training without an occurrence is invalid')
  f.event.occurrenceDate = f.invitation.occurrenceDate = '2026-10-08'
  assert.equal(planned(f).length, 2)
  assert.deepEqual(planSquadAutomation(f), [], 'Squad reminders apply only to matches')
  const other = structuredClone(f); other.event.occurrenceDate = other.invitation.occurrenceDate = '2026-10-15'
  assert.notEqual(reminder(other).key, reminder(f).key)
})

test('no retroactive enrolment, stale delivery, removed player, or already answered invitation', () => {
  for (const update of [f => { f.invitation.createdAt = '2026-09-30T12:00:00Z' },
    f => { f.invitation.deliveredAt = '2026-09-30T12:00:00Z' }, f => { f.invitation.memberActive = false },
    f => { f.invitation.cancelled = true }, f => { f.invitation.revoked = true },
    f => { f.invitation.teamId = 'other' }, f => { f.policy.teamId = 'other' },
    f => { f.invitation.responseStatus = 'available' }, f => { f.invitation.responseStatus = 'unavailable' },
    f => { f.invitation.responseStatus = 'unexpected' },
    f => { f.invitation.responseRevision = '' }, f => { f.invitation.deliveredAt = '2027-01-01T00:00:00Z' }]) {
    const f = fixture(); update(f); assert.deepEqual(planned(f), [])
  }
  const f = fixture(); f.event.createdAt = '2026-09-30T12:00:00Z'
  assert.deepEqual(planSquadAutomation(f), [])
  assert.throws(() => planned({ ...f, now: '' }), /clock/)
  assert.throws(() => planned({ ...f, policy: { ...f.policy, revision: '' } }), /persisted/)
  f.invitation.responseStatus='maybe'
  assert.deepEqual(planned(f).map(job=>job.action),['availability_deadline'],'An early Maybe stops reminders but retains the strict planning deadline')
})

test('past, started, cancelled, deleted, and closed events cannot enrol or run', () => {
  for (const change of [f => { f.event.startsAt = f.now }, f => { f.event.cancelled = true },
    f => { f.event.deleted = true }, ...['cancelled', 'completed', 'full_time', 'postponed', 'deleted'].map(status => f => { f.event.status = status })]) {
    const f = fixture(); const job = deadline(f); change(f)
    assert.deepEqual(planned(f), [])
    assert.equal(evaluateCoachReminderJob({ ...f, job }).state, 'skipped')
  }
  const f = fixture(); f.event.startsAt = '2026-10-02T11:59:59Z'; f.now = '2026-10-01T13:00:00Z'
  assert.deepEqual(planned(f), [], 'Do not schedule a deadline or reminder after the event starts')
})

test('execution checks current authority, policy, event, invitation, membership, and occurrence', () => {
  for (const change of [f => { f.authorityActive = false }, f => { f.policy.revision = 'p2' },
    f => { f.policy.options.reminderEnabled = false }, f => { f.policy.clubId = 'other' },
    f => { f.event.revision = 'e2' }, f => { f.event.startsAt = '2026-10-10T14:00:00Z' },
    f => { f.event.teamId = 'other' }, f => { f.event.occurrenceDate = '2026-10-09' },
    f => { f.invitation.id = 'replacement' }, f => { f.invitation.revision = 'i2' },
    f => { f.invitation.memberActive = false }, f => { f.invitation.revoked = true },
    f => { f.invitation.playerId = 'other' }, f => { f.invitation.deliveredAt = '2026-10-02T12:00:00Z' },
    f => { f.invitation.createdAt = '2026-09-01T12:00:00Z' }]) {
    const f = fixture(); const job = reminder(f); change(f)
    const result = evaluateCoachReminderJob({ ...f, job, now: '2026-10-02T13:00:00Z' })
    assert.equal(result.state, 'skipped'); assert.deepEqual(result.notifications, []); assert.equal(result.effect, null)
  }
})

test('not due is pending; reminders notify only eligible opted-in recipients, once each', () => {
  const f = fixture(); const job = reminder(f)
  assert.equal(evaluateCoachReminderJob({ ...f, job, now: '2026-10-02T11:59:59Z' }).state, 'pending')
  const parent = f.recipients[0]
  f.recipients.push({ ...parent }, ...[
    { active: false }, { authorized: false }, { notificationsEnabled: false }, { teamId: 'other' },
    { clubId: 'other' }, { playerId: 'other' }, { audience: 'coach' }, { id: '' },
  ].map((patch, i) => ({ ...parent, id: `bad-${i}`, ...patch })))
  const result = evaluateCoachReminderJob({ ...f, job, now: job.dueAt })
  assert.equal(result.state, 'completed'); assert.equal(result.effect, null)
  assert.equal(result.notifications.length, 1); assert.equal(result.notifications[0].recipientId, 'parent')
  for (const responseStatus of ['available', 'unavailable', 'maybe', 'unknown']) {
    f.invitation.responseStatus = responseStatus
    assert.equal(evaluateCoachReminderJob({ ...f, job, now: job.dueAt }).state, 'skipped')
  }
})

test('interrupted scheduler skips overdue reminders after the deadline', () => {
  const f = fixture()
  assert.equal(evaluateCoachReminderJob({ ...f, job: reminder(f) }).reason, 'deadline_passed')
  f.policy.options.deadlineMode = 'reminders_only'
  assert.equal(evaluateCoachReminderJob({ ...f, job: reminder(f) }).notifications.length, 1)
  assert.equal(planned(f).length, 1)
})

test('three strictness options produce separate planning effects, never an invented parent answer', () => {
  const f = fixture(); const job = deadline(f)
  const original = structuredClone(f.invitation)
  const result = evaluateCoachReminderJob({ ...f, job })
  assert.equal(result.effect.status, 'unavailable')
  assert.equal(result.effect.provenance, 'coach_deadline_automation')
  assert.equal(result.notifications.length, 1)
  assert.deepEqual(f.invitation, original)
  f.policy.options.deadlineMode = 'exclude_from_planning'
  const excluded = evaluateCoachReminderJob({ ...f, job })
  assert.equal(excluded.effect.status, null); assert.equal(excluded.effect.planningExcluded, true)
  assert.deepEqual(excluded.notifications, [])
  f.policy.options.deadlineMode = 'reminders_only'
  assert.equal(evaluateCoachReminderJob({ ...f, job }).reason, 'disabled')
})

test('Maybe is an explicit answer: deadline may exclude planning but never overwrite it', () => {
  const f = fixture(); const job = deadline(f)
  f.invitation.responseStatus = 'maybe'; f.invitation.responseSource = 'parent'; f.invitation.responseRevision = 'r2'
  const result = evaluateCoachReminderJob({ ...f, job })
  assert.equal(result.effect.status, null); assert.deepEqual(result.notifications, [])
  assert.deepEqual(projectCoachAvailability({ ...f, effect: result.effect }), {
    status: 'maybe', provenance: 'parent', planningExcluded: true, automatic: false,
  })
  for (const responseStatus of ['available', 'unavailable', 'unexpected']) {
    f.invitation.responseStatus = responseStatus
    assert.equal(evaluateCoachReminderJob({ ...f, job }).effect, null)
  }
})

test('late explicit replies win immediately; changes to event/policy/invitation invalidate old effects', () => {
  const f = fixture(); const effect = evaluateCoachReminderJob({ ...f, job: deadline(f) }).effect
  assert.deepEqual(projectCoachAvailability({ ...f, effect }), {
    status: 'unavailable', provenance: 'coach_deadline_automation', planningExcluded: true, automatic: true,
  })
  for (const responseStatus of ['available', 'unavailable', 'maybe']) {
    const latest = structuredClone(f)
    Object.assign(latest.invitation, { responseStatus, responseSource: 'parent', responseRevision: 'r2' })
    assert.deepEqual(projectCoachAvailability({ ...latest, effect }), {
      status: responseStatus, provenance: 'parent', planningExcluded: responseStatus !== 'available', automatic: false,
    })
  }
  for (const change of [f => { f.event.revision = 'e2' }, f => { f.policy.revision = 'p2' },
    f => { f.invitation.revision = 'i2' }, f => { f.invitation.memberActive = false },
    f => { f.invitation.teamId = 'other' }, f => { f.now = f.event.startsAt }]) {
    const latest = structuredClone(f); change(latest)
    assert.equal(projectCoachAvailability({ ...latest, effect }).automatic, false)
  }
})

test('elapsed hours are absolute across DST; squad days are local calendar days', () => {
  assert.equal(calendarDaysBefore('2026-03-30T14:00:00Z', 2, 'Europe/London'), '2026-03-28T15:00:00.000Z')
  assert.equal(calendarDaysBefore('2026-10-26T15:00:00Z', 2, 'Europe/London'), '2026-10-24T14:00:00.000Z')
  assert.equal(calendarDaysBefore('2026-03-30T14:00:00Z', 2, 'America/New_York'), '2026-03-28T14:00:00.000Z')
  assert.throws(() => calendarDaysBefore('2026-03-30T00:30:00Z', 1, 'Europe/London'), /nonexistent/)
  assert.throws(() => calendarDaysBefore('2026-10-26T01:30:00Z', 1, 'Europe/London'), /ambiguous/)
  assert.throws(() => calendarDaysBefore('2026-10-26T01:30:00Z', 1, ''), /timezone/)
  assert.throws(() => calendarDaysBefore('invalid', 1, 'Europe/London'), /explicit/)
  const f = fixture(); f.invitation.deliveredAt = '2026-10-24T12:00:00Z'; f.event.startsAt = '2026-10-30T12:00:00Z'; f.now = '2026-10-24T13:00:00Z'
  assert.equal(deadline(f).dueAt, '2026-10-26T12:00:00.000Z')
})

test('squad reminder fans out to every eligible coach in this team, never to parents or other teams', () => {
  const f = fixture(); const job = planSquadAutomation(f)[0]
  f.now = job.dueAt
  const coach = { id: 'coach-a', clubId: 'club', teamId: 'team', audience: 'coach', active: true, authorized: true, notificationsEnabled: true }
  f.recipients.push(coach, { ...coach, id: 'coach-b' }, { ...coach }, { ...coach, id: 'other', teamId: 'other' })
  assert.deepEqual(evaluateCoachReminderJob({ ...f, job }).notifications.map(row => row.recipientId), ['coach-a', 'coach-b'])
  f.squadSelected = true
  assert.equal(evaluateCoachReminderJob({ ...f, job }).reason, 'squad_selected')
  delete f.squadSelected
  assert.equal(evaluateCoachReminderJob({ ...f, job }).reason, 'squad_completion_unknown')
  f.event.startsAt = ''
  assert.deepEqual(planSquadAutomation(f), [], 'TBC starts cannot silently invent a kickoff time')
})

test('rescheduling changes keys, invalidates jobs and projections, and respects activation cutoff', () => {
  const f = fixture(); const oldJob = reminder(f); const oldSquad = planSquadAutomation(f)[0]
  f.event.revision = 'e2'; f.event.startsAt = '2026-10-09T14:00:00Z'
  assert.notEqual(reminder(f).key, oldJob.key)
  assert.equal(reminder(f).notificationKey, oldJob.notificationKey, 'A reschedule must not send the same invitation reminder twice')
  assert.notEqual(planSquadAutomation(f)[0].key, oldSquad.key)
  assert.equal(evaluateCoachReminderJob({ ...f, job: oldJob }).state, 'skipped')
  f.policy.effectiveFrom = '2026-10-08T16:00:00Z'; f.event.createdAt = '2026-10-08T17:00:00Z'
  assert.deepEqual(planSquadAutomation(f), [], 'Do not catch up a newly configured squad threshold')
})

test('altered due times, keys, and old-record jobs are rejected even when supplied directly to the worker', () => {
  const f = fixture(); const job = deadline(f)
  for (const patch of [{ key: 'invented' }, { notificationKey: 'invented' }, { dueAt: '2026-10-02T12:00:00Z' }, { action: 'account_join' }]) {
    assert.equal(evaluateCoachReminderJob({ ...f, job: { ...job, ...patch } }).state, 'skipped')
  }
})

test('delivery revalidation suppresses late answers, opt-out, cancellation, reschedule and revoked scope', () => {
  const f = fixture(); const job = deadline(f)
  const decision = evaluateCoachReminderJob({ ...f, job })
  const notification = { ...decision.notifications[0], jobKey: job.key, action: job.action, effectProvenance: decision.effect.provenance,responseRevision:f.invitation.responseRevision }
  assert.equal(validateCoachReminderNotification({ ...f, job, notification }).valid, true)
  for (const change of [f => { f.invitation.responseStatus = 'available' }, f => { f.invitation.responseStatus = 'maybe' },
    f => { f.recipients[0].notificationsEnabled = false }, f => { f.recipients[0].active = false },
    f => { f.event.cancelled = true }, f => { f.event.revision = 'e2' }, f => { f.policy.revision = 'p2' },
    f => { f.invitation.memberActive = false }, f => { f.invitation.responseRevision='new reset to awaiting' }, f => { f.authorityActive = false }, f => { f.now = f.event.startsAt }]) {
    const latest = structuredClone(f); change(latest)
    assert.equal(validateCoachReminderNotification({ ...latest, job, notification }).valid, false)
  }
  assert.equal(validateCoachReminderNotification({ ...f, job, notification: { ...notification, jobKey: 'other' } }).valid, false)
  assert.equal(validateCoachReminderNotification({ ...f, job, notification: { ...notification, effectProvenance: 'parent' } }).valid, false)
})

function memoryRepository(context, job) {
  const data = { job: { ...job, state: 'pending' }, effects: new Map(), notifications: new Map() }
  let tail = Promise.resolve()
  const repository = {
    async withLockedJob(key, callback) {
      let release
      const previous = tail
      tail = new Promise(resolve => { release = resolve })
      await previous
      const before = structuredClone(data)
      try {
        return await callback({
          getJob: async () => key === data.job.key ? data.job : null,
          loadCurrentContext: async () => context,
          insertEffectOnce: async effect => { if (!data.effects.has(effect.jobKey)) data.effects.set(effect.jobKey, effect) },
          insertNotificationOnce: async notification => {
            if (repository.interrupt) throw new Error('Interrupted transaction')
            if (!data.notifications.has(notification.idempotencyKey)) data.notifications.set(notification.idempotencyKey, notification)
          },
          finish: async completion => { Object.assign(data.job, completion) },
        })
      } catch (error) { Object.assign(data, before); throw error } finally { release() }
    },
  }
  return { data, repository }
}

test('concurrent/repeated job execution commits one effect and one notification', async () => {
  const context = fixture(); const job = deadline(context); const { data, repository } = memoryRepository(context, job)
  const results = await Promise.all(Array.from({ length: 12 }, () => processCoachReminderJob({ repository, jobKey: job.key, now: context.now })))
  assert.equal(data.effects.size, 1); assert.equal(data.notifications.size, 1)
  assert.equal(results.filter(result => result.duplicate).length, 11)
  assert.equal((await processCoachReminderJob({ repository, jobKey: 'missing', now: context.now })).state, 'missing')
})

test('interruption rolls back effect and outbox together; retry uses the original identity', async () => {
  const context = fixture(); const job = deadline(context); const { data, repository } = memoryRepository(context, job)
  repository.interrupt = true
  await assert.rejects(processCoachReminderJob({ repository, jobKey: job.key, now: context.now }), /Interrupted/)
  assert.equal(data.effects.size, 0); assert.equal(data.notifications.size, 0); assert.equal(data.job.state, 'pending')
  repository.interrupt = false
  await processCoachReminderJob({ repository, jobKey: job.key, now: context.now })
  assert.equal(data.effects.size, 1); assert.equal(data.notifications.size, 1)
})

test('late response or opt-out just before delivery suppresses a queued notification', async () => {
  let skipped; let sends = 0
  const repository = {
    claimNotification: async () => ({ notification: { idempotencyKey: 'key' }, leaseToken: 'lease' }),
    validateNotification: async () => ({ valid: false, reason: 'late_response_or_opt_out' }),
    skipNotification: async (_, reason) => { skipped = reason },
  }
  assert.equal((await deliverCoachReminderNotification({ repository, transport: { send: async () => { sends++ } }, notificationKey: 'key', now: fixture().now })).state, 'skipped')
  assert.equal(sends, 0); assert.equal(skipped, 'late_response_or_opt_out')
})

test('accepted transport uses the durable key; uncertain or interrupted delivery is held for reconciliation', async () => {
  let hold; let accepted; const sentKeys = []
  const repository = {
    claimNotification: async () => ({ notification: { idempotencyKey: 'durable-key' }, leaseToken: 'lease' }),
    validateNotification: async () => ({ valid: true }),
    acceptNotification: async (...args) => { accepted = args },
    holdNotification: async (...args) => { hold = args },
  }
  const args = { repository, notificationKey: 'durable-key', now: fixture().now }
  await deliverCoachReminderNotification({ ...args, transport: { send: async ({ idempotencyKey }) => { sentKeys.push(idempotencyKey); return { accepted: true, providerId: 'receipt' } } } })
  assert.deepEqual(sentKeys, ['durable-key']); assert.equal(accepted[1], 'lease')
  await assert.rejects(deliverCoachReminderNotification({ ...args, transport: { send: async () => ({}) } }), /uncertain/)
  assert.deepEqual(hold, ['durable-key', 'lease', 'delivery_requires_reconciliation'])
  repository.acceptNotification = async () => { throw new Error('Interrupted after provider acceptance') }
  await assert.rejects(deliverCoachReminderNotification({ ...args, transport: { send: async () => ({ accepted: true, providerId: 'receipt' }) } }), /Interrupted/)
  assert.equal(hold[2], 'delivery_requires_reconciliation')
  repository.claimNotification = async () => null
  assert.equal((await deliverCoachReminderNotification(args)).state, 'not_claimed')
})
