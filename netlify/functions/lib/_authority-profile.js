function normalizeText(value) {
  return String(value ?? '').trim()
}

function forbidden(message = 'Your account does not have active access.') {
  return Object.assign(new Error(message), { code: 'forbidden', statusCode: 403 })
}

export async function loadActiveAuthorityProfile(
  supabaseAdmin,
  authUser,
  { clubId = '', select = 'id, email, username, name, display_name, role, role_label, role_rank, club_id, status' } = {},
) {
  const authUserId = normalizeText(authUser?.id)
  const requestedClubId = normalizeText(clubId)

  if (!authUserId) {
    throw forbidden('Login is required.')
  }

  let profileQuery = supabaseAdmin
    .from('users')
    .select(select)
    .eq('id', authUserId)

  if (requestedClubId) {
    profileQuery = profileQuery.eq('club_id', requestedClubId)
  }

  const { data: profile, error: profileError } = await profileQuery.maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (!profile?.id || normalizeText(profile.status) !== 'active') {
    throw forbidden()
  }

  if (normalizeText(profile.role) === 'super_admin') {
    const { data: platformAdmin, error: platformAdminError } = await supabaseAdmin
      .from('platform_admins')
      .select('id')
      .eq('id', authUserId)
      .eq('status', 'active')
      .maybeSingle()

    if (platformAdminError) {
      throw platformAdminError
    }

    if (!platformAdmin?.id) {
      throw forbidden()
    }

    return profile
  }

  const profileClubId = normalizeText(profile.club_id)

  if (!profileClubId) {
    throw forbidden()
  }

  const [{ data: membership, error: membershipError }, { data: club, error: clubError }] = await Promise.all([
    supabaseAdmin
      .from('user_club_memberships')
      .select('auth_user_id')
      .eq('auth_user_id', authUserId)
      .eq('club_id', profileClubId)
      .eq('role', normalizeText(profile.role))
      .eq('role_rank', Number(profile.role_rank ?? 0))
      .maybeSingle(),
    supabaseAdmin
      .from('clubs')
      .select('id, status')
      .eq('id', profileClubId)
      .maybeSingle(),
  ])

  if (membershipError || clubError) {
    throw membershipError || clubError
  }

  if (!membership?.auth_user_id || !club?.id || normalizeText(club.status || 'active') !== 'active') {
    throw forbidden()
  }

  return profile
}
