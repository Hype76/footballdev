export const ACCESS_PLAN_KEYS = Object.freeze({
  individual: 'individual',
  singleTeam: 'single_team',
  smallClub: 'small_club',
  developmentClub: 'development_club',
  largeClub: 'large_club',
  pilot: 'pilot',
})

export const ACCESS_READINESS = Object.freeze({
  active: 'active',
  future: 'future',
  hidden: 'hidden',
  unavailable: 'unavailable',
})

export const ACCESS_LIMITS = Object.freeze({
  teams: 'teams',
  staffLogins: 'staffLogins',
  players: 'players',
  monthlyEvaluations: 'monthlyEvaluations',
})

export const CAPABILITIES = Object.freeze({
  secureAuthentication: 'secureAuthentication',
  accountProtection: 'accountProtection',
  safeguardingControls: 'safeguardingControls',
  essentialRolePermissions: 'essentialRolePermissions',
  parentalConsentVisibilityControls: 'parentalConsentVisibilityControls',
  safetyAuditability: 'safetyAuditability',
  dataRightsAccess: 'dataRightsAccess',
  dataRightsExport: 'dataRightsExport',
  dataRightsDeletion: 'dataRightsDeletion',
  basicDevelopmentRecords: 'basicDevelopmentRecords',
  goalsAndNotes: 'goalsAndNotes',
  basicPlayerFeedback: 'basicPlayerFeedback',
  limitedRecordHistory: 'limitedRecordHistory',
  responsiveWebPwa: 'responsiveWebPwa',
  footballPlayerBranding: 'footballPlayerBranding',
  familyPortalPreview: 'familyPortalPreview',
  fullTeamRecords: 'fullTeamRecords',
  fullRecordHistory: 'fullRecordHistory',
  assessments: 'assessments',
  standardAssessmentTemplates: 'standardAssessmentTemplates',
  customDevelopmentFields: 'customDevelopmentFields',
  monthlyEvaluations: 'monthlyEvaluations',
  playerNotes: 'playerNotes',
  attachments: 'attachments',
  standardProgressViews: 'standardProgressViews',
  parentPortal: 'parentPortal',
  parentInvitations: 'parentInvitations',
  parentEmails: 'parentEmails',
  pdfReports: 'pdfReports',
  parentCommunicationHistory: 'parentCommunicationHistory',
  teamCalendar: 'teamCalendar',
  trainingEvents: 'trainingEvents',
  fixtures: 'fixtures',
  generalEvents: 'generalEvents',
  matchDay: 'matchDay',
  teamPolls: 'teamPolls',
  teamStaffRoles: 'teamStaffRoles',
  basicLogoBranding: 'basicLogoBranding',
  basicActivityVisibility: 'basicActivityVisibility',
  clubAdministration: 'clubAdministration',
  clubStaffRoles: 'clubStaffRoles',
  sharedPlayerOversight: 'sharedPlayerOversight',
  bulkInvitesImports: 'bulkInvitesImports',
  clubWideCalendar: 'clubWideCalendar',
  clubWideEvents: 'clubWideEvents',
  recurringEvents: 'recurringEvents',
  calendarExportFeed: 'calendarExportFeed',
  sharedReportTemplates: 'sharedReportTemplates',
  customColoursBranding: 'customColoursBranding',
  fullOperationalAuditLog: 'fullOperationalAuditLog',
  basicClubAnalytics: 'basicClubAnalytics',
  advancedDevelopmentAnalytics: 'advancedDevelopmentAnalytics',
  playerPathways: 'playerPathways',
  coachHandovers: 'coachHandovers',
  scheduledReviewCycles: 'scheduledReviewCycles',
  approvalWorkflows: 'approvalWorkflows',
  customAssessmentTemplates: 'customAssessmentTemplates',
  customReportTemplates: 'customReportTemplates',
  clubWideOperationalExports: 'clubWideOperationalExports',
  scheduledParentReports: 'scheduledParentReports',
  prioritySupport: 'prioritySupport',
  negotiatedLimits: 'negotiatedLimits',
  bespokeBranding: 'bespokeBranding',
  assistedSetup: 'assistedSetup',
  dataMigration: 'dataMigration',
  customOnboarding: 'customOnboarding',
  rolloutPlanning: 'rolloutPlanning',
  integrations: 'integrations',
  externalCalendarIntegrations: 'externalCalendarIntegrations',
  dedicatedSupportContact: 'dedicatedSupportContact',
  agreedServiceTerms: 'agreedServiceTerms',
  platformAdminAccess: 'platformAdminAccess',
  nativeAppEntitlement: 'nativeAppEntitlement',
})

export const PLAN_ORDER = Object.freeze([
  ACCESS_PLAN_KEYS.individual,
  ACCESS_PLAN_KEYS.singleTeam,
  ACCESS_PLAN_KEYS.smallClub,
  ACCESS_PLAN_KEYS.developmentClub,
  ACCESS_PLAN_KEYS.largeClub,
])

export const TOP_TIER_PLAN_KEY = ACCESS_PLAN_KEYS.largeClub
export const INTERNAL_PLAN_KEYS = Object.freeze([
  ACCESS_PLAN_KEYS.pilot,
])

const ALL_PLANS = PLAN_ORDER
const SINGLE_TEAM_AND_ABOVE = PLAN_ORDER.slice(1)
const SMALL_CLUB_AND_ABOVE = PLAN_ORDER.slice(2)
const DEVELOPMENT_CLUB_AND_ABOVE = PLAN_ORDER.slice(3)
const LARGE_CLUB_ONLY = [ACCESS_PLAN_KEYS.largeClub]

export function getEntitlementPlanKey(planKey) {
  return String(planKey ?? '').trim() === ACCESS_PLAN_KEYS.pilot
    ? TOP_TIER_PLAN_KEY
    : String(planKey ?? '').trim()
}

function capability({
  key,
  label,
  category,
  minimumPlanKey = ACCESS_PLAN_KEYS.individual,
  includedPlans = ALL_PLANS,
  readiness = ACCESS_READINESS.active,
  requiresPayment = false,
  commercial = true,
  action = 'use it',
  rolePolicy = {},
  contextPolicy = {},
  setupRequirements = [],
  securityNotes = '',
  previewOnly = false,
  allowsLiveParentPlayerData = true,
}) {
  return Object.freeze({
    key,
    label,
    category,
    minimumPlanKey,
    includedPlans: Object.freeze([...includedPlans]),
    readiness,
    requiresPayment,
    commercial,
    action,
    rolePolicy: Object.freeze({ ...rolePolicy }),
    contextPolicy: Object.freeze({ ...contextPolicy }),
    setupRequirements: Object.freeze([...setupRequirements]),
    securityNotes,
    previewOnly,
    allowsLiveParentPlayerData,
  })
}

const coreCapability = (key, label, securityNotes) => capability({
  key,
  label,
  category: 'Core safety and rights',
  commercial: false,
  requiresPayment: false,
  action: 'keep accounts and data safe',
  securityNotes,
})

export const CAPABILITY_REGISTRY = Object.freeze({
  [CAPABILITIES.secureAuthentication]: coreCapability(CAPABILITIES.secureAuthentication, 'Secure authentication', 'Secure authentication is a baseline control, not a premium feature.'),
  [CAPABILITIES.accountProtection]: coreCapability(CAPABILITIES.accountProtection, 'Account protection', 'Account protection stays available wherever accounts exist.'),
  [CAPABILITIES.safeguardingControls]: coreCapability(CAPABILITIES.safeguardingControls, 'Safeguarding controls', 'Safeguarding controls must not be gated as paid value.'),
  [CAPABILITIES.essentialRolePermissions]: coreCapability(CAPABILITIES.essentialRolePermissions, 'Essential role permissions', 'Essential role and ownership checks stay separate from commercial entitlements.'),
  [CAPABILITIES.parentalConsentVisibilityControls]: coreCapability(CAPABILITIES.parentalConsentVisibilityControls, 'Parental consent and visibility controls', 'Consent and visibility controls follow the relevant parent feature and are not upsold separately.'),
  [CAPABILITIES.safetyAuditability]: coreCapability(CAPABILITIES.safetyAuditability, 'Safety auditability', 'Safety-critical auditability is separate from the premium operational audit log.'),
  [CAPABILITIES.dataRightsAccess]: coreCapability(CAPABILITIES.dataRightsAccess, 'Required data access rights', 'Required data access rights are not premium reporting exports.'),
  [CAPABILITIES.dataRightsExport]: coreCapability(CAPABILITIES.dataRightsExport, 'Required data export rights', 'Required data exports are separate from club-wide operational exports.'),
  [CAPABILITIES.dataRightsDeletion]: coreCapability(CAPABILITIES.dataRightsDeletion, 'Required data deletion rights', 'Required deletion rights are not premium features.'),

  [CAPABILITIES.basicDevelopmentRecords]: capability({ key: CAPABILITIES.basicDevelopmentRecords, label: 'Basic development records', category: 'Individual Coach - Free', commercial: false, action: 'record basic player development' }),
  [CAPABILITIES.goalsAndNotes]: capability({ key: CAPABILITIES.goalsAndNotes, label: 'Goals and notes', category: 'Individual Coach - Free', commercial: false, action: 'track goals and notes' }),
  [CAPABILITIES.basicPlayerFeedback]: capability({ key: CAPABILITIES.basicPlayerFeedback, label: 'Basic player feedback', category: 'Individual Coach - Free', commercial: false, action: 'record basic feedback' }),
  [CAPABILITIES.limitedRecordHistory]: capability({ key: CAPABILITIES.limitedRecordHistory, label: 'Limited record history', category: 'Individual Coach - Free', commercial: false, action: 'view limited history' }),
  [CAPABILITIES.responsiveWebPwa]: capability({ key: CAPABILITIES.responsiveWebPwa, label: 'Responsive web and PWA access', category: 'Individual Coach - Free', commercial: false, action: 'use the web app within plan limits' }),
  [CAPABILITIES.footballPlayerBranding]: capability({ key: CAPABILITIES.footballPlayerBranding, label: 'Football Player branding', category: 'Individual Coach - Free', commercial: false, action: 'use Football Player branding' }),
  [CAPABILITIES.familyPortalPreview]: capability({
    key: CAPABILITIES.familyPortalPreview,
    label: 'Family portal preview',
    category: 'Individual Coach - Free',
    commercial: false,
    action: 'show a non-operational family portal preview',
    previewOnly: true,
    allowsLiveParentPlayerData: false,
    securityNotes: 'Preview only. No live parent or player data, invitations, emails, PDFs, messaging, consent changes, or communication history.',
  }),

  [CAPABILITIES.fullTeamRecords]: capability({ key: CAPABILITIES.fullTeamRecords, label: 'Full records for one team', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'use full one-team records', contextPolicy: { requiresClub: true, requiresTeam: true } }),
  [CAPABILITIES.fullRecordHistory]: capability({ key: CAPABILITIES.fullRecordHistory, label: 'Full record history', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'view full record history' }),
  [CAPABILITIES.assessments]: capability({ key: CAPABILITIES.assessments, label: 'Assessments', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'create assessment sessions', contextPolicy: { requiresClub: true, requiresTeam: true }, rolePolicy: { minimumRoleRank: 20, blockedRoles: ['parent_portal'] } }),
  [CAPABILITIES.standardAssessmentTemplates]: capability({ key: CAPABILITIES.standardAssessmentTemplates, label: 'Standard assessment templates', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'use standard assessment templates' }),
  [CAPABILITIES.customDevelopmentFields]: capability({ key: CAPABILITIES.customDevelopmentFields, label: 'Custom development fields', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'change development fields', contextPolicy: { requiresClub: true, requiresTeam: true }, rolePolicy: { minimumRoleRank: 20, blockedRoles: ['parent_portal', 'super_admin'] } }),
  [CAPABILITIES.monthlyEvaluations]: capability({ key: CAPABILITIES.monthlyEvaluations, label: 'Monthly evaluations', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'create monthly evaluations' }),
  [CAPABILITIES.playerNotes]: capability({ key: CAPABILITIES.playerNotes, label: 'Player notes', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'write player notes' }),
  [CAPABILITIES.attachments]: capability({ key: CAPABILITIES.attachments, label: 'Attachments', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'use attachments' }),
  [CAPABILITIES.standardProgressViews]: capability({ key: CAPABILITIES.standardProgressViews, label: 'Standard progress views', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'view standard progress' }),
  [CAPABILITIES.parentPortal]: capability({ key: CAPABILITIES.parentPortal, label: 'Full Parent Portal', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'use the real Parent Portal', contextPolicy: { requiresClub: true, requiresLiveParentPlayerData: true } }),
  [CAPABILITIES.parentInvitations]: capability({ key: CAPABILITIES.parentInvitations, label: 'Parent invitations', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'send parent invitations', contextPolicy: { requiresClub: true, requiresTeam: true }, rolePolicy: { minimumRoleRank: 20, blockedRoles: ['parent_portal'] } }),
  [CAPABILITIES.parentEmails]: capability({ key: CAPABILITIES.parentEmails, label: 'Parent and player email', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'send emails to parents or players', contextPolicy: { requiresClub: true }, rolePolicy: { minimumRoleRank: 20, blockedRoles: ['parent_portal'] } }),
  [CAPABILITIES.pdfReports]: capability({ key: CAPABILITIES.pdfReports, label: 'PDF reports', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'create PDFs or attach PDFs to emails', contextPolicy: { requiresClub: true }, rolePolicy: { minimumRoleRank: 20, blockedRoles: ['parent_portal'] } }),
  [CAPABILITIES.parentCommunicationHistory]: capability({ key: CAPABILITIES.parentCommunicationHistory, label: 'Parent communication history', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'view parent communication history', contextPolicy: { requiresClub: true } }),
  [CAPABILITIES.teamCalendar]: capability({ key: CAPABILITIES.teamCalendar, label: 'Team calendar', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'use a team calendar', contextPolicy: { requiresClub: true, requiresTeam: true } }),
  [CAPABILITIES.trainingEvents]: capability({ key: CAPABILITIES.trainingEvents, label: 'Training events', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'manage training events' }),
  [CAPABILITIES.fixtures]: capability({ key: CAPABILITIES.fixtures, label: 'Fixtures', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'manage fixtures' }),
  [CAPABILITIES.generalEvents]: capability({ key: CAPABILITIES.generalEvents, label: 'General events', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'manage general events' }),
  [CAPABILITIES.matchDay]: capability({ key: CAPABILITIES.matchDay, label: 'Match day features', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'use match day features', contextPolicy: { requiresClub: true, requiresTeam: true }, rolePolicy: { minimumRoleRank: 20, blockedRoles: ['parent_portal', 'super_admin'] } }),
  [CAPABILITIES.teamPolls]: capability({ key: CAPABILITIES.teamPolls, label: 'Team polls', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'use team polls', contextPolicy: { requiresClub: true, requiresTeam: true }, rolePolicy: { minimumRoleRank: 20, blockedRoles: ['super_admin'] } }),
  [CAPABILITIES.teamStaffRoles]: capability({ key: CAPABILITIES.teamStaffRoles, label: 'Team staff roles', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'use team staff roles' }),
  [CAPABILITIES.basicLogoBranding]: capability({ key: CAPABILITIES.basicLogoBranding, label: 'Basic logo branding', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'change basic branding', contextPolicy: { requiresClub: true } }),
  [CAPABILITIES.basicActivityVisibility]: capability({ key: CAPABILITIES.basicActivityVisibility, label: 'Basic activity visibility', category: 'Single Team', minimumPlanKey: ACCESS_PLAN_KEYS.singleTeam, includedPlans: SINGLE_TEAM_AND_ABOVE, requiresPayment: true, action: 'view basic activity' }),

  [CAPABILITIES.clubAdministration]: capability({ key: CAPABILITIES.clubAdministration, label: 'Club administration', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'use club administration', contextPolicy: { requiresClub: true }, rolePolicy: { allowedRoles: ['admin', 'super_admin'] } }),
  [CAPABILITIES.clubStaffRoles]: capability({ key: CAPABILITIES.clubStaffRoles, label: 'Club staff roles', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'manage club staff roles', rolePolicy: { minimumRoleRank: 50 } }),
  [CAPABILITIES.sharedPlayerOversight]: capability({ key: CAPABILITIES.sharedPlayerOversight, label: 'Shared player oversight', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'use shared player oversight' }),
  [CAPABILITIES.bulkInvitesImports]: capability({ key: CAPABILITIES.bulkInvitesImports, label: 'Bulk invites and imports', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'use bulk invites or imports' }),
  [CAPABILITIES.clubWideCalendar]: capability({ key: CAPABILITIES.clubWideCalendar, label: 'Club-wide calendar', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'use a club-wide calendar', contextPolicy: { requiresClub: true }, rolePolicy: { allowedRoles: ['admin', 'super_admin'] } }),
  [CAPABILITIES.clubWideEvents]: capability({ key: CAPABILITIES.clubWideEvents, label: 'Club-wide events', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'manage club-wide events', contextPolicy: { requiresClub: true }, rolePolicy: { allowedRoles: ['admin', 'super_admin'] } }),
  [CAPABILITIES.recurringEvents]: capability({ key: CAPABILITIES.recurringEvents, label: 'Recurring events', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'create recurring events' }),
  [CAPABILITIES.calendarExportFeed]: capability({ key: CAPABILITIES.calendarExportFeed, label: 'Calendar export/feed', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'use calendar export/feed' }),
  [CAPABILITIES.sharedReportTemplates]: capability({ key: CAPABILITIES.sharedReportTemplates, label: 'Shared report templates', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'use shared report templates' }),
  [CAPABILITIES.customColoursBranding]: capability({ key: CAPABILITIES.customColoursBranding, label: 'Custom colours and club branding', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'use custom branding' }),
  [CAPABILITIES.fullOperationalAuditLog]: capability({ key: CAPABILITIES.fullOperationalAuditLog, label: 'Full operational audit log', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'view staff activity logs', contextPolicy: { requiresClub: true }, rolePolicy: { minimumRoleRank: 50 } }),
  [CAPABILITIES.basicClubAnalytics]: capability({ key: CAPABILITIES.basicClubAnalytics, label: 'Basic club analytics', category: 'Small Club', minimumPlanKey: ACCESS_PLAN_KEYS.smallClub, includedPlans: SMALL_CLUB_AND_ABOVE, requiresPayment: true, action: 'view basic club analytics' }),

  [CAPABILITIES.advancedDevelopmentAnalytics]: capability({ key: CAPABILITIES.advancedDevelopmentAnalytics, label: 'Advanced development analytics', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'use advanced development analytics' }),
  [CAPABILITIES.playerPathways]: capability({ key: CAPABILITIES.playerPathways, label: 'Player pathways across teams', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'use player pathways across teams' }),
  [CAPABILITIES.coachHandovers]: capability({ key: CAPABILITIES.coachHandovers, label: 'Coach handovers', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'use coach handovers' }),
  [CAPABILITIES.scheduledReviewCycles]: capability({ key: CAPABILITIES.scheduledReviewCycles, label: 'Scheduled review cycles', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'use scheduled review cycles' }),
  [CAPABILITIES.approvalWorkflows]: capability({ key: CAPABILITIES.approvalWorkflows, label: 'Approval workflows', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'change approval settings', rolePolicy: { allowedRoles: ['admin', 'super_admin'] } }),
  [CAPABILITIES.customAssessmentTemplates]: capability({ key: CAPABILITIES.customAssessmentTemplates, label: 'Custom assessment templates', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'use custom assessment templates' }),
  [CAPABILITIES.customReportTemplates]: capability({ key: CAPABILITIES.customReportTemplates, label: 'Custom report templates', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'use custom report templates' }),
  [CAPABILITIES.clubWideOperationalExports]: capability({ key: CAPABILITIES.clubWideOperationalExports, label: 'Club-wide operational exports', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'use club-wide operational exports', rolePolicy: { minimumRoleRank: 50 }, securityNotes: 'Premium operational exports are separate from required data rights exports.' }),
  [CAPABILITIES.scheduledParentReports]: capability({ key: CAPABILITIES.scheduledParentReports, label: 'Scheduled parent reports', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'use scheduled parent reports' }),
  [CAPABILITIES.prioritySupport]: capability({ key: CAPABILITIES.prioritySupport, label: 'Priority support', category: 'Development Club', minimumPlanKey: ACCESS_PLAN_KEYS.developmentClub, includedPlans: DEVELOPMENT_CLUB_AND_ABOVE, requiresPayment: true, action: 'use priority support' }),

  [CAPABILITIES.negotiatedLimits]: capability({ key: CAPABILITIES.negotiatedLimits, label: 'Negotiated limits', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use negotiated limits' }),
  [CAPABILITIES.bespokeBranding]: capability({ key: CAPABILITIES.bespokeBranding, label: 'Bespoke branding', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use bespoke branding' }),
  [CAPABILITIES.assistedSetup]: capability({ key: CAPABILITIES.assistedSetup, label: 'Assisted setup', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use assisted setup' }),
  [CAPABILITIES.dataMigration]: capability({ key: CAPABILITIES.dataMigration, label: 'Data migration', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use data migration' }),
  [CAPABILITIES.customOnboarding]: capability({ key: CAPABILITIES.customOnboarding, label: 'Custom onboarding', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use custom onboarding' }),
  [CAPABILITIES.rolloutPlanning]: capability({ key: CAPABILITIES.rolloutPlanning, label: 'Rollout planning', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use rollout planning' }),
  [CAPABILITIES.integrations]: capability({ key: CAPABILITIES.integrations, label: 'Integrations', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use integrations', setupRequirements: ['integrationsConfigured'], securityNotes: 'Large Club is eligible for integrations, but no integration is active without explicit configuration.' }),
  [CAPABILITIES.externalCalendarIntegrations]: capability({ key: CAPABILITIES.externalCalendarIntegrations, label: 'External calendar integrations', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use external calendar integrations', setupRequirements: ['externalCalendarIntegrationConfigured'], securityNotes: 'External calendar integrations default to Large Club and require explicit setup.' }),
  [CAPABILITIES.dedicatedSupportContact]: capability({ key: CAPABILITIES.dedicatedSupportContact, label: 'Dedicated support contact', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use a dedicated support contact' }),
  [CAPABILITIES.agreedServiceTerms]: capability({ key: CAPABILITIES.agreedServiceTerms, label: 'Agreed service terms', category: 'Large Club', minimumPlanKey: ACCESS_PLAN_KEYS.largeClub, includedPlans: LARGE_CLUB_ONLY, requiresPayment: true, action: 'use agreed service terms' }),

  [CAPABILITIES.platformAdminAccess]: capability({ key: CAPABILITIES.platformAdminAccess, label: 'Platform admin access', category: 'Platform', commercial: false, requiresPayment: false, action: 'use platform administration', rolePolicy: { allowedRoles: ['super_admin'] }, securityNotes: 'Platform authority comes from verified role, not plan fallback.' }),
  [CAPABILITIES.nativeAppEntitlement]: capability({ key: CAPABILITIES.nativeAppEntitlement, label: 'Native app entitlement', category: 'Future', includedPlans: [], readiness: ACCESS_READINESS.hidden, requiresPayment: false, action: 'use native apps', securityNotes: 'Native app entitlement remains inactive and hidden until separately approved.' }),
})

export const CAPABILITY_ALIASES = Object.freeze({
  approvalWorkflow: CAPABILITIES.approvalWorkflows,
  auditLogs: CAPABILITIES.fullOperationalAuditLog,
  basicBranding: CAPABILITIES.basicLogoBranding,
  customBranding: CAPABILITIES.customColoursBranding,
  customFormFields: CAPABILITIES.customDevelopmentFields,
  parentEmail: CAPABILITIES.parentEmails,
  pdfExport: CAPABILITIES.pdfReports,
  themes: CAPABILITIES.customColoursBranding,
  operationalExports: CAPABILITIES.clubWideOperationalExports,
  parentPortalPreview: CAPABILITIES.familyPortalPreview,
  realParentPortal: CAPABILITIES.parentPortal,
})

export const LEGACY_PLAN_FEATURE_KEYS = Object.freeze([
  'pdfExport',
  'parentEmail',
  'customFormFields',
  'basicBranding',
  'customBranding',
  'themes',
  'auditLogs',
  'approvalWorkflow',
])

export const LIMIT_REGISTRY = Object.freeze({
  [ACCESS_LIMITS.teams]: Object.freeze({
    label: 'Teams',
    source: 'PLAN_OPTIONS.limits.teams',
    notes: 'Approved team limits are 1, 1, 5, 10, and negotiated for Large Club.',
  }),
  [ACCESS_LIMITS.staffLogins]: Object.freeze({
    label: 'Staff logins',
    source: 'PLAN_OPTIONS.limits.staffLogins',
    notes: 'Small Club and Development Club preserve the currently enforced unlimited value until commercial numeric limits are approved.',
  }),
  [ACCESS_LIMITS.players]: Object.freeze({
    label: 'Players',
    source: 'PLAN_OPTIONS.limits.players',
    notes: 'Small Club and Development Club preserve the currently enforced unlimited value until commercial numeric limits are approved.',
  }),
  [ACCESS_LIMITS.monthlyEvaluations]: Object.freeze({
    label: 'Monthly evaluations',
    source: 'PLAN_OPTIONS.limits.monthlyEvaluations',
    notes: 'Individual remains limited. Paid tiers preserve unlimited monthly evaluations.',
  }),
})

export function normalizeCapabilityKey(capabilityKey) {
  const rawKey = String(capabilityKey ?? '').trim()
  return CAPABILITY_ALIASES[rawKey] || rawKey
}

export function getCapabilityDefinition(capabilityKey) {
  return CAPABILITY_REGISTRY[normalizeCapabilityKey(capabilityKey)] || null
}

export function isCapabilityKnown(capabilityKey) {
  return Boolean(getCapabilityDefinition(capabilityKey))
}

export function isCapabilityIncludedForPlan(planKey, capabilityKey) {
  const capabilityDefinition = getCapabilityDefinition(capabilityKey)

  if (!capabilityDefinition) {
    return false
  }

  return capabilityDefinition.includedPlans.includes(getEntitlementPlanKey(planKey))
}

export function getRequiredUpgradePlanKeyForCapability(capabilityKey, currentPlanKey = '') {
  const capabilityDefinition = getCapabilityDefinition(capabilityKey)

  if (!capabilityDefinition) {
    return ''
  }

  const currentIndex = PLAN_ORDER.indexOf(getEntitlementPlanKey(currentPlanKey))
  const searchStartIndex = currentIndex >= 0 ? currentIndex + 1 : 0
  return PLAN_ORDER.slice(searchStartIndex).find((planKey) => capabilityDefinition.includedPlans.includes(planKey)) || ''
}

export function getFeatureFlagMapForPlan(planKey) {
  const entitlementPlanKey = getEntitlementPlanKey(planKey)

  return Object.freeze(Object.fromEntries(
    LEGACY_PLAN_FEATURE_KEYS.map((featureName) => [featureName, isCapabilityIncludedForPlan(entitlementPlanKey, featureName)]),
  ))
}

export function getLimitDefinition(limitName) {
  return LIMIT_REGISTRY[String(limitName ?? '').trim()] || null
}
