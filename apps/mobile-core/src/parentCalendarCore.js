import {
  getParentProductDateTimeParts,
  getParentProductSortTimestamp,
} from './parentDateTimeCore.js'

const DAY_MS = 24 * 60 * 60 * 1000

function normalizeText(value) {
  return String(value ?? '').trim()
}

function dateOnly(value) {
  return getParentProductDateTimeParts(value).date
}

function timeOnly(value) {
  return getParentProductDateTimeParts(value).time
}

function timestampFor(value) {
  return getParentProductSortTimestamp(value)
}

function calendarSortKey(date, time = '') {
  return date ? `${date}T${time || '23:59'}` : '9999-12-31T23:59'
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase()
}

function isTerminalStatus(value) {
  return ['cancelled', 'closed', 'completed', 'expired', 'full_time', 'postponed'].includes(normalizeStatus(value))
}

export function isParentCalendarEventCancelled(event = {}) {
  return Boolean(event.cancelledAt || event.cancelled_at)
    || normalizeStatus(event.status) === 'cancelled'
}

export function isParentCalendarActionRequired(event = {}) {
  if (isTerminalStatus(event.status)) return false
  const responseState = normalizeStatus(event.responseState)
  return event.requiresResponse === true
    || ['awaiting_response', 'no_response', 'pending'].includes(responseState)
}

export function getParentCalendarMarkerTone(event = {}) {
  const status = normalizeStatus(event.status)
  const eventType = normalizeStatus(event.eventType)
  if (['cancelled', 'postponed'].includes(status)) return 'cancelled'
  if (isParentCalendarActionRequired(event)) return 'response'
  if (eventType.includes('match')) return 'match'
  if (eventType.includes('training') || eventType.includes('assessment') || eventType.includes('session')) return 'training'
  return 'event'
}

export function getParentCalendarEventBucket(event = {}, now = new Date()) {
  const currentDate = getDateInTimeZone(now)
  if (isTerminalStatus(event.status)) return 'history'
  if (!event.calendarDate) return 'date-tbc'
  if (event.calendarDate < currentDate) return 'history'
  const boundary = timestampFor(event.endsAt || event.startsAt)
  if (event.calendarDate === currentDate && Number.isFinite(boundary) && boundary > 0 && boundary <= now.getTime()) return 'history'
  if (isParentCalendarActionRequired(event)) return 'needs-response'
  return 'upcoming'
}

export function getDateInTimeZone(value = new Date(), timeZone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(value)
  const part = (type) => parts.find((entry) => entry.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function matchSortValue(match) {
  const date = dateOnly(match?.matchDate)
  const time = timeOnly(match?.kickoffTime) || '23:59'
  return date ? `${date}T${time}` : '9999-12-31T23:59'
}

function invitationKey(invitation) {
  return normalizeText(invitation?.eventId || invitation?.sourceRecordId)
}

function invitationStatus(invitation) {
  const invitationState = normalizeText(invitation?.invitationState).toLowerCase()
  if (['cancelled', 'closed', 'expired'].includes(invitationState)) return invitationState
  return normalizeText(invitation?.responseState).toLowerCase() || 'awaiting_response'
}

function normalizeSharedEvent(event, invitation) {
  const calendarDate = dateOnly(event.startsAt)
  const calendarTime = timeOnly(event.startsAt)
  const invitationDisplayState = invitation ? invitationStatus(invitation) : ''
  return {
    ...event,
    calendarDate,
    calendarTime,
    childName: invitation?.childName || '',
    id: `calendar:${event.id}`,
    invitationId: invitation?.invitationId || '',
    responseState: invitationDisplayState,
    requiresResponse: Boolean(invitation?.isPending),
    sortKey: calendarSortKey(calendarDate, calendarTime),
    sortTimestamp: timestampFor(event.startsAt),
    sourceId: event.id,
    sourceType: 'calendar_event',
    status: ['cancelled', 'closed', 'expired'].includes(invitationDisplayState)
      ? invitationDisplayState
      : event.status,
    teamName: invitation?.teamName || '',
  }
}

function normalizeInvitationEvent(invitation) {
  const sourceId = invitationKey(invitation)
  const state = invitationStatus(invitation)
  const calendarDate = dateOnly(invitation.eventStart || invitation.eventDate)
  const calendarTime = invitation.kickoffTimeTbc ? '' : timeOnly(invitation.eventStart)
  return {
    calendarDate,
    calendarTime,
    childName: invitation.childName || '',
    endsAt: invitation.eventEnd || '',
    eventType: normalizeText(invitation.sourceType || invitation.invitationType) || 'invitation',
    id: `invitation:${sourceId}:${invitation.invitationId}`,
    invitationId: invitation.invitationId || '',
    location: invitation.eventLocation || '',
    notes: normalizeText(invitation.notes),
    occurrenceDate: calendarDate,
    resources: Array.isArray(invitation.resources) ? invitation.resources : [],
    responseState: state,
    requiresResponse: Boolean(invitation.isPending),
    sortKey: calendarSortKey(calendarDate, calendarTime),
    sortTimestamp: timestampFor(invitation.eventStart || `${invitation.eventDate}T23:59:00`),
    sourceId,
    sourceType: 'invitation',
    startsAt: invitation.eventStart || invitation.eventDate || '',
    status: ['cancelled', 'closed', 'expired'].includes(state) ? state : 'scheduled',
    teamName: invitation.teamName || '',
    title: invitation.eventTitle || 'Invited event',
  }
}

function normalizeMatchEvent(match, invitation) {
  const date = dateOnly(match.matchDate)
  const time = match.kickoffTimeTbc ? '' : timeOnly(match.kickoffTime)
  return {
    arrivalTime: timeOnly(match.arrivalTime),
    calendarDate: date,
    calendarTime: time,
    childName: invitation?.childName || '',
    endsAt: invitation?.eventEnd || '',
    eventType: 'match_day',
    id: `match:${match.id}`,
    invitationId: invitation?.invitationId || '',
    kickoffTimeTbc: Boolean(match.kickoffTimeTbc),
    shirtChoice: ['home', 'away', 'tbc'].includes(normalizeText(match.shirtChoice).toLowerCase())
      ? normalizeText(match.shirtChoice).toLowerCase()
      : 'home',
    location: match.venueAddress || match.venueName || '',
    notes: match.notes || '',
    responseState: invitation ? invitationStatus(invitation) : match.availabilityStatus || '',
    requiresResponse: Boolean(invitation?.isPending),
    sortKey: calendarSortKey(date, time),
    sortTimestamp: timestampFor(invitation?.eventStart || `${matchSortValue(match)}:00`),
    sourceId: match.id,
    sourceType: 'match_day',
    startsAt: invitation?.eventStart || (date ? `${date}T${time || '23:59'}:00` : ''),
    status: match.status || 'scheduled',
    teamName: match.teamName || invitation?.teamName || '',
    title: `${match.teamName || 'Team'} v ${match.opponent || 'Opponent'}`,
  }
}

export function buildParentCalendarEvents({ calendarEvents = [], invitations = [], matches = [] } = {}) {
  const invitationByEvent = new Map()
  for (const invitation of invitations) {
    const key = invitationKey(invitation)
    if (key && !invitationByEvent.has(key)) invitationByEvent.set(key, invitation)
  }

  const sharedIds = new Set(calendarEvents.map((event) => normalizeText(event?.id)).filter(Boolean))
  const matchIds = new Set(matches.map((match) => normalizeText(match?.id)).filter(Boolean))
  const events = [
    ...calendarEvents.map((event) => normalizeSharedEvent(event, invitationByEvent.get(normalizeText(event?.id)))),
    ...matches.map((match) => normalizeMatchEvent(match, invitationByEvent.get(normalizeText(match?.id)))),
    ...invitations
      .filter((invitation) => {
        const key = invitationKey(invitation)
        return key && !sharedIds.has(key) && !matchIds.has(key)
      })
      .map(normalizeInvitationEvent),
  ]

  return events
    .filter((event) => !isParentCalendarEventCancelled(event))
    .sort((left, right) => (
      left.sortKey.localeCompare(right.sortKey)
      || left.title.localeCompare(right.title)
    ))
}

export function getParentCalendarWindow(events = [], windowKey = 'upcoming', now = new Date()) {
  const currentDate = getDateInTimeZone(now)
  const eventSortKey = (event) => normalizeText(event?.sortKey) || calendarSortKey(event?.calendarDate, event?.calendarTime)
  const sortedUpcoming = (items) => [...items].sort((left, right) => eventSortKey(left).localeCompare(eventSortKey(right)))
  const sortedHistory = (items) => [...items].sort((left, right) => eventSortKey(right).localeCompare(eventSortKey(left)))
  if (windowKey === 'all') return sortedUpcoming(events)
  if (windowKey === 'date-tbc') return sortedUpcoming(events.filter((event) => !event.calendarDate))
  if (windowKey === 'needs-response') {
    return sortedUpcoming(events.filter((event) => getParentCalendarEventBucket(event, now) === 'needs-response'))
  }
  if (windowKey === 'history') {
    return sortedHistory(events.filter((event) => getParentCalendarEventBucket(event, now) === 'history'))
  }
  if (windowKey === '30-days' || windowKey === 'next-30') {
    const endDate = new Date(`${currentDate}T12:00:00Z`).getTime() + (30 * DAY_MS)
    const endDateOnly = new Date(endDate).toISOString().slice(0, 10)
    return sortedUpcoming(events.filter((event) => (
      ['needs-response', 'upcoming'].includes(getParentCalendarEventBucket(event, now))
      && event.calendarDate >= currentDate
      && event.calendarDate <= endDateOnly
    )))
  }
  if (windowKey === 'previous-30') {
    const startDate = new Date(`${currentDate}T12:00:00Z`).getTime() - (30 * DAY_MS)
    const startDateOnly = new Date(startDate).toISOString().slice(0, 10)
    return sortedHistory(events.filter((event) => (
      getParentCalendarEventBucket(event, now) === 'history'
      && event.calendarDate >= startDateOnly
      && event.calendarDate < currentDate
    )))
  }
  return sortedUpcoming(events.filter((event) => ['needs-response', 'upcoming'].includes(getParentCalendarEventBucket(event, now))))
}

export function groupParentCalendarEvents(events = []) {
  const groups = []
  for (const event of events) {
    const current = groups.at(-1)
    const groupDate = event.calendarDate || 'date-tbc'
    if (current?.date === groupDate) {
      current.events.push(event)
    } else {
      groups.push({ date: groupDate, events: [event] })
    }
  }
  return groups
}

export function getParentCalendarMonthGrid(events = [], cursor = new Date(), now = new Date()) {
  const year = Number(cursor.getFullYear())
  const month = Number(cursor.getMonth())
  const first = new Date(year, month, 1, 12)
  const gridStart = new Date(year, month, 1 - ((first.getDay() + 6) % 7), 12)
  const today = getDateInTimeZone(now)
  const byDate = new Map()

  for (const event of events) {
    if (!event.calendarDate) continue
    const items = byDate.get(event.calendarDate) || []
    items.push(event)
    byDate.set(event.calendarDate, items)
  }

  return Array.from({ length: 42 }, (_unused, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const dayEvents = (byDate.get(dateKey) || []).sort((left, right) => (
      (normalizeText(left?.sortKey) || calendarSortKey(left?.calendarDate, left?.calendarTime))
        .localeCompare(normalizeText(right?.sortKey) || calendarSortKey(right?.calendarDate, right?.calendarTime))
    ))
    return {
      date: dateKey,
      day: date.getDate(),
      events: dayEvents,
      inMonth: date.getMonth() === month,
      isToday: dateKey === today,
      needsResponse: dayEvents.some(isParentCalendarActionRequired),
    }
  })
}
