import { MATCH_DAY_OFFLINE_MAX_AGE, MATCH_DAY_OUTBOX_LIMIT, projectMatchDayCommand } from '../../mobile-core/src/matchDayOutboxCore.js'

const ACTIONS = new Set(['start', 'timer', 'extended', 'score', 'goal', 'event', 'correct-goal', 'void-goal', 'shootout', 'void-shootout', 'request-review'])
const TIMER_ACTIONS = new Set(['pause', 'hydration', 'half_time', 'resume', 'full_time'])
const EXTENDED_ACTIONS = new Set(['normal_time_complete', 'start_extra_time', 'extra_time_half_time', 'start_extra_time_second_half', 'complete_extra_time', 'start_penalties'])

function scoreSide(match, side) {
  return (side === 'club') === (match.homeAway !== 'away') ? 'homeScore' : 'awayScore'
}

function shootoutSide(match, side) {
  return scoreSide(match, side) === 'homeScore' ? 'homeShootoutScore' : 'awayShootoutScore'
}

export function appendParentScorerCommand(journal, { id, kind, payload = {}, capturedAt = new Date().toISOString() }) {
  if (!journal?.baseMatch?.id || !journal.baseMatch.updatedAt) throw new Error('Refresh this fixture online before recording on this device.')
  const captured = Date.parse(capturedAt)
  const verified = Date.parse(journal.verifiedAt)
  if (!Number.isFinite(captured) || !Number.isFinite(verified) || captured - verified > MATCH_DAY_OFFLINE_MAX_AGE) throw new Error('This saved fixture is over 24 hours old. Refresh it online before recording.')
  if (!id || journal.pending.some(command => command.id === id)) throw new Error('This action already exists.')
  if (journal.pending.length >= MATCH_DAY_OUTBOX_LIMIT) throw new Error('The saved action queue is full. Reconnect to sync before recording more.')
  if (!ACTIONS.has(kind) || kind === 'timer' && !TIMER_ACTIONS.has(payload.action) || kind === 'extended' && !EXTENDED_ACTIONS.has(payload.action)) throw new Error('This match action is unavailable.')
  if (kind === 'score' && ![payload.homeScore, payload.awayScore].every(value => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 999)) throw new Error('Enter valid whole-number scores.')
  const previous = journal.pending.at(-1)
  if (previous && captured < Date.parse(previous.capturedAt)) throw new Error('The device clock changed. Check its time before recording another action.')
  if (kind === 'request-review' && journal.pending.some(command => command.kind === 'request-review')) throw new Error('This match has already been sent for review on this device.')
  if (journal.pending.some(command => command.kind === 'request-review')) throw new Error('This match has been sent to the Coach for review.')
  const command = { id, matchId: journal.baseMatch.id, kind, payload: JSON.parse(JSON.stringify(payload)), capturedAt,
    expectedUpdatedAt: previous ? null : journal.baseMatch.updatedAt, previousCommandId: previous?.id || null }
  return { ...journal, pending: [...journal.pending, command], error: '' }
}

export function projectParentScorerCommand(match, command) {
  const { kind, payload, capturedAt, id } = command
  if (kind === 'start') return projectMatchDayCommand(match, { kind: 'timer', payload: { action: 'start' }, capturedAt, id })
  if (kind === 'timer') return projectMatchDayCommand(match, command)
  if (kind === 'goal') return projectMatchDayCommand(match, { ...command, kind: 'event', payload: { ...payload, eventType: 'goal' } })
  if (kind === 'event' || kind === 'score') return projectMatchDayCommand(match, command)
  const next = { ...match, events: [...(match.events || [])], shootoutEvents: [...(match.shootoutEvents || [])] }
  if (kind === 'extended') {
    const action = payload.action
    const state = {
      normal_time_complete: [match.status, 'normal_time_complete', 'paused'],
      start_extra_time: ['extra_time', 'extra_time_first_half', 'running'],
      extra_time_half_time: ['extra_time', 'extra_time_half_time', 'half_time'],
      start_extra_time_second_half: ['extra_time', 'extra_time_second_half', 'running'],
      complete_extra_time: ['extra_time', 'extra_time_complete', 'paused'],
      start_penalties: ['penalties', 'penalties', 'paused'],
    }[action]
    if (state) Object.assign(next, { status: state[0], currentMatchPhase: state[1], timerStatus: state[2],
      timerStartedAt: state[2] === 'running' ? capturedAt : '', timerPausedAt: state[2] === 'running' ? '' : capturedAt })
  } else if (kind === 'correct-goal') {
    const target = next.events.find(event => event.id === payload.eventId)
    if (target && !target.voidedAt) {
      const previousSide = scoreSide(next, target.teamSide)
      const updatedSide = scoreSide(next, payload.goal?.teamSide || target.teamSide)
      if (previousSide !== updatedSide) {
        next[previousSide] = Math.max(0, Number(next[previousSide] || 0) - 1)
        next[updatedSide] = Number(next[updatedSide] || 0) + 1
      }
      next.events = next.events.map(event => event.id === target.id ? { ...event, ...payload.goal, pendingSync: true } : event)
    }
  } else if (kind === 'void-goal') {
    const target = next.events.find(event => event.id === payload.eventId)
    if (target && !target.voidedAt) {
      const side = scoreSide(next, target.teamSide)
      next[side] = Math.max(0, Number(next[side] || 0) - 1)
      next.events = next.events.map(event => event.id === target.id ? { ...event, voidedAt: capturedAt, pendingSync: true } : event)
    }
  } else if (kind === 'shootout') {
    if (payload.outcome === 'scored') {
      const side = shootoutSide(next, payload.teamSide)
      next[side] = Number(next[side] || 0) + 1
    }
    next.shootoutEvents.push({ ...payload, id, pendingSync: true, createdAt: capturedAt })
  } else if (kind === 'void-shootout') {
    const target = next.shootoutEvents.find(event => event.id === payload.kickId)
    if (target && !target.voidedAt) {
      if (target.outcome === 'scored') {
        const side = shootoutSide(next, target.teamSide)
        next[side] = Math.max(0, Number(next[side] || 0) - 1)
      }
      next.shootoutEvents = next.shootoutEvents.map(event => event.id === target.id ? { ...event, voidedAt: capturedAt, pendingSync: true } : event)
    }
  } else if (kind === 'request-review') {
    next.pendingReview = true
  }
  return next
}

export function projectParentScorerOutbox(journal) {
  return (journal?.pending || []).reduce(projectParentScorerCommand, journal?.baseMatch || null)
}
