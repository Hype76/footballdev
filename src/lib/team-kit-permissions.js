import { getWorkspaceScope } from './workspace-scope.js'

export function canManageTeamKitColours(user) {
  if (!user?.clubId || !user?.activeTeamId || user?.hasActivePlanAccess !== true
    || Number(user?.roleRank || 0) < 50) return false
  const scope = getWorkspaceScope(user)
  if (scope.key === 'club') return user.role === 'admin' && Number(user.roleRank) >= 90
  if (scope.planKey === 'team' || scope.planKey === 'single_team') return (user.role === 'admin' && Number(user.roleRank) >= 90)
    || (user.role === 'head_manager' && Number(user.roleRank) >= 70)
  return scope.key === 'team' || scope.key === 'individual'
}
