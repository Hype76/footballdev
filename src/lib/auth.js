import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react'
import { DEMO_ROLE_STORAGE_KEY, getDemoRole, isDemoEmail, isDemoUser } from './demo.js'
import { supabase } from './supabase-client.js'
import {
  areUsersEquivalent,
  claimStripeCheckoutForProfile,
  getPasswordResetRedirectUrl,
} from './auth-session-utils.js'
import {
  isClubAdmin,
  isParentPortalUser,
  isSuperAdmin,
} from './auth-permissions.js'
import { isParentPortalHost } from './app-origins.js'

export {
  canAssignRole,
  canCreateEvaluation,
  canDeletePlayer,
  canEditEvaluation,
  canManageClubLogo,
  canManageClubSettings,
  canManageEmailQueue,
  canManageFormFields,
  canManageMatchDay,
  canManageParentEmailTemplates,
  canManageParentLinks,
  canManagePolls,
  canManageTeamAppearance,
  canManageTeamSettings,
  canManageUsers,
  canShareEvaluation,
  canViewActivityLog,
  canViewBilling,
  canViewEndSeasonStats,
  canViewEvaluation,
  canViewPlatformFeedback,
  getRoleLabel,
  getWorkspaceHomeCopy,
  hasTeamWorkflowContext,
  isClubAdmin,
  isDemoAccount,
  isSuperAdmin,
  isParentPortalUser,
  isTesterAccessExpired,
  needsTeamWorkflowContext,
} from './auth-permissions.js'

const AuthContext = createContext(null)
let authDataModulePromise = null
let teamDataModulePromise = null
const SELECTED_CLUB_STORAGE_KEY = 'selected-club-id'
const SELECTED_TEAM_STORAGE_KEY = 'selected-team-id'
const SELECTED_ACCESS_MODE_STORAGE_KEY = 'selected-access-mode'
const SELECTED_ACCESS_MODE_EXPLICIT_KEY = 'selected-access-mode-explicit'
const PLATFORM_ADMIN_ACCESS_OPTION = {
  id: 'platform_admin',
  label: 'Platform Admin',
  meta: 'Open platform administration tools',
}
const PARENT_ACCESS_OPTION = {
  id: 'parent',
  label: 'Parent',
  meta: 'Open linked child access only',
}

function loadAuthDataModule() {
  if (!authDataModulePromise) {
    authDataModulePromise = import('./domain/auth-helpers.js')
  }

  return authDataModulePromise
}

function loadTeamDataModule() {
  if (!teamDataModulePromise) {
    teamDataModulePromise = import('./domain/teams.js')
  }

  return teamDataModulePromise
}

function buildAccessModeOptions(options = [], hasPlatformAdminAccess = false) {
  const normalizedOptions = (options ?? [])
    .map((option) => ({
      id: String(option?.id ?? '').trim(),
      label: String(option?.label ?? '').trim(),
      meta: String(option?.meta ?? '').trim(),
    }))
    .filter((option) => option.id)

  const withoutTeamAlias = hasPlatformAdminAccess
    ? normalizedOptions.filter((option) => option.id !== 'team' && option.id !== 'platform_admin')
    : normalizedOptions

  const nextOptions = hasPlatformAdminAccess
    ? [PLATFORM_ADMIN_ACCESS_OPTION, ...withoutTeamAlias]
    : withoutTeamAlias

  if (!nextOptions.some((option) => option.id === 'parent') && normalizedOptions.some((option) => option.id === 'parent')) {
    nextOptions.push(PARENT_ACCESS_OPTION)
  }

  return nextOptions
}

export async function verifyCurrentUserPassword(email, password) {
  const normalizedEmail = String(email ?? '').trim()
  const normalizedPassword = String(password ?? '')

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error('Enter your password to confirm this action.')
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword,
  })

  if (error) {
    throw new Error('Password confirmation failed. Check your password and try again.')
  }

  return true
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [user, setUser] = useState(null)
  const [clubOptions, setClubOptions] = useState([])
  const [accessModeOptions, setAccessModeOptions] = useState([])
  const [teamOptions, setTeamOptions] = useState([])
  const [hasPlatformAdminAccess, setHasPlatformAdminAccess] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [demoRoleKey, setDemoRoleKeyState] = useState(() => window.sessionStorage.getItem(DEMO_ROLE_STORAGE_KEY) || '')
  const userRef = useRef(null)
  const demoRoleKeyRef = useRef(demoRoleKey)
  const hasBootstrappedRef = useRef(false)
  const activeSyncIdRef = useRef(0)

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    demoRoleKeyRef.current = demoRoleKey
  }, [demoRoleKey])

  const applyTeamSelection = async (profile) => {
    if (!profile || isSuperAdmin(profile)) {
      setTeamOptions([])
      return profile
    }

    const { getAssignedTeamsForUser, getTeams } = await loadTeamDataModule()
    const assignedTeams = isClubAdmin(profile) ? await getTeams(profile) : await getAssignedTeamsForUser(profile)

    if (isClubAdmin(profile)) {
      setTeamOptions(assignedTeams)

      const selectedTeamId = window.sessionStorage.getItem(SELECTED_TEAM_STORAGE_KEY) || ''
      const selectedTeam = assignedTeams.find((team) => String(team.id) === selectedTeamId)

      if (!selectedTeam) {
        window.sessionStorage.removeItem(SELECTED_TEAM_STORAGE_KEY)
        return {
          ...profile,
          activeTeamId: '',
          activeTeamName: '',
        }
      }

      return {
        ...profile,
        activeTeamId: selectedTeam.id,
        activeTeamName: selectedTeam.name,
        themeMode: profile.themeMode || '',
        themeAccent: selectedTeam.themeAccent || profile.themeAccent || '',
        themeButtonStyle: selectedTeam.themeButtonStyle || profile.themeButtonStyle || '',
      }
    }

    if (assignedTeams.length <= 1) {
      const onlyTeam = assignedTeams[0]
      setTeamOptions([])

      if (!onlyTeam) {
        window.sessionStorage.removeItem(SELECTED_TEAM_STORAGE_KEY)
        return {
          ...profile,
          activeTeamId: '',
          activeTeamName: '',
        }
      }

      window.sessionStorage.setItem(SELECTED_TEAM_STORAGE_KEY, onlyTeam.id)
      return {
        ...profile,
        activeTeamId: onlyTeam.id,
        activeTeamName: onlyTeam.name,
        themeMode: profile.themeMode || '',
        themeAccent: onlyTeam.themeAccent || profile.themeAccent || '',
        themeButtonStyle: onlyTeam.themeButtonStyle || profile.themeButtonStyle || '',
      }
    }

    const selectedTeamId = window.sessionStorage.getItem(SELECTED_TEAM_STORAGE_KEY) || ''
    const selectedTeam = assignedTeams.find((team) => String(team.id) === selectedTeamId)

    if (!selectedTeam) {
      setTeamOptions(assignedTeams)
      return {
        ...profile,
        activeTeamId: '',
        activeTeamName: '',
      }
    }

    setTeamOptions(assignedTeams)
    return {
      ...profile,
      activeTeamId: selectedTeam.id,
      activeTeamName: selectedTeam.name,
      themeMode: profile.themeMode || '',
      themeAccent: selectedTeam.themeAccent || profile.themeAccent || '',
      themeButtonStyle: selectedTeam.themeButtonStyle || profile.themeButtonStyle || '',
    }
  }

  const applyDemoRolePreview = (profile, roleKey = demoRoleKeyRef.current) => {
    if (!profile || !isDemoUser(profile)) {
      return profile
    }

    const previewRole = getDemoRole(roleKey)

    if (!previewRole) {
      return {
        ...profile,
        isDemoAccount: true,
      }
    }

    return {
      ...profile,
      isDemoAccount: true,
      role: previewRole.role,
      roleLabel: previewRole.label,
      roleRank: previewRole.rank,
    }
  }

  const getAccessToken = async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    return sessionData?.session?.access_token || ''
  }

  const refreshPlatformAdminAccess = async (sessionUser = authUser) => {
    if (isParentPortalHost()) {
      setHasPlatformAdminAccess(false)
      return false
    }

    if (isDemoEmail(sessionUser?.email)) {
      setHasPlatformAdminAccess(false)
      return false
    }

    const accessToken = await getAccessToken()

    if (!accessToken) {
      setHasPlatformAdminAccess(false)
      return false
    }

    try {
      const response = await fetch('/.netlify/functions/platform-admin-access', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
      const result = await response.json().catch(() => ({}))
      const nextHasAccess = Boolean(response.ok && result.success !== false && result.hasPlatformAdminAccess)
      setHasPlatformAdminAccess(nextHasAccess)
      return nextHasAccess
    } catch (error) {
      console.error(error)
      setHasPlatformAdminAccess(false)
      return false
    }
  }

  const openPlatformAdminProfile = async () => {
    const accessToken = await getAccessToken()

    if (!accessToken) {
      throw new Error('Login again before opening platform admin.')
    }

    const response = await fetch('/.netlify/functions/platform-admin-access', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    const result = await response.json().catch(() => ({}))

    if (!response.ok || result.success === false || !result.user) {
      throw new Error(result.message || 'Platform admin access could not be opened.')
    }

    window.sessionStorage.removeItem(SELECTED_CLUB_STORAGE_KEY)
    window.sessionStorage.removeItem(SELECTED_TEAM_STORAGE_KEY)
    window.sessionStorage.setItem(SELECTED_ACCESS_MODE_STORAGE_KEY, 'platform_admin')
    window.sessionStorage.setItem(SELECTED_ACCESS_MODE_EXPLICIT_KEY, 'true')
    setClubOptions(result.user.clubOptions ?? [])
    setTeamOptions([])
    setHasPlatformAdminAccess(true)

    return result.user
  }

  useEffect(() => {
    let isMounted = true

    const finishBootstrap = () => {
      if (!isMounted || hasBootstrappedRef.current) {
        return
      }

      hasBootstrappedRef.current = true
      setIsLoading(false)
    }

    const applySignedOutState = () => {
      if (!isMounted) {
        return
      }

      activeSyncIdRef.current += 1
      setSession(null)
      setAuthUser(null)
      setUser(null)
      setClubOptions([])
      setAccessModeOptions([])
      setTeamOptions([])
      setHasPlatformAdminAccess(false)
      setIsProfileLoading(false)
      setAuthError('')
      window.sessionStorage.removeItem(SELECTED_CLUB_STORAGE_KEY)
      window.sessionStorage.removeItem(SELECTED_TEAM_STORAGE_KEY)
      window.sessionStorage.removeItem(SELECTED_ACCESS_MODE_STORAGE_KEY)
      window.sessionStorage.removeItem(SELECTED_ACCESS_MODE_EXPLICIT_KEY)
      window.sessionStorage.removeItem(DEMO_ROLE_STORAGE_KEY)
      setDemoRoleKeyState('')
      finishBootstrap()
    }

    const syncAuthenticatedSession = async (nextSession, options = {}) => {
      if (!isMounted || !nextSession?.user) {
        return
      }

      const syncId = activeSyncIdRef.current + 1
      activeSyncIdRef.current = syncId
      const nextUserId = String(nextSession.user?.id ?? '')
      const currentUserId = String(userRef.current?.id ?? '')
      const isSameUser = Boolean(currentUserId) && Boolean(nextUserId) && currentUserId === nextUserId
      const shouldLoadProfile = !options.background || !isSameUser || !userRef.current

      try {
        setSession(nextSession)
        setAuthUser(nextSession.user)
        if (shouldLoadProfile) {
          setIsProfileLoading(true)
        }

        const { fetchUserProfile } = await loadAuthDataModule()
        const selectedClubId = window.sessionStorage.getItem(SELECTED_CLUB_STORAGE_KEY) || ''
        const selectedAccessMode = window.sessionStorage.getItem(SELECTED_ACCESS_MODE_STORAGE_KEY) || ''
        const selectedAccessModeIsExplicit = window.sessionStorage.getItem(SELECTED_ACCESS_MODE_EXPLICIT_KEY) === 'true'
        const hasPlatformAccess = await refreshPlatformAdminAccess(nextSession.user)

        if (hasPlatformAccess && selectedAccessMode !== 'parent' && (selectedAccessMode !== 'team' || !selectedAccessModeIsExplicit)) {
          const platformProfile = await openPlatformAdminProfile()

          if (!isMounted || activeSyncIdRef.current !== syncId) {
            return
          }

          setAccessModeOptions([])
          setUser(platformProfile)
          setIsProfileLoading(false)
          setAuthError('')
          return
        }

        const profile = await fetchUserProfile(nextSession.user, {
          selectedClubId,
          selectedAccessMode,
        })

        if (!isMounted || activeSyncIdRef.current !== syncId) {
          return
        }

        if (profile?.requiresClubSelection) {
          setClubOptions(profile.clubOptions ?? [])
          setUser(null)
          setIsProfileLoading(false)
          setAuthError('')
          return
        }

        if (profile?.requiresAccessModeSelection) {
          setAccessModeOptions(buildAccessModeOptions(profile.accessModeOptions, hasPlatformAccess))
          setClubOptions([])
          setUser(null)
          setHasPlatformAdminAccess(hasPlatformAccess)
          setIsProfileLoading(false)
          setAuthError('')
          return
        }

        if (hasPlatformAccess && isParentPortalUser(profile) && !selectedAccessMode) {
          setAccessModeOptions(buildAccessModeOptions([PARENT_ACCESS_OPTION], hasPlatformAccess))
          setClubOptions([])
          setUser(null)
          setHasPlatformAdminAccess(true)
          setIsProfileLoading(false)
          setAuthError('')
          return
        }

        if (profile?.clubId) {
          window.sessionStorage.setItem(SELECTED_CLUB_STORAGE_KEY, profile.clubId)
        }

        const profileWithBilling = await claimStripeCheckoutForProfile(nextSession, profile)
        const profileWithTeam = await applyTeamSelection(profileWithBilling)
        const profileWithDemoPreview = applyDemoRolePreview(profileWithTeam)

        if (!isMounted || activeSyncIdRef.current !== syncId) {
          return
        }

        setClubOptions(profile.clubOptions ?? [])
        setAccessModeOptions([])
        setUser((currentUser) =>
          areUsersEquivalent(currentUser, profileWithDemoPreview) ? currentUser : profileWithDemoPreview,
        )
        setHasPlatformAdminAccess(hasPlatformAccess)
        setIsProfileLoading(false)
        setAuthError('')
      } catch (error) {
        console.error(error)

        if (!isMounted || activeSyncIdRef.current !== syncId) {
          return
        }

        if (!(options.background && isSameUser)) {
          setUser(null)
        }
        setIsProfileLoading(false)
        setAuthError(error.message || 'Could not load user profile.')
      } finally {
        finishBootstrap()
      }
    }

    const bootstrapAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          console.error(error)

          if (isMounted) {
            setAuthError(error.message || 'Could not restore your session.')
          }

          applySignedOutState()
          return
        }

        if (!data?.session?.user) {
          applySignedOutState()
          return
        }

        await syncAuthenticatedSession(data.session)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setAuthError(error.message || 'Could not restore your session.')
        }

        applySignedOutState()
      }
    }

    void bootstrapAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION') {
        return
      }

      window.setTimeout(() => {
        if (!nextSession?.user) {
          applySignedOutState()
          return
        }

        const nextUserId = String(nextSession.user?.id ?? '')
        const currentUserId = String(userRef.current?.id ?? '')
        const isSameUser = Boolean(currentUserId) && Boolean(nextUserId) && currentUserId === nextUserId
        const isBackgroundEvent =
          // Supabase can emit SIGNED_IN again when a tab regains focus for the same user.
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED' ||
          (event === 'SIGNED_IN' && isSameUser)

        void syncAuthenticatedSession(nextSession, {
          background: isBackgroundEvent,
        })
      }, 0)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  // Authentication bootstrap must run once. Functions it calls are scoped to this provider instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signInWithPassword = async ({ email, password, preferredAccessMode = '' }) => {
    setAuthError('')
    const nextPreferredAccessMode = String(preferredAccessMode ?? '').trim()

    if (nextPreferredAccessMode) {
      if (!['team', 'parent', 'platform_admin'].includes(nextPreferredAccessMode)) {
        throw new Error('Choose parent, team, or platform admin access to continue.')
      }

      window.sessionStorage.setItem(SELECTED_ACCESS_MODE_STORAGE_KEY, nextPreferredAccessMode)
      window.sessionStorage.setItem(SELECTED_ACCESS_MODE_EXPLICIT_KEY, 'true')
      window.sessionStorage.removeItem(SELECTED_CLUB_STORAGE_KEY)
      window.sessionStorage.removeItem(SELECTED_TEAM_STORAGE_KEY)
    } else {
      window.sessionStorage.removeItem(SELECTED_ACCESS_MODE_STORAGE_KEY)
      window.sessionStorage.removeItem(SELECTED_ACCESS_MODE_EXPLICIT_KEY)
      window.sessionStorage.removeItem(SELECTED_CLUB_STORAGE_KEY)
      window.sessionStorage.removeItem(SELECTED_TEAM_STORAGE_KEY)
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error(error)
      setAuthError(error.message || 'Login failed.')
      throw error
    }
  }

  const selectClub = async (clubId) => {
    if (!authUser) {
      throw new Error('Login again before choosing a club.')
    }

    setAuthError('')
    setIsProfileLoading(true)

    try {
      const { selectUserClub } = await loadAuthDataModule()
      const profile = await selectUserClub(authUser, clubId)
      window.sessionStorage.setItem(SELECTED_ACCESS_MODE_STORAGE_KEY, 'team')
      window.sessionStorage.setItem(SELECTED_ACCESS_MODE_EXPLICIT_KEY, 'true')
      window.sessionStorage.setItem(SELECTED_CLUB_STORAGE_KEY, profile.clubId)
      window.sessionStorage.removeItem(SELECTED_TEAM_STORAGE_KEY)
      const profileWithTeam = await applyTeamSelection(profile)
      setUser(applyDemoRolePreview(profileWithTeam))
      setAuthError('')
    } catch (error) {
      console.error(error)
      setAuthError(error.message || 'Could not switch club.')
      throw error
    } finally {
      setIsProfileLoading(false)
    }
  }

  const selectAccessMode = async (accessMode) => {
    if (!authUser) {
      throw new Error('Login again before choosing access.')
    }

    const nextAccessMode = String(accessMode ?? '').trim()

    if (!['team', 'parent', 'platform_admin'].includes(nextAccessMode)) {
      throw new Error('Choose parent, team, or platform admin access to continue.')
    }

    setAuthError('')
    setIsProfileLoading(true)

    try {
      if (nextAccessMode === 'platform_admin') {
        const platformProfile = await openPlatformAdminProfile()
        setAccessModeOptions([])
        setUser(platformProfile)
        setAuthError('')
        return
      }

      const { fetchUserProfile } = await loadAuthDataModule()
      window.sessionStorage.setItem(SELECTED_ACCESS_MODE_STORAGE_KEY, nextAccessMode)
      window.sessionStorage.setItem(SELECTED_ACCESS_MODE_EXPLICIT_KEY, 'true')
      window.sessionStorage.removeItem(SELECTED_CLUB_STORAGE_KEY)
      window.sessionStorage.removeItem(SELECTED_TEAM_STORAGE_KEY)
      const profile = await fetchUserProfile(authUser, {
        selectedAccessMode: nextAccessMode,
      })

      if (profile?.requiresClubSelection) {
        setClubOptions(profile.clubOptions ?? [])
        setAccessModeOptions([])
        setUser(null)
        setAuthError('')
        return
      }

      const profileWithTeam = profile?.role === 'parent_portal' ? profile : await applyTeamSelection(profile)
      setAccessModeOptions([])
      setClubOptions(profile.clubOptions ?? [])
      setUser(applyDemoRolePreview(profileWithTeam))
      setAuthError('')
    } catch (error) {
      console.error(error)
      setAuthError(error.message || 'Could not open this access.')
      throw error
    } finally {
      setIsProfileLoading(false)
    }
  }

  const selectTeam = async (teamId) => {
    if (!teamId && isClubAdmin(userRef.current)) {
      window.sessionStorage.removeItem(SELECTED_TEAM_STORAGE_KEY)
      setUser((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          activeTeamId: '',
          activeTeamName: '',
        }
      })
      return
    }

    let selectedTeam = teamOptions.find((team) => String(team.id) === String(teamId))

    if (!selectedTeam && userRef.current) {
      const { getAssignedTeamsForUser, getTeams } = await loadTeamDataModule()
      const nextTeamOptions = isClubAdmin(userRef.current)
        ? await getTeams(userRef.current)
        : await getAssignedTeamsForUser(userRef.current)
      setTeamOptions(nextTeamOptions)
      selectedTeam = nextTeamOptions.find((team) => String(team.id) === String(teamId))
    }

    if (!selectedTeam) {
      throw new Error('This team is not linked to your account.')
    }

    window.sessionStorage.setItem(SELECTED_TEAM_STORAGE_KEY, selectedTeam.id)
    setUser((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        activeTeamId: selectedTeam.id,
        activeTeamName: selectedTeam.name,
        themeMode: current.themeMode || '',
        themeAccent: selectedTeam.themeAccent || current.themeAccent || '',
        themeButtonStyle: selectedTeam.themeButtonStyle || current.themeButtonStyle || '',
      }
    })
  }

  const selectPlatformAdmin = async () => {
    setAuthError('')
    setIsProfileLoading(true)

    try {
      const platformProfile = await openPlatformAdminProfile()
      setAccessModeOptions([])
      setUser(platformProfile)
    } catch (error) {
      console.error(error)
      setAuthError(error.message || 'Platform admin access could not be opened.')
      throw error
    } finally {
      setIsProfileLoading(false)
    }
  }

  const setDemoRolePreview = (roleKey) => {
    const nextRoleKey = String(roleKey ?? '')

    if (nextRoleKey) {
      window.sessionStorage.setItem(DEMO_ROLE_STORAGE_KEY, nextRoleKey)
    } else {
      window.sessionStorage.removeItem(DEMO_ROLE_STORAGE_KEY)
    }

    setDemoRoleKeyState(nextRoleKey)
    demoRoleKeyRef.current = nextRoleKey
    setUser((currentUser) => applyDemoRolePreview(currentUser, nextRoleKey))
  }

  const refreshTeamSelection = async () => {
    const currentUser = userRef.current

    if (!currentUser) {
      return
    }

    const profileWithTeam = await applyTeamSelection(currentUser)
    setUser(applyDemoRolePreview(profileWithTeam))
  }

  const signUpWithClub = async ({ email, password, clubName, accessCode = '', planKey = 'small_club' }) => {
    setAuthError('')
    const testSignupWithoutPayment = String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
    const normalizedEmail = String(email ?? '').trim()
    const normalizedClubName = String(clubName ?? '').trim()
    const signupDisplayName = normalizedEmail.split('@')[0]?.replace(/[._-]+/g, ' ').trim() || ''
    const normalizedPlanKey = ['individual', 'single_team', 'small_club', 'large_club'].includes(planKey)
      ? planKey
      : 'small_club'

    if (testSignupWithoutPayment) {
      const prepareResponse = await fetch('/.netlify/functions/prepare-staging-test-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          clubName: normalizedClubName,
          accessCode: String(accessCode ?? '').trim(),
          planKey: normalizedPlanKey,
        }),
      })
      const prepareResult = await prepareResponse.json().catch(() => ({}))

      if (!prepareResponse.ok || prepareResult.success === false) {
        const prepareError = new Error(prepareResult.message || 'Staging test signup could not be prepared.')
        console.error(prepareError)
        setAuthError(prepareError.message)
        throw prepareError
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })

      if (signInError) {
        console.error(signInError)
        setAuthError(signInError.message || 'Login failed.')
        throw signInError
      }

      if (!signInData?.session || !signInData?.user) {
        const sessionError = new Error('Login session was not created.')
        console.error(sessionError)
        setAuthError(sessionError.message)
        throw sessionError
      }

      const { createClubAndManagerProfile } = await loadAuthDataModule()
      const profile = await createClubAndManagerProfile({
        authUser: signInData.user,
        clubName: normalizedClubName,
        accessCode,
        planKey: normalizedPlanKey,
        forceNewClub: true,
      })

      setSession(signInData.session)
      setAuthUser(signInData.user)
      setUser(profile)
      void refreshPlatformAdminAccess(signInData.user)
      if (profile?.clubId) {
        window.sessionStorage.setItem(SELECTED_CLUB_STORAGE_KEY, profile.clubId)
      }
      setClubOptions([])
      setTeamOptions([])
      setIsProfileLoading(false)
      setAuthError('')

      return {
        needsEmailVerification: false,
        user: profile,
        message: prepareResult.message || 'Access is ready. Continue into your workspace.',
      }
    }

    const emailRedirectTo = `${window.location.origin.replace(/\/$/, '')}/sign-in`
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo,
        data: {
          username: signupDisplayName,
          name: signupDisplayName,
          display_name: signupDisplayName,
          club_name: normalizedClubName,
          tester_access_code: String(accessCode ?? '').trim().toUpperCase(),
          test_signup_plan_key: testSignupWithoutPayment ? normalizedPlanKey : undefined,
        },
      },
    })

    if (error) {
      console.error(error)
      setAuthError(error.message || 'Sign up failed.')
      throw error
    }

    if (!data.user) {
      const signupError = new Error('Account creation did not return a user.')
      console.error(signupError)
      setAuthError(signupError.message)
      throw signupError
    }

    if (!data.session) {
      if (testSignupWithoutPayment && normalizedClubName) {
        try {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          })

          if (signInError) {
            throw signInError
          }

          if (!signInData?.session || !signInData?.user) {
            throw new Error('Login session was not created.')
          }

          const { createClubAndManagerProfile } = await loadAuthDataModule()
          const profile = await createClubAndManagerProfile({
            authUser: signInData.user,
            clubName: normalizedClubName,
            accessCode,
            planKey: normalizedPlanKey,
            forceNewClub: true,
          })

          setSession(signInData.session)
          setAuthUser(signInData.user)
          setUser(profile)
          void refreshPlatformAdminAccess()
          if (profile?.clubId) {
            window.sessionStorage.setItem(SELECTED_CLUB_STORAGE_KEY, profile.clubId)
          }
          setClubOptions([])
          setTeamOptions([])
          setIsProfileLoading(false)
          setAuthError('')

          return {
            needsEmailVerification: false,
            user: profile,
          }
        } catch (signInError) {
          console.error(signInError)
        }
      }

      setSession(null)
      setAuthUser(null)
      setUser(null)
      setClubOptions([])
      setTeamOptions([])
      setIsProfileLoading(false)
      setAuthError('')

      return {
        needsEmailVerification: true,
        email: data.user.email || email,
      }
    }

    try {
      const { createClubAndManagerProfile, fetchUserProfile } = await loadAuthDataModule()
      const profile = normalizedClubName
        ? await createClubAndManagerProfile({
          authUser: data.user,
          clubName: normalizedClubName,
          accessCode,
          planKey: normalizedPlanKey,
          forceNewClub: testSignupWithoutPayment,
        })
        : await fetchUserProfile(data.user)

      setSession(data.session ?? null)
      setAuthUser(data.user)
      const profileWithBilling = await claimStripeCheckoutForProfile(data.session, profile)
      setUser(profileWithBilling)
      void refreshPlatformAdminAccess()
      if (profileWithBilling?.clubId) {
        window.sessionStorage.setItem(SELECTED_CLUB_STORAGE_KEY, profileWithBilling.clubId)
      }
      setClubOptions([])
      setIsProfileLoading(false)
      setAuthError('')

      return {
        needsEmailVerification: false,
        user: profileWithBilling,
      }
    } catch (profileError) {
      console.error(profileError)
      setAuthError(profileError.message || 'Could not create your club.')
      throw profileError
    }
  }

  const signUpParentAccount = async ({ email, password, inviteToken = '' }) => {
    setAuthError('')
    const normalizedEmail = String(email ?? '').trim()
    const normalizedInviteToken = String(inviteToken ?? '').trim()
    const response = await fetch('/.netlify/functions/create-parent-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        password,
        inviteToken: normalizedInviteToken,
      }),
    })
    const result = await response.json().catch(() => ({}))

    if (!response.ok || result.success === false) {
      const error = new Error(result.message || 'Parent account could not be created.')
      console.error(error)
      setAuthError(error.message)
      throw error
    }

    setSession(null)
    setAuthUser(null)
    setUser(null)
    setClubOptions([])
    setTeamOptions([])
    setAccessModeOptions([])
    setIsProfileLoading(false)
    setAuthError('')

    return {
      needsEmailVerification: true,
      email: result.email || normalizedEmail,
    }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error(error)
      setAuthError(error.message || 'Sign out failed.')
      throw error
    }
  }

  const resetPassword = async (email) => {
    const normalizedEmail = String(email ?? '').trim()

    if (!normalizedEmail) {
      throw new Error('Enter your email address first.')
    }

    setAuthError('')

    const response = await fetch('/.netlify/functions/send-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        redirectTo: getPasswordResetRedirectUrl(),
      }),
    })

    const result = await response.json().catch(() => ({}))

    if (!response.ok || result.success === false) {
      const message = result.message || 'Password reset failed.'
      console.error(result)
      setAuthError(message)
      throw new Error(message)
    }
  }

  const updateCurrentClubDetails = (clubDetails) => {
    setUser((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        clubName: String(clubDetails.name ?? current.clubName ?? '').trim(),
        team: String(clubDetails.name ?? current.team ?? '').trim(),
        clubLogoUrl: String(clubDetails.logoUrl ?? current.clubLogoUrl ?? '').trim(),
        clubContactEmail: String(clubDetails.contactEmail ?? current.clubContactEmail ?? '').trim(),
        clubContactPhone: String(clubDetails.contactPhone ?? current.clubContactPhone ?? '').trim(),
        planKey: String(clubDetails.planKey ?? current.planKey ?? 'small_club').trim(),
        planStatus: String(clubDetails.planStatus ?? current.planStatus ?? 'active').trim(),
        isPlanComped: Boolean(clubDetails.isPlanComped ?? current.isPlanComped ?? false),
        stripeCustomerId: String(clubDetails.stripeCustomerId ?? current.stripeCustomerId ?? '').trim(),
        stripeSubscriptionId: String(clubDetails.stripeSubscriptionId ?? current.stripeSubscriptionId ?? '').trim(),
        stripePriceId: String(clubDetails.stripePriceId ?? current.stripePriceId ?? '').trim(),
        currentPeriodEnd: clubDetails.currentPeriodEnd ?? current.currentPeriodEnd ?? '',
        planUpdatedAt: clubDetails.planUpdatedAt ?? current.planUpdatedAt ?? '',
        requireApproval: Boolean(clubDetails.requireApproval ?? current.requireApproval ?? true),
      }
    })
  }

  const updateCurrentUserDetails = (profile) => {
    setUser((current) => {
      if (!current) {
        return profile
      }

      return {
        ...current,
        ...profile,
      }
    })
  }

  const value = {
    session,
    authUser,
    user,
    clubOptions,
    accessModeOptions,
    teamOptions,
    hasPlatformAdminAccess,
    isLoading,
    isProfileLoading,
    authError,
    signInWithPassword,
    signUpWithClub,
    signUpParentAccount,
    selectClub,
    selectAccessMode,
    selectTeam,
    selectPlatformAdmin,
    refreshTeamSelection,
    resetPassword,
    signOut,
    updateCurrentClubDetails,
    updateCurrentUserDetails,
    demoRoleKey,
    setDemoRolePreview,
  }

  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
