import { isClubAdmin, isSuperAdmin } from './auth-permissions.js'

export const CURRENT_RECOVERY_PHASE = 1

export const RECOVERY_MODULES = {
  activityLog: { phase: 6 },
  assessments: { phase: 1 },
  billing: { phase: 4, platformAdminOnlyDuringRecovery: true },
  clubSetup: { phase: 1 },
  emailMessages: { phase: 4 },
  formBuilder: { phase: 1 },
  help: { phase: 1 },
  matchDay: { phase: 1 },
  parentInvites: { phase: 3 },
  parentPortal: { phase: 1 },
  platformAdmin: { phase: 0, platformAdminOnlyDuringRecovery: true },
  platformFeedback: { phase: 6, platformAdminOnlyDuringRecovery: true },
  players: { phase: 1 },
  pollsAvailability: { phase: 4 },
  reports: { phase: 4 },
  sessions: { phase: 1 },
  shell: { phase: 1 },
  teamsStaff: { phase: 1 },
}

export function isRecoveryModuleVisible(moduleKey, { user } = {}) {
  const moduleConfig = RECOVERY_MODULES[moduleKey]

  if (!moduleConfig) {
    return true
  }

  if (moduleConfig.platformAdminOnlyDuringRecovery) {
    return isSuperAdmin(user)
  }

  if (moduleConfig.clubAdminOnlyDuringRecovery) {
    return isClubAdmin(user) || isSuperAdmin(user)
  }

  return Number(moduleConfig.phase ?? 99) <= CURRENT_RECOVERY_PHASE
}

export function getRecoveryModuleForPath(path) {
  const normalizedPath = String(path ?? '').split('?')[0].replace(/\/+$/, '') || '/'

  if (normalizedPath === '/match-day') {
    return 'matchDay'
  }

  if (normalizedPath === '/polls') {
    return 'pollsAvailability'
  }

  if (normalizedPath === '/parent-linking') {
    return 'parentInvites'
  }

  if (normalizedPath === '/parent-portal') {
    return 'parentPortal'
  }

  if (normalizedPath === '/parent-messages') {
    return 'emailMessages'
  }

  if (normalizedPath === '/parent-polls') {
    return 'pollsAvailability'
  }

  if (normalizedPath === '/friends-family') {
    return 'parentInvites'
  }

  if (['/email-queue', '/parent-email-templates'].includes(normalizedPath)) {
    return 'emailMessages'
  }

  if (normalizedPath === '/billing') {
    return 'billing'
  }

  if (normalizedPath === '/end-season-stats') {
    return 'reports'
  }

  if (normalizedPath === '/activity-log') {
    return 'activityLog'
  }

  if (normalizedPath === '/platform-feedback') {
    return 'platformFeedback'
  }

  if (normalizedPath === '/form-builder') {
    return 'formBuilder'
  }

  return ''
}

export function isRecoveryPathVisible(path, { user } = {}) {
  const moduleKey = getRecoveryModuleForPath(path)
  return moduleKey ? isRecoveryModuleVisible(moduleKey, { user }) : true
}
