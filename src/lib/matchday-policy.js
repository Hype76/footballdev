// Commercial entitlements only. Existing role and resource checks always apply.
export const MATCHDAY_BASELINE_CAPABILITIES = Object.freeze([
  'secureAuthentication', 'accountProtection', 'safeguardingControls',
  'essentialRolePermissions', 'parentalConsentVisibilityControls', 'safetyAuditability',
  'dataRightsAccess', 'dataRightsExport', 'dataRightsDeletion', 'responsiveWebPwa',
  'footballPlayerBranding',
])

export const MATCHDAY_DEFAULT_FLAGS = Object.freeze({
  players: true,
  teamCalendar: true, fixtures: true, matchDay: true, parentPortal: true,
  parentInvitations: true, parentEmails: true, pdfReports: true,
  nativeAppEntitlement: true, recurringEvents: true, calendarExportFeed: true,
  trainingEvents: false, generalEvents: false, teamPolls: false,
  basicDevelopmentRecords: false, goalsAndNotes: false, basicPlayerFeedback: false,
  limitedRecordHistory: false, fullTeamRecords: false, fullRecordHistory: false,
  assessments: false, standardAssessmentTemplates: false, customDevelopmentFields: false,
  monthlyEvaluations: false, playerNotes: false, attachments: false,
  standardProgressViews: false, parentCommunicationHistory: false,
  teamStaffRoles: false, basicLogoBranding: false, basicActivityVisibility: false,
  customColoursBranding: false, trialPlayers: false, resourceLibrary: false,
  staffChat: false, parentChat: false,
})

export const MATCHDAY_FEATURE_DEPENDENCIES = Object.freeze({
  fixtures: ['teamCalendar'], matchDay: ['fixtures'], recurringEvents: ['teamCalendar'],
  calendarExportFeed: ['teamCalendar'], trainingEvents: ['teamCalendar'], generalEvents: ['teamCalendar'],
  parentInvitations: ['parentPortal'], parentEmails: ['parentPortal'],
  pdfReports: ['matchDay'],
})

export const CLUB_ONLY_CAPABILITIES = Object.freeze([
  'clubAdministration', 'clubStaffRoles', 'sharedPlayerOversight', 'clubWideCalendar',
  'clubWideEvents', 'fullOperationalAuditLog', 'basicClubAnalytics',
  'advancedDevelopmentAnalytics', 'playerPathways', 'coachHandovers',
  'scheduledReviewCycles', 'approvalWorkflows', 'clubWideOperationalExports',
  'negotiatedLimits', 'assistedSetup', 'dataMigration', 'customOnboarding',
  'rolloutPlanning', 'dedicatedSupportContact', 'agreedServiceTerms',
])

export function validateMatchdayFlags(flags) {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) throw new Error('Feature settings must be an object.')
  const keys = Object.keys(MATCHDAY_DEFAULT_FLAGS)
  if (Object.keys(flags).length !== keys.length || keys.some(key => typeof flags[key] !== 'boolean')) {
    throw new Error('Every supported feature must have an explicit enabled or disabled value.')
  }
  for (const [key, dependencies] of Object.entries(MATCHDAY_FEATURE_DEPENDENCIES)) {
    if (flags[key] && dependencies.some(dependency => !flags[dependency])) {
      throw new Error(`${key} requires ${dependencies.join(', ')}.`)
    }
  }
  return Object.fromEntries(keys.map(key => [key, flags[key]]))
}

export function isMatchdayCapabilityEnabled(key, policy) {
  if (MATCHDAY_BASELINE_CAPABILITIES.includes(key)) return true
  const flags = policy?.flags ?? policy ?? MATCHDAY_DEFAULT_FLAGS
  return flags[key] === true && (MATCHDAY_FEATURE_DEPENDENCIES[key] || []).every(dependency => flags[dependency] === true)
}
