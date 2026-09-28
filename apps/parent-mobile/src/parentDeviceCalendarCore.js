const ACCEPTED_STATES = new Set(['accepted', 'attending', 'available', 'yes'])

function text(value) {
  return String(value ?? '').trim()
}

export function buildAcceptedParentCalendarEvents(items = [], now = new Date()) {
  const accepted = new Map()
  const threshold = now.getTime() - 24 * 60 * 60 * 1000

  for (const item of Array.isArray(items) ? items : []) {
    if (!ACCEPTED_STATES.has(text(item?.responseState).toLowerCase())) continue
    if (item?.status === 'cancelled' || item?.status === 'postponed') continue
    const sourceId = text(item?.sourceId || item?.id)
    const start = new Date(item?.startsAt || '')
    if (!sourceId || !Number.isFinite(start.getTime()) || start.getTime() < threshold) continue
    const suppliedEnd = new Date(item?.endsAt || '')
    const end = Number.isFinite(suppliedEnd.getTime()) && suppliedEnd > start
      ? suppliedEnd
      : new Date(start.getTime() + 2 * 60 * 60 * 1000)
    const key = `${text(item?.sourceType)}:${sourceId}:${start.toISOString()}`
    accepted.set(key, {
      key,
      title: text(item?.title) || 'Football Player event',
      startDate: start,
      endDate: end,
      location: text(item?.location),
      notes: text(item?.notes),
    })
  }

  return [...accepted.values()]
}

export function getParentCalendarEventFingerprint(event) {
  return JSON.stringify([
    event.title,
    event.startDate.toISOString(),
    event.endDate.toISOString(),
    event.location,
    event.notes,
  ])
}
