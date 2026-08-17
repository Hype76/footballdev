import { isDemoUser } from './demo.js'
import { CAPABILITIES, canUseFeature } from './paywall-access.js'
import { isPlanAccessActive } from './plans.js'
import {
  getWorkspaceScope,
  isClubWorkspace,
  isIndividualWorkspace,
  WORKSPACE_SCOPES,
} from './workspace-scope.js'

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function getRoleLabel(user) {
  if (!user) {
    return 'Unknown'
  }

  const scope = getWorkspaceScope(user)

  if (scope.supported && user.role === scope.ownerRole.key) {
    return scope.ownerRole.label
  }

  if (isAdultPlayerUser(user)) {
    return 'Player'
  }

  return user.roleLabel || user.role || 'Unknown'
}

export function getWorkspaceHomeCopy(user) {
  if (!user) {
    return {
      title: 'Home',
      description: 'Open your workspace when your access has loaded.',
    }
  }

  const scope = getWorkspaceScope(user)

  if (scope.key === WORKSPACE_SCOPES.club && isClubAdmin(user)) {
    return {
      title: 'Club Home',
      description: 'Manage the club workspace, teams, Coaches, players, and settings.',
    }
  }

  if (scope.key === WORKSPACE_SCOPES.team && user.role === scope.ownerRole.key) {
    return {
      title: 'Team Home',
      description: 'Manage your team, Coaches, players, parent updates, and match day.',
    }
  }

  if (scope.key === WORKSPACE_SCOPES.individual && user.role === scope.ownerRole.key) {
    return {
      title: 'Coach Home',
      description: 'Manage your squad, sessions, players, and development records.',
    }
  }

  if (user.role === 'manager' || user.role === 'head_manager' || Number(user.roleRank ?? 0) >= 50) {
    return {
      title: 'Manager Home',
      description: 'Manage your team, sessions, players, parent updates, and match day.',
    }
  }

  if (user.role === 'coach' || user.role === 'assistant_coach' || Number(user.roleRank ?? 0) >= 20) {
    return {
      title: 'Coach Home',
      description: 'Run sessions, record notes, and keep player records up to date.',
    }
  }

  return {
    title: 'Home',
    description: 'Open your workspace when your access has loaded.',
  }
}

export function isSuperAdmin(user) {
  return user?.role === 'super_admin'
}

export function isDemoAccount(user) {
  return Boolean(user?.isDemoAccount) || isDemoUser(user)
}

export function canViewPlatformFeedback(user) {
  return Boolean(user) && !isDemoAccount(user) && !isAdultPlayerUser(user)
}

export function isClubAdmin(user) {
  return user?.role === 'admin' && isClubWorkspace(user)
}

export function isParentPortalUser(user) {
  return user?.role === 'parent_portal'
}

export function isAdultPlayerUser(user) {
  return user?.role === 'adult_player'
}

function isPortalOnlyUser(user) {
  return isParentPortalUser(user) || isAdultPlayerUser(user)
}

export function canManageUsers(user) {
  if (!user) {
    return false
  }

  if (!isSuperAdmin(user) && !isPlanAccessActive(user)) {
    return false
  }

  if (isIndividualWorkspace(user)) {
    return isSuperAdmin(user)
  }

  return isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50
}

export function canViewActivityLog(user) {
  return Boolean(user) && (isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50)
}

export function canUseDataTransfer(user) {
  if (!user || isPortalOnlyUser(user) || isDemoAccount(user)) {
    return false
  }

  if (isSuperAdmin(user)) {
    return true
  }

  const role = String(user.role ?? '')
  const minimumRoleRank = role === 'coach' ? 20 : 50
  return Boolean(user.clubId)
    && ['admin', 'head_manager', 'manager', 'coach'].includes(role)
    && Number(user.roleRank ?? 0) >= minimumRoleRank
    && canUseFeature(user, CAPABILITIES.bulkInvitesImports)
}

export function canManageTeamSettings(user) {
  return Boolean(user)
    && isPlanAccessActive(user)
    && (
      isClubAdmin(user)
      || (
        ['head_manager', 'manager'].includes(user.role)
        && Number(user.roleRank ?? 0) >= 50
        && Boolean(user.activeTeamId)
      )
    )
}

export function canViewEndSeasonStats(user) {
  if (!user?.clubId || isSuperAdmin(user) || isPortalOnlyUser(user) || !isPlanAccessActive(user)) {
    return false
  }

  if (isClubAdmin(user)) {
    return true
  }

  return Number(user?.roleRank ?? 0) >= 20 && Boolean(user?.activeTeamId)
}

export function canManageTeamAppearance(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && !isPortalOnlyUser(user) && isPlanAccessActive(user) && Number(user?.roleRank ?? 0) >= 50
}

export function canAssignRole(user, targetRole) {
  if (!user || !targetRole || isPortalOnlyUser(user)) {
    return false
  }

  if (isSuperAdmin(user)) {
    return targetRole.roleKey !== 'super_admin'
  }

  const currentRank = Number(user.roleRank ?? 0)
  const targetRank = Number(targetRole.roleRank ?? targetRole.rank ?? 0)

  return currentRank >= 50 && targetRank <= currentRank
}

export function canManageFormFields(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isPortalOnlyUser(user)
    && !isClubAdmin(user)
    && isPlanAccessActive(user)
    && Number(user?.roleRank ?? 0) >= 20
    && Boolean(user?.activeTeamId)
}

export function canManageFeedbackForms(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isPortalOnlyUser(user)
    && !isClubAdmin(user)
    && isPlanAccessActive(user)
    && Number(user?.roleRank ?? 0) >= 50
    && Boolean(user?.activeTeamId)
}

export function canManageParentEmailTemplates(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && isPlanAccessActive(user) && Number(user?.roleRank ?? 0) >= 50
}

export function canManageEmailQueue(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && !isPortalOnlyUser(user) && isPlanAccessActive(user) && Number(user?.roleRank ?? 0) >= 20
}

export function canManageClubSettings(user) {
  return isClubAdmin(user) && isPlanAccessActive(user)
}

export function canManageClubLogo(user) {
  return canManageClubSettings(user)
}

export function isTesterAccessExpired(user) {
  return Boolean(user?.testerAccessExpired)
}

export function canViewBilling(user) {
  if (!user) {
    return false
  }

  if (isSuperAdmin(user)) {
    return true
  }

  const scope = getWorkspaceScope(user.planKey)
  return Boolean(user.clubId)
    && user.role === scope.ownerRole.key
    && Number(user.roleRank ?? 0) >= scope.ownerRole.rank
}

export function canDeletePlayer(user) {
  return Boolean(user?.clubId) && !isPortalOnlyUser(user) && Number(user?.roleRank ?? 0) >= 20
}

export function canShareEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  return canViewEvaluation(user, evaluation)
}

export function canCreateEvaluation(user) {
  if (!user || isPortalOnlyUser(user)) {
    return false
  }

  return Boolean(user.clubId) && !isSuperAdmin(user) && (!isClubAdmin(user) || Boolean(user.activeTeamId)) && isPlanAccessActive(user)
}

export function hasTeamWorkflowContext(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isPortalOnlyUser(user)
    && isPlanAccessActive(user)
    && Boolean(user?.activeTeamId)
}

export function needsTeamWorkflowContext(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isPortalOnlyUser(user)
    && isPlanAccessActive(user)
    && !user?.activeTeamId
}

export function canManageParentLinks(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && !isPortalOnlyUser(user) && isPlanAccessActive(user)
}

export function canManagePolls(user) {
  if (!user?.clubId || isSuperAdmin(user) || isPortalOnlyUser(user) || !isPlanAccessActive(user)) {
    return false
  }

  if (isClubAdmin(user)) {
    return true
  }

  return Boolean(user.activeTeamId)
    && ['head_manager', 'manager', 'coach', 'assistant_coach'].includes(user.role)
}

export function canUseStaffChat(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isPortalOnlyUser(user)
    && isPlanAccessActive(user)
    && Number(user?.roleRank ?? 0) >= 20
}

export function canUseClubStaffChat(user) {
  return canUseStaffChat(user) && isClubWorkspace(user) && Number(user?.roleRank ?? 0) >= 70
}

export function canUseResourceLibrary(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isPortalOnlyUser(user)
    && isPlanAccessActive(user)
    && Number(user?.roleRank ?? 0) >= 20
}

export function canManageResourceLibrary(user) {
  return canUseResourceLibrary(user) && Number(user?.roleRank ?? 0) >= 50
}

function getFormationBoardTeamRoleRank(user) {
  if (isClubAdmin(user)) {
    return Number(user?.activeTeamAssignmentRoleRank ?? 0)
  }

  return Number(user?.roleRank ?? 0)
}

export function canUseFormationBoards(user) {
  if (!user?.clubId || !user?.activeTeamId || isSuperAdmin(user) || isPortalOnlyUser(user) || !isPlanAccessActive(user)) {
    return false
  }

  return isClubAdmin(user) || getFormationBoardTeamRoleRank(user) >= 20
}

export function canCreateFormationBoard(user) {
  return canUseFormationBoards(user) && getFormationBoardTeamRoleRank(user) >= 30
}

export function canEditFormationBoard(user, board) {
  if (!canUseFormationBoards(user) || !board || board.archivedAt) {
    return false
  }

  const teamRoleRank = getFormationBoardTeamRoleRank(user)

  return teamRoleRank >= 50
    || (teamRoleRank >= 30 && (board.visibilityState === 'shared' || String(board.createdByProfileId) === String(user?.id)))
}

export function canArchiveFormationBoard(user, board) {
  if (!canUseFormationBoards(user) || !board) {
    return false
  }

  const teamRoleRank = getFormationBoardTeamRoleRank(user)
  return teamRoleRank >= 50
    || (teamRoleRank >= 30 && String(board.createdByProfileId) === String(user?.id))
}

export function canManageMatchDay(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isPortalOnlyUser(user)
    && !isClubAdmin(user)
    && isPlanAccessActive(user)
    && Number(user?.roleRank ?? 0) >= 20
    && Boolean(user?.activeTeamId)
}

export function canEditEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  if (isPortalOnlyUser(user)) {
    return false
  }

  if (isSuperAdmin(user)) {
    return true
  }

  const evaluationClubId = evaluation.clubId || evaluation.club_id || ''

  if (!user.clubId || (evaluationClubId && String(evaluationClubId) !== String(user.clubId))) {
    return false
  }

  if (isClubAdmin(user) && !user.activeTeamId) {
    return false
  }

  const evaluationTeamId = evaluation.teamId || evaluation.team_id || ''
  if (evaluationTeamId && user.activeTeamId && String(evaluationTeamId) !== String(user.activeTeamId)) {
    return false
  }

  if (Number(user.roleRank ?? 0) >= 50) {
    return true
  }

  const evaluationCoachId = evaluation.coachId || evaluation.coach_id || ''
  if (evaluationCoachId) {
    return String(evaluationCoachId) === String(user.id)
  }

  const evaluationCoach = evaluation.coach || evaluation.coachName || ''
  return normalizeName(evaluationCoach) === normalizeName(user.name)
}

export function canViewEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  if (isPortalOnlyUser(user)) {
    return false
  }

  if (isSuperAdmin(user)) {
    return true
  }

  const evaluationClubId = evaluation.clubId || evaluation.club_id || ''

  if (!user.clubId || (evaluationClubId && String(evaluationClubId) !== String(user.clubId))) {
    return false
  }

  const evaluationTeamId = evaluation.teamId || evaluation.team_id || ''
  if (evaluationTeamId && user.activeTeamId && String(evaluationTeamId) !== String(user.activeTeamId)) {
    return false
  }

  if (Number(user.roleRank ?? 0) >= 50) {
    return !isClubAdmin(user) || Boolean(user.activeTeamId)
  }

  return canEditEvaluation(user, evaluation)
}
