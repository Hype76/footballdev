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
    notes: '',
    responseState: state,
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
    calendarDate: date,
    calendarTime: time,
    childName: invitation?.childName || '',
    endsAt: invitation?.eventEnd || '',
    eventType: 'match_day',
    id: `match:${match.id}`,
    invitationId: invitation?.invitationId || '',
    kickoffTimeTbc: Boolean(match.kickoffTimeTbc),
    location: match.venueAddress || match.venueName || '',
    notes: match.notes || '',
    responseState: invitation ? invitationStatus(invitation) : match.availabilityStatus || '',
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
    .filter((event) => event.calendarDate)
    .sort((left, right) => (
      left.sortKey.localeCompare(right.sortKey)
      || left.title.localeCompare(right.title)
    ))
}

export function getParentCalendarWindow(events = [], windowKey = 'upcoming', now = new Date()) {
  const currentDate = getDateInTimeZone(now)
  if (windowKey === 'all') return [...events]
  if (windowKey === '30-days') {
    const endDate = new Date(`${currentDate}T12:00:00Z`).getTime() + (30 * DAY_MS)
    const endDateOnly = new Date(endDate).toISOString().slice(0, 10)
    return events.filter((event) => event.calendarDate >= currentDate && event.calendarDate <= endDateOnly)
  }
  return events.filter((event) => event.calendarDate >= currentDate || event.status === 'live')
}

export function groupParentCalendarEvents(events = []) {
  const groups = []
  for (const event of events) {
    const current = groups.at(-1)
    if (current?.date === event.calendarDate) {
      current.events.push(event)
    } else {
      groups.push({ date: event.calendarDate, events: [event] })
    }
  }
  return groups
}
