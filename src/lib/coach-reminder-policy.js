// Shared JavaScript only: usable by the current Coach and Parent OTA runtimes.
// This module plans effects; it never writes a parent's answer or sends a message.
export const COACH_DEADLINE_MODES = Object.freeze({
  reminders_only: 'Reminders only',
  exclude_from_planning: 'Exclude unanswered or Maybe from planning after the deadline',
  automatic_not_attending: 'Automatically mark unanswered as not attending and notify',
})

export const DEFAULT_COACH_REMINDER_POLICY = Object.freeze({
  reminderEnabled: false,
  reminderAfterHours: null,
  deadlineMode: 'reminders_only',
  deadlineAfterHours: null,
  squadReminderEnabled: false,
  squadDaysBefore: null,
})

const explicitAnswers = new Set(['available', 'unavailable', 'maybe'])
const closedStates = new Set(['cancelled', 'completed', 'full_time', 'postponed', 'deleted'])
const ms = value => Date.parse(value || '')
const iso = value => new Date(value).toISOString()
const fail = message => { throw new Error(message) }

function integer(value, minimum, maximum, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') fail(`${label} is required.`)
  const number = Number(value)
  if (!Number.isInteger(number) || number < minimum || number > maximum) fail(`${label} must be a whole number from ${minimum} to ${maximum}.`)
  return number
}

export function normalizeCoachReminderPolicy(input = {}) {
  const value = { ...DEFAULT_COACH_REMINDER_POLICY, ...input }
  for (const field of ['reminderEnabled', 'squadReminderEnabled']) {
    if (typeof value[field] !== 'boolean') fail(`${field} must be true or false.`)
  }
  if (!Object.prototype.hasOwnProperty.call(COACH_DEADLINE_MODES, value.deadlineMode)) fail('Choose a recognised deadline option.')
  const normalized = {
    reminderEnabled: value.reminderEnabled,
    reminderAfterHours: optionalTiming(value.reminderAfterHours, value.reminderEnabled, 720, 'Reminder hours'),
    deadlineMode: value.deadlineMode,
    deadlineAfterHours: optionalTiming(value.deadlineAfterHours, value.deadlineMode !== 'reminders_only', 720, 'Deadline hours'),
    squadReminderEnabled: value.squadReminderEnabled,
    squadDaysBefore: optionalTiming(value.squadDaysBefore, value.squadReminderEnabled, 30, 'Squad reminder days'),
  }
  if (normalized.reminderEnabled && normalized.deadlineMode !== 'reminders_only'
    && normalized.reminderAfterHours >= normalized.deadlineAfterHours) fail('The reminder must be earlier than the deadline.')
  return normalized
}

function optionalTiming(value, required, maximum, label) {
  if (!required && (value === null || value === undefined || value === '')) return null
  return integer(value, 1, maximum, label)
}

export function buildTeamCoachReminderConfiguration({ options, optedIn }) {
  if (typeof optedIn !== 'boolean') fail('Choose whether to enable the team policy.')
  const normalized = normalizeCoachReminderPolicy(options)
  if (optedIn && !normalized.reminderEnabled && normalized.deadlineMode === 'reminders_only' && !normalized.squadReminderEnabled) {
    fail('Choose at least one automatic reminder or deadline option before enabling the team policy.')
  }
  return { options: normalized, optedIn }
}

// Persisted decisions are the stopping condition confirmed by Simon. Draft
// client selections are deliberately not passed into this predicate.
export function isCoachReminderSquadPicked(savedDecisions = []) {
  return savedDecisions.some(decision => decision.status === 'selected')
}

const policyReady = (policy, now) => policy.optedIn === true && Number.isFinite(ms(policy.configuredAt))
  && Number.isFinite(ms(policy.effectiveFrom)) && ms(policy.configuredAt) <= ms(now) && ms(policy.effectiveFrom) <= ms(now)

function localParts(timestamp, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]))
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map(key => Number(values[key]))
}

const partsTimestamp = ([year, month, day, hour, minute, second]) => Date.UTC(year, month - 1, day, hour, minute, second)

function uniqueLocalInstant(target, timeZone) {
  const candidates = new Set()
  for (const offsetHours of [-36, -12, 0, 12, 36]) {
    const probe = target + offsetHours * 3600000
    const offset = partsTimestamp(localParts(probe, timeZone)) - probe
    const candidate = target - offset
    if (partsTimestamp(localParts(candidate, timeZone)) === target) candidates.add(candidate)
  }
  return candidates.size === 1 ? iso([...candidates][0]) : ''
}

export function coachReminderLocalStart(date, time, timeZone = 'Europe/London') {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(`${date}T${time}`)
  if (!match) return ''
  const parts=match.slice(1).map(value=>Number(value || 0)),target=partsTimestamp(parts)
  const probe=new Date(target)
  if (probe.getUTCFullYear()!==parts[0] || probe.getUTCMonth()+1!==parts[1] || probe.getUTCDate()!==parts[2]
    || parts[3]>23 || parts[4]>59 || parts[5]>59) return ''
  return uniqueLocalInstant(target,timeZone)
}

// Calendar days preserve the event's local wall time across DST. An ambiguous or
// nonexistent local time is blocked for review, rather than silently picking one.
export function calendarDaysBefore(startsAt, days, timeZone) {
  integer(days, 1, 30, 'Squad reminder days')
  if (!Number.isFinite(ms(startsAt)) || !timeZone) fail('An explicit event start and timezone are required.')
  const target = partsTimestamp(localParts(ms(startsAt), timeZone)) - days * 86400000
  const result=uniqueLocalInstant(target,timeZone)
  if (!result) fail('The squad reminder falls at an ambiguous or nonexistent local time. Choose an explicit time before scheduling.')
  return result
}

function supportedEvent(event) {
  return event && ['MATCH', 'TRAINING'].includes(event.kind)
    && event.id && event.clubId && event.teamId && event.revision
    && (event.kind !== 'TRAINING' || /^\d{4}-\d{2}-\d{2}$/.test(event.occurrenceDate || ''))
    && !event.kickoffTimeTbc && !event.cancelled && !event.deleted && !closedStates.has(event.status)
    && Number.isFinite(ms(event.startsAt))
}

function policySnapshot(policy) {
  if (!policy?.id || !policy.revision || !policy.clubId || !policy.teamId) fail('A persisted scoped policy revision is required.')
  return normalizeCoachReminderPolicy(policy.options)
}

const policyScopeMatches = (policy, event) => policy.clubId === event?.clubId && policy.teamId === event?.teamId

function matchesScope(left, right) {
  return left.clubId === right.clubId && left.teamId === right.teamId
    && left.eventId === right.eventId && (left.occurrenceDate || '') === (right.occurrenceDate || '')
}

function makeJob({ policy, event, invitation, action, dueAt }) {
  const scope = {
    clubId: event.clubId, teamId: event.teamId, eventId: event.id,
    occurrenceDate: event.occurrenceDate || '', playerId: invitation?.playerId || '',
  }
  // Structured encoding prevents collisions from punctuation in identifiers.
  const key = JSON.stringify(['coach-reminder-v1', policy.id, policy.revision, event.id,
    event.revision, scope.occurrenceDate, invitation?.id || '', invitation?.revision || '', action])
  const notificationKey = JSON.stringify(['coach-reminder-delivery-v1', policy.id, policy.revision, event.id,
    scope.occurrenceDate, invitation?.id || '', invitation?.revision || '', action])
  return {
    key, notificationKey, ...scope, kind: event.kind, action, dueAt,
    startsAt: event.startsAt, eventRevision: event.revision,
    policyId: policy.id, policyRevision: policy.revision,
    invitationId: invitation?.id || '', invitationRevision: invitation?.revision || '',
    deliveredAt: invitation?.deliveredAt || '',
  }
}

export function planAvailabilityAutomation({ policy, event, invitation, now }) {
  const options = policySnapshot(policy)
  if (!Number.isFinite(ms(now))) fail('An explicit clock is required.')
  if (!policyReady(policy, now)) return []
  if (!supportedEvent(event) || !policyScopeMatches(policy, event) || ms(event.startsAt) <= ms(now)) return []
  if (!invitation?.id || !invitation.revision || !invitation.playerId
    || !matchesScope(invitation, { ...event, eventId: event.id })
    || invitation.cancelled || invitation.revoked || invitation.memberActive !== true
    || !['pending','maybe'].includes(invitation.responseStatus) || !invitation.responseRevision) return []
  // Immutable first delivery is supplied by the delivery ledger. Resends do not
  // reset it. Neither old invitation records nor merely queued sends are enrolled.
  if (!Number.isFinite(ms(invitation.createdAt)) || ms(invitation.createdAt) < ms(policy.effectiveFrom)
    || !Number.isFinite(ms(invitation.deliveredAt)) || ms(invitation.deliveredAt) < ms(policy.effectiveFrom)
    || ms(invitation.deliveredAt) > ms(now)) return []
  const jobs = []
  const add = (action, hours) => {
    const dueAt = iso(ms(invitation.deliveredAt) + hours * 3600000)
    if (ms(dueAt) < ms(event.startsAt)) jobs.push(makeJob({ policy, event, invitation, action, dueAt }))
  }
  if (options.reminderEnabled && invitation.responseStatus === 'pending') add('availability_reminder', options.reminderAfterHours)
  if (options.deadlineMode !== 'reminders_only') add('availability_deadline', options.deadlineAfterHours)
  return jobs
}

export function planSquadAutomation({ policy, event, now }) {
  const options = policySnapshot(policy)
  if (!Number.isFinite(ms(now))) fail('An explicit clock is required.')
  if (!policyReady(policy, now)) return []
  if (!options.squadReminderEnabled || !supportedEvent(event) || !policyScopeMatches(policy, event) || event.kind !== 'MATCH'
    || ms(event.startsAt) <= ms(now) || !Number.isFinite(ms(event.createdAt))
    || ms(event.createdAt) < ms(policy.effectiveFrom)) return []
  const dueAt = calendarDaysBefore(event.startsAt, options.squadDaysBefore, event.timeZone)
  // Do not send a catch-up notification for a newly enabled policy.
  if (ms(dueAt) < ms(policy.effectiveFrom)) return []
  return [makeJob({ policy, event, action: 'squad_reminder', dueAt })]
}

function recipientList(recipients, job, audience) {
  const unique = new Map()
  for (const recipient of recipients || []) {
    if (!recipient?.id || recipient.active !== true || recipient.authorized !== true
      || recipient.clubId !== job.clubId || recipient.teamId !== job.teamId
      || recipient.audience !== audience || recipient.notificationsEnabled !== true) continue
    if (audience === 'availability' && recipient.playerId !== job.playerId) continue
    unique.set(recipient.id, { recipientId: recipient.id, audience,
      idempotencyKey: JSON.stringify([job.notificationKey, recipient.id]) })
  }
  return [...unique.values()]
}

export function evaluateCoachReminderJob({ job, policy, event, invitation, recipients = [], now, authorityActive, squadSelected }) {
  const skip = reason => ({ state: 'skipped', reason, effect: null, notifications: [] })
  const options = policySnapshot(policy)
  if (!Number.isFinite(ms(now)) || !Number.isFinite(ms(job?.dueAt))) fail('An explicit valid clock and due time are required.')
  if (authorityActive !== true) return skip('authority_removed')
  if (!policyReady(policy, now)) return skip('not_configured_or_opted_in')
  if (job.policyId !== policy.id || job.policyRevision !== policy.revision) return skip('policy_changed')
  if (!supportedEvent(event) || !policyScopeMatches(policy, event) || job.kind !== event.kind || job.eventId !== event.id
    || job.eventRevision !== event.revision || job.startsAt !== event.startsAt
    || !matchesScope(job, { ...event, eventId: event.id })) return skip('event_changed_or_closed')
  if (ms(now) >= ms(event.startsAt)) return skip('event_started')
  if (ms(now) < ms(job.dueAt)) return { state: 'pending', reason: 'not_due', effect: null, notifications: [] }
  if (job.action === 'availability_deadline' && options.deadlineMode === 'reminders_only') return skip('disabled')
  if (job.action === 'squad_reminder') {
    if (!options.squadReminderEnabled) return skip('disabled')
    const planned = planSquadAutomation({ policy, event, now }).find(item => item.key === job.key && item.notificationKey === job.notificationKey && item.dueAt === job.dueAt)
    if (!planned) return skip('job_not_enrolled')
    // The authoritative predicate is intentionally supplied by the integration.
    // Undefined does not mean unselected; the product decision must be explicit.
    if (typeof squadSelected !== 'boolean') return skip('squad_completion_unknown')
    if (squadSelected) return skip('squad_selected')
    return { state: 'completed', reason: 'squad_unselected', effect: null,
      notifications: recipientList(recipients, job, 'coach') }
  }
  if (!invitation || job.invitationId !== invitation.id || job.invitationRevision !== invitation.revision
    || job.deliveredAt !== invitation.deliveredAt || job.playerId !== invitation.playerId
    || !matchesScope(job, invitation) || invitation.memberActive !== true
    || invitation.cancelled || invitation.revoked) return skip('invitation_or_membership_changed')
  const planned = planAvailabilityAutomation({ policy, event,
    invitation: { ...invitation, responseStatus: 'pending' }, now })
    .find(item => item.key === job.key && item.notificationKey === job.notificationKey && item.dueAt === job.dueAt)
  if (!planned) return skip('job_not_enrolled')
  if (job.action === 'availability_reminder') {
    if (!options.reminderEnabled) return skip('disabled')
    if (explicitAnswers.has(invitation.responseStatus)) return skip('already_answered')
    if (invitation.responseStatus !== 'pending') return skip('response_unknown')
    // A delayed reminder must not follow a deadline's terminal notification.
    if (options.deadlineMode !== 'reminders_only'
      && ms(now) >= ms(invitation.deliveredAt) + options.deadlineAfterHours * 3600000) return skip('deadline_passed')
    return { state: 'completed', reason: 'unanswered', effect: null,
      notifications: recipientList(recipients, job, 'availability') }
  }
  if (job.action !== 'availability_deadline') return skip('unknown_action')
  if (options.deadlineMode === 'reminders_only') return skip('disabled')
  if (['available', 'unavailable'].includes(invitation.responseStatus)) return skip('already_answered')
  if (!['pending', 'maybe'].includes(invitation.responseStatus)) return skip('response_unknown')
  const automatic = options.deadlineMode === 'automatic_not_attending' && invitation.responseStatus === 'pending'
  if (options.deadlineMode === 'automatic_not_attending' && invitation.parentResponderActive !== true) return skip('no_linked_parent')
  return {
    state: 'completed', reason: automatic ? 'automatic_not_attending' : 'excluded_from_planning',
    effect: {
      jobKey: job.key, clubId: job.clubId, teamId: job.teamId, eventId: job.eventId,
      eventRevision: job.eventRevision, occurrenceDate: job.occurrenceDate, playerId: job.playerId,
      invitationId: job.invitationId, invitationRevision: job.invitationRevision,
      provenance: 'coach_deadline_automation', status: automatic ? 'unavailable' : null,
      planningExcluded: true, appliedAt: now, policyId: policy.id, policyRevision: policy.revision,
      responseRevision: invitation.responseRevision,
    },
    notifications: automatic ? recipientList(recipients, job, 'availability') : [],
  }
}

// Project the separate automation record at read time. A late explicit answer
// always wins and immediately restores planning eligibility when attending.
export function projectCoachAvailability({ event, invitation, effect, policy, now }) {
  const status = invitation?.responseStatus || 'pending'
  const explicit = explicitAnswers.has(status)
  const result = { status, provenance: explicit ? invitation.responseSource || 'explicit_response' : 'no_response',
    planningExcluded: status === 'unavailable', automatic: false }
  if (!effect || !policy || !policyReady(policy, now) || effect.provenance !== 'coach_deadline_automation' || !supportedEvent(event) || invitation?.memberActive !== true || invitation.cancelled || invitation.revoked
    || event.id !== effect.eventId || event.revision !== effect.eventRevision
    || !matchesScope(invitation, effect) || invitation.id !== effect.invitationId
    || invitation.revision !== effect.invitationRevision || invitation.playerId !== effect.playerId
    || effect.policyId !== policy?.id || effect.policyRevision !== policy?.revision
    || !Number.isFinite(ms(now)) || ms(now) >= ms(event.startsAt)
    || (invitation.responseRevision !== effect.responseRevision && status !== 'maybe')) return result
  if (explicit && status !== 'maybe') return result
  if (policy.options.deadlineMode === 'automatic_not_attending' && invitation.parentResponderActive !== true) return result
  if (!explicit && effect.status === 'unavailable') return {
    status: 'unavailable', provenance: 'coach_deadline_automation', planningExcluded: true, automatic: true,
  }
  // A late Maybe is still the parent's answer. It stops reminders and clears
  // automatic Not attending, but remains uncertain under the strict deadline.
  return { ...result, planningExcluded: effect.planningExcluded === true }
}

export function validateCoachReminderNotification({ notification, ...context }) {
  if (!notification || notification.jobKey !== context.job?.key || notification.action !== context.job.action) {
    return { valid: false, reason: 'notification_scope_changed' }
  }
  if(context.job.action!=='squad_reminder' && notification.responseRevision!==context.invitation?.responseRevision)return {valid:false,reason:'response_changed'}
  const decision = evaluateCoachReminderJob(context)
  const eligible = decision.notifications.find(item => item.idempotencyKey === notification.idempotencyKey
    && item.recipientId === notification.recipientId && item.audience === notification.audience)
  if (decision.state !== 'completed' || !eligible) return { valid: false, reason: decision.reason || 'recipient_changed' }
  if (notification.effectProvenance !== (decision.effect?.provenance || null)) return { valid: false, reason: 'effect_changed' }
  return { valid: true, reason: decision.reason }
}
