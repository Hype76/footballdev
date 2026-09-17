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
