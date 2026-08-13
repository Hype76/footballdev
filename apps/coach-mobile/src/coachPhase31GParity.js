import { COACH_PARITY_MATRIX } from './coachParityAudit.js'

const DESTINATIONS = Object.freeze({
  Billing: 'Settings and global payment_required banner',
  Calendar: 'Calendar',
  Chat: 'More > Chat',
  Club: 'Global context switcher and header',
  Context: 'Global context switcher',
  Development: 'More > Development and Player detail',
  Governance: 'Authoritative web workflow',
  Home: 'Home',
  Invites: 'More > Invites and availability',
  'Match Day': 'Match Day',
  Messages: 'More > Messages',
  'Platform Admin': 'Not exposed',
  Players: 'Players',
  Polls: 'More > Polls',
  Reports: 'Authoritative web workflow',
  Resources: 'More > Resources',
  Sessions: 'More > Sessions',
  Settings: 'More > Settings',
  Team: 'Global Team context and scoped operational screens',
})

const COMPLETE = 'COMPLETE'
const WEB = 'INTENTIONAL_WEB_ONLY'
const GOVERNED = 'COMPLETE_WITH_WEB_GOVERNANCE'
const DECISION = 'PRODUCT_BACKEND_DECISION_REQUIRED'
const TEST_EXCLUSION = 'INTENTIONAL_TEST_EXCLUSION'

const CLOSURE = Object.freeze({
  1: { status: COMPLETE },
  2: { status: COMPLETE },
  3: { status: COMPLETE },
  4: { status: COMPLETE },
  5: { status: COMPLETE },
  6: { status: COMPLETE },
  7: { status: COMPLETE },
  8: { status: COMPLETE },
  9: { status: COMPLETE },
  10: { status: WEB, reason: 'Team transfer, archive, restore, and event-safe removal are destructive governance workflows with cross-record impact and remain on the authoritative web surface.' },
  11: { status: COMPLETE },
  12: { status: COMPLETE },
  13: { status: COMPLETE },
  14: { status: COMPLETE },
  15: { status: WEB, reason: 'The current product does not expose a canonical fixture-linked Formation Board contract to Coach mobile. Dense board editing and publication remain on the web until that linkage is a product decision.' },
  16: { status: COMPLETE },
  17: { status: COMPLETE },
  18: { status: COMPLETE },
  19: { status: COMPLETE },
  20: { status: COMPLETE },
  21: { status: COMPLETE },
  22: { status: COMPLETE },
  23: { status: DECISION, reason: 'No approved FA transport, message format, or provider integration exists. The app provides the verified result and refuses to invent or send a format.' },
  24: { status: TEST_EXCLUSION, reason: 'Transport coordination is intentionally disabled in the test runtime. Canonical Match Day state and audit intent are present, with real email, push, SMS, and Chat delivery fixed at zero.' },
  25: { status: COMPLETE },
  26: { status: GOVERNED, reason: 'Coaches consume canonical dynamic forms and fields in mobile. Template creation, age-guidance governance, and form administration remain on the dense web builder.' },
  27: { status: COMPLETE },
  28: { status: GOVERNED, reason: 'Private drafts, notes, configured fields, final records, and history are operational in mobile. Parent report sharing remains the server-owned governed web flow.' },
  29: { status: COMPLETE },
  30: { status: GOVERNED, reason: 'Authorised metadata, HTTPS links, signed access, and bounded sharing authority exist. Large upload, bulk assignment, archive, and retention governance remain web-only.' },
  31: { status: COMPLETE },
  32: { status: COMPLETE },
  33: { status: GOVERNED, reason: 'Canonical communication history and delivery evidence are visible. The product has no separate staff inbox model, while announcement authoring, schedules, and external delivery remain governed web communication.' },
  34: { status: COMPLETE },
  35: { status: COMPLETE },
  36: { status: COMPLETE },
  37: { status: GOVERNED, reason: 'Team identity, branding, role, roster, and operational scope drive the app. Staff assignment, squad governance, and Team administration remain web-only.' },
  38: { status: GOVERNED, reason: 'Club identity, branding, Club scope, Resources, and operational context are present. Club-wide staff and settings administration remain web-only.' },
  39: { status: COMPLETE },
  40: { status: GOVERNED, reason: 'Account identity, role, context, biometric security, and logout are present. Login email and password changes remain on the official governed Auth web flow.' },
  41: { status: COMPLETE },
  42: { status: WEB, reason: 'Season reports and authorised exports are dense review and file workflows. Day-to-day source records remain available in their operational mobile domains.' },
  43: { status: WEB, reason: 'Activity Log and backup history are low-frequency governance evidence and require the authoritative desktop web review surface.' },
  44: { status: WEB, reason: 'Spreadsheet import, mapping, rollback, and bulk data governance are unsafe and unusable as a pitch-side phone workflow.' },
  45: { status: WEB, reason: 'Organisation-wide Parent email template governance is low-frequency and can affect real recipients. Mobile consumes approved product behavior only.' },
  46: { status: WEB, reason: 'Checkout, payment methods, coupons, Stripe settings, and billing ownership are financial governance. Mobile enforces access but cannot change payer authority.' },
  47: { status: WEB, reason: 'Platform Admin tooling is global governance, not Coach operational authority. A Platform Admin needs a separate active staff membership to enter Coach mobile.' },
})

function webProduct(area) {
  const products = {
    Billing: 'BillingPage and server plan authority',
    Calendar: 'FootballCalendar and Calendar domain',
    Chat: 'StaffChatPage and ParentChatStaffPage',
    Club: 'ClubSettingsPage and Club workspace',
    Context: 'Canonical workspace and membership authority',
    Development: 'CreateEvaluationPage, FeedbackFormsPage, and evaluation domain',
    Governance: 'ActivityLogPage, DataTransferPage, and governance tools',
    Home: 'CoachHomePage and domain summaries',
    Invites: 'Match, training, and Calendar availability domains',
    'Match Day': 'MatchDayPage and canonical Match Day RPCs',
    Messages: 'Communication history and approved web communication workflows',
    'Platform Admin': 'PlatformAdminPage',
    Players: 'PlayersPage and PlayerProfile',
    Polls: 'PollsPage and Poll RPCs',
    Reports: 'Season reports and export workflows',
    Resources: 'ResourceLibraryPage and Resource RPCs',
    Sessions: 'SessionsPage and assessment session domain',
    Settings: 'UserSettingsPage and device-local settings',
    Team: 'TeamManagementPage and Team workspace',
  }
  return products[area] || area
}

export const COACH_PHASE_31G_PARITY_MATRIX = Object.freeze(COACH_PARITY_MATRIX.map((row, index) => {
  const closure = CLOSURE[index + 1]
  if (!closure) throw new Error(`coach_phase31g_closure_missing_${index + 1}`)
  return Object.freeze({
    archiveInactiveBehaviour: 'Current authority is revalidated. Archived, inactive, removed, stale, or wrong-scope targets fail closed; cached reads are stale and read-only only where permitted.',
    authorityPath: row.authoritySource || 'Canonical web domain, RLS, and server authority',
    billingBehaviour: 'Reads follow canonical policy. Mutations require active plan access and remain blocked by payment_required server authority.',
    capability: row.webCapability,
    exclusionReason: closure.reason || '',
    finalStatus: closure.status,
    mobileDestination: DESTINATIONS[row.area] || 'Authoritative web workflow',
    notificationDeepLinkClassification: row.notificationDeepLink || 'No notification category required. Direct navigation revalidates current authority.',
    offlineClassification: row.offlineBehaviour || (row.writeCapability ? 'Online required' : 'Encrypted scoped read cache where operationally useful'),
    readParity: [WEB, DECISION, TEST_EXCLUSION].includes(closure.status) ? 'Operational summary or authoritative web surface as stated' : 'Complete for the bounded mobile workflow',
    roles: Object.freeze([...(row.roles || [])]),
    row: index + 1,
    webProduct: webProduct(row.area),
    writeParity: closure.status === COMPLETE ? 'Complete through canonical online authority' : closure.status === GOVERNED ? 'Operational writes complete; governed actions remain web-only' : 'Not exposed in Coach test runtime',
  })
}))

export const COACH_PHASE_31G_UNRESOLVED_ROWS = Object.freeze(
  COACH_PHASE_31G_PARITY_MATRIX.filter((row) => ['MISSING', 'DEFECT'].includes(row.finalStatus)),
)

export const COACH_PHASE_31G_EXCLUSIONS = Object.freeze(
  COACH_PHASE_31G_PARITY_MATRIX.filter((row) => row.finalStatus !== COMPLETE),
)
