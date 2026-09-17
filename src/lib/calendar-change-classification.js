// Classify the confirmed change, not the generic edit action requested by older apps.
export function resolveCalendarChangeAction(action, before, after) {
  if (action !== 'rescheduled') return action
  const normalise = value => {
    const text = String(value || '').trim()
    if (!text) return ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
    const stamp = Date.parse(text)
    return Number.isFinite(stamp) ? String(stamp) : text
  }
  return normalise(before?.startsAt) === normalise(after?.startsAt) ? 'update' : 'rescheduled'
}

export function hasCalendarSourceChanged(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].some(key => key !== 'updated_at' && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
}
