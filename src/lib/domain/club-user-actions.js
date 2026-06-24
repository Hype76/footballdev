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
    const { data: updatedUserRow, error: updateError } = await supabase
      .from('users')
      .update({
        role: roleKey,
        role_label: roleLabel,
        role_rank: roleRank,
      })
      .eq('id', existingUser.id)
      .select(USER_PROFILE_SELECT)
      .single()

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

  const { data: inviteRow, error: inviteError } = await supabase
    .from('club_user_invites')
    .upsert(
      {
        club_id: user.clubId,
        email: normalizedEmail,
        role_key: roleKey,
        role_label: roleLabel,
        role_rank: roleRank,
        created_by: user.id,
        ...getEntryIdentity(user),
        updated_by: getEntryUserId(user),
        ...getEntryIdentity(user, 'updated_by'),
      },
      {
        onConflict: 'club_id,email',
      },
    )
    .select('*')
    .single()

  if (inviteError) {
    console.error(inviteError)
    throw inviteError
  }

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
  invalidateMemoryCacheByPrefix('visible-club-users:')

  return {
    kind: 'invite',
    record: normalizeClubInviteRow(inviteRow),
  }
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

  if (normalizedPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }

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
    const { data: updatedUserRow, error: updateError } = await supabase
      .from('users')
      .update({
        role: roleKey,
        role_label: roleLabel,
        role_rank: roleRank,
      })
      .eq('id', existingUser.id)
      .select(USER_PROFILE_SELECT)
      .single()

    if (updateError) {
      console.error(updateError)
      throw updateError
    }

    if (normalizedTeamId) {
      const { error: teamStaffError } = await supabase
        .from('team_staff')
        .upsert(
          {
            team_id: normalizedTeamId,
            user_id: existingUser.id,
          },
          {
            onConflict: 'team_id,user_id',
          },
        )

      if (teamStaffError) {
        console.error(teamStaffError)
        throw teamStaffError
      }
    }

    invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
    invalidateMemoryCacheByPrefix(`user-access:${user.clubId}`)
    invalidateMemoryCacheByPrefix('visible-club-users:')
    invalidateMemoryCacheByPrefix('team-assignments:')

    return {
      kind: 'user',
      record: normalizeUserProfile(updatedUserRow),
    }
  }

  const inviteToken = createUuid()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: inviteRow, error: inviteError } = await supabase
    .from('club_user_invites')
    .upsert(
      {
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
        created_by: user.id,
        ...getEntryIdentity(user),
        updated_by: getEntryUserId(user),
        ...getEntryIdentity(user, 'updated_by'),
      },
      {
        onConflict: 'club_id,email',
      },
    )
    .select('*')
    .single()

  if (inviteError) {
    console.error(inviteError)
    throw inviteError
  }

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

  let query = supabase
    .from('users')
    .update({
      username: normalizedName,
      name: normalizedName,
    })
    .eq('id', targetUserId)

  if (user.role !== 'super_admin') {
    query = query.eq('club_id', user.clubId)
  }

  const { data, error } = await query
    .select(USER_PROFILE_SELECT)
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
  invalidateMemoryCacheByPrefix('visible-club-users:')
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'user_name_updated',
    entityType: 'user',
    entityId: data.id,
    metadata: {
      email: data.email,
      username: data.username,
      name: data.name,
    },
  })

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
