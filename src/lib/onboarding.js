const ONBOARDING_STORAGE_PREFIX = 'player-feedback:onboarding:'

export const ONBOARDING_STEPS = [
  {
    id: 'sessions',
    title: 'Start with sessions',
    body: 'Create a training, match, or tournament session, then add the players you want to assess.',
    target: 'nav-sessions',
    path: '/sessions',
    roles: ['coach', 'assistant_coach', 'manager', 'head_manager'],
    plans: ['individual', 'single_team', 'small_club', 'large_club'],
  },
  {
    id: 'players',
    title: 'Manage players',
    body: 'Use Players to review trial and squad histories, open profiles, and continue assessments.',
    target: 'nav-players',
    path: '/players',
    roles: ['coach', 'assistant_coach', 'manager', 'head_manager'],
    plans: ['individual', 'single_team', 'small_club', 'large_club'],
  },
  {
    id: 'add-player',
    title: 'Add player records',
    body: 'Add player details, parent contacts, and positions before starting reports.',
    target: 'nav-add-player',
    path: '/add-player',
    roles: ['coach', 'assistant_coach', 'manager', 'head_manager'],
    plans: ['individual', 'single_team', 'small_club', 'large_club'],
  },
  {
    id: 'form-builder',
    title: 'Configure forms',
    body: 'Team admins and managers can adjust the assessment fields your staff use.',
    target: 'nav-form-builder',
    path: '/form-builder',
    roles: ['manager', 'head_manager'],
    plans: ['single_team', 'small_club', 'large_club'],
  },
  {
    id: 'user-access',
    title: 'Control staff access',
    body: 'Add staff, allocate them to the right team, and keep access scoped.',
    target: 'nav-user-access',
    path: '/user-access',
    roles: ['manager', 'head_manager', 'admin'],
    plans: ['single_team', 'small_club', 'large_club'],
  },
  {
    id: 'teams',
    title: 'Manage teams',
    body: 'Club admins can create teams and control team level staff allocations.',
    target: 'nav-teams',
    path: '/teams',
    roles: ['admin'],
    plans: ['small_club', 'large_club'],
  },
]

export function getOnboardingStorageKey(user) {
  return `${ONBOARDING_STORAGE_PREFIX}${user?.id || 'anonymous'}`
}

export function readDismissedOnboarding(user) {
  try {
    return window.localStorage.getItem(getOnboardingStorageKey(user)) === 'dismissed'
  } catch {
    return false
  }
}

export function writeDismissedOnboarding(user) {
  try {
    window.localStorage.setItem(getOnboardingStorageKey(user), 'dismissed')
  } catch {
    // Local storage is optional. The account setting still controls future sessions.
  }
}

export function clearDismissedOnboarding(user) {
  try {
    window.localStorage.removeItem(getOnboardingStorageKey(user))
  } catch {
    // Local storage is optional.
  }
}

export function getVisibleOnboardingSteps({ user, planKey }) {
  if (!user) {
    return []
  }

  return ONBOARDING_STEPS.filter((step) => {
    const roleMatches = step.roles.includes(user.role)
    const planMatches = step.plans.includes(planKey)
    return roleMatches && planMatches
  })
}

export async function restartOnboarding({ authUser, updateCurrentUserDetails, user, updateOwnOnboardingSettings }) {
  clearDismissedOnboarding(user)
  const updatedProfile = await updateOwnOnboardingSettings({
    authUser,
    enabled: true,
  })
  updateCurrentUserDetails(updatedProfile)
  window.dispatchEvent(new Event('player-feedback:onboarding-restart'))
  return updatedProfile
}
