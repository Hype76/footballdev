import { MATCH_DAY_OFFLINE_MAX_AGE, MATCH_DAY_OUTBOX_LIMIT, mergeMatchDayCommandSnapshot, projectMatchDayCommand } from '../../mobile-core/src/matchDayOutboxCore.js'
import { canFinishPenaltyShootout } from '../../../src/lib/matchday-extended-ops.js'

const ACTIONS = new Set(['start', 'timer', 'extended', 'score', 'goal', 'event', 'correct-goal', 'void-goal', 'shootout', 'void-shootout', 'request-review'])
const TIMER_ACTIONS = new Set(['pause', 'hydration', 'half_time', 'resume', 'full_time'])
const EXTENDED_ACTIONS = new Set(['normal_time_complete', 'start_extra_time', 'extra_time_half_time', 'start_extra_time_second_half', 'complete_extra_time', 'start_penalties'])
const REJECTED_SHOOTOUT_FINISH = 'Complete the penalty shootout with a clear winner before Full Time.'

export function describeSavedScorerAction(command) {
  const payload = command?.payload || {}
  const detail = payload.goal || payload
  const title = String(detail.eventType || payload.action || command?.kind || 'action').replaceAll('-', ' ').replaceAll('_', ' ')
  const parts = [title]
  if (detail.teamSide) parts.push(detail.teamSide === 'club' ? 'your team' : 'opponents')
  if (detail.minute != null) parts.push(`minute ${detail.minute}`)
  if (detail.scorerName || detail.playerName) parts.push(detail.scorerName || detail.playerName)
  if (detail.assistName) parts.push(`assist ${detail.assistName}`)
  if (detail.playerOnName) parts.push(`on ${detail.playerOnName}`)
  if (detail.outcome) parts.push(detail.outcome)
  if (command?.kind === 'score') parts.push(`${payload.homeScore} - ${payload.awayScore}`)
  if (payload.reason) parts.push(payload.reason)
  return parts.join(', ')
}

export function canReviewParentScorerActions(journal) {
  return journal?.errorCode === '40001' || (journal?.errorCode === 'P0001' && journal.pending?.[0]?.kind === 'start'
    && journal.error === 'This saved clock action predates the current clock. Review it before continuing.')
}

export function isRedundantParentStart(journal, latest) {
  return canReviewParentScorerActions(journal) && journal.pending?.[0]?.kind === 'start'
    && latest?.status === 'live' && latest?.currentMatchPhase === 'first_half' && latest?.timerStatus === 'running'
}

export function reviewParentScorerConflict(journal, latest, expectedIds, { removeRedundantStart = false } = {}) {
  if (!canReviewParentScorerActions(journal) || !journal.pending?.length) throw new Error('Sync saved actions first so the server can confirm whether they were applied.')
  if (!Array.isArray(expectedIds) || journal.pending.length !== expectedIds.length || journal.pending.some((command, index) => command.id !== expectedIds[index])) throw new Error('The saved actions changed. Review them again.')
  if (!latest?.isScorer || !latest.updatedAt || latest.id !== journal.baseMatch?.id || latest.clubId !== journal.baseMatch?.clubId || latest.teamId !== journal.baseMatch?.teamId || latest.concludedAt || ['full_time', 'cancelled', 'postponed'].includes(latest.status)) {
    throw new Error('Refresh the open match before reviewing saved actions.')
  }
  if (removeRedundantStart && !isRedundantParentStart(journal, latest)) throw new Error('The saved start cannot be removed for this match state.')
  if (!removeRedundantStart && isRedundantParentStart(journal, latest)) throw new Error('The match is already running. Review the saved start before continuing.')
  const pending = removeRedundantStart ? journal.pending.slice(1) : journal.pending
  return { ...journal, baseMatch: latest, error: '', errorCode: '', verifiedAt: new Date().toISOString(),
    pending: pending.map((command, index) => index === 0 ? { ...command, expectedUpdatedAt: latest.updatedAt, previousCommandId: null } : command) }
}

export function canRestoreRejectedShootout(journal) {
  return journal?.error?.includes(REJECTED_SHOOTOUT_FINISH)
    && journal.pending?.[0]?.kind === 'timer'
    && journal.pending[0].payload?.action === 'full_time'
    && journal.baseMatch?.currentMatchPhase === 'penalties'
    && journal.pending.slice(1).every(command => command.kind === 'request-review')
}

export function restoreRejectedShootout(journal) {
  if (!canRestoreRejectedShootout(journal)) throw new Error('The saved shootout actions need review before they can be changed.')
  return { ...journal, pending: [], error: '', errorCode: '' }
}

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
  if (kind === 'timer' && payload.action === 'full_time') {
    const visible = projectParentScorerOutbox(journal)
    if (visible?.currentMatchPhase === 'penalties' && !canFinishPenaltyShootout(visible)) {
      throw new Error('Record more shootout kicks until one team has a clear winner before finishing.')
    }
  }
  if (kind === 'score' && ![payload.homeScore, payload.awayScore].every(value => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 999)) throw new Error('Enter valid whole-number scores.')
  const previous = journal.pending.at(-1)
  if (previous && captured < Date.parse(previous.capturedAt)) throw new Error('The device clock changed. Check its time before recording another action.')
  if (kind === 'request-review' && journal.pending.some(command => command.kind === 'request-review')) throw new Error('This match has already been sent for review on this device.')
  if (journal.pending.some(command => command.kind === 'request-review')) throw new Error('This match has been sent to the Coach for review.')
  if (kind === 'goal' && (String(payload.minute ?? '').trim() === '' || !Number.isInteger(Number(payload.minute)) || Number(payload.minute) < 0)) {
    throw new Error('Enter a whole goal minute of 0 or more before recording the goal.')
  }
  const command = { id, matchId: journal.baseMatch.id, kind, payload: JSON.parse(JSON.stringify(payload)), capturedAt,
    expectedUpdatedAt: previous ? null : journal.baseMatch.updatedAt, previousCommandId: previous?.id || null }
  return { ...journal, pending: [...journal.pending, command], error: canReviewParentScorerActions(journal) ? journal.error : '' }
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
    const target = next.events.find(event => event.id === payload.eventId || event.requestId === payload.eventId)
    if (target && !target.voidedAt && target.eventStatus !== 'voided') {
      const previousSide = scoreSide(next, target.teamSide)
      const updatedSide = scoreSide(next, payload.goal?.teamSide || target.teamSide)
      if (previousSide !== updatedSide) {
        next[previousSide] = Math.max(0, Number(next[previousSide] || 0) - 1)
        next[updatedSide] = Number(next[updatedSide] || 0) + 1
      }
      next.events = next.events.map(event => event.id === target.id ? { ...event, ...payload.goal, pendingSync: true } : event)
    }
  } else if (kind === 'void-goal') {
    const target = next.events.find(event => event.id === payload.eventId || event.requestId === payload.eventId)
    if (target && !target.voidedAt && target.eventStatus !== 'voided') {
      const side = scoreSide(next, target.teamSide)
      next[side] = Math.max(0, Number(next[side] || 0) - 1)
      next.events = next.events.map(event => event.id === target.id ? { ...event, eventStatus: 'voided', voidedAt: capturedAt, pendingSync: true } : event)
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

export function mergeParentScorerAcknowledgement(baseMatch, command, result) {
  // Keep local command identities until later queued corrections have synced.
  const projected = projectParentScorerCommand(baseMatch, command)
  let events = projected.events || []
  if (result.savedEvent && ['goal', 'event', 'score', 'correct-goal'].includes(command.kind)) {
    const localId = command.kind === 'correct-goal' ? command.payload.eventId : command.id
    const previous = events.find(event => event.id === result.savedEvent.id || event.id === localId || event.requestId === localId)
    const requestId = ['goal', 'event', 'score'].includes(command.kind) ? command.id : previous?.requestId || ''
    events = [...events.filter(event => event.id !== command.id && event.requestId !== command.id && event.id !== result.savedEvent.id && event.id !== previous?.id), { ...result.savedEvent, requestId, pendingSync: false }]
  } else if (command.kind === 'void-goal') {
    events = events.map(event => event.id === command.payload.eventId || event.requestId === command.payload.eventId ? { ...event, pendingSync: false } : event)
  }
  return { ...mergeMatchDayCommandSnapshot(projected, result.match || {}), events }
}

export function getVisibleParentScorerMatch(match, journal) {
  if (!journal?.baseMatch) return match
  if (journal.pending?.length) return projectParentScorerOutbox(journal)
  if (Date.parse(journal.baseMatch.updatedAt) > Date.parse(match.updatedAt)) {
    const acknowledged = journal.baseMatch
    // Retain the confirmed score while the fixture refreshes. Authority and
    // participant availability still come from the current linked-player view.
    return { ...match, homeScore: acknowledged.homeScore, awayScore: acknowledged.awayScore, events: acknowledged.events }
  }
  return match
}
