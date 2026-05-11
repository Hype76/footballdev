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
      'Manage assigned team workflows, sessions, and assessments.',
      'Use Assessment Fields when the plan includes custom form fields.',
      'Manage parent email templates when parent email is included.',
      'View billing on Individual accounts and where club access allows it.',
    ],
  },
  {
    key: 'manager',
    label: 'Manager',
    rank: 50,
    summary: 'Handles player records, sessions, assessments, and parent communication workflows.',
    capabilities: [
      'Add players and maintain player details.',
      'Create sessions and work through assessment queues.',
      'Create and edit club parent email templates where the plan allows it.',
      'Restore archived players only when the active player limit still allows it.',
    ],
  },
  {
    key: 'coach',
    label: 'Coach',
    rank: 30,
    summary: 'Completes assessments and reviews visible player history for assigned teams.',
    capabilities: [
      'View assigned team players.',
      'Create assessments from sessions or player profiles.',
      'Use the live preview while assessing players.',
      'Email reports only when the plan includes that feature.',
    ],
  },
  {
    key: 'assistant_coach',
    label: 'Assistant Coach',
    rank: 20,
    summary: 'Supports team workflow with limited access set by club managers.',
    capabilities: [
      'View assigned team information.',
      'Support player assessments where access allows it.',
      'Review visible player history.',
    ],
  },
]

export const planGuides = [
  {
    key: 'individual',
    label: 'Individual',
    summary: 'Free team admin account for a single team workspace.',
    details: [
      'One team, one staff login, five active players, and ten assessments per month.',
      'Assessment preview is available, but parent email sending is an upgrade feature.',
      'Billing is visible so the account can upgrade from the sidebar.',
    ],
  },
  {
    key: 'single_team',
    label: 'Single Team',
    summary: 'Paid plan for one team that needs sharing and form controls.',
    details: [
      'One team, three staff logins, and twenty active players.',
      'Includes parent emails, parent email templates, and custom form fields.',
      'Parent emails include a small Player Feedback website advert.',
    ],
  },
  {
    key: 'small_club',
    label: 'Small Club',
    summary: 'Club plan for several teams and fuller management controls.',
    details: [
      'Up to ten teams with unlimited players and staff logins.',
      'Includes parent emails, custom templates, custom branding, themes, and audit logs.',
      'Parent emails include a small Player Feedback website advert.',
    ],
  },
  {
    key: 'large_club',
    label: 'Large Club',
    summary: 'Expanded plan for larger organisations.',
    details: [
      'No standard team, staff, player, or monthly assessment limits.',
      'Includes the full club feature set.',
      'Used where the club needs a larger or custom operating model.',
    ],
  },
]

export const platformAdminGuide = [
  {
    title: 'Club management',
    body: 'Create, suspend, reactivate, and delete club workspaces from Platform Admin. Player assessment content stays inside the club workspace.',
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
    body: 'Demo data is reset and protected from destructive changes. Demo users can see billing for upgrade context, but cannot save restricted settings.',
  },
]

export function formatLimit(value) {
  return value === null || value === undefined ? 'Unlimited' : String(value)
}
