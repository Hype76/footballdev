import { supabase } from '../supabase-client.js'
import { clearViewCaches, getCachedResource, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { CLUB_SELECT, USER_PROFILE_SELECT } from './core-constants.js'
import { createAuditLog } from './audit.js'
import { blockDemoMutation } from './demo-guards.js'
import { normalizePlatformClubRow } from './platform-normalizers.js'
import { normalizeUserProfile } from './profile-normalizers.js'

export async function createPlatformClub({
  user,
  name,
  contactEmail = '',
  contactPhone = '',
  ownerEmail = '',
  planKey = 'small_club',
  billingMode = 'paid',
  accessToken = '',
}) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can create clubs.')
  }

  const normalizedName = String(name ?? '').trim()

  if (!normalizedName) {
    throw new Error('Club name is required.')
  }

  const response = await fetch('/.netlify/functions/platform-create-club', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken || ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: normalizedName,
      contactEmail,
      contactPhone,
      ownerEmail,
      planKey,
      billingMode,
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Club could not be created and invited.')
  }

  invalidateMemoryCacheByPrefix('platform-stats')

  return {
    ...normalizePlatformClubRow(result.club),
    ownerInvite: result.invite || null,
  }
}

export async function updatePlatformClubStatus({ user, clubId, status }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can update club status.')
  }

  const nextStatus = status === 'suspended' ? 'suspended' : 'active'
  const { data, error } = await supabase
    .from('clubs')
    .update({
      status: nextStatus,
      suspended_at: nextStatus === 'suspended' ? new Date().toISOString() : null,
    })
    .eq('id', clubId)
    .select(`${CLUB_SELECT}, created_at`)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-stats')
  invalidateMemoryCacheByPrefix(`club:${clubId}`)
  await createAuditLog({
    user,
    action: nextStatus === 'suspended' ? 'club_suspended' : 'club_reactivated',
    entityType: 'club',
    entityId: clubId,
    metadata: {
      clubName: data.name,
      status: nextStatus,
    },
  })

  return normalizePlatformClubRow(data)
}

export async function updatePlatformClubPlan({ user, clubId, planKey, planStatus = 'active', isPlanComped = false }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can update club plans.')
  }

  const normalizedPlanKey = ['individual', 'single_team', 'small_club', 'large_club'].includes(planKey)
    ? planKey
    : 'small_club'
  const normalizedPlanStatus = ['active', 'trialing', 'past_due', 'cancelled'].includes(planStatus)
    ? planStatus
    : 'active'

  const { data, error } = await supabase
    .from('clubs')
    .update({
      plan_key: normalizedPlanKey,
      plan_status: normalizedPlanStatus,
      is_plan_comped: Boolean(isPlanComped),
      plan_updated_at: new Date().toISOString(),
    })
    .eq('id', clubId)
    .select(`${CLUB_SELECT}, created_at`)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-stats')
  invalidateMemoryCacheByPrefix(`club:${clubId}`)
  invalidateMemoryCacheByPrefix('user-profile:')
  await createAuditLog({
    user,
    action: 'club_plan_updated',
    entityType: 'club',
    entityId: clubId,
    metadata: {
      clubName: data.name,
      planKey: normalizedPlanKey,
      planStatus: normalizedPlanStatus,
      isPlanComped: Boolean(isPlanComped),
    },
  })

  return normalizePlatformClubRow(data)
}

export async function deletePlatformClub({ user, clubId }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can delete clubs.')
  }

  const { data: clubRow, error: clubError } = await supabase
    .from('clubs')
    .select('id, name')
    .eq('id', clubId)
    .single()

  if (clubError) {
    console.error(clubError)
    throw clubError
  }

  const { data: deleteClubData, error: deleteClubError } = await supabase.rpc('delete_platform_club_cascade', {
    target_club_id: clubId,
  })

  if (deleteClubError) {
    console.error(deleteClubError)
    throw deleteClubError
  }

  const deleteResult = Array.isArray(deleteClubData) ? deleteClubData[0] : deleteClubData

  if (deleteResult && deleteResult.deleted !== true) {
    throw new Error('Club workspace could not be deleted.')
  }

  const { data: remainingClub, error: remainingClubError } = await supabase
    .from('clubs')
    .select('id')
    .eq('id', clubId)
    .maybeSingle()

  if (remainingClubError) {
    console.error(remainingClubError)
    throw remainingClubError
  }

  if (remainingClub?.id) {
    throw new Error('Club workspace could not be deleted.')
  }

  invalidateMemoryCacheByPrefix('platform-stats')
  invalidateMemoryCacheByPrefix(`club:${clubId}`)
  invalidateMemoryCacheByPrefix('user-profile:')
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('team-assignments:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  invalidateMemoryCacheByPrefix('club-users:')
  invalidateMemoryCacheByPrefix('user-access:')
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'club_deleted',
    entityType: 'club',
    entityId: clubId,
    metadata: {
      clubName: clubRow.name,
    },
  })
}

export async function updatePlatformUserStatus({ user, targetUserId, status }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can update user status.')
  }

  const normalizedTargetUserId = String(targetUserId ?? '').trim()

  if (!normalizedTargetUserId) {
    throw new Error('User ID is required.')
  }

  if (String(user.id) === normalizedTargetUserId) {
    throw new Error('You cannot suspend your own platform admin account.')
  }

  const nextStatus = status === 'suspended' ? 'suspended' : 'active'
  const { data, error } = await supabase
    .from('users')
    .update({
      status: nextStatus,
      suspended_at: nextStatus === 'suspended' ? new Date().toISOString() : null,
    })
    .eq('id', normalizedTargetUserId)
    .neq('role', 'super_admin')
    .select(USER_PROFILE_SELECT)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-stats')
  invalidateMemoryCacheByPrefix(`club-users:${data.club_id}`)
  invalidateMemoryCacheByPrefix('visible-club-users:')
  clearViewCaches()

  await createAuditLog({
    user,
    action: nextStatus === 'suspended' ? 'user_suspended' : 'user_reactivated',
    entityType: 'user',
    entityId: normalizedTargetUserId,
    metadata: {
      email: data.email,
      status: nextStatus,
      clubId: data.club_id,
    },
  })

  return normalizeUserProfile(data)
}

export async function deletePlatformUser({ user, targetUserId }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can delete users.')
  }

  const normalizedTargetUserId = String(targetUserId ?? '').trim()

  if (!normalizedTargetUserId) {
    throw new Error('User ID is required.')
  }

  if (String(user.id) === normalizedTargetUserId) {
    throw new Error('You cannot delete your own platform admin account.')
  }

  const { data: targetUser, error: targetUserError } = await supabase
    .from('users')
    .select('id, email, username, name, role, role_label, role_rank, club_id')
    .eq('id', normalizedTargetUserId)
    .neq('role', 'super_admin')
    .single()

  if (targetUserError) {
    console.error(targetUserError)
    throw targetUserError
  }

  const deleteResults = await Promise.all([
    supabase.from('team_staff').delete().eq('user_id', normalizedTargetUserId),
    supabase.from('user_club_memberships').delete().eq('auth_user_id', normalizedTargetUserId),
  ])
  const firstDeleteError = deleteResults.find((result) => result.error)?.error

  if (firstDeleteError) {
    console.error(firstDeleteError)
    throw firstDeleteError
  }

  const { error: userError } = await supabase
    .from('users')
    .delete()
    .eq('id', normalizedTargetUserId)
    .neq('role', 'super_admin')

  if (userError) {
    console.error(userError)
    throw userError
  }

  invalidateMemoryCacheByPrefix('platform-stats')
  invalidateMemoryCacheByPrefix(`club-users:${targetUser.club_id}`)
  invalidateMemoryCacheByPrefix(`user-access:${targetUser.club_id}`)
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('team-assignments:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  invalidateMemoryCacheByPrefix('visible-club-users:')
  clearViewCaches()

  await createAuditLog({
    user,
    action: 'platform_user_deleted',
    entityType: 'user',
    entityId: normalizedTargetUserId,
    metadata: {
      email: targetUser.email,
      name: targetUser.name || targetUser.username,
      role: targetUser.role_label || targetUser.role,
      clubId: targetUser.club_id,
    },
  })
}

export async function deletePlatformTeam({ user, teamId, clubId, password = '', accessToken = '' }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can delete teams.')
  }

  const normalizedTeamId = String(teamId ?? '').trim()
  const normalizedClubId = String(clubId ?? '').trim()

  if (!normalizedTeamId) {
    throw new Error('Team ID is required.')
  }

  if (!normalizedClubId) {
    throw new Error('Club ID is required.')
  }

  const response = await fetch('/.netlify/functions/platform-delete-team', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken || ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      teamId: normalizedTeamId,
      clubId: normalizedClubId,
      password: String(password ?? ''),
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    const error = new Error(result.message || 'Team could not be deleted.')
    error.code = result.code || 'server_error'
    error.statusCode = response.status
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-stats')
  invalidateMemoryCacheByPrefix(`teams:${result.team?.clubId || normalizedClubId}`)
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('team-assignments:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  clearViewCaches()

  return result.team || null
}

export async function getPlatformStats(user) {
  if (user?.role !== 'super_admin') {
    return {
      totals: {
        clubs: 0,
        users: 0,
        teams: 0,
        players: 0,
        evaluations: 0,
        communications: 0,
      },
      clubs: [],
    }
  }

  return getCachedResource('platform-stats', async () => {
    const [clubsResult, usersResult, teamsResult, playersResult, evaluationsResult, communicationLogsResult, auditLogsResult] = await Promise.all([
      supabase
        .from('clubs')
        .select(`${CLUB_SELECT}, created_at`)
        .order('name', { ascending: true }),
      supabase.from('users').select('id, email, username, name, role, role_label, role_rank, club_id, status, suspended_at').order('email', { ascending: true }),
      supabase.from('teams').select('id, name, club_id').order('name', { ascending: true }),
      supabase.from('players').select('id, club_id, section, status, created_at'),
      supabase.from('evaluations').select('id, club_id, section, status, created_at'),
      supabase.from('communication_logs').select('id, club_id, channel, action, created_at'),
      supabase.from('audit_logs').select('id, club_id, action, created_at'),
    ])

    const results = [clubsResult, usersResult, teamsResult, playersResult, evaluationsResult, communicationLogsResult, auditLogsResult]
    const firstError = results.find((result) => result.error)?.error

    if (firstError) {
      console.error(firstError)
      throw firstError
    }

    const clubs = clubsResult.data ?? []
    const users = usersResult.data ?? []
    const teams = teamsResult.data ?? []
    const players = playersResult.data ?? []
    const evaluations = evaluationsResult.data ?? []
    const communicationLogs = communicationLogsResult.data ?? []
    const auditLogs = auditLogsResult.data ?? []
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const isRecent = (row) => {
      const timestamp = new Date(row.created_at).getTime()
      return !Number.isNaN(timestamp) && timestamp >= sevenDaysAgo
    }
    const isArchivedPlayer = (player) => String(player.status ?? '').toLowerCase() === 'archived'
    const isSharedExport = (log) => {
      const channel = String(log.channel ?? '').toLowerCase()
      const action = String(log.action ?? '').toLowerCase()

      return (
        ['email', 'pdf'].includes(channel) ||
        action.includes('email') ||
        action.includes('pdf') ||
        action.includes('share') ||
        action.includes('export')
      )
    }
    const activePlayers = players.filter((player) => !isArchivedPlayer(player))
    const archivedPlayers = players.filter(isArchivedPlayer)
    const sharedExports = communicationLogs.filter(isSharedExport)
    const platformAdmins = users.filter((member) => member.role === 'super_admin')
    const clubUsers = users.filter((member) => member.club_id)

    return {
      totals: {
        clubs: clubs.length,
        users: users.length,
        clubUsers: clubUsers.length,
        platformAdmins: platformAdmins.length,
        teams: teams.length,
        players: activePlayers.length,
        playerRecords: players.length,
        archivedPlayers: archivedPlayers.length,
        evaluations: evaluations.length,
        communications: sharedExports.length,
        communicationRows: communicationLogs.length,
        auditEvents: auditLogs.length,
        recentEvaluations: evaluations.filter(isRecent).length,
        recentCommunications: sharedExports.filter(isRecent).length,
      },
      platformAdmins: platformAdmins.map((member) => ({
        id: member.id,
        email: String(member.email ?? '').trim(),
        name: String(member.name ?? member.username ?? '').trim(),
        role: String(member.role ?? '').trim(),
        roleLabel: String(member.role_label ?? '').trim() || 'Super Admin',
        roleRank: Number(member.role_rank ?? 100),
        status: String(member.status ?? 'active').trim() || 'active',
        suspendedAt: member.suspended_at ?? '',
      })),
      clubs: clubs.map((club) => {
        const clubUsers = users.filter((member) => member.club_id === club.id)
        const clubTeams = teams.filter((team) => team.club_id === club.id)
        const clubPlayers = players.filter((player) => player.club_id === club.id)
        const activeClubPlayers = clubPlayers.filter((player) => !isArchivedPlayer(player))
        const clubEvaluations = evaluations.filter((evaluation) => evaluation.club_id === club.id)
        const clubCommunicationLogs = communicationLogs.filter((log) => log.club_id === club.id)
        const clubSharedExports = clubCommunicationLogs.filter(isSharedExport)
        const clubAuditLogs = auditLogs.filter((log) => log.club_id === club.id)
        const clubActivityTimestamps = [...clubEvaluations, ...clubCommunicationLogs, ...clubAuditLogs]
          .map((row) => new Date(row.created_at).getTime())
          .filter((timestamp) => !Number.isNaN(timestamp))
        const latestActivityAt =
          clubActivityTimestamps.length > 0 ? new Date(Math.max(...clubActivityTimestamps)).toISOString() : ''
        const roleCounts = clubUsers.reduce((map, member) => {
          const roleLabel = String(member.role_label ?? '').trim() || 'User'
          map[roleLabel] = (map[roleLabel] ?? 0) + 1
          return map
        }, {})

        return {
          id: club.id,
          name: String(club.name ?? '').trim() || 'Unnamed club',
          contactEmail: String(club.contact_email ?? '').trim(),
          contactPhone: String(club.contact_phone ?? '').trim(),
          planKey: String(club.plan_key ?? 'small_club').trim() || 'small_club',
          planStatus: String(club.plan_status ?? 'active').trim() || 'active',
          isPlanComped: Boolean(club.is_plan_comped ?? false),
          status: String(club.status ?? 'active').trim() || 'active',
          suspendedAt: club.suspended_at,
          createdAt: club.created_at,
          userCount: clubUsers.length,
          teamCount: clubTeams.length,
          playerCount: activeClubPlayers.length,
          archivedPlayerCount: clubPlayers.filter(isArchivedPlayer).length,
          evaluationCount: clubEvaluations.length,
          communicationCount: clubSharedExports.length,
          communicationRowCount: clubCommunicationLogs.length,
          recentEvaluationCount: clubEvaluations.filter(isRecent).length,
          recentCommunicationCount: clubSharedExports.filter(isRecent).length,
          submittedCount: clubEvaluations.filter((evaluation) => evaluation.status === 'Submitted').length,
          approvedCount: clubEvaluations.filter((evaluation) => evaluation.status === 'Approved').length,
          rejectedCount: clubEvaluations.filter((evaluation) => evaluation.status === 'Rejected').length,
          trialCount: clubEvaluations.filter((evaluation) => evaluation.section === 'Trial').length,
          squadCount: clubEvaluations.filter((evaluation) => evaluation.section === 'Squad').length,
          trialPlayerCount: activeClubPlayers.filter((player) => player.section === 'Trial').length,
          squadPlayerCount: activeClubPlayers.filter((player) => player.section === 'Squad').length,
          promotedPlayerCount: activeClubPlayers.filter((player) => player.status === 'promoted').length,
          latestActivityAt,
          roleCounts: Object.entries(roleCounts)
            .map(([label, count]) => ({ label, count }))
            .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
          users: clubUsers.map((member) => ({
            id: member.id,
            email: String(member.email ?? '').trim(),
            name: String(member.name ?? member.username ?? '').trim(),
            role: String(member.role ?? '').trim(),
            roleLabel: String(member.role_label ?? '').trim() || 'User',
            roleRank: Number(member.role_rank ?? 0),
            status: String(member.status ?? 'active').trim() || 'active',
            suspendedAt: member.suspended_at ?? '',
          })),
          teams: clubTeams.map((team) => ({
            id: team.id,
            name: String(team.name ?? '').trim() || 'Unnamed team',
          })),
        }
      }),
    }
  })
}
