const TEAM_ROLE_KEYS = new Set(['head_manager', 'manager', 'coach', 'assistant_coach'])
const TEAM_MANAGEMENT_ROLE_KEYS = new Set(['head_manager', 'manager'])
const MAXIMUM_TEAM_ROLE_RANK = 70
const MINIMUM_TEAM_MANAGEMENT_RANK = 50

function normalizeRank(value) {
  const rank = Number(value ?? 0)
  return Number.isFinite(rank) ? rank : 0
}

export function canManageAssignedTeamRole(user, assignment) {
  if (!user || !assignment) {
    return false
  }

  if (user.role === 'admin' || user.role === 'super_admin') {
    return true
  }

  return String(assignment.userId ?? '') === String(user.id ?? '')
    && TEAM_MANAGEMENT_ROLE_KEYS.has(String(assignment.roleKey ?? ''))
    && normalizeRank(assignment.roleRank) >= MINIMUM_TEAM_MANAGEMENT_RANK
}

export function getTeamRoleGrantCeiling(user, assignment) {
  if (user?.role === 'admin' || user?.role === 'super_admin') {
    return MAXIMUM_TEAM_ROLE_RANK
  }

  if (!canManageAssignedTeamRole(user, assignment)) {
    return 0
  }

  return Math.min(normalizeRank(assignment.roleRank), MAXIMUM_TEAM_ROLE_RANK)
}

export function getPermittedTeamRoleOptions({ roles, user, assignment }) {
  const grantCeiling = getTeamRoleGrantCeiling(user, assignment)

  if (grantCeiling < MINIMUM_TEAM_MANAGEMENT_RANK) {
    return []
  }

  return (roles ?? [])
    .filter((role) =>
      TEAM_ROLE_KEYS.has(String(role?.roleKey ?? '')) &&
      normalizeRank(role?.roleRank) <= grantCeiling,
    )
    .sort((left, right) => normalizeRank(right?.roleRank) - normalizeRank(left?.roleRank))
}

export function getTeamRoleAuthorityMessage({ user, assignment }) {
  const grantCeiling = getTeamRoleGrantCeiling(user, assignment)

  if (grantCeiling >= 70) {
    return 'Team Admin authority can assign Team Admin, Manager, Coach, and Assistant Coach within this team. Club Admin and Platform Admin remain protected.'
  }

  if (grantCeiling >= 50) {
    return 'Manager authority can assign Manager, Coach, and Assistant Coach within this team. Team Admin, Club Admin, and Platform Admin remain unavailable.'
  }

  return 'You can view this team assignment, but you cannot change Coach roles.'
}
