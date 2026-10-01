// An empty journal is a cached server snapshot, not a pending local change.
// Use the newer detail so a confirmed conclusion survives a cache write failure.
export function selectCoachMatchDayDisplayMatch(serverMatch, projectedMatch, pendingCount = 0) {
  if (!projectedMatch || serverMatch && projectedMatch.id !== serverMatch.id) return serverMatch
  if (!serverMatch || pendingCount > 0) return projectedMatch
  const serverUpdatedAt = Date.parse(serverMatch.updatedAt)
  const projectedUpdatedAt = Date.parse(projectedMatch.updatedAt)
  return Number.isFinite(projectedUpdatedAt) && projectedUpdatedAt > serverUpdatedAt ? projectedMatch : serverMatch
}
