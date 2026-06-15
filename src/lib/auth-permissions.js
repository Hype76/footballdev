import { isDemoUser } from './demo.js'
import { isPlanAccessActive } from './plans.js'

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function getRoleLabel(user) {
  if (!user) {
    return 'Unknown'
  }

  if (user.role === 'admin') {
    return 'Club Admin'
  }

  if (user.role === 'head_manager') {
    return 'Team Admin'
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

  if (isClubAdmin(user)) {
    return {
      title: 'Club Home',
      description: 'Manage the club workspace, teams, staff, players, and settings.',
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
  return Boolean(user) && !isDemoAccount(user)
}

export function isClubAdmin(user) {
  return user?.role === 'admin'
}

export function isParentPortalUser(user) {
  return user?.role === 'parent_portal'
}

export function canManageUsers(user) {
  if (!user) {
    return false
  }

  if (!isSuperAdmin(user) && !isPlanAccessActive(user)) {
    return false
  }

  if (user.planKey === 'individual' && !user.isPlanComped) {
    return isSuperAdmin(user)
  }

  return isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50
}

export function canViewActivityLog(user) {
  return Boolean(user) && (isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50)
}

export function canManageTeamSettings(user) {
  return isClubAdmin(user) && isPlanAccessActive(user)
}

export function canViewEndSeasonStats(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && !isParentPortalUser(user) && isPlanAccessActive(user) && Number(user?.roleRank ?? 0) >= 50
}

export function canManageTeamAppearance(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && !isParentPortalUser(user) && isPlanAccessActive(user) && Number(user?.roleRank ?? 0) >= 50
}

export function canAssignRole(user, targetRole) {
  if (!user || !targetRole) {
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
    && !isParentPortalUser(user)
    && !isClubAdmin(user)
    && isPlanAccessActive(user)
    && Number(user?.roleRank ?? 0) >= 20
    && Boolean(user?.activeTeamId)
}

export function canManageParentEmailTemplates(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && isPlanAccessActive(user) && Number(user?.roleRank ?? 0) >= 50
}

export function canManageEmailQueue(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && !isParentPortalUser(user) && isPlanAccessActive(user) && Number(user?.roleRank ?? 0) >= 20
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

  return Boolean(user.clubId) && isClubAdmin(user)
}

export function canDeletePlayer(user) {
  return Boolean(user?.clubId) && Number(user?.roleRank ?? 0) >= 20
}

export function canShareEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  return canViewEvaluation(user, evaluation)
}

export function canCreateEvaluation(user) {
  if (!user) {
    return false
  }

  return Boolean(user.clubId) && !isSuperAdmin(user) && (!isClubAdmin(user) || Boolean(user.activeTeamId)) && isPlanAccessActive(user)
}

export function hasTeamWorkflowContext(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isParentPortalUser(user)
    && isPlanAccessActive(user)
    && Boolean(user?.activeTeamId)
}

export function needsTeamWorkflowContext(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isParentPortalUser(user)
    && isPlanAccessActive(user)
    && !user?.activeTeamId
}

export function canManageParentLinks(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && !isParentPortalUser(user) && isPlanAccessActive(user)
}

export function canManagePolls(user) {
  return Boolean(user?.clubId) && !isSuperAdmin(user) && !isParentPortalUser(user) && isPlanAccessActive(user) && Number(user?.roleRank ?? 0) >= 20
}

export function canManageMatchDay(user) {
  return Boolean(user?.clubId)
    && !isSuperAdmin(user)
    && !isParentPortalUser(user)
    && !isClubAdmin(user)
    && isPlanAccessActive(user)
    && Number(user?.roleRank ?? 0) >= 20
    && Boolean(user?.activeTeamId)
}

export function canEditEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  if (isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50) {
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

  if (isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50) {
    return true
  }

  const evaluationClubId = evaluation.clubId || evaluation.club_id || ''

  if (evaluationClubId && user.clubId) {
    return canEditEvaluation(user, evaluation) && String(evaluationClubId) === String(user.clubId)
  }

  return canEditEvaluation(user, evaluation)
}
