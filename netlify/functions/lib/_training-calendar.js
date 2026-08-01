import { Buffer } from 'node:buffer'

export const TRAINING_CALENDAR_TIME_ZONE = 'Europe/London'

const RECURRENCE_INTERVALS = {
  weekly: { frequency: 'WEEKLY', interval: 1, label: 'weekly' },
  fortnightly: { frequency: 'WEEKLY', interval: 2, label: 'fortnightly' },
  monthly: { frequency: 'MONTHLY', interval: 1, label: 'monthly' },
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function getLondonParts(value) {
  const date = value instanceof Date ? value : new Date(String(value ?? ''))

  if (Number.isNaN(date.getTime())) {
    return null
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: TRAINING_CALENDAR_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return {
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    month: Number(values.month),
    second: Number(values.second),
    year: Number(values.year),
  }
}

function toDateOnly(parts) {
  return parts
    ? `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    : ''
}

function toTimeOnly(parts) {
  return parts
    ? `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`
    : ''
}

function parseDateOnly(value) {
  const match = normalizeText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))

  return probe.getUTCFullYear() === parts.year
    && probe.getUTCMonth() === parts.month - 1
    && probe.getUTCDate() === parts.day
    ? parts
    : null
}

function addCalendarDays(dateValue, days) {
  const parts = parseDateOnly(dateValue)

  if (!parts) {
    return ''
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0)))
  return date.toISOString().slice(0, 10)
}

function addCalendarMonths(dateValue, months) {
  const parts = parseDateOnly(dateValue)

  if (!parts) {
    return ''
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0))
  return date.toISOString().slice(0, 10)
}

function getCalendarDayOffset(fromValue, toValue) {
  const from = parseDateOnly(fromValue)
  const to = parseDateOnly(toValue)

  if (!from || !to) {
    return 0
  }

  const fromTime = Date.UTC(from.year, from.month - 1, from.day)
  const toTime = Date.UTC(to.year, to.month - 1, to.day)
  return Math.round((toTime - fromTime) / 86400000)
}

function londonLocalDateTimeToUtc(dateValue, timeValue) {
  const date = parseDateOnly(dateValue)
  const timeMatch = normalizeText(timeValue).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)

  if (!date || !timeMatch) {
    return null
  }

  const target = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    Number(timeMatch[3] || 0),
  )
  let guess = target

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const displayed = getLondonParts(new Date(guess))

    if (!displayed) {
      return null
    }

    const displayedAsUtc = Date.UTC(
      displayed.year,
      displayed.month - 1,
      displayed.day,
      displayed.hour,
      displayed.minute,
      displayed.second,
    )
    const adjustment = target - displayedAsUtc
    guess += adjustment

    if (adjustment === 0) {
      break
    }
  }

  return new Date(guess)
}

export function buildOccurrences(event = {}, { maxOccurrences = 400 } = {}) {
  const sourceStart = new Date(event.starts_at ?? event.startsAt ?? '')
  const sourceEnd = new Date(event.ends_at ?? event.endsAt ?? event.starts_at ?? event.startsAt ?? '')

  if (Number.isNaN(sourceStart.getTime())) {
    return []
  }

  const startParts = getLondonParts(sourceStart)
  const endParts = Number.isNaN(sourceEnd.getTime()) ? startParts : getLondonParts(sourceEnd)
  const startDate = toDateOnly(startParts)
  const endDate = toDateOnly(endParts)
  const startTime = toTimeOnly(startParts)
  const endTime = toTimeOnly(endParts)
  const endDayOffset = getCalendarDayOffset(startDate, endDate)
  const frequency = normalizeText(event.recurrence_frequency ?? event.recurrenceFrequency ?? 'none').toLowerCase()
  const recurrenceUntil = normalizeText(event.recurrence_until ?? event.recurrenceUntil)
  const hasFiniteRecurrence = Boolean(RECURRENCE_INTERVALS[frequency] && parseDateOnly(recurrenceUntil))
  const finalDate = frequency === 'none' || !hasFiniteRecurrence ? startDate : recurrenceUntil
  const occurrences = []
  let cursorDate = startDate

  while (cursorDate && cursorDate <= finalDate) {
    const occurrenceStartsAt = londonLocalDateTimeToUtc(cursorDate, startTime)
    const occurrenceEndsAt = londonLocalDateTimeToUtc(addCalendarDays(cursorDate, endDayOffset), endTime)

    if (occurrenceStartsAt) {
      occurrences.push({
        occurrenceDate: cursorDate,
        occurrenceEndsAt: occurrenceEndsAt || occurrenceStartsAt,
        occurrenceStartsAt,
      })
    }

    if (frequency === 'weekly') {
      cursorDate = addCalendarDays(cursorDate, 7)
    } else if (frequency === 'fortnightly') {
      cursorDate = addCalendarDays(cursorDate, 14)
    } else if (frequency === 'monthly') {
      cursorDate = addCalendarMonths(cursorDate, 1)
    } else {
      break
    }

    if (occurrences.length >= maxOccurrences && cursorDate <= finalDate) {
      throw new Error('The recurring calendar schedule is too large to export safely.')
    }
  }

  return occurrences
}

export function formatLondonDateLabel(value) {
  const parsedDate = value instanceof Date ? value : new Date(String(value ?? ''))

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Date to be confirmed'
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: TRAINING_CALENDAR_TIME_ZONE,
  }).format(parsedDate)
}

function formatIcsUtc(value) {
  const parsedDate = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isNaN(parsedDate.getTime())
    ? ''
    : parsedDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function formatIcsLondon(value) {
  const parts = getLondonParts(value)

  return parts
    ? `${String(parts.year).padStart(4, '0')}${String(parts.month).padStart(2, '0')}${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}${String(parts.minute).padStart(2, '0')}${String(parts.second).padStart(2, '0')}`
    : ''
}

function escapeIcsText(value) {
  return normalizeText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function foldIcsLine(value) {
  const line = String(value ?? '')
  const chunks = []
  let chunk = ''

  for (const character of line) {
    const candidate = `${chunk}${character}`
    const limit = chunks.length === 0 ? 75 : 74

    if (Buffer.byteLength(candidate, 'utf8') > limit && chunk) {
      chunks.push(chunk)
      chunk = character
    } else {
      chunk = candidate
    }
  }

  chunks.push(chunk)
  return chunks.join('\r\n ')
}

function normalizeOccurrences(occurrences = []) {
  return occurrences
    .filter((occurrence) => {
      const status = normalizeText(occurrence?.status).toLowerCase()
      return status !== 'cancelled' && !occurrence?.cancelledAt && !occurrence?.cancelled_at
    })
    .map((occurrence) => ({
      ...occurrence,
      occurrenceStartsAt: new Date(occurrence.rescheduledStartsAt || occurrence.rescheduled_starts_at || occurrence.occurrenceStartsAt),
      occurrenceEndsAt: new Date(occurrence.rescheduledEndsAt || occurrence.rescheduled_ends_at || occurrence.occurrenceEndsAt || occurrence.occurrenceStartsAt),
      originalOccurrenceDate: normalizeText(occurrence.originalOccurrenceDate || occurrence.occurrenceDate),
      wasRescheduled: Boolean(occurrence.rescheduledStartsAt || occurrence.rescheduled_starts_at),
    }))
    .filter((occurrence) => !Number.isNaN(occurrence.occurrenceStartsAt.getTime()))
}

function buildEventLines({ event, occurrence, teamName, uid }) {
  const eventType = normalizeText(event.event_type ?? event.eventType ?? 'training') || 'training'
  const notes = normalizeText(event.notes)
  const description = [
    `${eventType.charAt(0).toUpperCase()}${eventType.slice(1)} schedule from Football Player.`,
    notes,
  ].filter(Boolean).join('\n\n')
  const updatedAt = formatIcsUtc(event.updated_at ?? event.updatedAt)
  const sequence = Math.max(0, Number(event.notification_revision ?? event.notificationRevision ?? 0) || 0)

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    updatedAt ? `LAST-MODIFIED:${updatedAt}` : '',
    `SEQUENCE:${sequence}`,
    `DTSTART;TZID=${TRAINING_CALENDAR_TIME_ZONE}:${formatIcsLondon(occurrence.occurrenceStartsAt)}`,
    `DTEND;TZID=${TRAINING_CALENDAR_TIME_ZONE}:${formatIcsLondon(occurrence.occurrenceEndsAt)}`,
    `SUMMARY:${escapeIcsText(event.title || teamName || 'Training session')}`,
    `CATEGORIES:${escapeIcsText(eventType.toUpperCase())}`,
    event.location ? `LOCATION:${escapeIcsText(event.location)}` : '',
    description ? `DESCRIPTION:${escapeIcsText(description)}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
  ].filter(Boolean)
}

function hasIrregularOccurrences(occurrences) {
  return occurrences.some((occurrence) => occurrence.wasRescheduled)
}

export function buildTrainingAvailabilityCalendarIcs({ event = {}, occurrences = [], teamName = '' } = {}) {
  const validOccurrences = normalizeOccurrences(occurrences)

  if (validOccurrences.length === 0) {
    return ''
  }

  const eventId = normalizeText(event.id) || 'event'
  const recurrenceFrequency = normalizeText(event.recurrence_frequency ?? event.recurrenceFrequency ?? 'none').toLowerCase()
  const recurrence = RECURRENCE_INTERVALS[recurrenceFrequency]
  const recurrenceUntil = normalizeText(event.recurrence_until ?? event.recurrenceUntil)
  const canUseRecurringEvent = Boolean(
    recurrence
      && !hasIrregularOccurrences(validOccurrences)
      && (validOccurrences.length > 1 || !recurrenceUntil),
  )
  let eventLines

  if (canUseRecurringEvent) {
    eventLines = buildEventLines({
      event,
      occurrence: validOccurrences[0],
      teamName,
      uid: `calendar-event-${eventId}@footballplayer.online`,
    })
    const recurrenceParts = [
      `FREQ=${recurrence.frequency}`,
      ...(recurrence.interval > 1 ? [`INTERVAL=${recurrence.interval}`] : []),
      ...(recurrenceUntil ? [`COUNT=${validOccurrences.length}`] : []),
    ]
    eventLines.splice(eventLines.length - 2, 0, `RRULE:${recurrenceParts.join(';')}`)
  } else {
    eventLines = validOccurrences.flatMap((occurrence) => buildEventLines({
      event,
      occurrence,
      teamName,
      uid: validOccurrences.length === 1 && recurrenceFrequency === 'none'
        ? `calendar-event-${eventId}@footballplayer.online`
        : `calendar-event-${eventId}-${occurrence.originalOccurrenceDate || formatIcsLondon(occurrence.occurrenceStartsAt).slice(0, 8)}@footballplayer.online`,
    }))
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Football Player//Calendar Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(event.title || teamName || 'Training sessions')}`,
    `X-WR-TIMEZONE:${TRAINING_CALENDAR_TIME_ZONE}`,
    'BEGIN:VTIMEZONE',
    `TZID:${TRAINING_CALENDAR_TIME_ZONE}`,
    `X-LIC-LOCATION:${TRAINING_CALENDAR_TIME_ZONE}`,
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0000',
    'TZOFFSETTO:+0100',
    'TZNAME:BST',
    'DTSTART:19700329T010000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0000',
    'TZNAME:GMT',
    'DTSTART:19701025T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...eventLines,
    'END:VCALENDAR',
  ]

  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

export function getTrainingCalendarSummary({ event = {}, occurrences = [] } = {}) {
  const validOccurrences = normalizeOccurrences(occurrences)
  const recurrenceFrequency = normalizeText(event.recurrence_frequency ?? event.recurrenceFrequency ?? 'none').toLowerCase()
  const recurrence = RECURRENCE_INTERVALS[recurrenceFrequency]
  const displayedOccurrences = validOccurrences.slice(0, 3)
  const finalOccurrence = validOccurrences.at(-1)
  const hasFiniteEnd = Boolean(normalizeText(event.recurrence_until ?? event.recurrenceUntil))

  return {
    actionLabel: validOccurrences.length > 1 || recurrence ? 'Add schedule to calendar' : 'Add to calendar',
    continuation: validOccurrences.length > 3 && finalOccurrence
      ? `Continues ${recurrence?.label || 'on the approved schedule'} until ${formatLondonDateLabel(finalOccurrence.occurrenceStartsAt)}.`
      : recurrence && !hasFiniteEnd
        ? `Continues ${recurrence.label} with no end date.`
        : '',
    displayedOccurrences,
    finalOccurrence,
    occurrenceCount: validOccurrences.length,
  }
}

export function buildTrainingCalendarFilename(event = {}) {
  const slug = normalizeText(event.title || 'training-schedule')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'training-schedule'

  return `football-player-${slug}.ics`
}
