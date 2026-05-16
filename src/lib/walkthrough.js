import { isSuperAdmin } from './auth.js'
import { PLAN_KEYS, getPlanKey } from './plans.js'

export const WALKTHROUGH_EVENT = 'player-feedback-walkthrough-reset'

const STORAGE_PREFIX = 'player-feedback-walkthrough'

function getStorageKey(user) {
  return `${STORAGE_PREFIX}:${user?.id || 'anonymous'}`
}

function readState(user) {
  try {
    const storedValue = window.localStorage.getItem(getStorageKey(user))
    const parsedValue = storedValue ? JSON.parse(storedValue) : {}
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {}
  } catch (error) {
    console.error(error)
    return {}
  }
}

function writeState(user, nextState) {
  try {
    window.localStorage.setItem(getStorageKey(user), JSON.stringify(nextState))
  } catch (error) {
    console.error(error)
  }
}

export function getWalkthroughState(user) {
  return {
    completed: {},
    disabled: false,
    ...readState(user),
  }
}

export function markWalkthroughComplete(user, walkthroughKey) {
  const currentState = getWalkthroughState(user)
  writeState(user, {
    ...currentState,
    completed: {
      ...currentState.completed,
      [walkthroughKey]: true,
    },
  })
}

export function setWalkthroughDisabled(user, disabled) {
  const currentState = getWalkthroughState(user)
  writeState(user, {
    ...currentState,
    disabled: Boolean(disabled),
  })
  window.dispatchEvent(new CustomEvent(WALKTHROUGH_EVENT))
}

export function resetWalkthrough(user) {
  const currentState = getWalkthroughState(user)
  writeState(user, {
    ...currentState,
    completed: {},
    disabled: false,
  })
  window.dispatchEvent(new CustomEvent(WALKTHROUGH_EVENT))
}

function userHasMinimumRank(user, minimumRank) {
  return Number(user?.roleRank ?? 0) >= Number(minimumRank ?? 0)
}

function planMatches(user, allowedPlans) {
  if (!allowedPlans?.length) {
    return true
  }

  return allowedPlans.includes(getPlanKey(user))
}

function roleMatches(user, allowedRoles) {
  if (!allowedRoles?.length) {
    return true
  }

  return allowedRoles.includes(user?.role)
}

export function canUseWalkthrough(user, walkthrough) {
  if (!user || !walkthrough) {
    return false
  }

  if (isSuperAdmin(user)) {
    return Boolean(walkthrough.platform)
  }

  if (walkthrough.platform) {
    return false
  }

  return (
    roleMatches(user, walkthrough.roles) &&
    planMatches(user, walkthrough.plans) &&
    userHasMinimumRank(user, walkthrough.minimumRank)
  )
}

const commonPlayerPlans = [
  PLAN_KEYS.individual,
  PLAN_KEYS.singleTeam,
  PLAN_KEYS.smallClub,
  PLAN_KEYS.largeClub,
]

export const WALKTHROUGHS = {
  '/sessions/start': {
    key: 'sessions',
    action: { label: 'Create Session', target: 'create-session-section' },
    plans: commonPlayerPlans,
    minimumRank: 10,
    steps: [
      {
        target: 'create-session-section',
        title: 'Create sessions',
        body: 'Set up training and match sessions for the team you are currently viewing.',
      },
      {
        target: 'open-sessions-section',
        title: 'Open saved sessions',
        body: 'Reopen existing sessions to continue notes, add players, or carry on assessments later.',
      },
      {
        target: 'session-players-section',
        title: 'Session players',
        body: 'Use the selected session panel to add players, record voice notes, and start assessment work.',
      },
    ],
  },
  '/players/current': {
    key: 'players',
    action: { label: 'Add Player', path: '/add-player' },
    plans: commonPlayerPlans,
    minimumRank: 10,
    steps: [
      {
        target: 'players-list-section',
        title: 'Player history',
        body: 'Open a player profile to review assessments, parent details, notes, actions, and long-term development history.',
      },
    ],
  },
  '/add-player': {
    key: 'add-player',
    action: { label: 'Player Details', target: 'add-player-form-section' },
    plans: commonPlayerPlans,
    minimumRank: 10,
    steps: [
      {
        target: 'add-player-form-section',
        title: 'Create the player record',
        body: 'Record the player section, team, positions, and parent or guardian contacts. Parent contacts are used later for email and PDF options.',
      },
    ],
  },
  '/teams': {
    key: 'teams',
    action: { label: 'Create Team', target: 'create-team-section' },
    minimumRank: 50,
    steps: [
      {
        target: 'create-team-section',
        title: 'Create teams',
        body: 'Create the teams that players, sessions, and assessments will sit inside. Club profile and logo settings are handled in Club Settings.',
      },
      {
        target: 'create-staff-section',
        title: 'Create team staff',
        body: 'Create staff logins for people who need team access, then choose the role they should hold.',
      },
      {
        target: 'team-staff-section',
        title: 'Control team access',
        body: 'Select a team, rename it if needed, and manage which staff can work inside that team.',
      },
    ],
  },
  '/user-access': {
    key: 'user-access',
    action: { label: 'Allocate Role', target: 'allocate-role-section' },
    plans: [PLAN_KEYS.singleTeam, PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'page-header',
        title: 'Club user access',
        body: 'This Club area controls club-level accounts and roles. Team allocation remains on the Teams page.',
      },
      {
        target: 'allocate-role-section',
        title: 'Allocate role',
        body: 'Add a user email, set an initial password, and choose the highest club role this person should hold.',
      },
      {
        target: 'active-users-section',
        title: 'Review active users',
        body: 'Check who already has access, update display names where allowed, and remove users when they should no longer work in this club.',
      },
      {
        target: 'pending-allocations-section',
        title: 'Pending access',
        body: 'Pending allocations show emails that will receive their role when the person signs in.',
      },
    ],
  },
  '/form-builder': {
    key: 'form-builder',
    action: { label: 'Configure Fields', target: 'current-fields-section' },
    plans: [PLAN_KEYS.singleTeam, PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'page-header',
        title: 'Assessment fields',
        body: 'This Club area controls the assessment fields used across the club. Team admins use the fields that club admins make available.',
      },
      {
        target: 'default-form-section',
        title: 'Default form',
        body: 'Load the starting assessment form if the club does not have fields yet.',
      },
      {
        target: 'current-fields-section',
        title: 'Current fields',
        body: 'Enable, disable, reorder, and edit the fields coaches will see during assessments.',
      },
      {
        target: 'add-field-section',
        title: 'Custom fields',
        body: 'Add club-specific fields when the default form does not match the coaching model.',
      },
    ],
  },
  '/parent-email-templates': {
    key: 'parent-email-templates',
    action: { label: 'Edit Templates', target: 'email-template-editor-section' },
    plans: [PLAN_KEYS.singleTeam, PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'page-header',
        title: 'Email templates',
        body: 'This Club area controls the saved email templates available to staff when sending parent or player messages.',
      },
      {
        target: 'email-template-editor-section',
        title: 'Template editor',
        body: 'Edit default templates, create custom templates, set where each template is available, and use fields to personalise the message.',
      },
    ],
  },
  '/bulk-email': {
    key: 'bulk-email',
    action: { label: 'Write Email', target: 'bulk-email-message-section' },
    plans: [PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    roles: ['admin'],
    minimumRank: 70,
    steps: [
      {
        target: 'page-header',
        title: 'Bulk email',
        body: 'This Club area sends one club-wide email to selected parent or player contacts. Recipients are hidden from each other.',
      },
      {
        target: 'bulk-email-message-section',
        title: 'Message',
        body: 'Choose parents or players, write the subject and message, and confirm the reply address before sending.',
      },
      {
        target: 'bulk-email-recipients-section',
        title: 'Recipients',
        body: 'Review the contacts before sending so the email only goes to the right people.',
      },
    ],
  },
  '/activity-log': {
    key: 'activity-log',
    action: { label: 'Review Activity', target: 'page-header' },
    plans: [PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'page-header',
        title: 'Review staff activity',
        body: 'This Club area shows staff activity by user and event type. Team staff only see activity for their active team.',
      },
    ],
  },
  '/archived-players': {
    key: 'archived-players',
    action: { label: 'Find Archived Players', target: 'page-header' },
    plans: commonPlayerPlans,
    minimumRank: 10,
    steps: [
      {
        target: 'page-header',
        title: 'Restore when needed',
        body: 'Use this page to find archived players, review the archive reason, and restore them when they should return to active use.',
      },
    ],
  },
  '/billing': {
    key: 'billing',
    action: { label: 'View Plan Details', target: 'current-plan-section' },
    minimumRank: 0,
    steps: [
      {
        target: 'page-header',
        title: 'Plan and payment details',
        body: 'This Club area shows the plan, billing status, renewal details, and invoices for the club account.',
      },
      {
        target: 'current-plan-section',
        title: 'Current plan',
        body: 'Check the active tier and status before changing access or investigating billing issues.',
      },
      {
        target: 'invoices-section',
        title: 'Invoices',
        body: 'View or download invoices once billing has created them for this subscription.',
      },
    ],
  },
  '/user-settings': {
    key: 'user-settings',
    action: { label: 'Account Profile', target: 'account-profile-settings' },
    minimumRank: 0,
    steps: [
      {
        target: 'page-header',
        title: 'My Settings',
        body: 'Use this page for your personal profile, sender details, display settings, walkthrough controls, login email, and password.',
      },
      {
        target: 'account-profile-settings',
        title: 'Profile and sender details',
        body: 'Your name appears in the workspace. Reply email and sender labels control parent-facing email details where your role allows it.',
      },
      {
        target: 'display-settings',
        title: 'Display',
        body: 'Theme and accent controls change how the workspace looks for your account.',
      },
      {
        target: 'walkthrough-settings',
        title: 'Walkthrough controls',
        body: 'Restart walkthroughs after training, or hide them once you no longer need page tips.',
      },
      {
        target: 'login-email-settings',
        title: 'Login email',
        body: 'Change the email address used for signing in. Demo accounts may block this setting.',
      },
      {
        target: 'password-settings',
        title: 'Password',
        body: 'Change your password while signed in, or send a reset email if needed.',
      },
    ],
  },
  '/club-settings': {
    key: 'club-settings',
    action: { label: 'Club Profile', target: 'club-profile-settings' },
    roles: ['admin'],
    minimumRank: 70,
    steps: [
      {
        target: 'page-header',
        title: 'Club Settings',
        body: 'This Club area controls shared club details. Personal settings stay in My Settings and team setup stays in Teams.',
      },
      {
        target: 'club-profile-settings',
        title: 'Club profile',
        body: 'Set the club name, contact details, and club logo. The club logo is used across all teams in this club.',
      },
      {
        target: 'sidebar-club-section',
        title: 'Club section',
        body: 'Use this sidebar section for club-wide tools: settings, user access, assessment fields, email templates, bulk email, activity log, and billing.',
      },
    ],
  },
  '/platform-admin': {
    key: 'platform-admin',
    action: { label: 'Platform Overview', target: 'page-header' },
    platform: true,
    steps: [
      {
        target: 'page-header',
        title: 'Platform oversight',
        body: 'Use this area to manage clubs, billing options, feedback, and platform-wide usage without exposing player details.',
      },
    ],
  },
}

export function getWalkthroughForPath(pathname, user) {
  const walkthrough = WALKTHROUGHS[pathname]

  if (!canUseWalkthrough(user, walkthrough)) {
    return null
  }

  return {
    ...walkthrough,
  }
}
