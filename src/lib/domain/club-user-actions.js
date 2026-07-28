import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { USER_PROFILE_SELECT } from './core-constants.js'
import { createAuditLog } from './audit.js'
import { blockDemoMutation } from './demo-guards.js'
import {
  getEntryIdentity,
  getEntryUserId,
  normalizeRoleKey,
  normalizeRoleLabel,
  normalizeRoleRank,
  normalizeWords,
} from './core-normalizers.js'
import { normalizeClubInviteRow } from './role-normalizers.js'
import { normalizeUserProfile } from './profile-normalizers.js'
import { assertClubFeature, assertStaffLoginLimitForEmail } from './plan-gates.js'
import { getTeams } from './team-actions.js'
import { buildStaffInviteUrl, sendStaffInvite } from '../email-builder.js'
import { CAPABILITIES } from '../paywall-access.js'
import { assertPasswordPolicy } from '../password-policy.js'

function createUuid() {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function savePendingClubUserInvite(payload) {
  const { data: existingInvite, error: existingInviteError } = await supabase
    .from('club_user_invites')
    .select('id')
    .eq('club_id', payload.club_id)
    .eq('email', payload.email)
    .eq('status', 'pending')
    .is('accepted_at', null)
    .is('cancelled_at', null)
    .is('replaced_at', null)
    .maybeSingle()

  if (existingInviteError) {
    throw existingInviteError
  }

  const writeQuery = existingInvite?.id
    ? supabase.from('club_user_invites').update(payload).eq('id', existingInvite.id)
    : supabase.from('club_user_invites').insert(payload)
  const { data, error } = await writeQuery.select('*').single()

  if (error) {
    throw error
  }

  return data
}

export async function assignClubUserRole({ user, email, role }) {
  await blockDemoMutation(user)

  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase()
  const roleKey = normalizeRoleKey(role.roleKey ?? role.key)
  const roleLabel = normalizeRoleLabel(role.roleLabel ?? role.label, roleKey)
  const roleRank = normalizeRoleRank(role.roleRank ?? role.rank, roleKey)
  await assertClubFeature({
    user,
    clubId: user.clubId,
    featureName: CAPABILITIES.clubStaffRoles,
  })

  await assertStaffLoginLimitForEmail({
    user,
    email: normalizedEmail,
  })

  const { data: existingUsers, error: existingUsersError } = await supabase
    .from('users')
    .select(USER_PROFILE_SELECT)
    .eq('club_id', user.clubId)
    .eq('email', normalizedEmail)
    .limit(1)

  if (existingUsersError) {
    console.error(existingUsersError)
    throw existingUsersError
  }

  const existingUser = existingUsers?.[0]

  if (existingUser) {
    const { data: updatedUserRow, error: updateError } = await supabase.rpc('set_club_user_role', {
      target_user_id: existingUser.id,
      target_role_key: roleKey,
      target_team_id: null,
    })

    if (updateError) {
      console.error(updateError)
      throw updateError
    }

    invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
    invalidateMemoryCacheByPrefix('visible-club-users:')

    return {
      kind: 'user',
      record: normalizeUserProfile(updatedUserRow),
    }
  }

  const inviteRow = await savePendingClubUserInvite({
    club_id: user.clubId,
    email: normalizedEmail,
    role_key: roleKey,
    role_label: roleLabel,
    role_rank: roleRank,
    status: 'pending',
    created_by: user.id,
    ...getEntryIdentity(user),
    updated_by: getEntryUserId(user),
    ...getEntryIdentity(user, 'updated_by'),
  })

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
  invalidateMemoryCacheByPrefix('visible-club-users:')

  return {
    kind: 'invite',
    record: normalizeClubInviteRow(inviteRow),
  }
}

export async function changeStaffRoleAssignment({
  user,
  assignmentId,
  roleKey,
  requestSource = 'application',
}) {
  await blockDemoMutation(user)

  const normalizedAssignmentId = String(assignmentId ?? '').trim()
  const normalizedRoleKey = normalizeRoleKey(roleKey)

  if (!normalizedAssignmentId || !normalizedRoleKey) {
    throw new Error('Choose a staff assignment and role before continuing.')
  }

  const { data, error } = await supabase.rpc('change_staff_role_assignment', {
    p_assignment_id: normalizedAssignmentId,
    p_target_role_key: normalizedRoleKey,
    p_request_source: String(requestSource ?? 'application').trim() || 'application',
  })

  if (error) {
    console.error(error)
    throw error
  }

  if (!data?.success) {
    const roleError = new Error(data?.message || 'The staff role could not be changed.')
    roleError.code = data?.category || 'role_change_denied'
    throw roleError
  }

  invalidateMemoryCacheByPrefix('club-users:')
  invalidateMemoryCacheByPrefix('visible-club-users:')
  invalidateMemoryCacheByPrefix('user-access:')
  invalidateMemoryCacheByPrefix('team-assignments:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('platform-stats')
  clearViewCaches()

  return data
}

export async function createStaffUserWithPassword({ user, email, password, role }) {
  await blockDemoMutation(user)

  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase()
  const normalizedPassword = String(password ?? '')

  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  assertPasswordPolicy(normalizedPassword)

  const roleKey = normalizeRoleKey(role.roleKey ?? role.key)
  const roleLabel = normalizeRoleLabel(role.roleLabel ?? role.label, roleKey)
  const roleRank = normalizeRoleRank(role.roleRank ?? role.rank, roleKey)
  await assertClubFeature({
    user,
    clubId: user.clubId,
    featureName: CAPABILITIES.clubStaffRoles,
  })

  await assertStaffLoginLimitForEmail({
    user,
    email: normalizedEmail,
  })

  const { data, error } = await supabase.functions.invoke('create-staff-user', {
    body: {
      email: normalizedEmail,
      password: normalizedPassword,
      roleKey,
      roleLabel,
      roleRank,
      clubId: user.clubId,
    },
  })

  if (error) {
    console.error(error)
    throw error
  }

  if (data?.error) {
    throw new Error(data.error)
  }

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
  invalidateMemoryCacheByPrefix(`user-access:${user.clubId}`)
  invalidateMemoryCacheByPrefix('visible-club-users:')

  return data
}

export async function createStaffInvite({ user, email, role, teamId = '' }) {
  await blockDemoMutation(user)

  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase()

  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  const roleKey = normalizeRoleKey(role.roleKey ?? role.key)
  const roleLabel = normalizeRoleLabel(role.roleLabel ?? role.label, roleKey)
  const roleRank = normalizeRoleRank(role.roleRank ?? role.rank, roleKey)
  const normalizedTeamId = String(teamId ?? '').trim() || null
  await assertClubFeature({
    user: {
      ...user,
      activeTeamId: normalizedTeamId || user.activeTeamId,
      teamId: normalizedTeamId || user.activeTeamId,
    },
    clubId: user.clubId,
    featureName: normalizedTeamId ? CAPABILITIES.teamStaffRoles : CAPABILITIES.clubStaffRoles,
  })

  await assertStaffLoginLimitForEmail({
    user,
    email: normalizedEmail,
  })

  const { data: existingUsers, error: existingUsersError } = await supabase
    .from('users')
    .select(USER_PROFILE_SELECT)
    .eq('club_id', user.clubId)
    .eq('email', normalizedEmail)
    .limit(1)

  if (existingUsersError) {
    console.error(existingUsersError)
    throw existingUsersError
  }

  const existingUser = existingUsers?.[0]

  if (existingUser) {
    const rpcName = normalizedTeamId ? 'assign_team_staff_role' : 'set_club_user_role'
    const rpcPayload = normalizedTeamId
      ? {
          p_target_user_id: existingUser.id,
          p_team_id: normalizedTeamId,
          p_target_role_key: roleKey,
          p_request_source: 'staff_invitation',
        }
      : {
          target_user_id: existingUser.id,
          target_role_key: roleKey,
          target_team_id: null,
        }
    const { data: updatedUserRow, error: updateError } = await supabase.rpc(rpcName, rpcPayload)

    if (updateError) {
      console.error(updateError)
      throw updateError
    }

    if (normalizedTeamId && !updatedUserRow?.success) {
      const assignmentError = new Error(updatedUserRow?.message || 'The team staff role could not be assigned.')
      assignmentError.code = updatedUserRow?.category || 'team_role_assignment_denied'
      throw assignmentError
    }

    invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
    invalidateMemoryCacheByPrefix(`user-access:${user.clubId}`)
    invalidateMemoryCacheByPrefix('visible-club-users:')
    invalidateMemoryCacheByPrefix('team-assignments:')

    return {
      kind: 'user',
      record: normalizedTeamId ? existingUser : normalizeUserProfile(updatedUserRow),
    }
  }

  const inviteToken = createUuid()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const inviteRow = await savePendingClubUserInvite({
    club_id: user.clubId,
    email: normalizedEmail,
    role_key: roleKey,
    role_label: roleLabel,
    role_rank: roleRank,
    team_id: normalizedTeamId,
    invite_token: inviteToken,
    expires_at: expiresAt,
    accepted_at: null,
    invite_sent_at: null,
    status: 'pending',
    created_by: user.id,
    ...getEntryIdentity(user),
    updated_by: getEntryUserId(user),
    ...getEntryIdentity(user, 'updated_by'),
  })

  const invite = normalizeClubInviteRow(inviteRow)
  const teams = normalizedTeamId ? await getTeams(user).catch(() => []) : []
  const selectedTeam = teams.find((team) => String(team.id) === normalizedTeamId)

  await sendStaffInvite({
    clubId: user.clubId,
    clubName: user.clubName,
    displayName: user.displayName || user.username || user.name || user.email,
    inviteId: invite.id,
    inviteToken: invite.inviteToken,
    inviteUrl: buildStaffInviteUrl(invite.inviteToken),
    logoUrl: user.clubLogoUrl,
    roleLabel,
    senderEmail: user.email,
    subject: `${user.clubName || 'Football Player'} staff invite`,
    teamName: selectedTeam?.name || user.activeTeamName || 'your team',
  })

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
  invalidateMemoryCacheByPrefix(`user-access:${user.clubId}`)
  invalidateMemoryCacheByPrefix('visible-club-users:')
  invalidateMemoryCacheByPrefix('team-assignments:')

  return {
    kind: 'invite',
    record: invite,
  }
}

export function canRemoveClubUser(actor, targetUser) {
  if (!actor || !targetUser) {
    return false
  }

  if (String(actor.id) === String(targetUser.id)) {
    return false
  }

  if (actor.role === 'super_admin') {
    return targetUser.role !== 'super_admin'
  }

  return (
    Boolean(actor.clubId) &&
    String(actor.clubId) === String(targetUser.clubId) &&
    Number(actor.roleRank ?? 0) >= 50 &&
    Number(targetUser.roleRank ?? 0) <= Number(actor.roleRank ?? 0)
  )
}

export function canUpdateClubUserName(actor, targetUser) {
  if (!actor || !targetUser) {
    return false
  }

  if (String(actor.id) === String(targetUser.id)) {
    return false
  }

  if (actor.role === 'super_admin') {
    return targetUser.role !== 'super_admin'
  }

  return (
    Boolean(actor.clubId) &&
    String(actor.clubId) === String(targetUser.clubId) &&
    Number(actor.roleRank ?? 0) >= 50 &&
    Number(targetUser.roleRank ?? 0) <= Number(actor.roleRank ?? 0)
  )
}

export async function updateClubUserName({ user, member, name }) {
  await blockDemoMutation(user)

  if (!canUpdateClubUserName(user, member)) {
    throw new Error('You can only update names for users at your role level or below.')
  }

  const targetUserId = String(member.id ?? '').trim()
  const normalizedName = normalizeWords(name)

  if (!targetUserId) {
    throw new Error('User ID is required.')
  }

  if (!normalizedName) {
    throw new Error('Name is required.')
  }

  const { data, error } = await supabase.rpc('update_club_user_name', {
    target_user_id: targetUserId,
    target_name: normalizedName,
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
  invalidateMemoryCacheByPrefix('visible-club-users:')
  clearViewCaches()
  return normalizeUserProfile(data)
}

export async function removeClubUser({ user, member }) {
  await blockDemoMutation(user)

  if (!canRemoveClubUser(user, member)) {
    throw new Error('You can only remove users at your role level or below.')
  }

  const targetUserId = String(member.id ?? '').trim()

  if (!targetUserId) {
    throw new Error('User ID is required.')
  }

  const teams = await getTeams(user)
  const teamIds = teams.map((team) => team.id).filter(Boolean)

  if (teamIds.length > 0) {
    const { error: teamStaffError } = await supabase
      .from('team_staff')
      .delete()
      .eq('user_id', targetUserId)
      .in('team_id', teamIds)

    if (teamStaffError) {
      console.error(teamStaffError)
      throw teamStaffError
    }
  }

  const { error: membershipError } = await supabase
    .from('user_club_memberships')
    .delete()
    .eq('auth_user_id', targetUserId)
    .eq('club_id', user.clubId)

  if (membershipError) {
    console.error(membershipError)
    throw membershipError
  }

  const { error: userError } = await supabase
    .from('users')
    .delete()
    .eq('id', targetUserId)
    .eq('club_id', user.clubId)

  if (userError) {
    console.error(userError)
    throw userError
  }

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
  invalidateMemoryCacheByPrefix(`user-access:${user.clubId}`)
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('team-assignments:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  invalidateMemoryCacheByPrefix('visible-club-users:')
  clearViewCaches()

  await createAuditLog({
    user,
    action: 'club_user_removed',
    entityType: 'user',
    entityId: targetUserId,
    metadata: {
      email: member.email,
      role: member.roleLabel || member.role,
    },
  })
}

export async function deleteClubInvite(inviteId) {
  await blockDemoMutation()

  const { error } = await supabase.from('club_user_invites').delete().eq('id', inviteId)

  if (error) {
    console.error(error)
    throw error
  }
}
