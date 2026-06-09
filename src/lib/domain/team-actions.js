import { supabase } from '../supabase-client.js'
import {
  createLimitUpgradeMessage,
  getPlanKey,
  getPlanLimit,
  PLAN_KEYS,
} from '../plans.js'
import { getCachedResource, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { createAuditLog } from './audit.js'
import { blockDemoMutation } from './demo-guards.js'
import {
  getEntryIdentity,
  getEntryUserId,
} from './core-normalizers.js'
import {
  normalizeTeamRow,
  normalizeTeamStaffRow,
} from './team-normalizers.js'
import { assertClubFeature } from './plan-gates.js'

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession()

  if (error) {
    console.error(error)
    throw error
  }

  const accessToken = data?.session?.access_token

  if (!accessToken) {
    throw new Error('Login is required.')
  }

  return accessToken
}

async function manageTeamRequest(payload) {
  const accessToken = await getAccessToken()
  const response = await fetch('/.netlify/functions/manage-team', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result?.success === false) {
    throw new Error(result?.message || 'Team could not be managed.')
  }

  return result
}

export async function getTeams(user) {
  if (!user?.clubId && user?.role !== 'super_admin') {
    return []
  }

  const cacheKey = user.role === 'super_admin' ? 'teams:super-admin' : `teams:${user.clubId}`

  return getCachedResource(cacheKey, async () => {
    let query = supabase.from('teams').select('*').order('name', { ascending: true })

    if (user.role !== 'super_admin') {
      query = query.eq('club_id', user.clubId)
    }

    const { data, error } = await query

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeTeamRow)
  })
}

export async function updateTeamSettings({ teamId, data, user = null }) {
  await blockDemoMutation(user)

  if (!teamId) {
    throw new Error('Team ID is required.')
  }

  const onlyNameUpdate = data && Object.keys(data).length === 1 && data.name !== undefined

  if (onlyNameUpdate && user?.clubId && (user.role === 'admin' || user.role === 'super_admin')) {
    const result = await manageTeamRequest({
      action: 'update',
      clubId: user.clubId,
      teamId,
      name: data.name,
    })

    invalidateMemoryCacheByPrefix(`teams:${user.clubId}`)
    invalidateMemoryCacheByPrefix('available-teams:')
    invalidateMemoryCacheByPrefix('assigned-teams:')
    invalidateMemoryCacheByPrefix('team-assignments:')

    return normalizeTeamRow(result.team)
  }

  const { data: currentTeam, error: currentTeamError } = await supabase
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .single()

  if (currentTeamError) {
    console.error(currentTeamError)
    throw currentTeamError
  }

  const previousTeamName = String(currentTeam.name ?? '').trim()
  const payload = {}
  const hasThemeUpdates =
    data.themeMode !== undefined ||
    data.themeAccent !== undefined ||
    data.themeButtonStyle !== undefined

  if (data.name !== undefined && Number(user?.roleRank ?? 0) < 50) {
    throw new Error('Only Team Admins can change team names.')
  }

  if (hasThemeUpdates && Number(user?.roleRank ?? 0) < 50) {
    throw new Error('Only Team Admins can change team appearance.')
  }

  if (data.name !== undefined) {
    payload.name = String(data.name ?? '').trim()
  }

  if (data.requireApproval !== undefined) {
    if (Boolean(data.requireApproval) !== Boolean(currentTeam.require_approval ?? true)) {
      await assertClubFeature({
        user,
        clubId: currentTeam.club_id,
        featureName: 'approvalWorkflow',
      })
    }

    payload.require_approval = Boolean(data.requireApproval)
  }

  if (data.themeMode !== undefined) {
    payload.theme_mode = ['system', 'dark', 'light'].includes(data.themeMode) ? data.themeMode : 'system'
  }

  if (data.themeAccent !== undefined) {
    payload.theme_accent = ['yellow', 'blue', 'green', 'red', 'purple'].includes(data.themeAccent) ? data.themeAccent : 'yellow'
  }

  if (data.themeButtonStyle !== undefined) {
    payload.theme_button_style = ['solid', 'gradient'].includes(data.themeButtonStyle) ? data.themeButtonStyle : 'solid'
  }

  if (user?.id) {
    payload.updated_by = getEntryUserId(user)
    Object.assign(payload, getEntryIdentity(user, 'updated_by'))
  }

  const { data: updatedTeam, error } = await supabase
    .from('teams')
    .update(payload)
    .eq('id', teamId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('teams:')
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  invalidateMemoryCacheByPrefix('user-profile:')
  invalidateMemoryCacheByPrefix('players:')

  if (payload.name && payload.name !== previousTeamName) {
    const linkedUpdateResults = await Promise.all([
      supabase.from('players').update({ team: payload.name }).eq('team', previousTeamName).eq('club_id', updatedTeam.club_id),
      supabase.from('evaluations').update({ team: payload.name }).eq('team', previousTeamName).eq('club_id', updatedTeam.club_id),
      supabase.from('evaluations').update({ team: payload.name }).eq('team_id', teamId).eq('club_id', updatedTeam.club_id),
    ])
    const firstLinkedUpdateError = linkedUpdateResults.find((result) => result.error)?.error

    if (firstLinkedUpdateError) {
      console.error(firstLinkedUpdateError)
      throw firstLinkedUpdateError
    }
  }

  return normalizeTeamRow(updatedTeam)
}

export async function getAvailableTeamsForUser(user) {
  if (!user) {
    return []
  }

  if (user.role === 'super_admin' || user.role === 'admin') {
    return getTeams(user)
  }

  if (!user.clubId) {
    return []
  }

  return getCachedResource(`available-teams:${user.id}:${user.clubId}`, async () => {
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from('team_staff')
      .select('team_id')
      .eq('user_id', user.id)

    if (assignmentError) {
      console.error(assignmentError)
      throw assignmentError
    }

    const teamIds = [...new Set((assignmentRows ?? []).map((row) => String(row.team_id ?? '').trim()).filter(Boolean))]

    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('club_id', user.clubId)
      .order('name', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    const clubTeams = (data ?? []).map(normalizeTeamRow)
    const teams = teamIds.length > 0
      ? clubTeams.filter((team) => teamIds.includes(String(team.id)))
      : clubTeams
    const activeTeamId = String(user.activeTeamId ?? '').trim()

    if (!activeTeamId) {
      return teams
    }

    const activeTeam = teams.find((team) => String(team.id) === activeTeamId)
    return activeTeam ? [activeTeam] : teams
  })
}

export async function getAssignedTeamsForUser(user) {
  if (!user?.id || !user?.clubId || user.role === 'super_admin') {
    return []
  }

  return getCachedResource(`assigned-teams:${user.id}:${user.clubId}`, async () => {
    const [{ data: assignmentRows, error: assignmentError }, { data: clubTeams, error: teamsError }] = await Promise.all([
      supabase.from('team_staff').select('team_id').eq('user_id', user.id),
      supabase.from('teams').select('*').eq('club_id', user.clubId).order('name', { ascending: true }),
    ])

    if (assignmentError || teamsError) {
      const error = assignmentError || teamsError
      console.error(error)
      throw error
    }

    const teams = (clubTeams ?? []).map(normalizeTeamRow)
    const teamIds = [...new Set((assignmentRows ?? []).map((row) => String(row.team_id ?? '').trim()).filter(Boolean))]

    if (teamIds.length === 0) {
      return []
    }

    return teams.filter((team) => teamIds.includes(String(team.id)))
  })
}

export async function getSessionTeamsForUser(user) {
  const activeTeamId = String(user?.activeTeamId ?? '').trim()
  const activeTeamName = String(user?.activeTeamName ?? '').trim()
  const assignedTeams = await getAssignedTeamsForUser(user).catch((error) => {
    console.error(error)
    return []
  })

  if (activeTeamId) {
    const matchedTeam = assignedTeams.find((team) => String(team.id) === activeTeamId)
    return matchedTeam ? [matchedTeam] : [{ id: activeTeamId, name: activeTeamName }]
  }

  if (assignedTeams.length > 0) {
    return assignedTeams
  }

  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  return getTeams(user)
}

export async function createTeam({ user, name }) {
  await blockDemoMutation(user)

  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  const teamName = String(name ?? '').trim()

  if (!teamName) {
    throw new Error('Team name is required.')
  }

  if (user.role === 'admin' || user.role === 'super_admin') {
    const result = await manageTeamRequest({
      action: 'create',
      clubId: user.clubId,
      name: teamName,
    })

    invalidateMemoryCacheByPrefix(`teams:${user.clubId}`)
    invalidateMemoryCacheByPrefix('available-teams:')
    invalidateMemoryCacheByPrefix('assigned-teams:')
    invalidateMemoryCacheByPrefix('team-assignments:')

    return normalizeTeamRow(result.team)
  }

  const teamLimit = getPlanKey(user) === PLAN_KEYS.largeClub ? null : getPlanLimit(user, 'teams')

  if (teamLimit !== null && teamLimit !== undefined) {
    const { count, error: countError } = await supabase
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', user.clubId)

    if (countError) {
      console.error(countError)
      throw countError
    }

    const currentTeamCount = Number(count ?? 0)
    const isFirstRunClubAdminTeam = user?.role === 'admin' && currentTeamCount === 0 && Number(teamLimit) === 0

    if (currentTeamCount >= Number(teamLimit) && !isFirstRunClubAdminTeam) {
      throw new Error(createLimitUpgradeMessage(user, 'teams', 'Teams'))
    }
  }

  const { data, error } = await supabase
    .from('teams')
    .insert({
      club_id: user.clubId,
      name: teamName,
      created_by: getEntryUserId(user),
      ...getEntryIdentity(user),
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
    })
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`teams:${user.clubId}`)
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  invalidateMemoryCacheByPrefix('team-assignments:')

  return normalizeTeamRow(data)
}

export async function deleteTeam(teamId, user = null) {
  await blockDemoMutation(user)

  if (user?.clubId && (user.role === 'admin' || user.role === 'super_admin')) {
    const result = await manageTeamRequest({
      action: 'delete',
      clubId: user.clubId,
      teamId,
    })

    invalidateMemoryCacheByPrefix('teams:')
    invalidateMemoryCacheByPrefix('available-teams:')
    invalidateMemoryCacheByPrefix('assigned-teams:')
    invalidateMemoryCacheByPrefix('team-assignments:')

    return normalizeTeamRow(result.team)
  }

  const { data: teamRow, error: teamError } = await supabase
    .from('teams')
    .select('id, name, club_id')
    .eq('id', teamId)
    .maybeSingle()

  if (teamError) {
    console.error(teamError)
    throw teamError
  }

  const { error } = await supabase.from('teams').delete().eq('id', teamId)

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('teams:')
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('team-assignments:')

  if (user) {
    await createAuditLog({
      user,
      action: 'team_deleted',
      entityType: 'team',
      entityId: teamId,
      metadata: {
        teamName: teamRow?.name || '',
        clubId: teamRow?.club_id || user.clubId || '',
      },
    })
  }
}

export async function getTeamStaffAssignments(user) {
  const teams = await getTeams(user)

  if (teams.length === 0) {
    return []
  }

  const teamIds = teams.map((team) => team.id)
  return getCachedResource(`team-assignments:${user.clubId || user.id}`, async () => {
    const { data, error } = await supabase
      .from('team_staff')
      .select('*')
      .in('team_id', teamIds)

    if (error) {
      console.error(error)
      throw error
    }

    const acceptedAssignments = (data ?? []).map(normalizeTeamStaffRow)

    const { data: pendingInvites, error: pendingInvitesError } = await supabase
      .from('club_user_invites')
      .select('id, team_id, created_at')
      .eq('club_id', user.clubId)
      .is('accepted_at', null)
      .in('team_id', teamIds)

    if (pendingInvitesError) {
      console.error(pendingInvitesError)
      throw pendingInvitesError
    }

    const pendingAssignments = (pendingInvites ?? []).map((invite) => ({
      id: `invite:${invite.id}`,
      teamId: invite.team_id ?? '',
      userId: `invite:${invite.id}`,
      createdAt: invite.created_at ?? '',
    }))

    return [...acceptedAssignments, ...pendingAssignments]
  })
}

export async function replaceTeamStaffAssignments(teamId, userIds) {
  await blockDemoMutation()

  const normalizedUserIds = [...new Set((userIds ?? []).map((userId) => String(userId).trim()).filter(Boolean))]
  const pendingInviteIds = normalizedUserIds
    .filter((userId) => userId.startsWith('invite:'))
    .map((userId) => userId.replace(/^invite:/, '').trim())
    .filter(Boolean)
  const acceptedUserIds = normalizedUserIds.filter((userId) => !userId.startsWith('invite:'))

  const { data: teamRow, error: teamError } = await supabase
    .from('teams')
    .select('id, club_id')
    .eq('id', teamId)
    .single()

  if (teamError) {
    console.error(teamError)
    throw teamError
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token

  if (!sessionError && accessToken && teamRow?.club_id) {
    const result = await manageTeamRequest({
      action: 'replace-staff',
      clubId: teamRow.club_id,
      teamId,
      userIds: acceptedUserIds,
      inviteIds: pendingInviteIds,
    })

    invalidateMemoryCacheByPrefix('available-teams:')
    invalidateMemoryCacheByPrefix('assigned-teams:')
    invalidateMemoryCacheByPrefix('assessment-sessions:')
    invalidateMemoryCacheByPrefix('team-assignments:')
    invalidateMemoryCacheByPrefix('visible-club-users:')

    return (result.assignments ?? []).map(normalizeTeamStaffRow)
  }

  if (acceptedUserIds.length > 0) {
    const { data: userRows, error: usersError } = await supabase
      .from('users')
      .select('id, club_id, role')
      .in('id', acceptedUserIds)

    if (usersError) {
      console.error(usersError)
      throw usersError
    }

    const allowedUserIds = new Set(
      (userRows ?? [])
        .filter((row) => String(row.club_id ?? '') === String(teamRow.club_id ?? '') && !['admin', 'super_admin'].includes(String(row.role ?? '')))
        .map((row) => String(row.id ?? '')),
    )
    const invalidUserIds = acceptedUserIds.filter((userId) => !allowedUserIds.has(String(userId)))

    if (invalidUserIds.length > 0) {
      throw new Error('One or more selected staff members cannot be assigned to a team.')
    }
  }

  const { error: deleteError } = await supabase.from('team_staff').delete().eq('team_id', teamId)

  if (deleteError) {
    console.error(deleteError)
    throw deleteError
  }

  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  invalidateMemoryCacheByPrefix('assessment-sessions:')
  invalidateMemoryCacheByPrefix('team-assignments:')
  invalidateMemoryCacheByPrefix('visible-club-users:')

  const { error: clearPendingInvitesError } = await supabase
    .from('club_user_invites')
    .update({ team_id: null })
    .eq('club_id', teamRow.club_id)
    .eq('team_id', teamId)
    .is('accepted_at', null)

  if (clearPendingInvitesError) {
    console.error(clearPendingInvitesError)
    throw clearPendingInvitesError
  }

  if (pendingInviteIds.length > 0) {
    const { error: pendingInviteError } = await supabase
      .from('club_user_invites')
      .update({ team_id: teamId })
      .eq('club_id', teamRow.club_id)
      .is('accepted_at', null)
      .in('id', pendingInviteIds)

    if (pendingInviteError) {
      console.error(pendingInviteError)
      throw pendingInviteError
    }
  }

  if (acceptedUserIds.length === 0) {
    return pendingInviteIds.map((inviteId) => ({
      id: `invite:${inviteId}`,
      teamId,
      userId: `invite:${inviteId}`,
      createdAt: '',
    }))
  }

  const { data, error } = await supabase
    .from('team_staff')
    .insert(acceptedUserIds.map((userId) => ({ team_id: teamId, user_id: userId })))
    .select('*')

  if (error) {
    console.error(error)
    throw error
  }

  return [
    ...(data ?? []).map(normalizeTeamStaffRow),
    ...pendingInviteIds.map((inviteId) => ({
      id: `invite:${inviteId}`,
      teamId,
      userId: `invite:${inviteId}`,
      createdAt: '',
    })),
  ]
}
