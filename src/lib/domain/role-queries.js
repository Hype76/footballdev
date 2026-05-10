import { supabase } from '../supabase-client.js'
import {
  getCachedResource,
} from './cache-store.js'
import {
  USER_PROFILE_SELECT,
} from './core-constants.js'
import {
  normalizeClubInviteRow,
  normalizeClubRoleRow,
} from './role-normalizers.js'
import {
  normalizeUserProfile,
} from './profile-normalizers.js'
import {
  getDefaultClubRoles,
} from './core-defaults.js'
import {
  getEntryIdentity,
  getEntryUserId,
  normalizeRoleKey,
  normalizeWords,
} from './core-normalizers.js'
import {
  seedDefaultClubRolesForClub,
} from './core-seeding.js'
import {
  blockDemoMutation,
  isDemoAccountValue,
} from './demo-guards.js'

export async function getClubRoles(user) {
  if (!user?.clubId) {
    return []
  }

  const loadRoles = async () => {
    const { data, error } = await supabase
      .from('club_roles')
      .select('*')
      .eq('club_id', user.clubId)
      .order('role_rank', { ascending: false })
      .order('role_label', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeClubRoleRow)
  }

  let roles = await loadRoles()

  if (roles.length === 0) {
    if (isDemoAccountValue(user)) {
      return getDefaultClubRoles().map((role) => ({
        id: role.key,
        clubId: user.clubId,
        roleKey: role.key,
        roleLabel: role.label,
        roleRank: role.rank,
        isSystem: true,
      }))
    }

    await seedDefaultClubRolesForClub(user.clubId)
    roles = await loadRoles()
  }

  return roles
}

export async function createClubRole({ user, label, rank = 10 }) {
  await blockDemoMutation(user)

  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  const roleLabel = normalizeWords(label)
  const roleKey = normalizeRoleKey(label)
  const roleRank = Number(rank)

  const { data, error } = await supabase
    .from('club_roles')
    .upsert(
      {
        club_id: user.clubId,
        role_key: roleKey,
        role_label: roleLabel,
        role_rank: Number.isNaN(roleRank) ? 10 : roleRank,
        is_system: false,
        created_by: getEntryUserId(user),
        ...getEntryIdentity(user),
        updated_by: getEntryUserId(user),
        ...getEntryIdentity(user, 'updated_by'),
      },
      {
        onConflict: 'club_id,role_key',
      },
    )
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeClubRoleRow(data)
}

export async function getClubUsers(user) {
  if (!user?.clubId) {
    return []
  }

  return getCachedResource(`club-users:${user.clubId}`, async () => {
    const { data, error } = await supabase
      .from('users')
      .select(USER_PROFILE_SELECT)
      .eq('club_id', user.clubId)
      .order('role_rank', { ascending: false })
      .order('email', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map((profile) => normalizeUserProfile(profile))
  })
}

export async function getVisibleClubUsers(user) {
  if (!user?.clubId) {
    return []
  }

  if (user.role === 'super_admin' || user.role === 'admin') {
    return getClubUsers(user)
  }

  const activeTeamId = String(user.activeTeamId ?? '').trim()
  const teamIds = activeTeamId ? [activeTeamId] : []

  if (teamIds.length === 0) {
    return []
  }

  return getCachedResource(`visible-club-users:${user.clubId}:${user.id}:${activeTeamId || teamIds.join(',')}`, async () => {
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from('team_staff')
      .select('user_id')
      .in('team_id', teamIds)

    if (assignmentError) {
      console.error(assignmentError)
      throw assignmentError
    }

    const userIds = [...new Set((assignmentRows ?? []).map((row) => String(row.user_id ?? '').trim()).filter(Boolean))]

    if (userIds.length === 0) {
      return []
    }

    const { data, error } = await supabase
      .from('users')
      .select(USER_PROFILE_SELECT)
      .eq('club_id', user.clubId)
      .in('id', userIds)
      .order('role_rank', { ascending: false })
      .order('email', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map((profile) => normalizeUserProfile(profile))
  })
}

export async function getClubUserInvites(user) {
  if (!user?.clubId) {
    return []
  }

  const { data, error } = await supabase
    .from('club_user_invites')
    .select('*')
    .eq('club_id', user.clubId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeClubInviteRow)
}
