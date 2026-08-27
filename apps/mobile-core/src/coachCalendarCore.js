import {
  buildRequiredLocalDateTime,
  normalizeRequiredDate,
  normalizeRequiredTime,
  validateOrdinaryEventDateTime,
} from '../../../src/lib/calendar-datetime-integrity.js'
import { getDateInTimeZone } from './parentCalendarCore.js'
import { normalizeLegacyMatchHomeAway, normalizeMatchDayShirtChoice } from '../../../src/lib/matchday-model.js'
import { resolveTeamNotificationDisplayName } from '../../../src/lib/team-notification-display.js'

export const COACH_CALENDAR_EVENT_TYPES = Object.freeze([
  'general',
  'training',
  'match',
  'meeting',
  'tournament',
  'social',
  'other',
])

export const COACH_CALENDAR_RECURRENCE = Object.freeze(['none', 'weekly', 'fortnightly', 'monthly'])
export const COACH_CALENDAR_PARENT_AUDIENCES = Object.freeze(['none', 'involved_players', 'all_team_parents', 'all_club_parents'])
const MAX_COACH_CALENDAR_OCCURRENCES = 52

function normalize(value) {
  return String(value ?? '').trim()
}

function normalizeKey(value) {
  return normalize(value).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

export function normalizeCoachCalendarFormDate(value) {
  const input = normalize(value)
  const isoDate = normalizeRequiredDate(input)
  if (isoDate) return isoDate
  const ukDate = input.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  return ukDate ? normalizeRequiredDate(`${ukDate[3]}-${ukDate[2]}-${ukDate[1]}`) : ''
}

export function formatCoachCalendarFormDate(value) {
  const date = normalizeCoachCalendarFormDate(value)
  if (!date) return normalize(value)
  const [year, month, day] = date.split('-')
  return `${day}-${month}-${year}`
}

function addUtcDays(date, amount) {
  const shifted = new Date(`${date}T12:00:00.000Z`)
  shifted.setUTCDate(shifted.getUTCDate() + amount)
  return shifted.toISOString().slice(0, 10)
}

export function buildCoachCalendarOccurrenceDates({ date, recurrenceFrequency = 'none', recurrenceUntil = '' } = {}) {
  const firstDate = normalizeCoachCalendarFormDate(date)
  const frequency = COACH_CALENDAR_RECURRENCE.includes(normalizeKey(recurrenceFrequency))
    ? normalizeKey(recurrenceFrequency)
    : 'none'
  const until = normalizeCoachCalendarFormDate(recurrenceUntil) || firstDate
  if (!firstDate) return []
  if (frequency === 'none' || until <= firstDate) return [firstDate]

  const dates = []
  let cursor = firstDate
  while (cursor <= until && dates.length < MAX_COACH_CALENDAR_OCCURRENCES) {
    dates.push(cursor)
    if (frequency === 'monthly') {
      const [year, month, day] = firstDate.split('-').map(Number)
      const nextMonth = month - 1 + dates.length
      const lastDay = new Date(Date.UTC(year, nextMonth + 1, 0)).getUTCDate()
      cursor = new Date(Date.UTC(year, nextMonth, Math.min(day, lastDay), 12)).toISOString().slice(0, 10)
    } else {
      cursor = addUtcDays(cursor, frequency === 'fortnightly' ? 14 : 7)
    }
  }
  return dates
}

function related(row, key) {
  const value = row?.[key]
  return Array.isArray(value) ? value[0] : value
}

function londonParts(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/London',
    year: 'numeric',
  }).formatToParts(date)
  const part = (type) => parts.find((entry) => entry.type === type)?.value || ''
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  }
}

function offsetMinutesAt(timestamp) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 0
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/London',
    year: 'numeric',
  }).formatToParts(date)
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value || 0)
  const localizedAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
  return Math.round((localizedAsUtc - date.getTime()) / 60000)
}

export function londonLocalToUtcIso(dateValue, timeValue) {
  const date = normalizeCoachCalendarFormDate(dateValue)
  const time = normalizeRequiredTime(timeValue)
  if (!date || !time) throw new Error('Enter a valid Europe/London date and time.')
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  const first = desiredUtc - (offsetMinutesAt(desiredUtc) * 60000)
  const corrected = desiredUtc - (offsetMinutesAt(first) * 60000)
  const parts = londonParts(corrected)
  if (parts?.date !== date || parts?.time !== time) {
    throw new Error('That Europe/London time does not exist because the clocks change.')
  }
  return new Date(corrected).toISOString()
}

export function formatCoachCalendarDateTime(value) {
  if (!normalize(value)) return 'Time not set'
  const date = new Date(value || 0)
  if (Number.isNaN(date.getTime())) return 'Time not set'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'Europe/London',
    weekday: 'short',
  }).format(date)
}

export function formatCoachCalendarEventDateTime(event = {}) {
  if (event.dateTimeIssue === 'invalid_local_time') {
    const calendarDate = normalize(event.calendarDate)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(calendarDate)
      ? new Date(`${calendarDate}T12:00:00.000Z`)
      : null
    const dateLabel = date && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        year: 'numeric',
      }).format(date)
      : 'Date not set'
    return `${dateLabel} | Time needs updating`
  }
  return formatCoachCalendarDateTime(event.startsAt)
}

export function getCoachCalendarMonthKey(value = new Date()) {
  const normalized = normalize(value)
  const explicit = normalized.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (explicit) return `${explicit[1]}-${explicit[2]}`
  return getDateInTimeZone(value).slice(0, 7)
}

export function shiftCoachCalendarMonth(monthKey, amount) {
  const normalized = getCoachCalendarMonthKey(monthKey)
  const [year, month] = normalized.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, (month - 1) + Number(amount || 0), 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

export function buildCoachCalendarMonth(events = [], monthKey = getCoachCalendarMonthKey(), selectedDate = '', now = new Date()) {
  const normalizedMonth = getCoachCalendarMonthKey(monthKey)
  const [year, month] = normalizedMonth.split('-').map(Number)
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, month - 1, 1 - mondayOffset))
  const today = getDateInTimeZone(now)
  const eventMap = new Map()
  for (const event of events) {
    const date = normalize(event?.calendarDate)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (!eventMap.has(date)) eventMap.set(date, [])
    eventMap.get(date).push(event)
  }
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getTime() + (index * 24 * 60 * 60 * 1000))
    const key = date.toISOString().slice(0, 10)
    const dayEvents = Object.freeze([...(eventMap.get(key) || [])])
    return Object.freeze({
      date: key,
      dateLabel: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC', year: 'numeric' }).format(date),
      dayNumber: date.getUTCDate(),
      events: dayEvents,
      inMonth: key.startsWith(normalizedMonth),
      isSelected: key === selectedDate,
      isToday: key === today,
    })
  })
  return Object.freeze({
    days: Object.freeze(days),
    monthKey: normalizedMonth,
    title: new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC', year: 'numeric' }).format(firstDay),
    today,
    weeks: Object.freeze(Array.from({ length: 6 }, (_, index) => Object.freeze(days.slice(index * 7, (index + 1) * 7)))),
  })
}

export function normalizeCoachCalendarEvent(row, sourceType = 'calendar_event') {
  const team = related(row, 'teams')
  const source = normalizeKey(sourceType)
  const isMatchDay = source === 'match_day'
  const isSession = source === 'assessment_session'
  const matchDate = normalize(row.match_date ?? row.matchDate)
  const kickoffTime = normalize(row.kickoff_time ?? row.kickoffTime)
  const sessionDate = normalize(row.session_date ?? row.sessionDate)
  const startTime = normalize(row.start_time ?? row.startTime)
  const endTime = normalize(row.end_time ?? row.endTime)
  let dateTimeIssue = ''
  let startsAt = normalize(row.starts_at ?? row.startsAt)
  let endsAt = normalize(row.ends_at ?? row.endsAt)
  if (isMatchDay && matchDate) {
    try {
      startsAt = londonLocalToUtcIso(matchDate, kickoffTime || '23:59')
    } catch {
      startsAt = ''
      dateTimeIssue = 'invalid_local_time'
    }
    if (startsAt && !endsAt) {
      const kickoffTimestamp = Date.parse(startsAt)
      const matchMinutes = Math.max(Number(row.match_duration_minutes ?? row.matchDurationMinutes ?? 90), 1)
      if (Number.isFinite(kickoffTimestamp)) endsAt = new Date(kickoffTimestamp + ((matchMinutes + 60) * 60 * 1000)).toISOString()
    }
  } else if (isSession) {
    startsAt = sessionDate
    if (sessionDate && startTime) {
      try {
        startsAt = londonLocalToUtcIso(sessionDate, startTime)
      } catch {
        startsAt = ''
        dateTimeIssue = 'invalid_local_time'
      }
    }
    if (sessionDate && endTime) {
      try {
        endsAt = londonLocalToUtcIso(sessionDate, endTime)
      } catch {
        endsAt = ''
        dateTimeIssue = 'invalid_local_time'
      }
    }
  }
  const teamId = normalize(row.team_id ?? row.teamId)
  const status = normalizeKey(row.status || (row.cancelled_at || row.cancelledAt ? 'cancelled' : 'scheduled')) || 'scheduled'
  const eventType = isMatchDay
    ? 'fixture'
    : isSession
      ? normalizeKey(row.session_type ?? row.sessionType) || 'training'
      : normalizeKey(row.event_type ?? row.eventType) || 'general'
  const title = isMatchDay
    ? `${normalize(team?.name ?? row.team_name ?? row.teamName) || 'Team'} v ${normalize(row.opponent) || 'Opponent'}`
    : normalize(row.title) || (isSession ? 'Training session' : 'Calendar event')
  const dateParts = londonParts(startsAt)
  const sourceCalendarDate = isMatchDay ? matchDate : isSession ? sessionDate : ''
  const sourceCalendarTime = isMatchDay ? kickoffTime : isSession ? startTime : ''

  return Object.freeze({
    availabilitySummary: row.availabilitySummary || null,
    calendarDate: sourceCalendarDate || dateParts?.date || normalize(startsAt).slice(0, 10),
    calendarTime: sourceCalendarTime || dateParts?.time || '',
    cancelledAt: normalize(row.cancelled_at ?? row.cancelledAt) || (status === 'cancelled' ? normalize(row.updated_at ?? row.updatedAt) : ''),
    canEdit: source === 'calendar_event' && row.canEdit !== false,
    dateTimeIssue,
    endsAt,
    eventType,
    id: `${source}:${normalize(row.id)}`,
    involvedPlayerIds: Object.freeze([...(Array.isArray(row.involvedPlayerIds) ? row.involvedPlayerIds : [])].map(normalize).filter(Boolean)),
    isClubWide: !teamId,
    isInheritedClubEvent: Boolean(row.isInheritedClubEvent),
    kickoffTimeTbc: row.kickoff_time_tbc === true || row.kickoffTimeTbc === true,
    homeAway: isMatchDay ? normalizeLegacyMatchHomeAway(row.home_away ?? row.homeAway) : '',
    shirtChoice: isMatchDay ? normalizeMatchDayShirtChoice(row.shirt_choice ?? row.shirtChoice) : '',
    location: normalize(row.location || row.venue_address || row.venueAddress || row.venue_name || row.venueName),
    notes: normalize(row.notes),
    parentAudience: normalizeKey(row.parent_audience ?? row.parentAudience) || 'none',
    parentVisible: row.parent_visible === true || row.parentVisible === true,
    recurrenceFrequency: normalizeKey(row.recurrence_frequency ?? row.recurrenceFrequency) || 'none',
    recurrenceUntil: normalize(row.recurrence_until ?? row.recurrenceUntil),
    occurrenceDate: normalize(row.occurrence_date ?? row.occurrenceDate) || sourceCalendarDate || dateParts?.date || normalize(startsAt).slice(0, 10),
    seriesEndsAt: endsAt,
    seriesStartsAt: startsAt,
    sourceId: normalize(row.id),
    sourceType: source,
    startsAt,
    status,
    teamId,
    teamName: normalize(team?.name ?? row.team ?? row.team_name ?? row.teamName),
    teamNotificationDisplayName: resolveTeamNotificationDisplayName(
      team || {},
      row.team_notification_display_name ?? row.teamNotificationDisplayName ?? team?.name ?? row.team_name ?? row.teamName,
    ),
    title,
    updatedAt: normalize(row.updated_at ?? row.updatedAt),
  })
}

function expandCoachCalendarEventOccurrences(event, availabilityByEventId = {}) {
  const occurrenceDates = buildCoachCalendarOccurrenceDates({
    date: event.calendarDate,
    recurrenceFrequency: event.recurrenceFrequency,
    recurrenceUntil: event.recurrenceUntil,
  })
  if (occurrenceDates.length <= 1) {
    return [Object.freeze({
      ...event,
      availabilitySummary: availabilityByEventId[`${event.sourceId}:${event.calendarDate}`] || availabilityByEventId[event.sourceId] || event.availabilitySummary,
      occurrenceDate: event.calendarDate,
    })]
  }

  const startParts = londonParts(event.seriesStartsAt)
  const endParts = londonParts(event.seriesEndsAt)
  const crossesMidnight = Boolean(startParts?.date && endParts?.date && endParts.date > startParts.date)
  return occurrenceDates.map((occurrenceDate) => {
    let startsAt = event.startsAt
    let endsAt = event.endsAt
    try {
      startsAt = londonLocalToUtcIso(occurrenceDate, startParts?.time || event.calendarTime || '18:00')
      endsAt = londonLocalToUtcIso(crossesMidnight ? addUtcDays(occurrenceDate, 1) : occurrenceDate, endParts?.time || startParts?.time || '19:00')
    } catch {
      startsAt = event.startsAt
      endsAt = event.endsAt
    }
    return Object.freeze({
      ...event,
      availabilitySummary: availabilityByEventId[`${event.sourceId}:${occurrenceDate}`] || null,
      calendarDate: occurrenceDate,
      id: `${event.id}:${occurrenceDate}`,
      occurrenceDate,
      startsAt,
      endsAt,
    })
  })
}

export function buildCoachCalendarEvents({ calendarEvents = [], matches = [], sessions = [], availabilityByEventId = {} } = {}) {
  const ordinary = calendarEvents.flatMap((row) => {
    const event = normalizeCoachCalendarEvent(row)
    return expandCoachCalendarEventOccurrences(event, availabilityByEventId)
  })
  const combined = [
    ...ordinary,
    ...matches.map((row) => normalizeCoachCalendarEvent(row, 'match_day')),
    ...sessions.map((row) => normalizeCoachCalendarEvent(row, 'assessment_session')),
  ]
  const unique = new Map()
  for (const event of combined) {
    if (event.sourceId && event.calendarDate && !unique.has(event.id)) unique.set(event.id, event)
  }
  return [...unique.values()]
    .sort((left, right) => (
      `${left.calendarDate}T${left.calendarTime || '23:59'}`.localeCompare(`${right.calendarDate}T${right.calendarTime || '23:59'}`)
      || left.title.localeCompare(right.title)
    ))
}

export function filterCoachCalendarEvents(events = [], windowKey = 'upcoming', now = new Date()) {
  const today = getDateInTimeZone(now)
  const nowTimestamp = now.getTime()
  const isPast = (event) => {
    const boundary = Date.parse(normalize(event.endsAt || event.startsAt))
    if (Number.isFinite(boundary)) return boundary <= nowTimestamp
    return event.calendarDate < today
  }
  if (windowKey === 'all') return [...events]
  if (windowKey === 'cancelled') return events.filter((event) => event.status === 'cancelled' || event.cancelledAt)
  if (windowKey === 'history') return events.filter((event) => (
    event.status !== 'cancelled'
    && !event.cancelledAt
    && (isPast(event) || event.status === 'completed')
  ))
  return events.filter((event) => (
    !isPast(event)
    && event.status !== 'cancelled'
    && event.status !== 'completed'
    && !event.cancelledAt
  ))
}

export function groupCoachCalendarEvents(events = []) {
  const groups = []
  for (const event of events) {
    const existing = groups.at(-1)
    if (existing?.date === event.calendarDate) existing.events.push(event)
    else groups.push({ date: event.calendarDate, events: [event] })
  }
  return groups
}

export function getCoachCalendarContextModel({ context, contexts = [] } = {}) {
  const clubId = normalize(context?.clubId)
  const available = (Array.isArray(contexts) && contexts.length ? contexts : [context])
    .filter((candidate) => candidate?.id && normalize(candidate.clubId) === clubId)
  const options = available.map((candidate) => Object.freeze({
    id: normalize(candidate.id),
    label: candidate.teamId ? normalize(candidate.teamName) || 'Team' : `Club: ${normalize(candidate.clubName) || 'Club'}`,
    teamId: normalize(candidate.teamId),
  }))
  const teamContextCount = options.filter((option) => option.teamId).length
  const isTeamScope = Boolean(normalize(context?.teamId))
  return Object.freeze({
    currentLabel: isTeamScope
      ? `Team: ${normalize(context?.teamName) || 'Team'}`
      : `Club: ${normalize(context?.clubName) || 'Club'}`,
    isTeamScope,
    options: Object.freeze(options),
    selectedContextId: normalize(context?.id),
    teamContextCount,
  })
}

export function getCoachCalendarMutationPolicy({ context, event = null } = {}) {
  const roleRank = Number(context?.roleRank || 0)
  const canMutate = context?.paymentAccess?.canMutate === true && roleRank >= 20
  const inherited = Boolean(event?.isInheritedClubEvent)
  return Object.freeze({
    canCreate: canMutate && Boolean(context?.teamId || context?.role === 'admin'),
    canEdit: canMutate && (!inherited || context?.role === 'admin') && event?.sourceType !== 'match_day' && event?.sourceType !== 'assessment_session',
    communicationsMode: 'disabled_test_sink',
    onlineRequired: true,
  })
}

export function buildCoachCalendarPayload({ context, form }) {
  const eventType = normalizeKey(form?.eventType)
  if (!COACH_CALENDAR_EVENT_TYPES.includes(eventType)) throw new Error('Choose a supported Calendar event type.')
  const opponent = normalize(form?.opponent)
  const title = eventType === 'match'
    ? `${normalize(context?.teamName || context?.activeTeamName) || 'Team'} v ${opponent || 'Opponent'}`
    : normalize(form?.title)
  if (eventType === 'match' && !opponent) throw new Error('Add the opponent.')
  if (eventType !== 'match' && !title) throw new Error('Add an event title.')
  const dateTime = validateOrdinaryEventDateTime({
    date: normalizeCoachCalendarFormDate(form?.date),
    endTime: form?.endTime,
    startTime: form?.startTime,
  })
  const recurrenceFrequency = COACH_CALENDAR_RECURRENCE.includes(normalizeKey(form?.recurrenceFrequency))
    ? normalizeKey(form.recurrenceFrequency)
    : 'none'
  const recurrenceUntil = recurrenceFrequency === 'none' ? '' : normalizeCoachCalendarFormDate(form?.recurrenceUntil)
  if (recurrenceFrequency !== 'none' && !recurrenceUntil) throw new Error('Add a repeat until date.')
  const activeTeamId = normalize(context?.teamId || context?.activeTeamId)
  const teamId = context?.role === 'admin' ? normalize(form?.teamId || activeTeamId) : activeTeamId
  if (context?.role !== 'admin' && !teamId) throw new Error('Choose an assigned Team before saving.')
  const parentVisible = form?.parentVisible === true
  const parentAudience = COACH_CALENDAR_PARENT_AUDIENCES.includes(normalizeKey(form?.parentAudience))
    ? normalizeKey(form.parentAudience)
    : 'none'
  if (parentVisible && parentAudience === 'none') throw new Error('Choose who can see this event.')
  if (parentVisible && parentAudience === 'all_team_parents' && !teamId) throw new Error('Choose a Team before sharing with Team parents.')
  if (parentVisible && parentAudience === 'all_club_parents' && context?.role !== 'admin') {
    throw new Error('Club parent sharing is only available to Club Admins.')
  }
  return Object.freeze({
    club_id: normalize(context?.clubId),
    ends_at: londonLocalToUtcIso(dateTime.date, dateTime.endTime),
    event_type: eventType,
    location: normalize(form?.location),
    notes: normalize(form?.notes),
    parent_audience: parentVisible ? parentAudience : 'none',
    parent_visible: parentVisible,
    recurrence_frequency: recurrenceFrequency,
    recurrence_until: recurrenceUntil || null,
    starts_at: londonLocalToUtcIso(dateTime.date, dateTime.startTime),
    team_id: teamId || null,
    title,
  })
}

export function coachCalendarFormFromEvent(event = null, context = null) {
  const start = londonParts(event?.seriesStartsAt || event?.startsAt)
  const end = londonParts(event?.seriesEndsAt || event?.endsAt)
  return {
    date: formatCoachCalendarFormDate(start?.date || getDateInTimeZone()),
    endTime: end?.time || '19:00',
    eventType: COACH_CALENDAR_EVENT_TYPES.includes(event?.eventType) ? event.eventType : 'training',
    involvedPlayerIds: Array.isArray(event?.involvedPlayerIds) ? event.involvedPlayerIds : [],
    location: normalize(event?.location),
    notes: normalize(event?.notes),
    notifyParents: event?.notifyParents === true,
    notificationTeamName: resolveTeamNotificationDisplayName(
      { notificationDisplayName: event?.teamNotificationDisplayName },
      context?.teamName || context?.activeTeamName || event?.teamName,
    ),
    opponent: event?.eventType === 'match'
      ? normalize(event?.title).replace(new RegExp(`^${normalize(context?.teamName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+v\\s+`, 'i'), '')
      : '',
    parentAudience: event?.parentAudience || 'none',
    parentVisible: event?.parentVisible === true,
    requestTrainingAvailability: event?.requestTrainingAvailability === true,
    recurrenceFrequency: event?.recurrenceFrequency || 'none',
    recurrenceUntil: formatCoachCalendarFormDate(event?.recurrenceUntil || ''),
    resourceIds: [...new Set((Array.isArray(event?.resourceIds) ? event.resourceIds : []).map(normalize).filter(Boolean))],
    startTime: start?.time || '18:00',
    teamId: normalize(event?.teamId || context?.teamId || context?.activeTeamId),
    title: normalize(event?.title),
    trainingAvailabilitySendDaysBefore: Number.isInteger(Number(event?.trainingAvailabilitySendDaysBefore))
      ? Number(event.trainingAvailabilitySendDaysBefore)
      : 2,
  }
}

export function getCoachCalendarEventResourceIds(resources = [], eventId = '', occurrenceDate = '') {
  const normalizedEventId = normalize(eventId)
  const normalizedOccurrenceDate = normalizeCoachCalendarFormDate(occurrenceDate)
  if (!normalizedEventId || !normalizedOccurrenceDate) return []
  return [...new Set((Array.isArray(resources) ? resources : [])
    .filter((resource) => Array.isArray(resource?.links) && resource.links.some((link) => (
      normalizeKey(link?.linkedType) === 'calendar_event'
      && normalize(link?.linkedId) === normalizedEventId
      && normalizeCoachCalendarFormDate(link?.calendarOccurrenceDate ?? link?.calendar_occurrence_date) === normalizedOccurrenceDate
    )))
    .map((resource) => normalize(resource?.id))
    .filter(Boolean))]
}

export function toggleCoachCalendarResourceId(resourceIds = [], resourceId = '') {
  const normalizedResourceId = normalize(resourceId)
  const current = [...new Set((Array.isArray(resourceIds) ? resourceIds : []).map(normalize).filter(Boolean))]
  if (!normalizedResourceId) return current
  return current.includes(normalizedResourceId)
    ? current.filter((id) => id !== normalizedResourceId)
    : [...current, normalizedResourceId]
}

export function getCanonicalCalendarLocalDateTime(date, time) {
  return buildRequiredLocalDateTime(normalizeCoachCalendarFormDate(date), time)
}
