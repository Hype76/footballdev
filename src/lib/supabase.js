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
  canRemoveClubUser,
  getClubRoles,
  getClubUserInvites,
  getClubUsers,
  getDefaultClubRoles,
  removeClubUser,
  seedDefaultClubRolesForClub,
  SYSTEM_ROLE_OPTIONS,
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
  createCommunicationLog,
  createPlayer,
  deletePlayer,
  deletePlayerRecord,
  getPlayers,
  promotePlayerToSquad,
  updatePlayer,
} from './domain/players.js'

export {
  createEvaluation,
  getEvaluations,
  updateEvaluation,
  updateEvaluationStatus,
} from './domain/evaluations.js'

export {
  addPlayersToAssessmentSession,
  clearAssessmentSessionPlayers,
  createAssessmentSession,
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
  getPlatformStats,
  updateClubSettings,
  getClubSettings,
  importClubLogoFromUrl,
  updatePlatformClubStatus,
  uploadClubLogo,
} from './domain/platform.js'
