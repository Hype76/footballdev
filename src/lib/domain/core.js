import {
  CLUB_LOGOS_BUCKET,
  EVALUATION_SECTIONS,
  MAX_LOGO_FILE_SIZE_BYTES,
  REQUEST_TIMEOUT_MS,
  supabase,
} from '../supabase-client.js'
import {
  clearViewCaches,
  getCachedResource,
  invalidateMemoryCacheByPrefix,
} from './cache-store.js'
import {
  CLUB_SELECT,
  MEMBERSHIP_CLUB_SELECT,
  USER_PROFILE_SELECT,
} from './core-constants.js'
import {
  PLAYER_CONTACT_TYPES,
} from './contact-utils.js'
import { createAuditLog } from './audit.js'
import {
  normalizeCommunicationLogRow,
  normalizePlayerStaffNoteRow,
} from './activity-normalizers.js'
import {
  getSignupClubName,
  normalizeClubMembershipRow,
  normalizeUserProfile,
} from './profile-normalizers.js'
import {
  attachStaffVoiceNoteUrls,
  uploadStaffVoiceNote,
} from './staff-voice-notes.js'
import {
  canEditClubIdentity,
  PLAN_KEYS,
} from '../plans.js'
import {
  assertPlayerLimitForUpsert,
  findExistingPlayer,
} from './plan-gates.js'
import { fetchClubDetails } from './club-data.js'
import {
  getTeams,
} from './team-actions.js'
import {
  blockDemoMutation,
  isDemoAccountValue,
} from './demo-guards.js'
import {
  SYSTEM_ROLE_OPTIONS,
} from './core-defaults.js'
import {
  canSwitchParentToStaff,
  getActiveStaffMemberships,
} from '../staff-workspace-access.js'
import {
  getEntryIdentity,
  getEntryUserEmail,
  getEntryUserId,
  getEntryUserName,
} from './core-normalizers.js'
import {
  normalizeEvaluationRow,
} from './evaluation-normalizers.js'
import {
  mapPlayerToRow,
  normalizePlayerRow,
} from './player-normalizers.js'
import {
  ARCHIVED_PLAYER_RETENTION_MONTHS,
  VOICE_NOTE_RETENTION_DAYS,
  addDays,
  addMonths,
} from '../retention.js'
export { supabase, CLUB_LOGOS_BUCKET, MAX_LOGO_FILE_SIZE_BYTES, EVALUATION_SECTIONS, REQUEST_TIMEOUT_MS } from '../supabase-client.js'
export {
  formatParentContactEmails,
  formatParentContactNames,
  getContactTemplateAudiences,
  normalizeParentContacts,
  normalizePlayerContactType,
  PLAYER_CONTACT_TYPES,
} from './contact-utils.js'
export { getDefaultClubRoles, getDefaultFormFields, SYSTEM_ROLE_OPTIONS } from './core-defaults.js'
export {
  getDisplayName,
  getClubName,
  getClubValue,
  getEntryIdentity,
  getEntryUserEmail,
  getEntryUserId,
  getEntryUserName,
  getLegacyRoleDefaults,
  isPastDate,
  normalizeDateOnly,
  normalizeFieldOptions,
  normalizeFieldType,
  normalizeRoleKey,
  normalizeRoleLabel,
  normalizeRoleRank,
  normalizeWords,
} from './core-normalizers.js'
export * from './evaluation-normalizers.js'
export * from './player-normalizers.js'
export * from './session-normalizers.js'
export * from './activity-normalizers.js'
export * from './form-field-normalizers.js'
export * from './role-normalizers.js'
export * from './platform-normalizers.js'
export * from './team-normalizers.js'
export * from './profile-normalizers.js'
export * from './club-logo-utils.js'
export * from './club-settings-normalizers.js'
export * from './demo-guards.js'
export * from './staff-voice-notes.js'
export * from './core-seeding.js'
export * from './platform-admin-actions.js'
export * from './club-data.js'
export * from './plan-gates.js'
export * from './form-field-actions.js'
export * from './team-actions.js'
export * from './club-user-actions.js'
export * from './sessions.js'
export * from './evaluation-actions.js'
export * from './role-queries.js'
export * from './club-settings-actions.js'

async function claimInvitedUserProfiles(authUser) {
  if (!authUser?.id) {
    return []
  }

  const { data, error } = await supabase.rpc('accept_own_club_user_invites')

  if (error) {
    console.error(error)
    throw error
  }

  return (Array.isArray(data) ? data : []).map(normalizeClubMembershipRow)
}

async function getUserClubMemberships(authUser) {
  if (!authUser?.id) {
    return []
  }

  const { data, error } = await supabase
    .from('user_club_memberships')
    .select(MEMBERSHIP_CLUB_SELECT)
    .eq('auth_user_id', authUser.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? [])
    .filter((row) => {
      const clubRow = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs
      return Boolean(row.club_id && clubRow?.id)
    })
    .map(normalizeClubMembershipRow)
}

async function getParentPortalMemberships(authUser) {
  if (!authUser?.id) {
    return []
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name, logo_url, contact_email)')
    .eq('auth_user_id', authUser.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) {
    console.error(error)
    return []
  }

  const normalizedAuthEmail = String(authUser.email ?? '').trim().toLowerCase()
  const rows = data ?? []

  if (normalizedAuthEmail && rows.some((row) => String(row.email ?? '').trim().toLowerCase() !== normalizedAuthEmail)) {
    const { data: syncedRows, error: syncError } = await supabase
      .from('parent_player_links')
      .update({
        email: normalizedAuthEmail,
        updated_at: new Date().toISOString(),
      })
      .eq('auth_user_id', authUser.id)
      .eq('status', 'active')
      .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name, logo_url, contact_email)')

    if (syncError) {
      console.error(syncError)
    } else {
      rows.splice(0, rows.length, ...(syncedRows ?? []))
    }
  }

  return rows.map((row) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
    const club = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs

    return {
      id: row.id,
      clubId: row.club_id,
      clubName: String(club?.name ?? '').trim(),
      clubLogoUrl: String(club?.logo_url ?? '').trim(),
      clubContactEmail: String(club?.contact_email ?? '').trim(),
      teamId: row.team_id,
      teamName: String(team?.name ?? player?.team ?? '').trim(),
      themeMode: String(team?.theme_mode ?? '').trim(),
      themeAccent: String(team?.theme_accent ?? '').trim(),
      themeButtonStyle: String(team?.theme_button_style ?? '').trim(),
      playerId: row.player_id,
      playerName: String(player?.player_name ?? '').trim(),
      playerSection: String(player?.section ?? '').trim(),
      linkType: String(row.link_type ?? 'parent').trim(),
    }
  })
}

function normalizeParentPortalProfile(authUser, parentLinks, options = {}) {
  const selectedLink = parentLinks[0]

  return {
    id: authUser.id,
    email: String(authUser.email ?? '').trim().toLowerCase(),
    username: String(authUser.user_metadata?.username ?? '').trim(),
    name: String(authUser.user_metadata?.name ?? authUser.email ?? '').trim(),
    displayName: String(authUser.user_metadata?.display_name ?? authUser.user_metadata?.name ?? authUser.email ?? '').trim(),
    role: 'parent_portal',
    roleLabel: 'Parent',
    roleRank: 0,
    accountStatus: 'active',
    planKey: PLAN_KEYS.individual,
    planStatus: 'active',
    isPlanComped: false,
    clubId: selectedLink?.clubId ?? '',
    clubName: selectedLink?.clubName ?? 'Family portal',
    clubLogoUrl: selectedLink?.clubLogoUrl ?? '',
    activeTeamId: selectedLink?.teamId ?? '',
    activeTeamName: selectedLink?.teamName ?? '',
    themeMode: selectedLink?.themeMode ?? '',
    themeAccent: selectedLink?.themeAccent ?? '',
    themeButtonStyle: selectedLink?.themeButtonStyle ?? '',
    parentPortalLinks: parentLinks,
    accessModeOptions: Array.isArray(options.accessModeOptions) ? options.accessModeOptions : [],
    selectedParentLinkId: selectedLink?.id ?? '',
    selectedPlayerId: selectedLink?.playerId ?? '',
    selectedPlayerName: selectedLink?.playerName ?? '',
    selectedPlayerSection: selectedLink?.playerSection ?? '',
  }
}

function buildParentAccessModeOptions({ hasPlatformAccess = false, hasTeamAccess = false } = {}) {
  const options = []

  if (hasPlatformAccess) {
    options.push({ id: 'platform_admin', label: 'Platform Admin', meta: 'Open platform administration tools' })
  }

  if (hasTeamAccess) {
    options.push({ id: 'team', label: 'Team / Coach', meta: 'Open coaching and club tools' })
  }

  return options
}

async function applyActiveMembership(authUser, membership) {
  const { data, error } = await supabase.rpc('activate_own_club_membership', {
    target_club_id: membership.clubId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`user-profile:${authUser.id}`)
  return data
}

async function resolveIncompleteClubProfile(authUser, selectedClubId = '', { allowClubCreation = true } = {}) {
  const memberships = await getUserClubMemberships(authUser)

  if (memberships.length === 0) {
    if (!allowClubCreation) {
      return {
        teamAccessUnavailable: true,
        intendedAccessMode: 'team',
      }
    }

    return createClubAndManagerProfile({
      authUser,
      clubName: getSignupClubName(authUser),
    })
  }

  if (memberships.length > 1 && !selectedClubId) {
    return {
      requiresClubSelection: true,
      clubOptions: memberships,
    }
  }

  const selectedMembership =
    memberships.find((membership) => String(membership.clubId) === selectedClubId) ?? memberships[0]

  return applyActiveMembership(authUser, selectedMembership)
}

export function shouldCompleteSignupClubProfile({ selectedAccessMode = '', loginAccessIntent = '' } = {}) {
  const normalizedSelectedAccessMode = String(selectedAccessMode ?? '').trim()
  const normalizedLoginAccessIntent = String(loginAccessIntent ?? '').trim()

  if (['team', 'parent', 'platform_admin'].includes(normalizedLoginAccessIntent)) {
    return false
  }

  return normalizedSelectedAccessMode !== 'parent'
}

async function ensureSignupClubProfileWithServer({ authUser, clubName, accessCode = '', planKey = '', forceNewClub = false, signupIntent = false }) {
  await blockDemoMutation(authUser)

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token

  if (!accessToken) {
    throw new Error('Login again before creating your club.')
  }

  const response = await fetch('/.netlify/functions/ensure-signup-club-profile', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clubName: String(clubName ?? '').trim(),
      accessCode: String(accessCode ?? '').trim(),
      planKey: String(planKey ?? '').trim(),
      forceNewClub: Boolean(forceNewClub),
      signupIntent: Boolean(signupIntent),
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false || !result.profile) {
    throw new Error(result.message || result.error || 'Could not create your club profile.')
  }

  invalidateMemoryCacheByPrefix(`user-profile:${authUser.id}`)
  return normalizeUserProfile({
    ...result.profile,
    clubs: result.club ?? result.profile.clubs ?? null,
    email: result.profile.email || authUser.email,
  })
}

export async function selectUserClub(authUser, clubId) {
  if (!authUser?.id || !clubId) {
    throw new Error('Choose a club to continue.')
  }

  await blockDemoMutation(authUser)
  await claimInvitedUserProfiles(authUser)
  const memberships = await getUserClubMemberships(authUser)
  const selectedMembership = memberships.find((membership) => String(membership.clubId) === String(clubId))

  if (!selectedMembership) {
    throw new Error('This club is not linked to your account.')
  }

  const data = await applyActiveMembership(authUser, selectedMembership)
  return normalizeUserProfile({
    ...data,
    clubOptions: memberships,
    clubs: {
      name: selectedMembership.clubName,
      logo_url: selectedMembership.clubLogoUrl,
      contact_email: selectedMembership.clubContactEmail,
      contact_phone: selectedMembership.clubContactPhone,
      require_approval: selectedMembership.requireApproval,
      status: selectedMembership.clubStatus,
      suspended_at: selectedMembership.clubSuspendedAt,
      plan_key: selectedMembership.planKey,
      plan_status: selectedMembership.planStatus,
      is_plan_comped: selectedMembership.isPlanComped,
    },
  })
}

export async function fetchUserProfile(authUser, options = {}) {
  let selectedClubId = String(options.selectedClubId ?? '').trim()
  const selectedAccessMode = String(options.selectedAccessMode ?? '').trim()
  const loginAccessIntent = String(options.loginAccessIntent ?? '').trim()
  const requireExistingStaffAccess = options.requireExistingStaffAccess === true
  const cacheKey = `user-profile:${authUser?.id || ''}:${selectedClubId || 'active'}:${selectedAccessMode || 'default'}:${requireExistingStaffAccess ? 'existing-staff' : 'standard'}`
  const isDemoAuthUser = isDemoAccountValue(authUser)

  if (!authUser?.id) {
    throw new Error('User profile not found.')
  }

  return getCachedResource(cacheKey, async () => {
    const loadUserRow = async () => {
      const { data, error } = await supabase
        .from('users')
        .select(USER_PROFILE_SELECT)
        .eq('id', authUser.id)
        .maybeSingle()

      if (error) {
        console.error(error)
        throw error
      }

      return data
    }

    let data = await loadUserRow()
    const parentLinks = isDemoAuthUser ? [] : await getParentPortalMemberships(authUser)
    const hasParentAccess = parentLinks.length > 0
    let loadedMemberships = null
    let loadedAuthoritativeStaffMemberships = null
    const loadMemberships = async () => {
      if (loadedMemberships === null) {
        loadedMemberships = isDemoAuthUser ? [] : await getUserClubMemberships(authUser)
      }

      return loadedMemberships
    }
    const loadAuthoritativeStaffMemberships = async () => {
      if (loadedAuthoritativeStaffMemberships !== null) {
        return loadedAuthoritativeStaffMemberships
      }

      const memberships = await loadMemberships()

      loadedAuthoritativeStaffMemberships = memberships
      return loadedAuthoritativeStaffMemberships
    }
    const loadStaffMemberships = async () => {
      const memberships = requireExistingStaffAccess
        ? await loadAuthoritativeStaffMemberships()
        : await loadMemberships()
      return requireExistingStaffAccess ? getActiveStaffMemberships(memberships) : memberships
    }
    const allowSignupClubProfileCompletion = shouldCompleteSignupClubProfile({
      selectedAccessMode,
      loginAccessIntent,
    })

    if (!isDemoAuthUser && !requireExistingStaffAccess) {
      const acceptedMemberships = await claimInvitedUserProfiles(authUser)

      if (acceptedMemberships.length > 0) {
        loadedMemberships = null
        loadedAuthoritativeStaffMemberships = null
        data = await loadUserRow()
      }
    }

    if (selectedAccessMode === 'team' && requireExistingStaffAccess) {
      const memberships = await loadAuthoritativeStaffMemberships()

      if (!canSwitchParentToStaff({ profile: data, memberships })) {
        return {
          teamAccessUnavailable: true,
          intendedAccessMode: 'team',
        }
      }

      const activeMemberships = getActiveStaffMemberships(memberships)
      if (selectedClubId && !activeMemberships.some((membership) => String(membership.clubId) === selectedClubId)) {
        selectedClubId = ''
      }
    }

    if (hasParentAccess && selectedAccessMode === 'parent') {
      const memberships = await loadAuthoritativeStaffMemberships()
      const hasPlatformAccess = data?.role === 'super_admin'
      const hasTeamAccess = canSwitchParentToStaff({ profile: data, memberships })

      return normalizeParentPortalProfile(authUser, parentLinks, {
        accessModeOptions: buildParentAccessModeOptions({ hasPlatformAccess, hasTeamAccess }),
      })
    }

    if (data?.role === 'super_admin') {
      const memberships = await loadStaffMemberships()

      if (selectedAccessMode === 'parent' && !hasParentAccess) {
        return {
          parentAccessUnavailable: true,
          accessModeOptions: buildParentAccessModeOptions({ hasPlatformAccess: true }),
        }
      }

      if (hasParentAccess && !selectedAccessMode) {
        return {
          requiresAccessModeSelection: true,
          accessModeOptions: [
            { id: 'platform_admin', label: 'Platform Admin', meta: 'Open platform administration tools' },
            { id: 'parent', label: 'Parent / Friends and Family', meta: 'Open linked child access only' },
          ],
        }
      }

      return normalizeUserProfile({
        ...data,
        email: data.email || authUser.email,
        clubOptions: memberships,
        parentPortalLinks: parentLinks,
      })
    }

    if (!isDemoAuthUser && allowSignupClubProfileCompletion && data?.role === 'admin' && data?.club_id) {
      try {
        const ensuredProfile = await ensureSignupClubProfileWithServer({
          authUser,
          clubName: getSignupClubName(authUser),
        })

        if (ensuredProfile?.planKey === 'individual' || ensuredProfile?.planKey === 'single_team') {
          return ensuredProfile
        }

        data = await loadUserRow()
      } catch (error) {
        console.error(error)
      }
    }

    if (!data) {
      if (isDemoAuthUser) {
        throw new Error('Demo profile not found.')
      }

      if (hasParentAccess) {
        const memberships = await loadStaffMemberships()

        if (memberships.length > 0) {
          if (selectedAccessMode === 'team' && loginAccessIntent === 'team') {
            return {
              requiresClubSelection: true,
              clubOptions: memberships,
            }
          }

          return {
            requiresAccessModeSelection: true,
            accessModeOptions: [
              { id: 'team', label: 'Team / Coach', meta: 'Open coaching and club tools' },
              { id: 'parent', label: 'Parent', meta: 'Open linked child access only' },
            ],
          }
        }

        if (selectedAccessMode === 'team' && loginAccessIntent === 'team') {
          return {
            loginIntentMismatch: true,
            intendedAccessMode: 'team',
            availableAccessMode: 'parent',
          }
        }

        return normalizeParentPortalProfile(authUser, parentLinks)
      }

      data = await resolveIncompleteClubProfile(authUser, selectedClubId, {
        allowClubCreation: allowSignupClubProfileCompletion,
      })
      if (data?.teamAccessUnavailable) {
        return data
      }

      if (data?.requiresClubSelection) {
        return data
      }
    }

    if (!isDemoAuthUser && data?.role !== 'super_admin' && !data?.club_id) {
      data = await resolveIncompleteClubProfile(authUser, selectedClubId, {
        allowClubCreation: allowSignupClubProfileCompletion,
      })
      if (data?.teamAccessUnavailable) {
        return data
      }

      if (data?.requiresClubSelection) {
        return data
      }
    }

    const authEmail = String(authUser.email ?? '').trim().toLowerCase()
    const profileEmail = String(data.email ?? '').trim().toLowerCase()

    if (!isDemoAuthUser && !requireExistingStaffAccess && authEmail && authEmail !== profileEmail) {
      const { data: syncedData, error: syncError } = await supabase.rpc('sync_own_user_email')

      if (syncError) {
        console.error(syncError)
      } else {
        data = syncedData
      }
    }

    const memberships = data.role === 'super_admin' ? [] : await loadStaffMemberships()
    const hasTeamAccess = Boolean(data?.club_id || memberships.length > 0 || data.role === 'super_admin')

    if (selectedAccessMode === 'parent' && loginAccessIntent === 'parent' && !hasParentAccess && hasTeamAccess) {
      return {
        loginIntentMismatch: true,
        intendedAccessMode: 'parent',
        availableAccessMode: 'team',
      }
    }

    if (selectedAccessMode === 'parent' && !hasParentAccess && hasTeamAccess) {
      return {
        parentAccessUnavailable: true,
        accessModeOptions: buildParentAccessModeOptions({ hasTeamAccess: true }),
      }
    }

    if (hasTeamAccess && hasParentAccess && !selectedAccessMode) {
      return {
        requiresAccessModeSelection: true,
        accessModeOptions: [
          { id: 'team', label: 'Team / Coach', meta: 'Open coaching and club tools' },
          { id: 'parent', label: 'Parent', meta: 'Open linked child access only' },
        ],
      }
    }

    if (memberships.length > 1 && !selectedClubId) {
      return {
        requiresClubSelection: true,
        clubOptions: memberships,
      }
    }

    if (!isDemoAuthUser && memberships.length > 1 && selectedClubId && String(data.club_id) !== selectedClubId) {
      const selectedMembership = memberships.find((membership) => String(membership.clubId) === selectedClubId)

      if (!selectedMembership) {
        return {
          requiresClubSelection: true,
          clubOptions: memberships,
        }
      }

      data = await applyActiveMembership(authUser, selectedMembership)
    }

    let clubData = null

    if (data.club_id) {
      try {
        clubData = await fetchClubDetails(data.club_id)
      } catch (error) {
        console.error(error)
      }
    }

    return normalizeUserProfile({
      ...data,
      clubs: clubData,
      email: data.email || authUser.email,
      parentPortalLinks: parentLinks,
    })
  })
}

export async function createClubAndManagerProfile({ authUser, clubName, accessCode = '', planKey = '', forceNewClub = false }) {
  await blockDemoMutation(authUser)

  try {
    return await ensureSignupClubProfileWithServer({
      authUser,
      clubName,
      accessCode,
      planKey,
      forceNewClub,
      signupIntent: forceNewClub || Boolean(String(accessCode ?? '').trim()),
    })
  } catch (serverError) {
    console.error(serverError)
    throw serverError
  }
}

export async function updateOwnUserSettings({
  authUser,
  username,
  displayName,
  teamName,
  clubName,
  replyToEmail,
}) {
  if (!authUser?.id) {
    throw new Error('Signed in user is required.')
  }

  await blockDemoMutation(authUser)

  const normalizedUsername = String(username ?? '').trim()
  const normalizedDisplayName = String(displayName ?? '').trim()
  const normalizedTeamName = String(teamName ?? '').trim()
  const normalizedClubName = String(clubName ?? '').trim()
  const normalizedReplyToEmail = String(replyToEmail ?? '').trim().toLowerCase()

  if (!normalizedUsername) {
    throw new Error('Username is required.')
  }

  const { data: currentProfile, error: currentProfileError } = await supabase
    .from('users')
    .select(`${USER_PROFILE_SELECT}, clubs:club_id (${CLUB_SELECT})`)
    .eq('id', authUser.id)
    .single()

  if (currentProfileError) {
    console.error(currentProfileError)
    throw currentProfileError
  }

  const currentUser = normalizeUserProfile(currentProfile)
  const canEditSenderIdentity = Number(currentUser.roleRank ?? 0) >= 50
  const safeTeamName = canEditSenderIdentity
    ? normalizedTeamName
    : String(currentUser.emailTeamName || currentUser.activeTeamName || '').trim()
  const safeClubName = canEditClubIdentity(currentUser)
    ? normalizedClubName
    : String(currentUser.emailClubName || currentUser.clubName || '').trim()
  const safeReplyToEmail = canEditSenderIdentity
    ? normalizedReplyToEmail
    : String(currentUser.replyToEmail || currentUser.email || '').trim().toLowerCase()

  const { data, error } = await supabase.rpc('update_own_user_profile', {
    profile_username: normalizedUsername,
    profile_display_name: normalizedDisplayName,
    profile_team_name: safeTeamName,
    profile_club_name: safeClubName,
    profile_reply_to_email: safeReplyToEmail,
  })

  if (error) {
    console.error(error)
    throw error
  }

  const { error: authError } = await supabase.auth.updateUser({
    data: {
      username: normalizedUsername,
      name: normalizedUsername,
    },
  })

  if (authError) {
    console.error(authError)
  }

  invalidateMemoryCacheByPrefix(`user-profile:${authUser.id}`)

  let clubData = null

  if (data.club_id) {
    try {
      clubData = await fetchClubDetails(data.club_id)
    } catch (clubError) {
      console.error(clubError)
    }
  }

  return normalizeUserProfile({
    ...data,
    clubs: clubData,
  })
}

export async function updateOwnThemeSettings({ authUser, mode }) {
  if (!authUser?.id) {
    throw new Error('Signed in user is required.')
  }

  await blockDemoMutation(authUser)

  const normalizedMode = ['system', 'dark', 'light'].includes(mode) ? mode : 'system'

  const { data, error } = await supabase.rpc('update_own_theme_settings', {
    profile_mode: normalizedMode,
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`user-profile:${authUser.id}`)

  let clubData = null

  if (data.club_id) {
    try {
      clubData = await fetchClubDetails(data.club_id)
    } catch (clubError) {
      console.error(clubError)
    }
  }

  return normalizeUserProfile({
    ...data,
    clubs: clubData,
  })
}

export async function requestLoginEmailChange({ authUser, email }) {
  if (!authUser?.id) {
    throw new Error('Signed in user is required.')
  }

  await blockDemoMutation(authUser)

  const normalizedEmail = String(email ?? '').trim().toLowerCase()

  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  if (normalizedEmail === String(authUser.email ?? '').trim().toLowerCase()) {
    return {
      email: normalizedEmail,
      pendingConfirmation: false,
      unchanged: true,
    }
  }

  const { data, error } = await supabase.auth.updateUser({
    email: normalizedEmail,
  })

  if (error) {
    console.error(error)
    throw error
  }

  const confirmedEmail = String(data?.user?.email ?? '').trim().toLowerCase()
  const isConfirmedImmediately = confirmedEmail === normalizedEmail

  if (isConfirmedImmediately) {
    const { error: profileError } = await supabase.rpc('sync_own_user_email')

    if (profileError) {
      console.error(profileError)
      throw profileError
    }

    invalidateMemoryCacheByPrefix(`user-profile:${authUser.id}`)
  }

  return {
    email: normalizedEmail,
    pendingConfirmation: !isConfirmedImmediately,
  }
}

export async function updateSignedInPassword(password) {
  await blockDemoMutation()

  const normalizedPassword = String(password ?? '')

  if (normalizedPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }

  const { error } = await supabase.auth.updateUser({
    password: normalizedPassword,
  })

  if (error) {
    console.error(error)
    throw error
  }
}

export async function getEvaluations({ user, status, playerName, section, includeArchivedPlayers = false } = {}) {
  if (!user) {
    return []
  }

  let query = supabase.from('evaluations').select('*').order('created_at', { ascending: false })

  if (user.role !== 'super_admin') {
    if (!user.clubId) {
      return []
    }

    query = query.eq('club_id', user.clubId)
  }

  if (status) {
    query = query.eq('status', status)
  }

  if (playerName) {
    query = query.eq('player_name', playerName)
  }

  if (section) {
    query = query.eq('section', section)
  }

  if (user.activeTeamId) {
    query = query.eq('team_id', user.activeTeamId)
  } else if (user.activeTeamName) {
    query = query.eq('team', user.activeTeamName)
  }

  const shouldLoadArchivedPlayers = user.role !== 'super_admin' && user.clubId && !includeArchivedPlayers
  const [{ data, error }, teams, archivedPlayers] = await Promise.all([
    query,
    user.role === 'super_admin' ? Promise.resolve([]) : getTeams(user).catch(() => []),
    shouldLoadArchivedPlayers
      ? getPlayers({ user, status: 'archived', includeArchived: true }).catch(() => [])
      : Promise.resolve([]),
  ])

  if (error) {
    console.error(error)
    throw error
  }

  const teamsByName = new Map(teams.map((team) => [String(team.name ?? '').trim().toLowerCase(), team]))
  const archivedPlayerIds = new Set(archivedPlayers.map((player) => String(player.id ?? '').trim()).filter(Boolean))
  const archivedPlayerNames = new Set(
    archivedPlayers.map((player) => String(player.playerName ?? '').trim().toLowerCase()).filter(Boolean),
  )

  return (data ?? [])
    .map((row) => normalizeEvaluationRow(row))
    .filter((evaluation) => {
      if (includeArchivedPlayers || (archivedPlayerIds.size === 0 && archivedPlayerNames.size === 0)) {
        return true
      }

      const evaluationPlayerId = String(evaluation.playerId ?? '').trim()
      const evaluationPlayerName = String(evaluation.playerName ?? '').trim().toLowerCase()

      return !archivedPlayerIds.has(evaluationPlayerId) && !archivedPlayerNames.has(evaluationPlayerName)
    })
    .map((evaluation) => {
      const matchingTeam = teamsByName.get(evaluation.team.toLowerCase())

      return {
        ...evaluation,
        teamRequireApproval: Boolean(matchingTeam?.requireApproval ?? evaluation.teamRequireApproval ?? true),
      }
    })
}

export async function getPlayers({ user, section, playerId, playerName, teamId, status, includeArchived = false } = {}) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const normalizedPlayerId = String(playerId ?? '').trim()
  const normalizedTeamId = String(teamId ?? '').trim()
  const playerCacheScope = normalizedPlayerId ? `id:${normalizedPlayerId}` : `name:${playerName || 'all'}`
  const teamCacheScope = normalizedTeamId || user.activeTeamId || user.activeTeamName || 'all'
  const cacheKey = `players:${user.clubId}:${section || 'all'}:${playerCacheScope}:${teamCacheScope}:${status || 'current'}:${includeArchived ? 'with-archived' : 'without-archived'}`

  return getCachedResource(cacheKey, async () => {
    let query = supabase
      .from('players')
      .select('*')
      .eq('club_id', user.clubId)
      .order('section', { ascending: true })
      .order('player_name', { ascending: true })

    if (section) {
      query = query.eq('section', section)
    }

    if (status) {
      query = query.eq('status', status)
    } else if (!includeArchived) {
      query = query.neq('status', 'archived')
    }

    if (normalizedTeamId) {
      query = query.eq('team_id', normalizedTeamId)
    } else if (!normalizedPlayerId && user.activeTeamId) {
      query = query.eq('team_id', user.activeTeamId)
    } else if (!normalizedPlayerId && user.activeTeamName) {
      query = query.eq('team', user.activeTeamName)
    }

    if (normalizedPlayerId) {
      query = query.eq('id', normalizedPlayerId)
    } else if (playerName) {
      query = query.eq('player_name', playerName)
    }

    const { data, error } = await query

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizePlayerRow)
  })
}

export async function createPlayer({ user, player }) {
  await blockDemoMutation(user)

  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to add players.')
  }

  await assertPlayerLimitForUpsert({
    user,
    clubId: user.clubId,
    section: player.section,
    playerName: player.playerName ?? player.name,
    team: player.team,
    teamId: player.teamId || user.activeTeamId,
  })

  const payload = {
    ...mapPlayerToRow(player, user),
    status: player.status || 'active',
    archived_at: null,
    archived_delete_at: null,
    archived_by: null,
    archived_reason: null,
    created_by: getEntryUserId(user),
    ...getEntryIdentity(user),
  }
  const existingPlayer = await findExistingPlayer({
    clubId: user.clubId,
    section: player.section,
    playerName: player.playerName ?? player.name,
    team: player.team,
    teamId: player.teamId || user.activeTeamId,
  })
  const query = existingPlayer?.id
    ? supabase.from('players').update(payload).eq('id', existingPlayer.id)
    : supabase.from('players').insert(payload)
  let { data, error } = await query.select('*').single()

  if (!existingPlayer?.id && error?.code === '23505') {
    const fallback = await supabase
      .from('players')
      .upsert(payload, {
        onConflict: 'club_id,team_id,section,player_name',
      })
      .select('*')
      .single()

    data = fallback.data
    error = fallback.error
  }

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'player_created',
    entityType: 'player',
    entityId: data.id,
    metadata: {
      playerName: data.player_name,
      section: data.section,
      team: data.team,
    },
  })
  return normalizePlayerRow(data)
}

export async function archivePlayer({ user, playerId, reason }) {
  await blockDemoMutation(user)

  const normalizedReason = String(reason ?? '').trim()

  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to archive players.')
  }

  if (Number(user.roleRank ?? 0) < 20) {
    throw new Error('You do not have access to archive players.')
  }

  if (!playerId) {
    throw new Error('Player is required.')
  }

  if (!normalizedReason) {
    throw new Error('Add an archive reason before continuing.')
  }

  const { data: currentPlayerRow, error: currentPlayerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .single()

  if (currentPlayerError) {
    console.error(currentPlayerError)
    throw currentPlayerError
  }

  const currentPlayer = normalizePlayerRow(currentPlayerRow)
  const previousStatus = currentPlayer.status === 'archived'
    ? currentPlayer.archivedPreviousStatus || 'active'
    : currentPlayer.status || 'active'
  const archivedAt = new Date()

  const { data, error } = await supabase
    .from('players')
    .update({
      status: 'archived',
      archived_reason: normalizedReason,
      archived_at: archivedAt.toISOString(),
      archived_delete_at: addMonths(archivedAt, ARCHIVED_PLAYER_RETENTION_MONTHS).toISOString(),
      archived_by: user.id,
      archived_previous_status: previousStatus,
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
    })
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'player_archived',
    entityType: 'player',
    entityId: data.id,
    metadata: {
      playerName: data.player_name,
      section: data.section,
      team: data.team,
      reason: normalizedReason,
    },
  })

  return normalizePlayerRow(data)
}

export async function restorePlayer({ user, playerId }) {
  await blockDemoMutation(user)

  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to restore players.')
  }

  if (!playerId) {
    throw new Error('Player is required.')
  }

  const { data: currentPlayerRow, error: currentPlayerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .single()

  if (currentPlayerError) {
    console.error(currentPlayerError)
    throw currentPlayerError
  }

  const currentPlayer = normalizePlayerRow(currentPlayerRow)
  const restoredStatus = currentPlayer.archivedPreviousStatus && currentPlayer.archivedPreviousStatus !== 'archived'
    ? currentPlayer.archivedPreviousStatus
    : 'active'

  if (restoredStatus !== 'archived') {
    await assertPlayerLimitForUpsert({
      user,
      clubId: user.clubId,
      section: currentPlayer.section,
      playerName: currentPlayer.playerName,
      team: currentPlayer.team,
      teamId: currentPlayer.teamId,
    })
  }

  const { data, error } = await supabase
    .from('players')
    .update({
      status: restoredStatus,
      archived_reason: null,
      archived_at: null,
      archived_delete_at: null,
      archived_by: null,
      archived_previous_status: null,
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
    })
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'player_restored',
    entityType: 'player',
    entityId: data.id,
    metadata: {
      playerName: data.player_name,
      section: data.section,
      team: data.team,
    },
  })

  return normalizePlayerRow(data)
}

export async function createCommunicationLog({
  user,
  playerId,
  evaluationId,
  channel = 'pdf',
  action,
  recipientEmail = '',
  metadata = {},
}) {
  if (isDemoAccountValue(user)) {
    return
  }

  if (!user?.clubId || !user?.id || !action) {
    return
  }

  const { data, error } = await supabase.from('communication_logs').insert({
    club_id: user.clubId,
    player_id: playerId || null,
    evaluation_id: evaluationId || null,
    user_id: user.id,
    user_name: getEntryUserName(user),
    user_email: getEntryUserEmail(user),
    channel,
    action,
    recipient_email: String(recipientEmail ?? '').trim(),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  }).select('id').single()

  if (error) {
    console.error(error)
    return null
  }

  return data
}

export async function getPlayerCommunicationLogs({ user, playerId, limit = 50 } = {}) {
  if (!user?.clubId || !playerId) {
    return []
  }

  const { data, error } = await supabase
    .from('communication_logs')
    .select('*')
    .eq('club_id', user.clubId)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeCommunicationLogRow)
}

export async function getPlayerDecisionLogs({ user, limit = 1000 } = {}) {
  if (!user?.clubId) {
    return []
  }

  let query = supabase
    .from('communication_logs')
    .select('*')
    .eq('club_id', user.clubId)
    .eq('channel', 'player_decision')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 1000, 1), 2000))

  if (user.activeTeamName) {
    query = query.eq('metadata->>team', user.activeTeamName)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeCommunicationLogRow)
}

export async function getAssessmentReminderLogs({ user, limit = 1000 } = {}) {
  if (!user?.clubId) {
    return []
  }

  let query = supabase
    .from('communication_logs')
    .select('*')
    .eq('club_id', user.clubId)
    .eq('channel', 'reminder')
    .eq('action', 'next_assessment_reminder_set')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 1000, 1), 2000))

  if (user.activeTeamName) {
    query = query.eq('metadata->>team', user.activeTeamName)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeCommunicationLogRow)
}

export async function createPlayerStaffNote({ user, playerId, sessionId = '', note, audioBlob = null, audioDurationSeconds = null }) {
  await blockDemoMutation(user)

  const normalizedNote = String(note ?? '').trim()
  const hasAudio = Boolean(audioBlob)

  if (!user?.clubId || !user?.id || (!normalizedNote && !hasAudio)) {
    throw new Error('Add a note before saving.')
  }

  const audioUpload = await uploadStaffVoiceNote({
    user,
    playerId,
    sessionId,
    audioBlob,
  })
  const audioExpiresAt = hasAudio ? addDays(new Date(), VOICE_NOTE_RETENTION_DAYS).toISOString() : null

  const { data, error } = await supabase
    .from('player_staff_notes')
    .insert({
      club_id: user.clubId,
      player_id: playerId || null,
      session_id: sessionId || null,
      user_id: user.id,
      user_name: getEntryUserName(user),
      user_email: getEntryUserEmail(user),
      note: normalizedNote || 'Voice note',
      audio_path: audioUpload.audioPath,
      audio_mime_type: audioUpload.audioMimeType,
      audio_duration_seconds: Number.isFinite(Number(audioDurationSeconds)) ? Number(audioDurationSeconds) : null,
      audio_expires_at: audioExpiresAt,
    })
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  try {
    await createCommunicationLog({
      user,
      playerId: playerId || null,
      channel: hasAudio ? 'voice_note' : 'staff_note',
      action: hasAudio ? 'voice_note_added' : 'staff_note_added',
      metadata: {
        sessionId: sessionId || '',
        hasAudio,
      },
    })
  } catch (logError) {
    console.error('Staff note activity could not be logged', logError)
  }

  const [noteWithAudioUrl] = await attachStaffVoiceNoteUrls([normalizePlayerStaffNoteRow(data)])
  return noteWithAudioUrl
}

export async function assignPlayerStaffNote({ user, noteId, playerId } = {}) {
  await blockDemoMutation(user)

  const normalizedNoteId = String(noteId ?? '').trim()
  const normalizedPlayerId = String(playerId ?? '').trim()
  const assignmentContext = {
    hasNoteId: Boolean(normalizedNoteId),
    hasPlayerId: Boolean(normalizedPlayerId),
    clubId: user?.clubId || '',
    currentTeamId: user?.activeTeamId || '',
    currentTeamName: user?.activeTeamName || '',
    userId: user?.id || '',
    role: user?.role || '',
    roleRank: user?.roleRank ?? '',
  }

  if (!user?.clubId || !user?.id || !normalizedNoteId || !normalizedPlayerId) {
    console.error('Voice note assignment blocked before lookup', assignmentContext)
    throw new Error('Choose a player before assigning this voice note.')
  }

  const [{ data: noteData, error: noteError }, { data: playerData, error: playerError }] = await Promise.all([
    supabase
      .from('player_staff_notes')
      .select('*')
      .eq('club_id', user.clubId)
      .eq('id', normalizedNoteId)
      .maybeSingle(),
    supabase
      .from('players')
      .select('*')
      .eq('club_id', user.clubId)
      .eq('id', normalizedPlayerId)
      .maybeSingle(),
  ])

  if (noteError || !noteData) {
    console.error('Voice note assignment note lookup failed', {
      ...assignmentContext,
      errorCode: noteError?.code || '',
      errorMessage: noteError?.message || '',
    })
    throw new Error('Voice note could not be found.')
  }

  if (playerError || !playerData) {
    console.error('Voice note assignment player lookup failed', {
      ...assignmentContext,
      errorCode: playerError?.code || '',
      errorMessage: playerError?.message || '',
    })
    throw new Error('Player could not be found.')
  }

  const activeTeamId = String(user.activeTeamId ?? '').trim()
  const activeTeamName = String(user.activeTeamName ?? '').trim().toLowerCase()
  const playerTeamId = String(playerData.team_id ?? '').trim()
  const playerTeamName = String(playerData.team ?? '').trim().toLowerCase()
  const noteOwnerId = String(noteData.user_id ?? '').trim()
  const canAssignOtherStaffNotes = Number(user.roleRank ?? 0) >= 50 || user.role === 'admin'
  const debugContext = {
    ...assignmentContext,
    noteOwnerId,
    notePlayerId: noteData.player_id || '',
    noteSessionId: noteData.session_id || '',
    selectedPlayerId: playerData.id || '',
    selectedPlayerSection: playerData.section || '',
    selectedPlayerStatus: playerData.status || '',
    selectedPlayerTeamId: playerTeamId,
    selectedPlayerTeamName: playerData.team || '',
    canAssignOtherStaffNotes,
  }

  if (activeTeamId && playerTeamId && activeTeamId !== playerTeamId) {
    console.error('Voice note assignment blocked by player team id guard', debugContext)
    throw new Error('Choose a player from your current team.')
  }

  if (activeTeamName && playerTeamName && activeTeamName !== playerTeamName) {
    console.error('Voice note assignment blocked by player team name guard', debugContext)
    throw new Error('Choose a player from your current team.')
  }

  if (noteOwnerId && noteOwnerId !== String(user.id) && !canAssignOtherStaffNotes) {
    console.error('Voice note assignment blocked by owner guard', debugContext)
    throw new Error('You can only assign voice notes you recorded.')
  }

  const { data, error } = await supabase
    .from('player_staff_notes')
    .update({ player_id: normalizedPlayerId })
    .eq('club_id', user.clubId)
    .eq('id', normalizedNoteId)
    .select('*')
    .maybeSingle()

  if (error || !data) {
    console.error('Voice note assignment update failed', {
      ...debugContext,
      errorCode: error?.code || '',
      errorMessage: error?.message || '',
      updatedRowReturned: Boolean(data),
    })
    throw new Error('Could not assign the voice note. Please try again.')
  }

  try {
    await createCommunicationLog({
      user,
      playerId: normalizedPlayerId,
      channel: 'voice_note',
      action: 'voice_note_assigned',
      metadata: {
        noteId: normalizedNoteId,
      },
    })
  } catch (logError) {
    console.error('Voice note assignment could not be logged', logError)
  }

  const [noteWithAudioUrl] = await attachStaffVoiceNoteUrls([normalizePlayerStaffNoteRow(data)])
  return noteWithAudioUrl
}

export async function getPlayerStaffNotes({ user, playerId, limit = 50 } = {}) {
  if (!user?.clubId || !playerId) {
    return []
  }

  const { data, error } = await supabase
    .from('player_staff_notes')
    .select('*')
    .eq('club_id', user.clubId)
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))

  if (error) {
    console.error(error)
    throw error
  }

  return attachStaffVoiceNoteUrls((data ?? []).map(normalizePlayerStaffNoteRow))
}

export async function getUnassignedStaffVoiceNotes({ user, limit = 10 } = {}) {
  if (!user?.clubId || !user?.id) {
    return []
  }

  let query = supabase
    .from('player_staff_notes')
    .select('*')
    .eq('club_id', user.clubId)
    .is('player_id', null)
    .is('session_id', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 10, 1), 25))

  if (Number(user.roleRank ?? 0) < 50 && user.role !== 'admin') {
    query = query.eq('user_id', user.id)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  return attachStaffVoiceNoteUrls((data ?? []).map(normalizePlayerStaffNoteRow))
}

export async function getSessionStaffNotes({ user, sessionId, limit = 50 } = {}) {
  if (!user?.clubId || !sessionId) {
    return []
  }

  const { data, error } = await supabase
    .from('player_staff_notes')
    .select('*')
    .eq('club_id', user.clubId)
    .eq('session_id', sessionId)
    .is('player_id', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))

  if (error) {
    console.error(error)
    throw error
  }

  return attachStaffVoiceNoteUrls((data ?? []).map(normalizePlayerStaffNoteRow))
}

export async function deletePlayerStaffNote({ noteId } = {}) {
  const normalizedNoteId = String(noteId ?? '').trim()

  if (!normalizedNoteId) {
    throw new Error('Voice note ID is required.')
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token

  if (!accessToken) {
    throw new Error('Login again before deleting this voice note.')
  }

  const response = await fetch('/.netlify/functions/delete-staff-voice-note', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ noteId: normalizedNoteId }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Voice note could not be deleted.')
  }

  return result
}

export async function updatePlayer({ user, playerId, player }) {
  await blockDemoMutation(user)

  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to update players.')
  }

  const { data: currentPlayerRow, error: currentPlayerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .single()

  if (currentPlayerError) {
    console.error(currentPlayerError)
    throw currentPlayerError
  }

  const currentPlayer = normalizePlayerRow(currentPlayerRow)
  const payload = mapPlayerToRow(player, user)
  const isPromotingToSquad = currentPlayer.section !== 'Squad' && payload.section === 'Squad'

  const { data, error } = await supabase
    .from('players')
    .update(payload)
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: isPromotingToSquad ? 'player_promoted' : 'player_updated',
    entityType: 'player',
    entityId: data.id,
    metadata: {
      playerName: data.player_name,
      section: data.section,
      team: data.team,
    },
  })
  return normalizePlayerRow(data)
}

export async function promotePlayerToSquad({ user, playerId }) {
  await blockDemoMutation(user)

  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to promote players.')
  }

  const { data: currentPlayerRow, error: currentPlayerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .single()

  if (currentPlayerError) {
    console.error(currentPlayerError)
    throw currentPlayerError
  }

  const currentPlayer = normalizePlayerRow(currentPlayerRow)

  if (currentPlayer.section === 'Squad') {
    return currentPlayer
  }

  const promotedAt = new Date().toISOString()
  const { data: promotedRow, error: promoteError } = await supabase
    .from('players')
    .update({
      section: 'Squad',
      status: 'promoted',
      promoted_at: promotedAt,
      promoted_by: user.id,
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
    })
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (promoteError) {
    console.error(promoteError)
    throw promoteError
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'player_promoted',
    entityType: 'player',
    entityId: promotedRow.id,
    metadata: {
      playerName: promotedRow.player_name,
      fromSection: currentPlayer.section,
      toSection: 'Squad',
      team: promotedRow.team,
    },
  })

  return normalizePlayerRow(promotedRow)
}

export async function movePlayerToTrial({ user, playerId }) {
  await blockDemoMutation(user)

  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to move players.')
  }

  const { data: currentPlayerRow, error: currentPlayerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .single()

  if (currentPlayerError) {
    console.error(currentPlayerError)
    throw currentPlayerError
  }

  const currentPlayer = normalizePlayerRow(currentPlayerRow)

  if (currentPlayer.section === 'Trial') {
    return currentPlayer
  }

  const { data: movedRow, error: moveError } = await supabase
    .from('players')
    .update({
      section: 'Trial',
      status: 'active',
      promoted_at: null,
      promoted_by: null,
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
    })
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (moveError) {
    console.error(moveError)
    throw moveError
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'player_moved_to_trial',
    entityType: 'player',
    entityId: movedRow.id,
    metadata: {
      playerName: movedRow.player_name,
      fromSection: currentPlayer.section,
      toSection: 'Trial',
      team: movedRow.team,
    },
  })

  return normalizePlayerRow(movedRow)
}

export async function deletePlayerRecord({ user, playerId }) {
  await blockDemoMutation(user)

  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to delete players.')
  }

  const { data, error } = await supabase.from('players').delete().eq('id', playerId).eq('club_id', user.clubId).select('id')

  if (error) {
    console.error(error)
    throw error
  }

  if (!data?.length) {
    throw new Error('No player record was deleted. Check permissions or refresh the player profile.')
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'player_record_deleted',
    entityType: 'player',
    entityId: playerId,
  })
}

export async function deleteArchivedPlayers({ user, playerIds }) {
  await blockDemoMutation(user)

  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to delete archived players.')
  }

  const normalizedPlayerIds = Array.from(
    new Set((Array.isArray(playerIds) ? playerIds : []).map((playerId) => String(playerId ?? '').trim()).filter(Boolean)),
  )

  if (normalizedPlayerIds.length === 0) {
    throw new Error('Select at least one archived player to delete.')
  }

  const { data: archivedPlayers, error: archivedPlayerLookupError } = await supabase
    .from('players')
    .select('id, player_name')
    .eq('club_id', user.clubId)
    .eq('status', 'archived')
    .in('id', normalizedPlayerIds)

  if (archivedPlayerLookupError) {
    console.error(archivedPlayerLookupError)
    throw archivedPlayerLookupError
  }

  if (!archivedPlayers?.length) {
    throw new Error('No archived players were found. Check permissions or refresh archived players.')
  }

  const archivedPlayerNames = Array.from(
    new Set(archivedPlayers.map((player) => String(player.player_name ?? '').trim()).filter(Boolean)),
  )
  const { data: clubSessions, error: clubSessionsError } = await supabase
    .from('assessment_sessions')
    .select('id')
    .eq('club_id', user.clubId)

  if (clubSessionsError) {
    console.error(clubSessionsError)
    throw clubSessionsError
  }

  const clubSessionIds = (clubSessions ?? []).map((session) => session.id).filter(Boolean)
  const { error: evaluationIdDeleteError } = await supabase
    .from('evaluations')
    .delete()
    .eq('club_id', user.clubId)
    .in('player_id', normalizedPlayerIds)

  if (evaluationIdDeleteError) {
    console.error(evaluationIdDeleteError)
    throw evaluationIdDeleteError
  }

  if (archivedPlayerNames.length > 0) {
    const { error: evaluationNameDeleteError } = await supabase
      .from('evaluations')
      .delete()
      .eq('club_id', user.clubId)
      .in('player_name', archivedPlayerNames)

    if (evaluationNameDeleteError) {
      console.error(evaluationNameDeleteError)
      throw evaluationNameDeleteError
    }
  }

  const { error: sessionPlayerIdDeleteError } = await supabase
    .from('assessment_session_players')
    .delete()
    .in('player_id', normalizedPlayerIds)

  if (sessionPlayerIdDeleteError) {
    console.error(sessionPlayerIdDeleteError)
    throw sessionPlayerIdDeleteError
  }

  if (clubSessionIds.length > 0 && archivedPlayerNames.length > 0) {
    const { error: sessionPlayerNameDeleteError } = await supabase
      .from('assessment_session_players')
      .delete()
      .in('session_id', clubSessionIds)
      .in('player_name', archivedPlayerNames)

    if (sessionPlayerNameDeleteError) {
      console.error(sessionPlayerNameDeleteError)
      throw sessionPlayerNameDeleteError
    }
  }

  const { data: deletedPlayers, error: playerDeleteError } = await supabase
    .from('players')
    .delete()
    .eq('club_id', user.clubId)
    .eq('status', 'archived')
    .in('id', normalizedPlayerIds)
    .select('id, player_name')

  if (playerDeleteError) {
    console.error(playerDeleteError)
    throw playerDeleteError
  }

  if (!deletedPlayers?.length) {
    throw new Error('No archived players were deleted. Check permissions or refresh archived players.')
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'archived_players_deleted',
    entityType: 'player',
    metadata: {
      playerIds: deletedPlayers.map((player) => player.id),
      playerNames: deletedPlayers.map((player) => player.player_name).filter(Boolean),
    },
  })

  return deletedPlayers
}

export async function deletePlayer(playerName, user, options = {}) {
  await blockDemoMutation(user)

  if (!user?.clubId && user?.role !== 'super_admin') {
    throw new Error('Club ID is required.')
  }

  const playerIds = Array.from(new Set((options.playerIds ?? []).filter(Boolean)))

  if (playerIds.length > 0) {
    let evaluationIdQuery = supabase.from('evaluations').delete().in('player_id', playerIds)

    if (user.role !== 'super_admin') {
      evaluationIdQuery = evaluationIdQuery.eq('club_id', user.clubId)
    }

    const { error: evaluationIdDeleteError } = await evaluationIdQuery

    if (evaluationIdDeleteError) {
      console.error(evaluationIdDeleteError)
      throw evaluationIdDeleteError
    }
  }

  let evaluationQuery = supabase.from('evaluations').delete().eq('player_name', playerName)

  if (user.role !== 'super_admin') {
    evaluationQuery = evaluationQuery.eq('club_id', user.clubId)
  }

  const { error } = await evaluationQuery

  if (error) {
    console.error(error)
    throw error
  }

  if (user.role !== 'super_admin') {
    let playerDeleteQuery = supabase.from('players').delete().eq('club_id', user.clubId)

    if (playerIds.length > 0) {
      playerDeleteQuery = playerDeleteQuery.in('id', playerIds)
    } else {
      playerDeleteQuery = playerDeleteQuery.ilike('player_name', playerName)
    }

    const { data: deletedPlayers, error: playerDeleteError } = await playerDeleteQuery.select('id')

    if (playerDeleteError) {
      console.error(playerDeleteError)
      throw playerDeleteError
    }

    if (!deletedPlayers?.length) {
      throw new Error('No player record was deleted. Check permissions or refresh the player profile.')
    }

    invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
    clearViewCaches()
    await createAuditLog({
      user,
      action: 'player_deleted',
      entityType: 'player',
      metadata: {
        playerName,
      },
    })
  }
}
