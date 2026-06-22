export const roleGuides = [
  {
    key: 'admin',
    label: 'Club Admin',
    rank: 90,
    summary: 'Owns the club workspace, billing access, teams, staff access, and club settings.',
    capabilities: [
      'Create teams and manage club level setup.',
      'Manage users and roles below Club Admin.',
      'View billing and plan controls for the club.',
      'Use audit and activity views when the plan includes them.',
    ],
  },
  {
    key: 'head_manager',
    label: 'Team Admin',
    rank: 70,
    summary: 'Runs team level operations and can manage key settings for assigned football staff.',
    capabilities: [
      'Manage assigned team sessions and development records.',
      'Use Development Fields when the plan includes custom form fields.',
      'Manage parent email templates when parent email is included.',
      'View billing on Individual accounts and where club access allows it.',
    ],
  },
  {
    key: 'manager',
    label: 'Manager',
    rank: 50,
    summary: 'Handles player records, sessions, development records, and parent communication.',
    capabilities: [
      'Add players and maintain player details.',
      'Create sessions and work through development queues.',
      'Create and edit club parent email templates where the plan allows it.',
      'Restore archived players only when the active player limit still allows it.',
    ],
  },
  {
    key: 'coach',
    label: 'Coach',
    rank: 30,
    summary: 'Completes development records and reviews visible player history for assigned teams.',
    capabilities: [
      'View assigned team players.',
      'Create development records from sessions or player profiles.',
      'Use the live preview while recording player development.',
      'Email reports only when the plan includes that feature.',
    ],
  },
  {
    key: 'assistant_coach',
    label: 'Assistant Coach',
    rank: 20,
    summary: 'Supports team work with limited access set by club managers.',
    capabilities: [
      'View assigned team information.',
      'Support player development records where access allows it.',
      'Review visible player history.',
    ],
  },
]

export const planGuides = [
  {
    key: 'individual',
    label: 'Individual Coach - Free',
    summary: 'Free account for one coach testing basic player records with a small squad.',
    details: [
      'One team, one staff login, up to five players, basic development records, goals, notes, and limited history.',
      'Family portal is preview only. Real parent access, parent communication, emails, and PDFs start at Single Team.',
      'Billing is visible so the account can upgrade from the sidebar.',
    ],
  },
  {
    key: 'single_team',
    label: 'Single Team',
    summary: 'The complete Football Player product for one team.',
    details: [
      'One team, up to five staff, and up to thirty players.',
      'Includes full record history, assessments, player notes, attachments, Parent Portal, parent emails, PDF reports, and communication history.',
      'Includes calendar, training events, fixtures, general events, match day, team polls, basic logo branding, and basic activity visibility.',
    ],
  },
  {
    key: 'small_club',
    label: 'Small Club',
    summary: 'Club plan for oversight across several teams.',
    details: [
      'Up to five teams, with staff and player limits kept as currently enforced until explicit commercial limits are approved.',
      'Includes club admin access, club staff roles, shared player oversight, bulk invites/imports, and club-wide calendar controls.',
      'Includes shared report templates, custom colours and club branding, full operational audit log, and basic club analytics.',
    ],
  },
  {
    key: 'development_club',
    label: 'Development Club',
    summary: 'Club plan for mature development operations across teams.',
    details: [
      'Up to ten teams, with staff and player limits kept as currently enforced until explicit commercial limits are approved.',
      'Includes advanced development analytics, player pathways, coach handovers, scheduled review cycles, and approval workflows.',
      'Includes custom assessment/report templates, club-wide operational exports, scheduled parent reports, and priority support.',
    ],
  },
  {
    key: 'large_club',
    label: 'Large Club',
    summary: 'Contact-sales plan for larger clubs and negotiated rollouts.',
    details: [
      'For more than ten teams with negotiated limits and agreed service terms.',
      'Includes assisted setup, data migration, custom onboarding, bespoke branding, rollout planning, and a dedicated support contact.',
      'Integrations are available only where agreed and configured.',
    ],
  },
]

export const platformAdminGuide = [
  {
    title: 'Club management',
    body: 'Create, suspend, reactivate, and delete club workspaces from Platform Admin. Player development content stays inside the club workspace.',
  },
  {
    title: 'Billing options',
    body: 'Create Stripe promotion codes, set one live website promotion, manage plan comping, and update club billing status.',
  },
  {
    title: 'Platform feedback',
    body: 'Review feedback from clubs, update statuses, add admin notes, and remove items that no longer need tracking.',
  },
  {
    title: 'Demo account',
    body: 'Demo data is reset and protected from destructive changes. Demo users can see billing for upgrade context. Restricted settings remain locked.',
  },
]

export const onboardingVideoGuides = [
  {
    key: 'workspace-start',
    title: 'Start in your workspace',
    duration: '1 min',
    src: '/onboarding/workspace-start.mp4',
    poster: '/onboarding/video-poster.svg',
    captions: '/onboarding/workspace-start.vtt',
    caption: 'A quick route through the sidebar, top bar, information page, and the first places most users need.',
    steps: [
      'Open the sidebar and choose the area you need.',
      'Use the top bar to confirm role, team, and club context.',
      'Return to Information when you need the guide library.',
    ],
  },
  {
    key: 'teams-staff',
    title: 'Set up teams and staff',
    duration: '2 min',
    src: '/onboarding/teams-staff.mp4',
    poster: '/onboarding/video-poster.svg',
    captions: '/onboarding/teams-staff.vtt',
    caption: 'Create teams, add staff logins, and allocate access based on the current plan and role limits.',
    steps: [
      'Create or review teams from Team Management.',
      'Invite staff or create staff logins.',
      'Assign each staff member only to the teams they should manage.',
    ],
  },
  {
    key: 'players',
    title: 'Add and manage players',
    duration: '2 min',
    src: '/onboarding/players.mp4',
    poster: '/onboarding/video-poster.svg',
    captions: '/onboarding/players.vtt',
    caption: 'Add players, keep details current, and understand how archived players affect plan limits.',
    steps: [
      'Add player details, team, section, positions, and shirt number where used.',
      'Open a player profile to review history and parent contacts.',
      'Archive players when they should no longer count as active.',
    ],
  },
  {
    key: 'sessions-development-records',
    title: 'Run sessions and development records',
    duration: '3 min',
    src: '/onboarding/sessions-assessments.mp4',
    poster: '/onboarding/video-poster.svg',
    captions: '/onboarding/sessions-assessments.vtt',
    caption: 'Build a session, add players, complete development fields, then preview the report before sharing.',
    steps: [
      'Create a training or match session and add the correct players.',
      'Open the development queue and complete each player report.',
      'Use preview before exporting or sending parent email.',
    ],
  },
  {
    key: 'development-fields',
    title: 'Configure development fields',
    duration: '2 min',
    src: '/onboarding/assessment-fields.mp4',
    poster: '/onboarding/video-poster.svg',
    captions: '/onboarding/assessment-fields.vtt',
    caption: 'Change the fields coaches complete so reports match the way your club reviews player development.',
    steps: [
      'Open Development Fields from the sidebar.',
      'Add, reorder, or remove fields for your club development records.',
      'Check the development form before coaches start a new session.',
    ],
  },
  {
    key: 'parent-email',
    title: 'Send parent emails',
    duration: '2 min',
    src: '/onboarding/parent-email.mp4',
    poster: '/onboarding/video-poster.svg',
    captions: '/onboarding/parent-email.vtt',
    caption: 'Use parent email templates and send feedback from the development record flow or player profile.',
    steps: [
      'Create or review parent email templates.',
      'Confirm parent contact details on the player profile.',
      'Send the report and review delivery from the queue where available.',
    ],
  },
  {
    key: 'billing',
    title: 'Review billing and plan limits',
    duration: '1 min',
    src: '/onboarding/billing.mp4',
    poster: '/onboarding/video-poster.svg',
    captions: '/onboarding/billing.vtt',
    caption: 'Check the current plan, what the plan unlocks, and why an upgrade may be needed.',
    steps: [
      'Open Billing from the sidebar.',
      'Compare plan limits with current club usage.',
      'Start checkout only when the club is ready to upgrade.',
    ],
  },
  {
    key: 'platform-admin',
    title: 'Manage clubs as platform admin',
    duration: '3 min',
    src: '/onboarding/platform-admin.mp4',
    poster: '/onboarding/video-poster.svg',
    captions: '/onboarding/platform-admin.vtt',
    caption: 'Create and manage clubs, billing options, promotions, and platform feedback without entering club content.',
    steps: [
      'Open Platform Admin to review platform level stats.',
      'Use Club Management for workspace status and plan checks.',
      'Use Billing Options and Platform Feedback for operational tasks.',
    ],
  },
]

export function formatLimit(value) {
  return value === null || value === undefined ? 'Unlimited' : String(value)
}
