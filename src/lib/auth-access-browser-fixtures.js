import { createElement, useState } from 'react'
import { isParentPortalHost } from './app-origins.js'
import { DEMO_EMAIL, DEMO_PASSWORD } from './demo.js'
import { resolveAccessModeForRoute } from './parent-auth-intent.js'
import { canSwitchParentToStaff } from './staff-workspace-access.js'

const FIXTURE_SESSION_KEY = 'auth-access-browser-fixture-email'
const FIXTURE_ACCESS_MODE_KEY = 'selected-access-mode'
const FIXTURE_ACCESS_MODE_EXPLICIT_KEY = 'selected-access-mode-explicit'
const FIXTURE_SELECTED_TEAM_KEY = 'selected-team-id'
const FIXTURE_LOGIN_INTENT_KEY = 'login-access-intent'
const FIXTURE_PROFILE_PATCH_PREFIX = 'auth-access-browser-fixture-profile-patch:'

const teamOptions = [
  {
    id: 'team-u12',
    name: 'U12 Fixture Team',
    themeAccent: 'green',
    themeButtonStyle: 'solid',
  },
]

const clubOptions = [
  {
    clubId: 'club-fixture',
    clubName: 'Fixture United',
  },
]

const parentPortalLinks = [
  {
    id: 'parent-link-fixture',
    playerId: 'player-fixture',
    playerName: 'Fixture Child',
    clubId: 'club-fixture',
    clubName: 'Fixture United',
    clubLogoUrl: '/assets/football-player-logo.png',
    teamId: 'team-u12',
    teamName: 'U12 Fixture Team',
    status: 'active',
  },
]

const multipleParentPortalLinks = [
  ...parentPortalLinks,
  {
    id: 'parent-link-fixture-second',
    playerId: 'player-fixture-second',
    playerName: 'Second Fixture Child',
    clubId: 'club-fixture',
    clubName: 'Fixture United',
    teamId: 'team-u12',
    teamName: 'U12 Fixture Team',
    status: 'active',
  },
]

function makeAuthUser(email) {
  return {
    id: `auth-${email}`,
    email,
  }
}

function makeBaseProfile(email, overrides = {}) {
  return {
    id: `user-${email}`,
    authUserId: `auth-${email}`,
    email,
    name: overrides.name || 'Fixture User',
    username: overrides.name || 'Fixture User',
    displayName: overrides.name || 'Fixture User',
    clubId: 'club-fixture',
    clubName: 'Fixture United',
    team: 'Fixture United',
    planKey: 'small_club',
    planStatus: 'active',
    isPlanComped: true,
    role: 'coach',
    roleLabel: 'Coach',
    roleRank: 30,
    activeTeamId: 'team-u12',
    activeTeamName: 'U12 Fixture Team',
    parentPortalLinks: [],
    themeAccent: 'green',
    themeButtonStyle: 'solid',
    ...overrides,
  }
}

function getFixtureProfilePatchKey(email) {
  return `${FIXTURE_PROFILE_PATCH_PREFIX}${String(email ?? '').trim().toLowerCase()}`
}

function readFixtureProfilePatch(email) {
  const normalizedEmail = String(email ?? '').trim().toLowerCase()

  if (!normalizedEmail) {
    return {}
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(getFixtureProfilePatchKey(normalizedEmail)) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function getProductionShapedStaffOptions(account) {
  return canSwitchParentToStaff(account?.staffAccessData)
    ? [{ id: 'team', label: 'Team / Coach', meta: 'Open coaching and club tools' }]
    : []
}

const fixtureAccounts = {
  [DEMO_EMAIL]: {
    password: DEMO_PASSWORD,
    hasPlatformAdminAccess: false,
    defaultMode: 'team',
    teamProfile: makeBaseProfile(DEMO_EMAIL, {
      name: 'Demo Fixture',
      role: 'admin',
      roleLabel: 'Club Admin',
      roleRank: 80,
      activeTeamId: '',
      activeTeamName: '',
    }),
  },
  'platform.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: true,
    defaultMode: 'platform_admin',
    platformProfile: makeBaseProfile('platform.fixture@footballplayer.test', {
      name: 'Platform Fixture',
      role: 'super_admin',
      roleLabel: 'Platform Admin',
      roleRank: 100,
      clubId: '',
      clubName: 'Platform',
      team: 'Platform',
      activeTeamId: '',
      activeTeamName: '',
      clubOptions,
      parentPortalLinks: [],
    }),
  },
  'club.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'team',
    teamProfile: makeBaseProfile('club.fixture@footballplayer.test', {
      name: 'Club Fixture',
      role: 'admin',
      roleLabel: 'Club Admin',
      roleRank: 80,
      activeTeamId: '',
      activeTeamName: '',
    }),
  },
  'other-club.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'team',
    teamProfile: makeBaseProfile('other-club.fixture@footballplayer.test', {
      name: 'Other Club Fixture',
      role: 'admin',
      roleLabel: 'Club Admin',
      roleRank: 80,
      clubId: 'club-other-fixture',
      clubName: 'Other Fixture FC',
      team: 'Other Fixture FC',
      activeTeamId: '',
      activeTeamName: '',
      themeAccent: 'blue',
      themeButtonStyle: 'solid',
    }),
  },
  'coach.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'team',
    teamProfile: makeBaseProfile('coach.fixture@footballplayer.test', {
      name: 'Coach Fixture',
      role: 'coach',
      roleLabel: 'Coach',
      roleRank: 30,
    }),
  },
  'assistant.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'team',
    teamProfile: makeBaseProfile('assistant.fixture@footballplayer.test', {
      name: 'Assistant Fixture',
      role: 'assistant_coach',
      roleLabel: 'Assistant Coach',
      roleRank: 20,
    }),
  },
  'manager.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'team',
    teamProfile: makeBaseProfile('manager.fixture@footballplayer.test', {
      name: 'Manager Fixture',
      role: 'manager',
      roleLabel: 'Manager',
      roleRank: 50,
    }),
  },
  'team-admin.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'team',
    teamProfile: makeBaseProfile('team-admin.fixture@footballplayer.test', {
      name: 'Team Admin Fixture',
      role: 'head_manager',
      roleLabel: 'Team Admin',
      roleRank: 70,
    }),
  },
  'parent.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'parent',
    parentProfile: makeBaseProfile('parent.fixture@footballplayer.test', {
      name: 'Parent Fixture',
      role: 'parent_portal',
      roleLabel: 'Parent',
      roleRank: 0,
      clubId: '',
      clubName: 'Fixture Family',
      team: 'Fixture Family',
      activeTeamId: '',
      activeTeamName: '',
      parentPortalLinks,
    }),
  },
  'parent-multiple.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'parent',
    parentProfile: makeBaseProfile('parent-multiple.fixture@footballplayer.test', {
      name: 'Multiple Child Parent Fixture',
      role: 'parent_portal',
      roleLabel: 'Parent',
      roleRank: 0,
      clubId: '',
      clubName: 'Fixture Family',
      team: 'Fixture Family',
      activeTeamId: '',
      activeTeamName: '',
      parentPortalLinks: multipleParentPortalLinks,
    }),
  },
  'parent-unlinked.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'parent',
    parentProfileUnavailable: true,
  },
  'adult-player.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'player',
    playerProfile: makeBaseProfile('adult-player.fixture@footballplayer.test', {
      name: 'Adult Player Fixture',
      displayName: 'Adult Player Fixture',
      role: 'adult_player',
      roleLabel: 'Player',
      roleRank: 0,
      accessMode: 'player',
      planKey: 'individual',
      activeTeamId: 'team-u12',
      activeTeamName: 'U12 Fixture Team',
      adultPlayerLinkId: 'adult-player-link-fixture',
      adultPlayerLinkStatus: 'active',
      selectedPlayerId: 'adult-player-fixture',
      selectedPlayerName: 'Adult Player Fixture',
      parentPortalLinks: [],
    }),
  },
  'fallback-dual.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'parent',
    parentProfileUnavailable: true,
    teamProfile: makeBaseProfile('fallback-dual.fixture@footballplayer.test', {
      name: 'Fallback Dual Fixture',
      role: 'admin',
      roleLabel: 'Club Admin',
      roleRank: 80,
      activeTeamId: '',
      activeTeamName: '',
      parentPortalLinks: [],
    }),
    fallbackAccessModeOptions: [
      { id: 'team', label: 'Team / Coach', meta: 'Open coaching and club tools' },
    ],
  },
  'lookup-failed-dual.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'parent',
    parentProfileUnavailable: true,
    parentAccessReason: 'lookup_failed',
    teamProfile: makeBaseProfile('lookup-failed-dual.fixture@footballplayer.test', {
      name: 'Lookup Failed Dual Fixture',
      role: 'admin',
      roleLabel: 'Club Admin',
      roleRank: 80,
      activeTeamId: '',
      activeTeamName: '',
      parentPortalLinks: [],
    }),
    fallbackAccessModeOptions: [
      { id: 'team', label: 'Team / Coach', meta: 'Open coaching and club tools' },
    ],
  },
  'stale-label-dual.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: false,
    defaultMode: 'parent',
    parentProfileUnavailable: true,
    hideTeamOptions: true,
    teamProfile: makeBaseProfile('stale-label-dual.fixture@footballplayer.test', {
      name: 'Stale Label Fixture',
      role: 'admin',
      roleLabel: 'Team Admin',
      roleRank: 80,
      activeTeamId: 'team-u17-green',
      activeTeamName: 'U17 Green',
      parentPortalLinks,
    }),
    fallbackAccessModeOptions: [
      { id: 'team', label: 'Team / Coach', meta: 'Open coaching and club tools' },
    ],
  },
  'multi.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: true,
    defaultMode: 'platform_admin',
    staffAccessData: {
      profile: {
        id: 'staff-profile-fixture',
        status: 'active',
      },
      memberships: [
        {
          auth_user_id: 'auth-multi.fixture@footballplayer.test',
          club_id: 'club-fixture',
          club_status: 'active',
          role: 'admin',
          role_rank: 90,
        },
      ],
    },
    platformProfile: makeBaseProfile('multi.fixture@footballplayer.test', {
      name: 'Multi Fixture',
      role: 'super_admin',
      roleLabel: 'Platform Admin',
      roleRank: 100,
      clubId: '',
      clubName: 'Platform',
      team: 'Platform',
      activeTeamId: '',
      activeTeamName: '',
      clubOptions,
      parentPortalLinks,
    }),
    teamProfile: makeBaseProfile('multi.fixture@footballplayer.test', {
      name: 'Multi Fixture',
      role: 'admin',
      roleLabel: 'Club Admin',
      roleRank: 80,
      activeTeamId: '',
      activeTeamName: '',
      parentPortalLinks,
    }),
    parentProfile: makeBaseProfile('multi.fixture@footballplayer.test', {
      name: 'Multi Fixture',
      role: 'parent_portal',
      roleLabel: 'Parent',
      roleRank: 0,
      clubId: '',
      clubName: 'Fixture Family',
      team: 'Fixture Family',
      activeTeamId: '',
      activeTeamName: '',
      parentPortalLinks,
    }),
  },
  'teamless.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: true,
    defaultMode: 'team',
    teamProfile: makeBaseProfile('teamless.fixture@footballplayer.test', {
      name: 'Teamless Fixture',
      role: 'admin',
      roleLabel: 'Club Admin',
      roleRank: 80,
      activeTeamId: '',
      activeTeamName: '',
    }),
    platformProfile: makeBaseProfile('teamless.fixture@footballplayer.test', {
      name: 'Teamless Fixture',
      role: 'super_admin',
      roleLabel: 'Platform Admin',
      roleRank: 100,
      clubId: '',
      clubName: 'Platform',
      team: 'Platform',
      activeTeamId: '',
      activeTeamName: '',
      clubOptions,
    }),
  },
}

function getFixtureAccount(email) {
  return fixtureAccounts[String(email ?? '').trim().toLowerCase()] || null
}

function clearPendingFixtureAccessState() {
  window.sessionStorage.removeItem(FIXTURE_ACCESS_MODE_KEY)
  window.sessionStorage.removeItem(FIXTURE_ACCESS_MODE_EXPLICIT_KEY)
  window.sessionStorage.removeItem(FIXTURE_SELECTED_TEAM_KEY)
  window.sessionStorage.removeItem(FIXTURE_LOGIN_INTENT_KEY)
}

function getProfileForMode(account, mode, selectedTeamId = '') {
  const selectedTeam = teamOptions.find((team) => String(team.id) === String(selectedTeamId))

  if (account.playerProfile) {
    return account.playerProfile
  }

  if (mode === 'platform_admin' && account.platformProfile) {
    return account.platformProfile
  }

  if (mode === 'parent') {
    if (account.parentProfileUnavailable || !account.parentProfile) {
      return null
    }

    return {
      ...account.parentProfile,
      accessModeOptions: account.staffAccessData
        ? getProductionShapedStaffOptions(account)
        : (account.parentProfile.accessModeOptions ?? []),
    }
  }

  if (mode === 'team' && account.teamProfile) {
    return selectedTeam
      ? {
          ...account.teamProfile,
          activeTeamId: selectedTeam.id,
          activeTeamName: selectedTeam.name,
        }
      : account.teamProfile
  }

  if (mode === 'team' && account.platformProfile) {
    return account.platformProfile
  }

  if (mode) {
    return null
  }

  if (account.teamProfile) {
    return account.teamProfile
  }

  return account.parentProfile || null
}

function getAccessRouteMismatch(account, mode, loginAccessIntent = '') {
  if (!account) {
    return null
  }

  if (mode === 'parent' && account.parentProfileUnavailable) {
    if (account.parentAccessReason === 'lookup_failed' || !loginAccessIntent) {
      return {
        parentAccessUnavailable: true,
        parentAccessReason: account.parentAccessReason || 'no_active_parent_link',
      }
    }

    if (account.teamProfile || account.platformProfile) {
      return {
        loginIntentMismatch: true,
        intendedAccessMode: 'parent',
        availableAccessMode: 'team',
      }
    }

    return {
      parentAccessUnavailable: true,
      parentAccessReason: account.parentAccessReason || 'no_active_parent_link',
    }
  }

  if (mode === 'parent' && !account.parentProfile && !account.parentProfileUnavailable && (account.teamProfile || account.platformProfile)) {
    return {
      loginIntentMismatch: true,
      intendedAccessMode: 'parent',
      availableAccessMode: 'team',
    }
  }

  if (mode === 'team' && !account.teamProfile && !account.platformProfile && account.parentProfile) {
    return {
      loginIntentMismatch: true,
      intendedAccessMode: 'team',
      availableAccessMode: 'parent',
    }
  }

  return null
}

function makeSession(email) {
  return {
    access_token: `fixture-token-${email}`,
    user: makeAuthUser(email),
  }
}

export function FixtureAuthProvider({ AuthContext, children }) {
  const [email, setEmail] = useState(() => window.sessionStorage.getItem(FIXTURE_SESSION_KEY) || '')
  const [mode, setMode] = useState(() => window.sessionStorage.getItem(FIXTURE_ACCESS_MODE_KEY) || '')
  const [selectedTeamId, setSelectedTeamId] = useState(() => window.sessionStorage.getItem(FIXTURE_SELECTED_TEAM_KEY) || '')
  const [profilePatch, setProfilePatch] = useState(() => readFixtureProfilePatch(
    window.sessionStorage.getItem(FIXTURE_SESSION_KEY) || '',
  ))
  const [isLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  const account = getFixtureAccount(email)
  const loginAccessIntent = window.sessionStorage.getItem(FIXTURE_LOGIN_INTENT_KEY) || ''
  const restoredMode = mode
    ? resolveAccessModeForRoute({
        isParentHost: isParentPortalHost(),
        loginAccessIntent,
        pathname: window.location.pathname,
        selectedAccessMode: mode,
      })
    : ''
  const activeMode = restoredMode || mode || account?.defaultMode || ''
  const baseUser = account ? getProfileForMode(account, activeMode, selectedTeamId) : null
  const user = baseUser ? { ...baseUser, ...profilePatch } : null
  const accessRouteMismatch = user ? null : getAccessRouteMismatch(account, activeMode, loginAccessIntent)
  const session = account ? makeSession(email) : null
  const authUser = session?.user || null
  const hasPlatformAdminAccess = Boolean(account?.hasPlatformAdminAccess)
  const isParentProfile = user?.role === 'parent_portal'
  const isAdultPlayerProfile = user?.role === 'adult_player'
  const isPlatformProfile = user?.role === 'super_admin'
  const nextTeamOptions = user && !isParentProfile && !isAdultPlayerProfile && !isPlatformProfile && !account?.hideTeamOptions ? teamOptions : []
  const nextClubOptions = isPlatformProfile ? clubOptions : []
  const nextAccessModeOptions = Array.isArray(user?.accessModeOptions)
    ? user.accessModeOptions
    : (activeMode === 'parent' && Array.isArray(account?.fallbackAccessModeOptions) ? account.fallbackAccessModeOptions : [])

  const signInWithPassword = async ({ email: nextEmail, password, preferredAccessMode = '' }) => {
    const normalizedEmail = String(nextEmail ?? '').trim().toLowerCase()
    const nextAccount = getFixtureAccount(normalizedEmail)

    if (!nextAccount || password !== nextAccount.password) {
      const message = 'Fixture login failed.'
      clearPendingFixtureAccessState()
      setAuthError(message)
      setMode('')
      setSelectedTeamId('')
      throw new Error(message)
    }

    const nextMode = preferredAccessMode || nextAccount.defaultMode || 'team'
    window.sessionStorage.setItem(FIXTURE_SESSION_KEY, normalizedEmail)
    window.sessionStorage.setItem(FIXTURE_ACCESS_MODE_KEY, nextMode)
    if (preferredAccessMode) {
      window.sessionStorage.setItem(FIXTURE_LOGIN_INTENT_KEY, nextMode)
    } else {
      window.sessionStorage.removeItem(FIXTURE_LOGIN_INTENT_KEY)
    }
    window.sessionStorage.removeItem(FIXTURE_SELECTED_TEAM_KEY)
    setEmail(normalizedEmail)
    setMode(nextMode)
    setSelectedTeamId('')
    setProfilePatch(readFixtureProfilePatch(normalizedEmail))
    setAuthError('')

    return {
      session: makeSession(normalizedEmail),
      user: makeAuthUser(normalizedEmail),
    }
  }

  const selectAccessMode = async (nextMode, options = {}) => {
    const normalizedMode = String(nextMode ?? '').trim()

    if (!['platform_admin', 'parent', 'team'].includes(normalizedMode)) {
      throw new Error('Choose parent, team, or platform admin access to continue.')
    }

    if (normalizedMode === 'team' && !getProfileForMode(account, 'team', selectedTeamId)) {
      throw new Error('Staff access is no longer active. Ask a club admin to review this account.')
    }

    if (options.deferCommit === true) {
      return getProfileForMode(account, normalizedMode, selectedTeamId)
    }

    window.sessionStorage.setItem(FIXTURE_ACCESS_MODE_KEY, normalizedMode)
    window.sessionStorage.setItem(FIXTURE_ACCESS_MODE_EXPLICIT_KEY, 'true')
    window.sessionStorage.removeItem(FIXTURE_LOGIN_INTENT_KEY)

    if (options.redirectTo) {
      window.location.assign(options.redirectTo)
      return
    }

    setMode(normalizedMode)
    setAuthError('')
  }

  const selectPlatformAdmin = async () => {
    await selectAccessMode('platform_admin')
  }

  const selectClub = async () => {
    window.sessionStorage.setItem(FIXTURE_ACCESS_MODE_KEY, 'team')
    window.sessionStorage.removeItem(FIXTURE_LOGIN_INTENT_KEY)
    window.sessionStorage.removeItem(FIXTURE_SELECTED_TEAM_KEY)
    setSelectedTeamId('')
    setMode('team')
    setAuthError('')
  }

  const selectTeam = async (teamId) => {
    const selectedTeam = teamOptions.find((team) => String(team.id) === String(teamId))

    if (!selectedTeam) {
      throw new Error('This team is not linked to your account.')
    }

    window.sessionStorage.setItem(FIXTURE_SELECTED_TEAM_KEY, selectedTeam.id)
    window.sessionStorage.setItem(FIXTURE_ACCESS_MODE_KEY, 'team')
    window.sessionStorage.removeItem(FIXTURE_LOGIN_INTENT_KEY)
    setSelectedTeamId(selectedTeam.id)
    setMode('team')
    setAuthError('')
  }

  const signOut = async () => {
    window.sessionStorage.removeItem(FIXTURE_SESSION_KEY)
    clearPendingFixtureAccessState()
    setEmail('')
    setMode('')
    setSelectedTeamId('')
    setProfilePatch({})
    setAuthError('')
  }

  const updateCurrentUserDetails = (profile) => {
    const nextPatch = profile && typeof profile === 'object' ? profile : {}

    setProfilePatch((current) => {
      const merged = {
        ...current,
        ...nextPatch,
      }
      window.localStorage.setItem(getFixtureProfilePatchKey(email), JSON.stringify(merged))
      return merged
    })
  }

  const value = {
    session,
    authUser,
    user,
    clubOptions: nextClubOptions,
    accessModeOptions: nextAccessModeOptions,
    accessRouteMismatch,
    teamOptions: nextTeamOptions,
    hasPlatformAdminAccess,
    isLoading,
    isProfileLoading: false,
    authError,
    signInWithPassword,
    signUpWithClub: async () => {
      throw new Error('Fixture sign up is unavailable.')
    },
    signUpParentAccount: async () => {
      throw new Error('Fixture parent sign up is unavailable.')
    },
    selectClub,
    selectAccessMode,
    selectTeam,
    selectPlatformAdmin,
    refreshTeamSelection: async () => {},
    resetPassword: async () => {},
    signOut,
    updateCurrentClubDetails: updateCurrentUserDetails,
    updateCurrentUserDetails,
    demoRoleKey: '',
    setDemoRolePreview: () => {},
  }

  return createElement(AuthContext.Provider, { value }, children)
}
