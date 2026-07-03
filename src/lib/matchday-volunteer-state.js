function normalizeText(value) {
  return String(value ?? '').trim()
}

export function getMatchDayVolunteerActionKey({ matchId, requestId, role }) {
  return [matchId, role, requestId].map((value) => normalizeText(value)).join(':')
}

export function buildMatchDayVolunteerAssignment({
  match,
  now = new Date().toISOString(),
  result = {},
  role,
  user = {},
  volunteer = {},
}) {
  const normalizedRole = normalizeText(role).toLowerCase()
  const parentLinkId = normalizeText(result.parentLinkId || volunteer.parentLinkId)

  return {
    id: normalizeText(result.assignmentId) || `local-${match.id}-${normalizedRole}`,
    matchDayId: match.id,
    role: normalizedRole,
    parentLinkId,
    authUserId: normalizeText(result.authUserId || volunteer.authUserId),
    parentEmail: normalizeText(volunteer.parentEmail || volunteer.parentName),
    playerName: normalizeText(volunteer.playerName),
    assignedByName: normalizeText(user.displayName || user.name || user.email),
    isCurrentParent: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function reconcileMatchDayVolunteerSelection(match, {
  now,
  result,
  role,
  selected = true,
  user,
  volunteer,
}) {
  if (!match?.id) {
    return match
  }

  const normalizedRole = normalizeText(role).toLowerCase()
  const currentAssignments = Array.isArray(match.roleAssignments) ? match.roleAssignments : []
  const nextAssignments = currentAssignments.filter((assignment) => assignment.role !== normalizedRole)

  if (selected !== false) {
    nextAssignments.push(buildMatchDayVolunteerAssignment({
      match,
      now,
      result,
      role: normalizedRole,
      user,
      volunteer,
    }))
  }

  const nextMatch = {
    ...match,
    roleAssignments: nextAssignments,
  }

  if (normalizedRole === 'scorer') {
    nextMatch.scorerAssignments = selected === false
      ? []
      : [{
        id: normalizeText(result?.assignmentId) || `local-${match.id}-scorer`,
        matchDayId: match.id,
        parentLinkId: normalizeText(result?.parentLinkId || volunteer?.parentLinkId),
        authUserId: normalizeText(result?.authUserId || volunteer?.authUserId),
        assignedByName: normalizeText(user?.displayName || user?.name || user?.email),
        createdAt: now || new Date().toISOString(),
      }]
  }

  return nextMatch
}

export function reconcileMatchDayVolunteerSelectionInList(matches, {
  matchId,
  ...options
}) {
  return (matches || []).map((match) => (
    String(match.id) === String(matchId)
      ? reconcileMatchDayVolunteerSelection(match, options)
      : match
  ))
}
