function normalizeText(value) {
  return String(value ?? '').trim()
}

export function getMatchDayVolunteerActionKey({ matchId, requestId, role }) {
  return [matchId, role, requestId].map((value) => normalizeText(value)).join(':')
}

function normalizeServerAssignment(assignment) {
  if (!assignment || typeof assignment !== 'object') {
    return null
  }

  return {
    id: normalizeText(assignment.id),
    matchDayId: normalizeText(assignment.matchDayId),
    role: normalizeText(assignment.role).toLowerCase(),
    parentLinkId: normalizeText(assignment.parentLinkId),
    authUserId: normalizeText(assignment.authUserId),
    parentEmail: normalizeText(assignment.parentEmail),
    playerName: normalizeText(assignment.playerName),
    assignedByName: normalizeText(assignment.assignedByName),
    isCurrentParent: assignment.isCurrentParent === true,
    createdAt: normalizeText(assignment.createdAt),
    updatedAt: normalizeText(assignment.updatedAt),
  }
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
  const serverAssignment = normalizeServerAssignment(result.assignment)
  const parentLinkId = normalizeText(result.parentLinkId || volunteer.parentLinkId)

  return {
    id: serverAssignment?.id || normalizeText(result.assignmentId) || `local-${match.id}-${normalizedRole}`,
    matchDayId: serverAssignment?.matchDayId || match.id,
    role: normalizedRole,
    parentLinkId: serverAssignment?.parentLinkId || parentLinkId,
    authUserId: serverAssignment?.authUserId || normalizeText(result.authUserId || volunteer.authUserId),
    parentEmail: serverAssignment?.parentEmail || normalizeText(volunteer.parentEmail || volunteer.parentName),
    playerName: serverAssignment?.playerName || normalizeText(volunteer.playerName),
    assignedByName: serverAssignment?.assignedByName || normalizeText(user.displayName || user.name || user.email),
    isCurrentParent: false,
    createdAt: serverAssignment?.createdAt || now,
    updatedAt: serverAssignment?.updatedAt || now,
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
  let savedAssignment = null

  if (selected !== false) {
    savedAssignment = buildMatchDayVolunteerAssignment({
      match,
      now,
      result,
      role: normalizedRole,
      user,
      volunteer,
    })
    nextAssignments.push(savedAssignment)
  }

  const nextMatch = {
    ...match,
    roleAssignments: nextAssignments,
  }

  if (normalizedRole === 'scorer') {
    nextMatch.scorerAssignments = selected === false
      ? []
      : [{
        id: savedAssignment?.id || normalizeText(result?.assignmentId) || `local-${match.id}-scorer`,
        matchDayId: savedAssignment?.matchDayId || match.id,
        parentLinkId: savedAssignment?.parentLinkId || normalizeText(result?.parentLinkId || volunteer?.parentLinkId),
        authUserId: savedAssignment?.authUserId || normalizeText(result?.authUserId || volunteer?.authUserId),
        assignedByName: savedAssignment?.assignedByName || normalizeText(user?.displayName || user?.name || user?.email),
        createdAt: savedAssignment?.createdAt || now || new Date().toISOString(),
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
