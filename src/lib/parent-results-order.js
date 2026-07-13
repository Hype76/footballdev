function normalizeText(value) {
  return String(value ?? '').trim()
}

function getFirstValue(record, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], record)

    if (normalizeText(value)) {
      return value
    }
  }

  return ''
}

function parseDateParts(value) {
  const match = normalizeText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  const [, yearValue, monthValue, dayValue] = match
  const year = Number(yearValue)
  const month = Number(monthValue)
  const day = Number(dayValue)
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null
  }

  return { day, month, timestamp, year }
}

function parseTimeParts(value) {
  const match = normalizeText(value).match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/)

  if (!match) {
    return null
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] || 0)

  if (hour > 23 || minute > 59 || second > 59) {
    return null
  }

  return { hour, minute, second }
}

function parseDateTime(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return null
  }

  const dateOnly = parseDateParts(normalizedValue)

  if (dateOnly) {
    return { hasTime: false, timestamp: dateOnly.timestamp }
  }

  const localDateTime = normalizedValue.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)$/)

  if (localDateTime) {
    const dateParts = parseDateParts(localDateTime[1])
    const timeParts = parseTimeParts(localDateTime[2])

    if (!dateParts || !timeParts) {
      return null
    }

    return {
      hasTime: true,
      timestamp: Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        timeParts.hour,
        timeParts.minute,
        timeParts.second,
      ),
    }
  }

  const timestamp = Date.parse(normalizedValue)

  if (!Number.isFinite(timestamp)) {
    return null
  }

  return {
    hasTime: /[T ]\d{2}:\d{2}/.test(normalizedValue),
    timestamp,
  }
}

function combineDateAndTime(dateValue, timeValue) {
  const dateParts = parseDateParts(dateValue)
  const timeParts = parseTimeParts(timeValue)

  if (!dateParts || !timeParts) {
    return null
  }

  return {
    hasTime: true,
    timestamp: Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hour,
      timeParts.minute,
      timeParts.second,
    ),
  }
}

function getPrimaryDate(match) {
  const directMatchStartValue = getFirstValue(match, [
    'fixtureStartsAt',
    'fixtureStartAt',
    'matchStartsAt',
    'matchStartAt',
    'scheduledStartsAt',
  ])
  const directMatchStart = parseDateTime(directMatchStartValue)

  if (directMatchStart?.hasTime) {
    return { ...directMatchStart, displayValue: directMatchStartValue, source: 'match_start' }
  }

  const matchDate = getFirstValue(match, ['matchDate', 'match_date', 'fixtureDate', 'fixture_date'])
  const kickoffTime = getFirstValue(match, ['kickoffTime', 'kickoff_time', 'startTime', 'start_time'])
  const combinedMatchStart = combineDateAndTime(matchDate, kickoffTime)

  if (combinedMatchStart) {
    return { ...combinedMatchStart, displayValue: `${normalizeText(matchDate)}T${normalizeText(kickoffTime)}`, source: 'match_start' }
  }

  const embeddedMatchStart = parseDateTime(matchDate)

  if (embeddedMatchStart?.hasTime) {
    return { ...embeddedMatchStart, displayValue: matchDate, source: 'match_start' }
  }

  const calendarStartValue = getFirstValue(match, [
    'calendarEventStartsAt',
    'calendarEventStart',
    'calendar_event_start',
    'eventStart',
    'event_start',
    'calendarEvent.startsAt',
    'calendarEvent.starts_at',
  ])
  const calendarStart = parseDateTime(calendarStartValue)

  if (calendarStart) {
    return { ...calendarStart, displayValue: calendarStartValue, source: 'calendar_event' }
  }

  const authoritativeMatchDate = parseDateTime(matchDate)

  if (authoritativeMatchDate) {
    return { ...authoritativeMatchDate, displayValue: matchDate, source: 'match_date' }
  }

  const reportMatchDateValue = getFirstValue(match, [
    'resultMatchDate',
    'result_match_date',
    'finalReportMatchDate',
    'final_report_match_date',
    'finalReport.matchDate',
    'finalReport.match_date',
  ])
  const reportMatchDate = parseDateTime(reportMatchDateValue)

  return reportMatchDate
    ? { ...reportMatchDate, displayValue: reportMatchDateValue, source: 'result_match_date' }
    : null
}

function getFallbackTimestamp(match) {
  const completionTimestamp = parseDateTime(getFirstValue(match, [
    'completedAt',
    'completed_at',
    'fullTimeAt',
    'full_time_at',
    'concludedAt',
    'concluded_at',
    'finalReport.completedAt',
    'finalReport.completed_at',
  ]))

  if (completionTimestamp) {
    return completionTimestamp.timestamp
  }

  return parseDateTime(getFirstValue(match, ['createdAt', 'created_at']))?.timestamp ?? null
}

function compareOptionalNumberDesc(left, right) {
  if (left === right) {
    return 0
  }

  if (left === null) {
    return 1
  }

  if (right === null) {
    return -1
  }

  return right - left
}

function compareTextDesc(left, right) {
  if (left === right) {
    return 0
  }

  return left < right ? 1 : -1
}

export function getParentResultOrderKey(match = {}) {
  const primaryDate = getPrimaryDate(match)
  const sourceId = normalizeText(getFirstValue(match, [
    'fixtureId',
    'fixture_id',
    'matchId',
    'match_id',
    'calendarEventId',
    'calendar_event_id',
    'eventId',
    'event_id',
    'id',
  ]))
  const recordId = normalizeText(match.id)
  const createdTimestamp = parseDateTime(getFirstValue(match, ['createdAt', 'created_at']))?.timestamp ?? null

  return {
    createdTimestamp,
    fallbackTimestamp: getFallbackTimestamp(match),
    hasPrimaryDate: Boolean(primaryDate),
    hasPrimaryTime: primaryDate?.hasTime === true,
    primarySource: primaryDate?.source ?? 'undated',
    primaryTimestamp: primaryDate?.timestamp ?? null,
    recordId,
    sourceId,
  }
}

export function getParentResultDateForDisplay(match = {}) {
  const primaryDate = getPrimaryDate(match)

  if (!primaryDate) {
    return null
  }

  return {
    hasTime: primaryDate.hasTime,
    source: primaryDate.source,
    value: normalizeText(primaryDate.displayValue),
  }
}

export function compareParentResultsNewestFirst(left, right) {
  const leftKey = getParentResultOrderKey(left)
  const rightKey = getParentResultOrderKey(right)

  if (leftKey.hasPrimaryDate !== rightKey.hasPrimaryDate) {
    return leftKey.hasPrimaryDate ? -1 : 1
  }

  if (leftKey.hasPrimaryDate) {
    return compareOptionalNumberDesc(leftKey.primaryTimestamp, rightKey.primaryTimestamp)
      || Number(rightKey.hasPrimaryTime) - Number(leftKey.hasPrimaryTime)
      || compareTextDesc(leftKey.sourceId, rightKey.sourceId)
      || compareOptionalNumberDesc(leftKey.createdTimestamp, rightKey.createdTimestamp)
      || compareTextDesc(leftKey.recordId, rightKey.recordId)
  }

  return compareOptionalNumberDesc(leftKey.fallbackTimestamp, rightKey.fallbackTimestamp)
    || compareTextDesc(leftKey.sourceId, rightKey.sourceId)
    || compareTextDesc(leftKey.recordId, rightKey.recordId)
}

export function sortParentResultsNewestFirst(matches = []) {
  return Array.isArray(matches) ? [...matches].sort(compareParentResultsNewestFirst) : []
}
