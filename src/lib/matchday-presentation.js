export function sortMatchDayPresentation(matches) {
  return [...(Array.isArray(matches) ? matches : [])].sort((left, right) => {
    const priorityDifference = Number(left?.presentationPriority ?? 99) - Number(right?.presentationPriority ?? 99)
    if (priorityDifference !== 0) {
      return priorityDifference
    }

    const kickoffValue = match => {
      const value = match?.scheduledKickoffAt || (match?.matchDate ? `${match.matchDate}T${match.kickoffTime || '23:59:59'}` : '')
      const timestamp = value ? new Date(value).getTime() : NaN
      return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
    }
    const leftKickoff = kickoffValue(left)
    const rightKickoff = kickoffValue(right)
    if (leftKickoff !== rightKickoff) {
      return leftKickoff - rightKickoff
    }

    return String(left?.id || '').localeCompare(String(right?.id || ''))
  })
}
