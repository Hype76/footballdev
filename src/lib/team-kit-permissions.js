import { getWorkspaceScope } from './workspace-scope.js'

export function canManageTeamKitColours(user) {
  if (!user?.clubId || !user?.activeTeamId || user?.hasActivePlanAccess !== true
    || Number(user?.roleRank || 0) < 50) return false
  const scope = getWorkspaceScope(user).key
  return scope === 'club' ? user.role === 'admin' : scope === 'team' || scope === 'individual'
}
