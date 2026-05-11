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
    plans: commonPlayerPlans,
    minimumRank: 10,
    steps: [
      {
        target: 'sidebar-sessions',
        title: 'Sessions',
        body: 'Use Sessions to set up training, matches, and tournaments for the team you are currently viewing.',
      },
      {
        target: 'page-header',
        title: 'Run the session workflow',
        body: 'This page is where staff reopen existing sessions, add players, complete session work, and continue assessments later.',
      },
    ],
  },
  '/players': {
    key: 'players',
    plans: commonPlayerPlans,
    minimumRank: 10,
    steps: [
      {
        target: 'sidebar-players',
        title: 'Players',
        body: 'The Players page gives staff the active player list for their team view.',
      },
      {
        target: 'page-header',
        title: 'Player history',
        body: 'Open a player profile to review assessments, parent details, notes, actions, and long-term development history.',
      },
    ],
  },
  '/add-player': {
    key: 'add-player',
    plans: commonPlayerPlans,
    minimumRank: 10,
    steps: [
      {
        target: 'sidebar-add-player',
        title: 'Add Player',
        body: 'Add players here before placing them into sessions or starting assessments.',
      },
      {
        target: 'page-header',
        title: 'Create the player record',
        body: 'Record the player section, team, positions, and parent or guardian contacts. Parent contacts are used later for email and PDF options.',
      },
    ],
  },
  '/teams': {
    key: 'teams',
    minimumRank: 50,
    steps: [
      {
        target: 'sidebar-teams',
        title: 'Teams',
        body: 'Teams is where club admins create teams and team admins manage the team they are responsible for.',
      },
      {
        target: 'page-header',
        title: 'Control team access',
        body: 'Create teams, create staff accounts, and decide which staff can work inside each team.',
      },
      {
        target: 'team-logo-settings',
        title: 'Team logo',
        body: 'Use the selected team panel to upload the logo for that team.',
      },
    ],
  },
  '/user-access': {
    key: 'user-access',
    plans: [PLAN_KEYS.singleTeam, PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'sidebar-user-access',
        title: 'User Access',
        body: 'Use this page to allocate staff roles at your role level or below.',
      },
      {
        target: 'page-header',
        title: 'Role control',
        body: 'Staff access controls who can manage sessions, players, forms, logs, billing, and team administration.',
      },
    ],
  },
  '/form-builder': {
    key: 'form-builder',
    plans: [PLAN_KEYS.singleTeam, PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'sidebar-form-builder',
        title: 'Assessment Fields',
        body: 'Assessment Fields controls the fields your coaches use when scoring players.',
      },
      {
        target: 'page-header',
        title: 'Configure assessments',
        body: 'Default fields can be enabled or disabled. Custom fields let clubs shape the form around their own coaching model.',
      },
    ],
  },
  '/parent-email-templates': {
    key: 'parent-email-templates',
    plans: [PLAN_KEYS.singleTeam, PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'sidebar-parent-email-templates',
        title: 'Email Templates',
        body: 'Use Email Templates to prepare reusable parent messages for offers, invite backs, and no place offered outcomes.',
      },
      {
        target: 'page-header',
        title: 'Manage parent messaging',
        body: 'Templates save staff time and keep parent communication consistent. Coaches can use these templates when sending parent feedback.',
      },
    ],
  },
  '/activity-log': {
    key: 'activity-log',
    plans: [PLAN_KEYS.smallClub, PLAN_KEYS.largeClub],
    minimumRank: 50,
    steps: [
      {
        target: 'sidebar-activity-log',
        title: 'Activity Log',
        body: 'Activity Log shows accountability for the team or club areas your role is allowed to see.',
      },
      {
        target: 'page-header',
        title: 'Review staff activity',
        body: 'Use filters to see relevant activity by user and event type. Team staff only see activity for their active team.',
      },
    ],
  },
  '/archived-players': {
    key: 'archived-players',
    plans: commonPlayerPlans,
    minimumRank: 10,
    steps: [
      {
        target: 'sidebar-archived-players',
        title: 'Archived Players',
        body: 'Archived Players keeps removed players out of active lists while preserving their details and assessment history.',
      },
      {
        target: 'page-header',
        title: 'Restore when needed',
        body: 'Use this page to find archived players, review the archive reason, and restore them when they should return to active use.',
      },
    ],
  },
  '/billing': {
    key: 'billing',
    minimumRank: 0,
    steps: [
      {
        target: 'sidebar-billing',
        title: 'Billing',
        body: 'Billing is only available to the top billing role for the current plan.',
      },
      {
        target: 'page-header',
        title: 'Plan and payment details',
        body: 'Use this page to review plan status, billing dates, and payment actions for the account.',
      },
    ],
  },
  '/user-settings': {
    key: 'user-settings',
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
    platform: true,
    steps: [
      {
        target: 'sidebar-platform-admin',
        title: 'Platform Admin',
        body: 'Platform Admin is separate from club work and is used for account oversight.',
      },
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
