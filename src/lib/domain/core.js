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
  normalizeClubInviteRow,
} from './role-normalizers.js'
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
  seedDefaultClubRolesForClub,
} from './core-seeding.js'
import {
  canEditClubIdentity,
} from '../plans.js'
import {
  assertClubFeature,
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
  getDisplayName,
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

async function upsertClubMembershipFromInvite(authUser, invite) {
  const displayName = getDisplayName(authUser)
  const normalizedEmail = String(authUser?.email ?? invite.email ?? '').trim().toLowerCase()

  const { data, error } = await supabase
    .from('user_club_memberships')
    .upsert(
      {
        auth_user_id: authUser.id,
        email: normalizedEmail,
        username: displayName,
        name: displayName,
        role: invite.roleKey,
        role_label: invite.roleLabel,
        role_rank: invite.roleRank,
        club_id: invite.clubId,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'auth_user_id,club_id',
      },
    )
    .select(MEMBERSHIP_CLUB_SELECT)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeClubMembershipRow(data)
}

async function claimInvitedUserProfiles(authUser) {
  const normalizedEmail = String(authUser?.email ?? '').trim().toLowerCase()

  if (!normalizedEmail) {
    return []
  }

  const { data: inviteRows, error: inviteError } = await supabase
    .from('club_user_invites')
    .select('*')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)

  if (inviteError) {
    console.error(inviteError)
    throw inviteError
  }

  if (!inviteRows?.length) {
    return []
  }

  const memberships = await Promise.all(inviteRows.map((inviteRow) => upsertClubMembershipFromInvite(authUser, normalizeClubInviteRow(inviteRow))))
  const { error: inviteUpdateError } = await supabase
    .from('club_user_invites')
    .update({
      accepted_at: new Date().toISOString(),
    })
    .eq('email', normalizedEmail)
    .is('accepted_at', null)

  if (inviteUpdateError) {
    console.error(inviteUpdateError)
  }

  return memberships
}

async function getUserClubMemberships(authUser) {
  const normalizedEmail = String(authUser?.email ?? '').trim().toLowerCase()

  if (!authUser?.id && !normalizedEmail) {
    return []
  }

  const { data, error } = await supabase
    .from('user_club_memberships')
    .select(MEMBERSHIP_CLUB_SELECT)
    .or(`auth_user_id.eq.${authUser.id},email.eq.${normalizedEmail}`)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeClubMembershipRow)
}

async function syncMembershipFromUserRow(data, authUser) {
  if (!data?.club_id || data.role === 'super_admin') {
    return null
  }

  const { data: membershipRow, error } = await supabase
    .from('user_club_memberships')
    .upsert(
      {
        auth_user_id: authUser.id,
        email: String(data.email ?? authUser.email ?? '').trim().toLowerCase(),
        username: String(data.username ?? '').trim(),
        name: String(data.name ?? '').trim(),
        role: data.role,
        role_label: data.role_label,
        role_rank: data.role_rank,
        club_id: data.club_id,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'auth_user_id,club_id',
      },
    )
    .select(MEMBERSHIP_CLUB_SELECT)
    .single()

  if (error) {
    console.error(error)
    return null
  }

  return normalizeClubMembershipRow(membershipRow)
}

async function applyActiveMembership(authUser, membership) {
  const normalizedEmail = String(authUser?.email ?? membership.email ?? '').trim().toLowerCase()
  const displayName = getDisplayName({
    ...authUser,
    email: normalizedEmail,
    username: membership.username,
    name: membership.name,
  })

  const payload = {
    id: authUser.id,
    email: normalizedEmail,
    username: membership.username || displayName,
    name: membership.name || displayName,
    role: membership.role,
    role_label: membership.roleLabel,
    role_rank: membership.roleRank,
    club_id: membership.clubId,
  }

  const { data, error } = await supabase
    .from('users')
    .upsert(payload, {
      onConflict: 'id',
    })
    .select(USER_PROFILE_SELECT)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`user-profile:${authUser.id}`)
  return data
}

async function resolveIncompleteClubProfile(authUser, selectedClubId = '') {
  const memberships = await getUserClubMemberships(authUser)

  if (memberships.length === 0) {
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

async function ensureSignupClubProfileWithServer({ authUser, clubName, accessCode = '', forceNewClub = false }) {
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
      forceNewClub: Boolean(forceNewClub),
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
  const selectedClubId = String(options.selectedClubId ?? '').trim()
  const cacheKey = `user-profile:${authUser?.id || ''}:${selectedClubId || 'active'}`
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

    if (data?.role === 'super_admin') {
      const memberships = await getUserClubMemberships(authUser)

      return normalizeUserProfile({
        ...data,
        email: data.email || authUser.email,
        clubOptions: memberships,
      })
    }

    if (!isDemoAuthUser && data?.role === 'admin' && data?.club_id) {
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

    if (!isDemoAuthUser && data?.club_id) {
      await claimInvitedUserProfiles(authUser)
    }

    if (!data) {
      if (isDemoAuthUser) {
        throw new Error('Demo profile not found.')
      }

      data = await resolveIncompleteClubProfile(authUser, selectedClubId)
      if (data?.requiresClubSelection) {
        return data
      }
    } else if (!isDemoAuthUser) {
      await syncMembershipFromUserRow(data, authUser)
    }

    if (!isDemoAuthUser && data?.role !== 'super_admin' && !data?.club_id) {
      data = await resolveIncompleteClubProfile(authUser, selectedClubId)
      if (data?.requiresClubSelection) {
        return data
      }
    }

    const authEmail = String(authUser.email ?? '').trim().toLowerCase()
    const profileEmail = String(data.email ?? '').trim().toLowerCase()

    if (!isDemoAuthUser && authEmail && authEmail !== profileEmail) {
      const { data: syncedData, error: syncError } = await supabase
        .from('users')
        .update({
          email: authEmail,
        })
        .eq('id', authUser.id)
        .select(USER_PROFILE_SELECT)
        .single()

      if (syncError) {
        console.error(syncError)
      } else {
        data = syncedData
      }
    }

    const memberships = data.role === 'super_admin' ? [] : await getUserClubMemberships(authUser)
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
    })
  })
}

export async function createClubAndManagerProfile({ authUser, clubName, accessCode = '', forceNewClub = false }) {
  await blockDemoMutation(authUser)

  try {
    return await ensureSignupClubProfileWithServer({ authUser, clubName, accessCode, forceNewClub })
  } catch (serverError) {
    console.error(serverError)
    if (forceNewClub) {
      throw serverError
    }

    if (String(accessCode ?? '').trim()) {
      throw serverError
    }
  }

  const { data: club, error: clubError } = await supabase
    .from('clubs')
    .insert({
      name: String(clubName ?? '').trim(),
      plan_key: 'individual',
      plan_status: 'active',
    })
    .select(CLUB_SELECT)
    .single()

  if (clubError) {
    console.error(clubError)
    throw clubError
  }

  await seedDefaultClubRolesForClub(club.id)

  const { data: userProfile, error: userError } = await supabase
    .from('users')
    .upsert(
      {
        id: authUser.id,
        email: authUser.email,
        username: getDisplayName(authUser),
        name: getDisplayName(authUser),
        display_name: getDisplayName(authUser),
        club_name: String(clubName ?? '').trim(),
        reply_to_email: String(authUser.email ?? '').trim().toLowerCase(),
        role: 'head_manager',
        role_label: 'Team Admin',
        role_rank: 70,
        club_id: club.id,
      },
      {
        onConflict: 'id',
      },
    )
    .select(USER_PROFILE_SELECT)
    .single()

  if (userError) {
    console.error(userError)
    throw userError
  }

  await syncMembershipFromUserRow(userProfile, authUser)

  return normalizeUserProfile({
    ...userProfile,
    clubs: club,
  })
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
  const safeClubName = canEditClubIdentity(currentUser)
    ? normalizedClubName
    : String(currentUser.emailClubName || currentUser.clubName || '').trim()

  const { data, error } = await supabase
    .from('users')
    .update({
      username: normalizedUsername,
      name: normalizedUsername,
      display_name: normalizedDisplayName,
      team_name: normalizedTeamName,
      club_name: safeClubName,
      reply_to_email: normalizedReplyToEmail,
    })
    .eq('id', authUser.id)
    .select(USER_PROFILE_SELECT)
    .single()

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

export async function updateOwnThemeSettings({ authUser, mode, accent }) {
  if (!authUser?.id) {
    throw new Error('Signed in user is required.')
  }

  await blockDemoMutation(authUser)

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select(USER_PROFILE_SELECT)
    .eq('id', authUser.id)
    .single()

  if (profileError) {
    console.error(profileError)
    throw profileError
  }

  await assertClubFeature({
    user: normalizeUserProfile(profile),
    clubId: profile.club_id,
    featureName: 'themes',
  })

  const normalizedMode = ['system', 'dark', 'light'].includes(mode) ? mode : 'system'
  const normalizedAccent = ['yellow', 'blue', 'green', 'red', 'purple'].includes(accent) ? accent : 'yellow'

  const { data, error } = await supabase
    .from('users')
    .update({
      theme_mode: normalizedMode,
      theme_accent: normalizedAccent,
    })
    .eq('id', authUser.id)
    .select(USER_PROFILE_SELECT)
    .single()

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
    const { error: profileError } = await supabase
      .from('users')
      .update({
        email: normalizedEmail,
      })
      .eq('id', authUser.id)

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

  if (user.activeTeamName) {
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

export async function getPlayers({ user, section, playerName, status, includeArchived = false } = {}) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const cacheKey = `players:${user.clubId}:${section || 'all'}:${playerName || 'all'}:${status || 'current'}:${includeArchived ? 'with-archived' : 'without-archived'}:${user.activeTeamId || user.activeTeamName || 'all'}`

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

    if (user.activeTeamName) {
      query = query.eq('team', user.activeTeamName)
    }

    if (playerName) {
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
  })

  const payload = {
    ...mapPlayerToRow(player, user),
    status: player.status || 'active',
    archived_at: null,
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
  })
  const query = existingPlayer?.id
    ? supabase.from('players').update(payload).eq('id', existingPlayer.id)
    : supabase.from('players').insert(payload)
  let { data, error } = await query.select('*').single()

  if (!existingPlayer?.id && error?.code === '23505') {
    const fallback = await supabase
      .from('players')
      .upsert(payload, {
        onConflict: 'club_id,section,player_name',
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

  const { data, error } = await supabase
    .from('players')
    .update({
      status: 'archived',
      archived_reason: normalizedReason,
      archived_at: new Date().toISOString(),
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
    })
  }

  const { data, error } = await supabase
    .from('players')
    .update({
      status: restoredStatus,
      archived_reason: null,
      archived_at: null,
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

  const { error } = await supabase.from('communication_logs').insert({
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
  })

  if (error) {
    console.error(error)
  }
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

export async function createPlayerStaffNote({ user, playerId, sessionId = '', note, audioBlob = null, audioDurationSeconds = null }) {
  await blockDemoMutation(user)

  const normalizedNote = String(note ?? '').trim()
  const hasAudio = Boolean(audioBlob)

  if (!user?.clubId || !user?.id || (!playerId && !sessionId) || (!normalizedNote && !hasAudio)) {
    throw new Error('Add a note before saving.')
  }

  const audioUpload = await uploadStaffVoiceNote({
    user,
    playerId,
    sessionId,
    audioBlob,
  })

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
    })
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

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
