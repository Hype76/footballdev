import { formatParentProductDateTime, getParentProductDateTimeParts } from '../../mobile-core/src/parentDateTimeCore.js'

export function getParentEventPresentation(event = {}) {
  const type = [event.eventType, event.sourceType, event.invitationType].filter(Boolean).join(' ').toLowerCase()
  let presentation = { iconKey: 'parent.calendar', label: 'Event', tone: 'accentText' }
  if (type.includes('match')) presentation = { iconKey: 'football', label: 'Match day', tone: 'accentText' }
  else if (type.includes('training')) presentation = { iconKey: 'parent.training', label: 'Training', tone: 'success' }
  else if (type.includes('assessment')) presentation = { iconKey: 'parent.training', label: 'Assessment', tone: 'success' }
  else if (type.includes('session')) presentation = { iconKey: 'parent.training', label: 'Session', tone: 'success' }
  else if (type.includes('meeting')) presentation = { iconKey: 'parent.calendar', label: 'Meeting', tone: 'accentText' }
  const status = event.cancelledAt || event.cancelled_at ? 'cancelled' : String(event.status || '').toLowerCase()
  if (['cancelled', 'postponed', 'closed', 'expired'].includes(status)) {
    return { ...presentation, label: status[0].toUpperCase() + status.slice(1), tone: 'danger' }
  }
  return presentation
}

export function getParentEventDateTimeLabel(event = {}) {
  const parts = getParentProductDateTimeParts(event.startsAt || event.eventStart || event.eventDate)
  const date = event.calendarDate ?? parts.date
  const time = event.calendarTime ?? parts.time
  const dateLabel = formatParentProductDateTime(date, { fallback: 'Date TBC', includeTime: false, weekday: 'short' })
  const isMatch = getParentEventPresentation(event).iconKey === 'football'
  if (event.kickoffTimeTbc || (isMatch && !time)) return `${dateLabel} · Time TBC`
  return time ? `${dateLabel} at ${time}` : dateLabel
}
