import { getMatchTimerMinute } from './matchday-timer.js'

export const MATCH_DAY_EVENT_MINUTE_MIN = 0
export const MATCH_DAY_EVENT_MINUTE_MAX = 130
export const MATCH_DAY_EVENT_MINUTE_VALIDATION_MESSAGE = 'Choose a valid match minute before saving this event.'

function normalizeMinuteText(value) {
  return String(value ?? '').trim()
}

export function normalizeMatchDayEventMinute(value) {
  const minuteText = normalizeMinuteText(value)

  if (!minuteText) {
    return {
      minute: null,
      isValid: true,
      hasValue: false,
    }
  }

  const minute = Number(minuteText)
  const isValid =
    Number.isInteger(minute)
    && minute >= MATCH_DAY_EVENT_MINUTE_MIN
    && minute <= MATCH_DAY_EVENT_MINUTE_MAX

  return {
    minute: isValid ? minute : null,
    isValid,
    hasValue: true,
  }
}

export function assertValidMatchDayEventMinute(value) {
  const result = normalizeMatchDayEventMinute(value)

  if (!result.isValid) {
    throw new Error(MATCH_DAY_EVENT_MINUTE_VALIDATION_MESSAGE)
  }

  return result.minute
}

export function resolveMatchDayEventMinute({ manualMinute = '', match = {}, now = Date.now() } = {}) {
  const manualResult = normalizeMatchDayEventMinute(manualMinute)

  if (manualResult.hasValue) {
    return manualResult
  }

  const clockMinute = getMatchTimerMinute(match, now)
  return normalizeMatchDayEventMinute(clockMinute ?? '')
}

export function getMatchDayEventSaveErrorMessage(error, fallback = 'Match event could not be added.') {
  const rawMessage = normalizeMinuteText(error?.message)

  if (/match_day_events|constraint|check constraint|minute_check/i.test(rawMessage)) {
    return MATCH_DAY_EVENT_MINUTE_VALIDATION_MESSAGE
  }

  return rawMessage || fallback
}
