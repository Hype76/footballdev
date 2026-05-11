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
  '/sessions': {
    key: 'sessions',
    action: { label: 'Create Session', target: 'create-session-section' },
    plans: commonPlayerPlans,
    minimumRank: 10,
    steps: [
      {
        target: 'create-session-section',
        title: 'Create sessions',
        body: 'Set up training, match, and tournament sessions for the team you are currently viewing.',
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
  '/players': {
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
        body: 'Create the club teams that players, sessions, and assessments will use.',
      },
      {
        target: 'create-staff-section',
        title: 'Create staff access',
        body: 'Create staff logins, choose their role, and allocate them to a team.',
      },
      {
        target: 'team-staff-section',
        title: 'Control team access',
        body: 'Select a team, rename it if needed, and manage which staff can work inside it.',
      },
    ],
  },
  '/user-access': {
    key: 'user-access',
    action: { label: 'Open Teams', path: '/teams' },
    plans: [PLAN_KEYS.singleTeam, PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'page-header',
        title: 'Role control',
        body: 'Staff access controls who can manage sessions, players, forms, logs, billing, and team administration.',
      },
    ],
  },
  '/form-builder': {
    key: 'form-builder',
    action: { label: 'Configure Fields', target: 'page-header' },
    plans: [PLAN_KEYS.singleTeam, PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'page-header',
        title: 'Configure assessments',
        body: 'Default fields can be enabled or disabled. Custom fields let clubs shape the form around their own coaching model.',
      },
    ],
  },
  '/parent-email-templates': {
    key: 'parent-email-templates',
    action: { label: 'Edit Templates', target: 'page-header' },
    plans: [PLAN_KEYS.singleTeam, PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'page-header',
        title: 'Manage parent messaging',
        body: 'Templates save staff time and keep parent communication consistent. Coaches can use these templates when sending parent feedback.',
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
        body: 'Use filters to see relevant activity by user and event type. Team staff only see activity for their active team.',
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
    action: { label: 'View Plan Details', target: 'page-header' },
    minimumRank: 0,
    steps: [
      {
        target: 'page-header',
        title: 'Plan and payment details',
        body: 'Use this page to review plan status, billing dates, and payment actions for the account.',
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
    action: { label: 'Club Logo', target: 'club-profile-settings' },
    roles: ['admin'],
    minimumRank: 70,
    steps: [
      {
        target: 'page-header',
        title: 'Club Settings',
        body: 'Club admins control the shared club profile that appears across the workspace and parent previews.',
      },
      {
        target: 'club-profile-settings',
        title: 'Club profile',
        body: 'Set the club logo, club name, contact email, and contact phone from here.',
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
