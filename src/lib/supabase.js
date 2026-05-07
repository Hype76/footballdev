export {
  CLUB_LOGOS_BUCKET,
  EVALUATION_SECTIONS,
  MAX_LOGO_FILE_SIZE_BYTES,
  REQUEST_TIMEOUT_MS,
  supabase,
} from './supabase-client.js'

export {
  clearViewCaches,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from './cache.js'

export {
  formatParentContactEmails,
  formatParentContactNames,
  normalizeParentContacts,
} from './utils.js'

export {
  createClubAndManagerProfile,
  fetchUserProfile,
  normalizeUserProfile,
  requestLoginEmailChange,
  selectUserClub,
  updateOwnOnboardingSettings,
  updateOwnThemeSettings,
  updateOwnUserSettings,
  updateSignedInPassword,
} from './domain/auth-helpers.js'

export {
  addFormField,
  deleteFormField,
  getConfiguredFormFields,
  getDefaultFormFields,
  getFormFields,
  reorderFormFields,
  updateFormField,
} from './domain/form-fields.js'

export {
  createClubRole,
  createStaffUserWithPassword,
  deleteClubInvite,
  assignClubUserRole,
  canUpdateClubUserName,
  canRemoveClubUser,
  getClubRoles,
  getClubUserInvites,
  getClubUsers,
  getVisibleClubUsers,
  getDefaultClubRoles,
  removeClubUser,
  seedDefaultClubRolesForClub,
  SYSTEM_ROLE_OPTIONS,
  updateClubUserName,
} from './domain/roles.js'

export {
  createTeam,
  deleteTeam,
  getAssignedTeamsForUser,
  getAvailableTeamsForUser,
  getTeams,
  getTeamStaffAssignments,
  replaceTeamStaffAssignments,
  updateTeamSettings,
} from './domain/teams.js'

export {
  archivePlayer,
  createCommunicationLog,
  createPlayerStaffNote,
  createPlayer,
  deletePlayer,
  deletePlayerRecord,
  getPlayerCommunicationLogs,
  getPlayerDecisionLogs,
  getPlayerStaffNotes,
  getPlayers,
  promotePlayerToSquad,
  restorePlayer,
  updatePlayer,
} from './domain/players.js'

export {
  createEvaluation,
  deleteEvaluation,
  getEvaluations,
  updateEvaluation,
  updateEvaluationStatus,
} from './domain/evaluations.js'

export {
  addPlayersToAssessmentSession,
  clearAssessmentSessionPlayers,
  completeAssessmentSession,
  createAssessmentSession,
  createAssessmentSessionGame,
  deleteAssessmentSession,
  deleteAssessmentSessionGame,
  getAssessmentSessionGames,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  updateAssessmentSessionPlayer,
} from './domain/sessions.js'

export {
  createPlatformFeedback,
  deletePlatformFeedback,
  getPlatformFeedback,
  unvotePlatformFeedback,
  updatePlatformFeedback,
  votePlatformFeedback,
} from './domain/feedback.js'

export {
  createPlatformClub,
  deletePlatformClub,
  deletePlatformTeam,
  deletePlatformUser,
  getPlatformStats,
  updateClubSettings,
  getClubSettings,
  importClubLogoFromUrl,
  updatePlatformClubStatus,
  updatePlatformClubPlan,
  updatePlatformUserStatus,
  uploadClubLogo,
} from './domain/platform.js'

export {
  createAuditLog,
  getAuditLogs,
  getRecordBackups,
} from './domain/audit.js'
