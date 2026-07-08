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
  getContactTemplateAudiences,
  normalizeParentContacts,
  normalizePlayerContactType,
  PLAYER_CONTACT_TYPES,
} from './utils.js'

export {
  createClubAndManagerProfile,
  fetchUserProfile,
  normalizeUserProfile,
  requestLoginEmailChange,
  selectUserClub,
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
  archiveFeedbackForm,
  buildFeedbackFormSnapshot,
  canCompleteFeedbackForms,
  canManageFeedbackForms,
  createFeedbackForm,
  duplicateFeedbackForm,
  FEEDBACK_FORM_FIELD_TYPES,
  getActiveFeedbackFormForSubmission,
  getActiveFeedbackForms,
  getFeedbackForms,
  getUsableFeedbackFormFields,
  isGraphableFeedbackFormFieldType,
  normalizeFeedbackFormField,
  normalizeFeedbackFormRow,
  updateFeedbackForm,
  validateFeedbackFormDraft,
} from './domain/feedback-forms.js'

export {
  getDefaultClubParentEmailTemplates,
  getParentEmailTemplates,
  upsertParentEmailTemplate,
} from './domain/parent-email-templates.js'

export {
  createClubRole,
  createStaffInvite,
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
  acceptParentPortalInvite,
  createFamilyShareLink,
  createParentPortalInvites,
  createParentPortalInvitesForPlayers,
  getFamilyLinksForParentLink,
  getParentLinkingPlayers,
  getParentLinksForPlayer,
  getParentPortalLinks,
  getParentPortalMessages,
  markParentPortalMessageRead,
  prepareParentPortalEmailChange,
  revokeFamilyPortalLink,
  revokeParentPortalLink,
  updateOwnParentPortalLinksEmail,
  updateParentPortalDisplayName,
} from './domain/parent-portal.js'

export {
  archivePlayer,
  assignPlayerStaffNote,
  createCommunicationLog,
  createPlayerStaffNote,
  deletePlayerStaffNote,
  createPlayer,
  deleteArchivedPlayers,
  deletePlayer,
  deletePlayerRecord,
  getPlayerCommunicationLogs,
  getPlayerDecisionLogs,
  getAssessmentReminderLogs,
  getPlayerStaffNotes,
  getSessionStaffNotes,
  getUnassignedStaffVoiceNotes,
  getPlayers,
  movePlayerToTrial,
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
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvents,
  getParentPortalSharedCalendarEvents,
  updateCalendarEvent,
} from './domain/calendar-events.js'

export {
  buildTrainingAvailabilityPayload,
  cancelPendingTrainingAvailabilityRequests,
  getDefaultTrainingAvailabilityForm,
  getTrainingAvailabilityChipState,
  getTrainingAvailabilitySettingsForEvents,
  getTrainingAvailabilitySummaryForEvents,
  normalizeTrainingAvailabilityDetail,
  saveTrainingAvailabilitySettings,
  summarizeTrainingAvailabilityRows,
  TRAINING_AVAILABILITY_CHIP_STATES,
} from './domain/training-availability.js'

export {
  getCalendarEventInvites,
  getParentPortalEventInvites,
  saveCalendarEventInvites,
} from './domain/calendar-event-invites.js'

export {
  addPlayersToAssessmentSession,
  clearAssessmentSessionPlayers,
  completeAssessmentSession,
  createAssessmentSession,
  deleteAssessmentSession,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  updateAssessmentSession,
  updateAssessmentSessionPlayer,
} from './domain/sessions.js'

export {
  createPlatformFeedback,
  deletePlatformFeedback,
  getPlatformFeedbackAttachmentUrl,
  getPlatformFeedback,
  getPlatformFeedbackReports,
  unvotePlatformFeedback,
  updatePlatformFeedback,
  updatePlatformFeedbackReportStatus,
  votePlatformFeedback,
} from './domain/feedback.js'

export {
  createPoll,
  deletePoll,
  getParentPortalPolls,
  getPolls,
  POLL_AUDIENCE_OPTIONS,
  POLL_TYPE_OPTIONS,
  submitParentPortalPollVote,
  submitStaffPollVote,
  updatePollStatus,
} from './domain/polls.js'

export {
  archiveStaffChatConversation,
  createStaffChatConversation,
  deleteStaffChatMessage,
  getStaffChatConversations,
  getStaffChatMessages,
  getStaffChatStaffDirectory,
  getStaffChatTeams,
  markStaffChatConversationRead,
  sendStaffChatMessage,
  STAFF_CHAT_CONVERSATION_TYPES,
} from './domain/staff-chat.js'

export {
  archiveResourceLibraryItem,
  assignResourceLibraryItem,
  createExternalResourceLibraryItem,
  formatResourceLibraryFileSize,
  getAssignedResourcesForPlayer,
  getCalendarEventResources,
  getParentPortalPlayerResources,
  getResourceLibraryDownloadUrl,
  getResourceLibraryItems,
  getResourceLibraryPlayers,
  getResourceLibraryTeams,
  normalizeResourceLibraryItem,
  RESOURCE_LIBRARY_ALLOWED_MIME_TYPES,
  RESOURCE_LIBRARY_BUCKET,
  RESOURCE_LIBRARY_CATEGORIES,
  RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES,
  RESOURCE_LIBRARY_SHARE_DESCRIPTION_MAX_LENGTH,
  removeResourceLibraryLink,
  syncCalendarEventResourceLinks,
  uploadResourceLibraryItem,
  validateResourceLibraryFile,
} from './domain/resource-library.js'

export {
  addMatchDayGoalAsScorer,
  correctMatchDayGoalAsScorer,
  correctStaffMatchDayGoal,
  addStaffMatchDayEvent,
  addStaffMatchDayGoal,
  calculateArrivalTime,
  createMatchDayEventLogEntry,
  createMatchDay,
  expressMatchDayScorerInterest,
  getTodayMatchDayDateValue,
  getMatchDays,
  getMatchLocations,
  getParentPortalMatchDays,
  getParentPortalMatchDayPlayers,
  MATCH_DAY_ARRIVAL_OPTIONS,
  MATCH_DAY_HOME_AWAY_OPTIONS,
  MATCH_DAY_STATUS_OPTIONS,
  resetPreviousMatchDayResults,
  selectMatchDayScorer,
  selectMatchDayVolunteer,
  isPastMatchDayDate,
  isPastMatchDayDateTime,
  updateMatchDay,
  updateMatchDayScoreAsScorer,
  voidMatchDayGoalAsScorer,
  voidStaffMatchDayGoal,
} from './domain/match-day.js'

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

export {
  getEndSeasonStats,
} from './domain/season-stats.js'
