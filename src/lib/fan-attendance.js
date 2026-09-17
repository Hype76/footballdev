import { upcomingFanSchedule } from './fan-schedule.js'
import { getParentProductDateTimeParts } from '../../apps/mobile-core/src/parentDateTimeCore.js'

export function fanAttendanceStart(item) {
  return item.starts_at || (item.time ? `${item.date}T${item.time}` : item.date)
}

export function groupFanAttendance(items, now = new Date()) {
  const valid = items.filter(item => getParentProductDateTimeParts(fanAttendanceStart(item)).date && !['cancelled', 'postponed'].includes(item.status))
  const upcoming = upcomingFanSchedule(valid, now)
  const upcomingIds = new Set(upcoming.map(item => item.id))
  const key = item => { const parts = getParentProductDateTimeParts(fanAttendanceStart(item)); return `${parts.date}T${parts.time || '23:59'}` }
  return { upcoming, past: valid.filter(item => !upcomingIds.has(item.id)).sort((a, b) => key(b).localeCompare(key(a))) }
}

export function fanAttendanceResponse(value) {
  if (['available', 'attending', 'accepted'].includes(value)) return { label: value === 'available' ? 'Available' : 'Attending', icon: 'attendance.available', tone: 'success' }
  if (['unavailable', 'not_attending', 'declined'].includes(value)) return { label: value === 'unavailable' ? 'Unavailable' : 'Not attending', icon: 'attendance.unavailable', tone: 'danger' }
  if (value === 'maybe') return { label: 'Maybe', icon: 'attendance.maybe', tone: 'warning' }
  return { label: 'Awaiting response', icon: 'attendance.maybe', tone: 'textSecondary' }
}
