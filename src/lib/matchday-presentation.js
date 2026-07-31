export function sortMatchDayPresentation(matches) {
  return [...(Array.isArray(matches) ? matches : [])].sort((left, right) => {
    const priorityDifference = Number(left?.presentationPriority ?? 99) - Number(right?.presentationPriority ?? 99)
    if (priorityDifference !== 0) {
      return priorityDifference
    }

    const leftKickoff = left?.scheduledKickoffAt ? new Date(left.scheduledKickoffAt).getTime() : Number.MAX_SAFE_INTEGER
    const rightKickoff = right?.scheduledKickoffAt ? new Date(right.scheduledKickoffAt).getTime() : Number.MAX_SAFE_INTEGER
    if (leftKickoff !== rightKickoff) {
      return leftKickoff - rightKickoff
    }

    return String(left?.id || '').localeCompare(String(right?.id || ''))
  })
}
