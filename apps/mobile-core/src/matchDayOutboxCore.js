import { getMatchTimerElapsedSeconds } from '../../../src/lib/matchday-timer.js'

export const MATCH_DAY_OUTBOX_LIMIT = 200
export const MATCH_DAY_OFFLINE_MAX_AGE = 24 * 60 * 60 * 1000
export const OFFLINE_MATCH_TIMER_ACTIONS = new Set(['start', 'pause', 'hydration', 'half_time', 'resume', 'full_time'])
const activeSyncs = new Set()

export function mergeMatchDayCommandSnapshot(baseMatch, result) {
  const previous = { ...baseMatch }
  // Explicit server nulls and false values must clear the previous camel-case values.
  for (const field of Object.keys(result)) {
    delete previous[field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())]
  }
  return { ...previous, ...result }
}

export function projectMatchDayCommand(match, command) {
  const next = { ...match, events: [...(match.events || [])] }
  const { kind, payload, capturedAt, id } = command
  if (kind === 'timer') {
    const action = payload.action
    const at = Date.parse(capturedAt)
    const elapsed = getMatchTimerElapsedSeconds(match, at)
    if (action === 'start') Object.assign(next, { status: 'live', currentMatchPhase: 'first_half', timerStatus: 'running', timerElapsedSeconds: 0, timerStartedAt: capturedAt, phaseStartedAt: capturedAt, timerPausedAt: '' })
    else if (action === 'resume') {
      const halfTime = match.status === 'half_time' || match.timerStatus === 'half_time'
      const fromFullTime = match.timerStatus === 'full_time'
      const status = halfTime ? 'second_half' : fromFullTime ? match.fullTimeResumeStatus || 'second_half' : match.status
      Object.assign(next, { status, currentMatchPhase: halfTime ? 'second_half' : fromFullTime ? status === 'live' ? 'first_half' : status : match.currentMatchPhase,
        timerStatus: 'running', timerElapsedSeconds: halfTime && match.clockMode !== 'continuous' ? Math.max(elapsed, Math.floor((match.matchDurationMinutes || 90) / 2) * 60) : elapsed,
        timerStartedAt: capturedAt, phaseStartedAt: capturedAt, timerPausedAt: '', fullTimeResumeStatus: '' })
    } else {
      Object.assign(next, { timerStatus: action === 'pause' ? 'paused' : action, timerElapsedSeconds: elapsed, timerStartedAt: '', timerPausedAt: capturedAt })
      if (action === 'half_time') Object.assign(next, { status: 'half_time', currentMatchPhase: 'half_time' })
      if (action === 'full_time') Object.assign(next, { status: 'full_time', currentMatchPhase: 'full_time', fullTimeResumeStatus: match.status === 'half_time' ? 'second_half' : match.status })
    }
  } else {
    if (kind === 'score') Object.assign(next, { homeScore: Number(payload.homeScore), awayScore: Number(payload.awayScore) })
    if (kind === 'event' && payload.eventType === 'goal') {
      const homeGoal = (payload.teamSide === 'club') === (match.homeAway !== 'away')
      next[homeGoal ? 'homeScore' : 'awayScore'] = Number(next[homeGoal ? 'homeScore' : 'awayScore'] || 0) + 1
    }
    next.events.push({ ...payload, id, requestId: id, eventType: kind === 'score' ? 'score_correction' : payload.eventType,
      homeScore: next.homeScore, awayScore: next.awayScore, createdAt: capturedAt, eventStatus: 'active', pendingSync: true })
  }
  return next
}

export function projectMatchDayOutbox(journal) {
  return (journal?.pending || []).reduce(projectMatchDayCommand, journal?.baseMatch || null)
}

export function appendMatchDayCommand(journal, { id, kind, payload, capturedAt = new Date().toISOString() }) {
  if (!journal?.baseMatch?.id || !journal.baseMatch.updatedAt) throw new Error('Refresh this fixture online before recording on this device.')
  const time = Date.parse(capturedAt)
  const verified = Date.parse(journal.verifiedAt)
  if (!Number.isFinite(time) || !Number.isFinite(verified) || time - verified > MATCH_DAY_OFFLINE_MAX_AGE) throw new Error('This saved fixture is over 24 hours old. Refresh it online before recording.')
  if (!id || journal.pending.some(command => command.id === id)) throw new Error('This action already exists.')
  if (journal.pending.length >= MATCH_DAY_OUTBOX_LIMIT) throw new Error('The saved action queue is full. Reconnect to sync before recording more.')
  if (!['event', 'score', 'timer'].includes(kind) || kind === 'timer' && !OFFLINE_MATCH_TIMER_ACTIONS.has(payload.action)) throw new Error('This action needs an online connection.')
  if (kind === 'score' && ![payload.homeScore, payload.awayScore].every(value => Number.isInteger(value) && value >= 0 && value <= 999)) throw new Error('Enter valid whole-number scores.')
  const previous = journal.pending.at(-1)
  if (previous && time < Date.parse(previous.capturedAt)) throw new Error('The device clock changed. Check its time before recording another action.')
  const command = { id, matchId: journal.baseMatch.id, kind, payload: JSON.parse(JSON.stringify(payload)), capturedAt,
    expectedUpdatedAt: previous ? null : journal.baseMatch.updatedAt, previousCommandId: previous?.id || null }
  return { ...journal, pending: [...journal.pending, command], error: '' }
}

// Persist before showing success. Reuse each command ID after an uncertain response.
export function createMatchDayOutbox({ read, update, send, key = '', onChange = () => {} }) {
  let syncing = false
  let stopped = false
  const publish = journal => { if (!stopped) onChange(journal) }
  return {
    start() { stopped = false },
    stop() { stopped = true },
    async load() { const journal = await read(); publish(journal); return journal },
    async refresh(match) {
      const journal = await update(current => {
        if (current?.pending?.length || Date.parse(match.updatedAt) < Date.parse(current?.baseMatch?.updatedAt)) return current
        return { baseMatch: match, pending: [], verifiedAt: new Date().toISOString(), error: '' }
      })
      publish(journal)
      return journal
    },
    async enqueue(input) {
      const journal = await update(current => appendMatchDayCommand(current, input))
      publish(journal)
      return journal
    },
    async discardPending(match) {
      if (syncing || key && activeSyncs.has(key)) throw new Error('A saved action is being checked. Wait for sync to finish before discarding.')
      const journal = await update(current => ({ ...current, baseMatch: match || current.baseMatch, pending: [], error: '' }))
      publish(journal)
      return journal
    },
    async sync() {
      if (syncing || stopped || key && activeSyncs.has(key)) return
      syncing = true
      if (key) activeSyncs.add(key)
      try {
        while (!stopped) {
          const journal = await read()
          const command = journal?.pending?.[0]
          if (!command) return
          try {
            const match = await send(command, journal.baseMatch)
            if (stopped) return
            const next = await update(current => {
              if (current?.pending?.[0]?.id !== command.id) throw new Error('The saved action queue changed. Reopen this fixture.')
              return { ...current, baseMatch: match, pending: current.pending.slice(1), error: '', verifiedAt: new Date().toISOString() }
            })
            publish(next)
          } catch (error) {
            if (stopped) return
            const next = await update(current => ({ ...current, error: error?.message || 'Waiting for a connection. Your actions remain saved on this device.' }))
            publish(next)
            return
          }
        }
      } finally { syncing = false; if (key) activeSyncs.delete(key) }
    },
  }
}
