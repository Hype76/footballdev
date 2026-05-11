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

const platformAdminSteps = [
  {
    title: 'Check platform status',
    body: 'Start with Platform Admin to review account totals, feedback, and any clubs needing attention.',
  },
  {
    title: 'Manage clubs separately',
    body: 'Use Club and Team Management for club setup. Keep platform work separate from normal club player workflows.',
  },
  {
    title: 'Review billing tools',
    body: 'Use Billing Options for Stripe promotion codes, live public promotions, and plan controls.',
  },
]

const clubAdminSteps = [
  {
    title: 'Create teams first',
    body: 'Use Teams to create club teams before coaches start adding players or sessions.',
  },
  {
    title: 'Create staff logins',
    body: 'Create staff access after teams exist, then allocate each staff member to the correct team.',
  },
  {
    title: 'Switch into team view',
    body: 'Use Workspace view to move from club admin tools into a team when you need player, session, or assessment tools.',
  },
]

const teamAdminSteps = [
  {
    title: 'Check team access',
    body: 'Use User Access to confirm staff roles and keep permissions clear for this team.',
  },
  {
    title: 'Prepare the assessment form',
    body: 'Use Assessment Fields and Email Templates when your plan includes them, then coaches can use the same workflow.',
  },
  {
    title: 'Run sessions',
    body: 'Use Sessions as the main working area for training, match, and tournament assessment queues.',
  },
]

const managerSteps = [
  {
    title: 'Prepare player records',
    body: 'Use Players and Add Player to keep parent contacts, positions, sections, and squad status accurate.',
  },
  {
    title: 'Run assessment sessions',
    body: 'Use Sessions to add players to a workflow, collect notes, and complete assessments.',
  },
  {
    title: 'Send parent feedback',
    body: 'Use player profiles and assessment previews to send the right parent message when your plan includes email.',
  },
]

const coachSteps = [
  {
    title: 'Open your team',
    body: 'Confirm the active team in Workspace view before adding players or completing assessments.',
  },
  {
    title: 'Use sessions first',
    body: 'Sessions keep the list of players and notes together, which makes assessment work clearer.',
  },
  {
    title: 'Review player history',
    body: 'Open Players to check previous assessments and staff notes before adding new feedback.',
  },
]

function getRoleOnboardingSteps(user) {
  if (isSuperAdmin(user)) {
    return platformAdminSteps
  }

  if (user?.role === 'admin' && !user?.activeTeamId) {
    return clubAdminSteps
  }

  if (user?.role === 'head_manager') {
    return teamAdminSteps
  }

  if (user?.role === 'manager') {
    return managerSteps
  }

  return coachSteps
}

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
    roles: ['admin'],
    minimumRank: 70,
    steps: [
      {
        target: 'sidebar-teams',
        title: 'Teams',
        body: 'Club Admin users manage club teams and staff allocation from here.',
      },
      {
        target: 'page-header',
        title: 'Control team access',
        body: 'Create teams, add staff accounts, and decide which staff can work inside each team.',
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
    steps: getRoleOnboardingSteps(user),
  }
}
