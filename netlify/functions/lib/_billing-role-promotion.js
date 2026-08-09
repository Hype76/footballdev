import { shouldPromoteWorkspaceOwnerToClubAdmin } from '../../../src/lib/workspace-scope.js'

const CLUB_ADMIN_ROLE = {
  role: 'admin',
  roleLabel: 'Club Admin',
  roleRank: 90,
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function shouldPromoteBillPayer(previousPlanKey, nextPlanKey) {
  return shouldPromoteWorkspaceOwnerToClubAdmin(previousPlanKey, nextPlanKey)
}

export function getClubAdminRole() {
  return { ...CLUB_ADMIN_ROLE }
}

export async function promoteClubBillPayerToAdmin(
  supabaseAdmin,
  {
    clubId,
    customerEmail = '',
    fallbackUserId = '',
    fallbackToHighestRole = false,
  },
) {
  const normalizedClubId = String(clubId ?? '').trim()
  const normalizedEmail = normalizeEmail(customerEmail)
  const normalizedFallbackUserId = String(fallbackUserId ?? '').trim()

  if (!normalizedClubId) {
    return null
  }

  let query = supabaseAdmin
    .from('users')
    .select('id, email, role, role_label, role_rank, club_id')
    .eq('club_id', normalizedClubId)

  if (normalizedEmail) {
    query = query.ilike('email', normalizedEmail)
  } else if (normalizedFallbackUserId) {
    query = query.eq('id', normalizedFallbackUserId)
  } else if (fallbackToHighestRole) {
    query = query.order('role_rank', { ascending: false }).order('created_at', { ascending: true })
  } else {
    return null
  }

  const { data: billPayer, error: billPayerError } = await query.limit(1).maybeSingle()

  if (billPayerError) {
    throw billPayerError
  }

  if (!billPayer?.id) {
    return null
  }

  const { error: workspaceOwnerError } = await supabaseAdmin
    .from('clubs')
    .update({ workspace_owner_user_id: billPayer.id })
    .eq('id', normalizedClubId)

  if (workspaceOwnerError) {
    throw workspaceOwnerError
  }

  if (Number(billPayer.role_rank ?? 0) >= CLUB_ADMIN_ROLE.roleRank && billPayer.role === CLUB_ADMIN_ROLE.role) {
    return {
      userId: billPayer.id,
      email: billPayer.email,
      role: billPayer.role,
      roleLabel: billPayer.role_label,
      roleRank: Number(billPayer.role_rank ?? 0),
      promoted: false,
    }
  }

  const rolePayload = {
    role: CLUB_ADMIN_ROLE.role,
    role_label: CLUB_ADMIN_ROLE.roleLabel,
    role_rank: CLUB_ADMIN_ROLE.roleRank,
  }

  const { data: updatedUser, error: updateUserError } = await supabaseAdmin
    .from('users')
    .update(rolePayload)
    .eq('id', billPayer.id)
    .select('id, email, role, role_label, role_rank')
    .single()

  if (updateUserError) {
    throw updateUserError
  }

  const { error: membershipError } = await supabaseAdmin
    .from('user_club_memberships')
    .update({
      ...rolePayload,
      updated_at: new Date().toISOString(),
    })
    .eq('auth_user_id', billPayer.id)
    .eq('club_id', normalizedClubId)

  if (membershipError) {
    throw membershipError
  }

  return {
    userId: updatedUser.id,
    email: updatedUser.email,
    role: updatedUser.role,
    roleLabel: updatedUser.role_label,
    roleRank: Number(updatedUser.role_rank ?? CLUB_ADMIN_ROLE.roleRank),
    promoted: true,
  }
}
