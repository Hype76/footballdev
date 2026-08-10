export const PARENT_PRODUCT_TIME_ZONE = 'Europe/London'

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/
const OFFSET_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i
const TIME_ONLY_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/

function emptyParts() {
  return {
    date: '',
    hasTime: false,
    instant: null,
    isAllDay: false,
    isValid: false,
    time: '',
  }
}

function validDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day
    && value.getUTCHours() === hour
    && value.getUTCMinutes() === minute
    && value.getUTCSeconds() === second
}

function zonedInstantParts(instant) {
  const values = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: PARENT_PRODUCT_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(instant)
  const part = (type) => values.find((entry) => entry.type === type)?.value || ''
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    hasTime: true,
    instant,
    isAllDay: false,
    isValid: true,
    time: `${part('hour')}:${part('minute')}`,
  }
}

export function getParentProductDateTimeParts(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? emptyParts() : zonedInstantParts(new Date(value.getTime()))
  }

  const normalized = String(value ?? '').trim()
  if (!normalized) return emptyParts()

  const dateOnlyMatch = normalized.match(DATE_ONLY_PATTERN)
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch.map(Number)
    if (!validDateParts(year, month, day)) return emptyParts()
    return {
      date: normalized,
      hasTime: false,
      instant: null,
      isAllDay: true,
      isValid: true,
      time: '',
    }
  }

  const timeOnlyMatch = normalized.match(TIME_ONLY_PATTERN)
  if (timeOnlyMatch) {
    const [, hour, minute, second = '0'] = timeOnlyMatch
    if (!validDateParts(2000, 1, 1, Number(hour), Number(minute), Number(second))) return emptyParts()
    return {
      date: '',
      hasTime: true,
      instant: null,
      isAllDay: false,
      isValid: true,
      time: `${hour}:${minute}`,
    }
  }

  const localDateTimeMatch = normalized.match(LOCAL_DATE_TIME_PATTERN)
  if (localDateTimeMatch && !OFFSET_PATTERN.test(normalized)) {
    const [, year, month, day, hour, minute, second = '0'] = localDateTimeMatch
    const numeric = [year, month, day, hour, minute, second].map(Number)
    if (!validDateParts(...numeric)) return emptyParts()
    return {
      date: `${year}-${month}-${day}`,
      hasTime: true,
      instant: null,
      isAllDay: false,
      isValid: true,
      time: `${hour}:${minute}`,
    }
  }

  if (!OFFSET_PATTERN.test(normalized)) return emptyParts()
  const instant = new Date(normalized)
  return Number.isNaN(instant.getTime()) ? emptyParts() : zonedInstantParts(instant)
}

export function getParentProductSortTimestamp(value) {
  const parts = getParentProductDateTimeParts(value)
  if (!parts.isValid) return Number.POSITIVE_INFINITY
  if (parts.instant) return parts.instant.getTime()
  if (!parts.date && parts.hasTime) {
    const [hour = 0, minute = 0] = parts.time.split(':').map(Number)
    return Date.UTC(1970, 0, 1, hour, minute)
  }
  const [year, month, day] = parts.date.split('-').map(Number)
  const [hour = 0, minute = 0] = parts.time.split(':').map(Number)
  return Date.UTC(year, month - 1, day, hour, minute)
}

export function getParentProductWallTimeSortTimestamp(value) {
  const parts = getParentProductDateTimeParts(value)
  if (!parts.isValid) return Number.POSITIVE_INFINITY
  const [hour = 0, minute = 0] = parts.time.split(':').map(Number)
  if (!parts.date) return Date.UTC(1970, 0, 1, hour, minute)
  const [year, month, day] = parts.date.split('-').map(Number)
  return Date.UTC(year, month - 1, day, hour, minute)
}

export function formatParentProductDateTime(value, {
  day = 'numeric',
  fallback = 'Time to be confirmed',
  includeTime = true,
  locale = 'en-GB',
  month = 'short',
  weekday,
  year,
} = {}) {
  const parts = getParentProductDateTimeParts(value)
  if (!parts.isValid) return fallback
  if (!parts.date) return formatParentProductTime(value, { fallback, locale })

  const [dateYear, dateMonth, dateDay] = parts.date.split('-').map(Number)
  const [hour = 12, minute = 0] = parts.time.split(':').map(Number)
  const displayDate = parts.instant || new Date(Date.UTC(dateYear, dateMonth - 1, dateDay, hour, minute))
  const options = {
    day,
    month,
    timeZone: parts.instant ? PARENT_PRODUCT_TIME_ZONE : 'UTC',
    ...(weekday ? { weekday } : {}),
    ...(year ? { year } : {}),
    ...(includeTime && parts.hasTime ? { hour: '2-digit', hourCycle: 'h23', minute: '2-digit' } : {}),
  }
  return new Intl.DateTimeFormat(locale, options).format(displayDate)
}

export function formatParentProductTime(value, {
  fallback = 'Time to be confirmed',
  locale = 'en-GB',
} = {}) {
  const parts = getParentProductDateTimeParts(value)
  if (!parts.isValid || !parts.hasTime) return fallback
  if (parts.instant) {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      timeZone: PARENT_PRODUCT_TIME_ZONE,
    }).format(parts.instant)
  }
  const [hour, minute] = parts.time.split(':').map(Number)
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)))
}
