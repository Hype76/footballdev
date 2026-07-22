import {
  DEFAULT_MATCH_DURATION_MINUTES,
  isContinuousMatchClock,
  normalizeMatchDurationMinutes,
} from './matchday-model.js'

export const RUNNING_MATCH_TIMER_STATUSES = new Set(['live', 'second_half', 'extra_time', 'penalties'])
export const FROZEN_MATCH_TIMER_STATUSES = new Set(['paused', 'half_time', 'hydration', 'full_time'])
export const RESUMABLE_MATCH_TIMER_STATUSES = new Set(['paused', 'half_time', 'hydration'])
export const DEFAULT_MATCH_HALF_SECONDS = (DEFAULT_MATCH_DURATION_MINUTES / 2) * 60

const NON_CLOCK_MATCH_STATUSES = new Set(['scheduled', 'scorer_request', 'postponed', 'cancelled'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeFiniteTimestamp(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null
}

function normalizeNonNegativeInteger(value) {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? Math.max(Math.floor(numberValue), 0) : 0
}

function getTimestampMs(value) {
  const timestamp = new Date(value || 0).getTime()
  return Number.isNaN(timestamp) || timestamp <= 0 ? null : timestamp
}

export function getMatchHalfSeconds(match = {}) {
  return (normalizeMatchDurationMinutes(match.matchDurationMinutes ?? match.match_duration_minutes) / 2) * 60
}

function getMatchTimerPeriodFloorSeconds(status, match) {
  if (isContinuousMatchClock(match)) {
    return 0
  }

  return normalizeText(status) === 'second_half' ? getMatchHalfSeconds(match) : 0
}

export function getMatchTimerState(match = {}, now = Date.now()) {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const status = normalizeText(match.status) || 'scheduled'
  const timerStatus = normalizeText(match.timerStatus ?? match.timer_status)
  const storedElapsedSeconds = normalizeNonNegativeInteger(match.timerElapsedSeconds ?? match.timer_elapsed_seconds)
  const periodFloorSeconds = getMatchTimerPeriodFloorSeconds(status, match)
  const flooredStoredElapsedSeconds = Math.max(storedElapsedSeconds, periodFloorSeconds)
  const timerStartedAtMs = getTimestampMs(match.timerStartedAt ?? match.timer_started_at)

  if (timerStatus === 'running') {
    if (!timerStartedAtMs || timerStartedAtMs > nowMs) {
      return {
        elapsedSeconds: flooredStoredElapsedSeconds,
        timerStatus,
        isRunning: true,
        isFrozen: false,
      }
    }

    return {
      elapsedSeconds: flooredStoredElapsedSeconds + Math.max(Math.floor((nowMs - timerStartedAtMs) / 1000), 0),
      timerStatus,
      isRunning: true,
      isFrozen: false,
    }
  }

  if (FROZEN_MATCH_TIMER_STATUSES.has(timerStatus)) {
    return {
      elapsedSeconds: flooredStoredElapsedSeconds,
      timerStatus,
      isRunning: false,
      isFrozen: true,
    }
  }

  if (NON_CLOCK_MATCH_STATUSES.has(status)) {
    return {
      elapsedSeconds: null,
      timerStatus: 'not_started',
      isRunning: false,
      isFrozen: false,
    }
  }

  if (RUNNING_MATCH_TIMER_STATUSES.has(status)) {
    const fallbackStartedAtMs = getTimestampMs(match.phaseStartedAt ?? match.phase_started_at ?? match.updatedAt ?? match.updated_at) ?? nowMs

    if (fallbackStartedAtMs > nowMs) {
      return {
        elapsedSeconds: null,
        timerStatus: 'not_started',
        isRunning: false,
        isFrozen: false,
      }
    }

    return {
      elapsedSeconds: periodFloorSeconds + Math.max(Math.floor((nowMs - fallbackStartedAtMs) / 1000), 0),
      timerStatus: 'running',
      isRunning: true,
      isFrozen: false,
    }
  }

  if (status === 'half_time' || status === 'full_time') {
    return {
      elapsedSeconds: storedElapsedSeconds,
      timerStatus: status,
      isRunning: false,
      isFrozen: true,
    }
  }

  return {
    elapsedSeconds: null,
    timerStatus: 'not_started',
    isRunning: false,
    isFrozen: false,
  }
}

export function createServerClockSample(clockSample = {}) {
  const { serverNowMs, sampledAtMs } = clockSample ?? {}
  const normalizedServerNowMs = normalizeFiniteTimestamp(serverNowMs)
  const normalizedSampledAtMs = normalizeFiniteTimestamp(sampledAtMs)

  if (!normalizedServerNowMs || !normalizedSampledAtMs) {
    return null
  }

  return {
    serverNowMs: normalizedServerNowMs,
    sampledAtMs: normalizedSampledAtMs,
  }
}

export function createServerClockSampleFromDateHeader(dateHeader, { sampledAtMs = Date.now() } = {}) {
  const serverNowMs = Date.parse(dateHeader || '')
  return createServerClockSample({ serverNowMs, sampledAtMs })
}

export function getServerSyncedNowMs(clockSample = null, now = Date.now()) {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const sample = createServerClockSample(clockSample)

  if (!sample) {
    return null
  }

  return Math.floor(sample.serverNowMs + Math.max(nowMs - sample.sampledAtMs, 0))
}

export function getMatchTimerElapsedSeconds(match = {}, now = Date.now()) {
  if (now === null) {
    return null
  }

  return getMatchTimerState(match, now).elapsedSeconds
}

export function getMatchTimerMinute(match = {}, now = Date.now()) {
  if (now === null) {
    return null
  }

  const status = normalizeText(match.status)
  if (NON_CLOCK_MATCH_STATUSES.has(status) || status === 'full_time') {
    return null
  }

  const elapsedSeconds = getMatchTimerElapsedSeconds(match, now)
  return elapsedSeconds === null ? null : Math.max(Math.floor(elapsedSeconds / 60) + 1, 1)
}

export function formatMatchTimerClock(match = {}, now = Date.now()) {
  if (now === null) {
    return 'Syncing clock...'
  }

  const elapsedSeconds = getMatchTimerElapsedSeconds(match, now)
  if (elapsedSeconds === null) {
    return '0:00'
  }

  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = String(elapsedSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function getMatchTimerDisplayLabel(match = {}) {
  return isContinuousMatchClock(match) ? 'Elapsed continuous clock' : 'Match timer'
}

export function isMatchTimerPaused(match = {}) {
  const state = getMatchTimerState(match)
  return RESUMABLE_MATCH_TIMER_STATUSES.has(state.timerStatus) || normalizeText(match.status) === 'half_time'
}

export function isMatchTimerRunning(match = {}) {
  return getMatchTimerState(match).isRunning
}
