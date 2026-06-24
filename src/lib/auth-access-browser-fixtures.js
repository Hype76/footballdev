import { createElement, useState } from 'react'

const FIXTURE_SESSION_KEY = 'auth-access-browser-fixture-email'
const FIXTURE_ACCESS_MODE_KEY = 'selected-access-mode'
const FIXTURE_SELECTED_TEAM_KEY = 'selected-team-id'

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
    role: 'coach',
    roleLabel: 'Coach',
    roleRank: 30,
    activeTeamId: 'team-u12',
    activeTeamName: 'U12 Fixture Team',
    parentPortalLinks: [],
    ...overrides,
  }
}

const fixtureAccounts = {
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
  'multi.fixture@footballplayer.test': {
    password: 'FixturePass123!',
    hasPlatformAdminAccess: true,
    defaultMode: 'platform_admin',
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

function getProfileForMode(account, mode, selectedTeamId = '') {
  const selectedTeam = teamOptions.find((team) => String(team.id) === String(selectedTeamId))

  if (mode === 'platform_admin' && account.platformProfile) {
    return account.platformProfile
  }

  if (mode === 'parent' && account.parentProfile) {
    return account.parentProfile
  }

  if (account.teamProfile) {
    return selectedTeam
      ? {
          ...account.teamProfile,
          activeTeamId: selectedTeam.id,
          activeTeamName: selectedTeam.name,
          themeAccent: selectedTeam.themeAccent || account.teamProfile.themeAccent || '',
          themeButtonStyle: selectedTeam.themeButtonStyle || account.teamProfile.themeButtonStyle || '',
        }
      : account.teamProfile
  }

  if (account.platformProfile) {
    return account.platformProfile
  }

  return account.parentProfile || null
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
  const [isLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  const account = getFixtureAccount(email)
  const activeMode = mode || account?.defaultMode || ''
  const user = account ? getProfileForMode(account, activeMode, selectedTeamId) : null
  const session = account ? makeSession(email) : null
  const authUser = session?.user || null
  const hasPlatformAdminAccess = Boolean(account?.hasPlatformAdminAccess)
  const isParentProfile = user?.role === 'parent_portal'
  const isPlatformProfile = user?.role === 'super_admin'
  const nextTeamOptions = user && !isParentProfile && !isPlatformProfile ? teamOptions : []
  const nextClubOptions = isPlatformProfile ? clubOptions : []

  const signInWithPassword = async ({ email: nextEmail, password, preferredAccessMode = '' }) => {
    const normalizedEmail = String(nextEmail ?? '').trim().toLowerCase()
    const nextAccount = getFixtureAccount(normalizedEmail)

    if (!nextAccount || password !== nextAccount.password) {
      const message = 'Fixture login failed.'
      setAuthError(message)
      throw new Error(message)
    }

    const nextMode = preferredAccessMode || nextAccount.defaultMode || 'team'
    window.sessionStorage.setItem(FIXTURE_SESSION_KEY, normalizedEmail)
    window.sessionStorage.setItem(FIXTURE_ACCESS_MODE_KEY, nextMode)
    window.sessionStorage.removeItem(FIXTURE_SELECTED_TEAM_KEY)
    setEmail(normalizedEmail)
    setMode(nextMode)
    setSelectedTeamId('')
    setAuthError('')
  }

  const selectAccessMode = async (nextMode) => {
    const normalizedMode = String(nextMode ?? '').trim()

    if (!['platform_admin', 'parent', 'team'].includes(normalizedMode)) {
      throw new Error('Choose parent, team, or platform admin access to continue.')
    }

    window.sessionStorage.setItem(FIXTURE_ACCESS_MODE_KEY, normalizedMode)
    if (normalizedMode !== 'team') {
      window.sessionStorage.removeItem(FIXTURE_SELECTED_TEAM_KEY)
      setSelectedTeamId('')
    }
    setMode(normalizedMode)
    setAuthError('')
  }

  const selectPlatformAdmin = async () => {
    await selectAccessMode('platform_admin')
  }

  const selectClub = async () => {
    window.sessionStorage.setItem(FIXTURE_ACCESS_MODE_KEY, 'team')
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
    setSelectedTeamId(selectedTeam.id)
    setMode('team')
    setAuthError('')
  }

  const signOut = async () => {
    window.sessionStorage.removeItem(FIXTURE_SESSION_KEY)
    window.sessionStorage.removeItem(FIXTURE_ACCESS_MODE_KEY)
    window.sessionStorage.removeItem(FIXTURE_SELECTED_TEAM_KEY)
    setEmail('')
    setMode('')
    setSelectedTeamId('')
    setAuthError('')
  }

  const value = {
    session,
    authUser,
    user,
    clubOptions: nextClubOptions,
    accessModeOptions: [],
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
    updateCurrentClubDetails: () => {},
    updateCurrentUserDetails: () => {},
    demoRoleKey: '',
    setDemoRolePreview: () => {},
  }

  return createElement(AuthContext.Provider, { value }, children)
}
