const CLUB_ADMIN_ROLE = {
  role: 'admin',
  roleLabel: 'Club Admin',
  roleRank: 90,
}

const PLAN_RANKS = {
  individual: 0,
  single_team: 1,
  small_club: 2,
  large_club: 3,
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function shouldPromoteBillPayer(previousPlanKey, nextPlanKey) {
  const previousRank = PLAN_RANKS[String(previousPlanKey ?? '').trim()]
  const nextRank = PLAN_RANKS[String(nextPlanKey ?? '').trim()]

  if (previousRank === undefined || nextRank === undefined) {
    return false
  }

  return previousRank <= PLAN_RANKS.single_team && nextRank > previousRank
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
