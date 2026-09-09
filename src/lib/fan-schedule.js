import { getParentProductDateTimeParts } from '../../apps/mobile-core/src/parentDateTimeCore.js'

export function upcomingFanSchedule(items, now = new Date()) {
  const current = getParentProductDateTimeParts(now)
  const currentKey = `${current.date}T${current.time}`
  const startParts = (item) => getParentProductDateTimeParts(item.starts_at || (item.time ? `${item.date}T${item.time}` : item.date))
  return items.filter((item) => {
    if (['cancelled', 'closed', 'completed', 'expired', 'full_time', 'postponed'].includes(item.status)) return false
    const start = startParts(item)
    if (!start.isValid || !start.date) return false
    const end = getParentProductDateTimeParts(item.ends_at || (item.end_time ? `${item.date}T${item.end_time}` : ''))
    if (!item.ends_at && end.isValid && end.date === start.date && end.time < start.time) {
      const nextDay = new Date(`${end.date}T12:00:00Z`)
      nextDay.setUTCDate(nextDay.getUTCDate() + 1)
      end.date = nextDay.toISOString().slice(0, 10)
    }
    const boundary = end.isValid ? end : start
    return `${boundary.date}T${boundary.time || '23:59'}` > currentKey
  }).sort((a, b) => {
    const left = startParts(a), right = startParts(b)
    return `${left.date}T${left.time || '23:59'}`.localeCompare(`${right.date}T${right.time || '23:59'}`)
  })
}
