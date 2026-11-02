const london = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

function londonParts(date) {
  const parts = Object.fromEntries(london.formatToParts(date).map((part) => [part.type, part.value]))
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) }
}

function localToInstant(parts) {
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  let guess = wall
  for (let i = 0; i < 3; i += 1) {
    const actual = londonParts(new Date(guess))
    const actualWall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    const adjustment = wall - actualWall
    if (!adjustment) return new Date(guess)
    guess += adjustment
  }
  // A nonexistent local time during the spring change is not an actual occurrence.
  const actual = londonParts(new Date(guess))
  return actual.year === parts.year && actual.month === parts.month && actual.day === parts.day && actual.hour === parts.hour && actual.minute === parts.minute ? new Date(guess) : null
}

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

export function excludeDeletedParentOccurrences(rows = [], events = []) {
  const excluded = new Map(events.filter(event => event.cancelled_at && event.cancellation_reason != null)
    .map(event => [String(event.id), new Set(event.deleted_occurrence_dates ?? event.deletedOccurrenceDates ?? [])]))
  return rows.filter(row => {
    if (row.source_event_type !== 'calendar_event' || !excluded.has(String(row.event_id))) return true
    const start = new Date(row.event_start)
    if (Number.isNaN(start.getTime())) return true
    const parts = londonParts(start)
    const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    return !excluded.get(String(row.event_id)).has(key)
  })
}

// Keep the original identity and London wall time for each remaining cancelled occurrence.
export function expandCancelledParentSeries(events = [], now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return events.flatMap((event) => {
    if (!event.cancelledAt || !['weekly', 'fortnightly', 'monthly'].includes(event.recurrenceFrequency)) return [event]
    const start = new Date(event.startsAt)
    const end = new Date(event.endsAt || event.startsAt)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !event.recurrenceUntil) return [event]
    const original = londonParts(start)
    const duration = end.getTime() - start.getTime()
    const anchor = new Date(Date.UTC(original.year, original.month - 1, original.day))
    let date = anchor
    const occurrences = []
    const deletedDates = new Set(event.deletedOccurrenceDates ?? event.deleted_occurrence_dates ?? [])
    for (let i = 0; i < 10000 && dateKey(date) <= event.recurrenceUntil && occurrences.length < 80; i += 1) {
      const occurrenceKey = dateKey(date)
      const instant = localToInstant({ ...original, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() })
      if (instant && occurrenceKey >= today && !deletedDates.has(occurrenceKey)) occurrences.push({ ...event, occurrenceKey, startsAt: instant.toISOString(), endsAt: new Date(instant.getTime() + duration).toISOString() })
      if (event.recurrenceFrequency === 'monthly') {
        // Match the established calendar recurrence, which advances from the prior occurrence.
        const next = new Date(date)
        next.setUTCMonth(next.getUTCMonth() + 1)
        date = next
      } else {
        date = new Date(date.getTime() + (event.recurrenceFrequency === 'weekly' ? 7 : 14) * 86400000)
      }
    }
    return occurrences
  })
}
