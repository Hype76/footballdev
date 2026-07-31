import { supabase } from './supabase-client.js'
import { canSwitchParentToStaff } from './staff-workspace-access.js'

const STAFF_PROFILE_SELECT = 'id, status, suspended_at'
const STAFF_MEMBERSHIP_SELECT = 'club_id, role, role_rank, clubs:club_id (status, suspended_at)'

function normalizeMembership(row) {
  const club = Array.isArray(row?.clubs) ? row.clubs[0] : row?.clubs

  return {
    clubId: row?.club_id,
    clubStatus: club?.status,
    clubSuspendedAt: club?.suspended_at,
    role: row?.role,
    roleRank: row?.role_rank,
  }
}

export async function resolveOwnParentStaffReturnMode(authUser) {
  const authUserId = String(authUser?.id ?? '').trim()

  if (!authUserId) {
    return ''
  }

  const [profileResult, membershipResult] = await Promise.all([
    supabase
      .from('users')
      .select(STAFF_PROFILE_SELECT)
      .eq('id', authUserId)
      .maybeSingle(),
    supabase
      .from('user_club_memberships')
      .select(STAFF_MEMBERSHIP_SELECT)
      .eq('auth_user_id', authUserId)
      .order('created_at', { ascending: true }),
  ])

  if (profileResult.error || membershipResult.error) {
    throw new Error('Staff access could not be verified.')
  }

  const memberships = (membershipResult.data ?? []).map(normalizeMembership)

  return canSwitchParentToStaff({
    profile: profileResult.data,
    memberships,
  }) ? 'team' : ''
}
