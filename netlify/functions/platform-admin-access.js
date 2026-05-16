import { supabaseAdmin } from './_supabase.js'
import { json } from './_stripe-billing.js'

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function getDisplayName(authUser, profile = null) {
  return String(
    profile?.name ??
      profile?.display_name ??
      profile?.username ??
      authUser?.user_metadata?.name ??
      authUser?.email ??
      'Platform Admin',
  ).trim()
}

function normalizeClubMembershipRow(row) {
  const club = Array.isArray(row?.clubs) ? row.clubs[0] : row?.clubs

  return {
    id: row?.id,
    authUserId: row?.auth_user_id ?? '',
    email: normalizeEmail(row?.email),
    username: String(row?.username ?? '').trim(),
    name: String(row?.name ?? '').trim(),
    role: String(row?.role ?? '').trim(),
    roleLabel: String(row?.role_label ?? '').trim(),
    roleRank: Number(row?.role_rank ?? 0),
    clubId: row?.club_id ?? '',
    clubName: String(club?.name ?? '').trim(),
    clubLogoUrl: String(club?.logo_url ?? '').trim(),
    clubContactEmail: String(club?.contact_email ?? '').trim(),
    clubContactPhone: String(club?.contact_phone ?? '').trim(),
    clubStatus: String(club?.status ?? 'active').trim() || 'active',
    clubSuspendedAt: club?.suspended_at ?? '',
    planKey: String(club?.plan_key ?? 'small_club').trim() || 'small_club',
    planStatus: String(club?.plan_status ?? 'active').trim() || 'active',
    isPlanComped: Boolean(club?.is_plan_comped ?? false),
    requireApproval: Boolean(club?.require_approval ?? true),
  }
}

async function getUserClubMemberships(authUser) {
  const email = normalizeEmail(authUser?.email)

  if (!authUser?.id && !email) {
    return []
  }

  const { data, error } = await supabaseAdmin
    .from('user_club_memberships')
    .select('*, clubs:club_id (name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at, plan_key, plan_status, is_plan_comped)')
    .or(`auth_user_id.eq.${authUser.id},email.eq.${email}`)
    .order('created_at', { ascending: true })

  if (error && error.code !== '42P01') {
    throw error
  }

  return (data ?? []).map(normalizeClubMembershipRow)
}

async function getParentPortalLinks(authUser) {
  if (!authUser?.id) {
    return []
  }

  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, player_id, link_type, players:player_id (player_name, section, team), teams:team_id (name), clubs:club_id (name, logo_url)')
    .eq('auth_user_id', authUser.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error && error.code !== '42P01') {
    throw error
  }

  return (data ?? []).map((row) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
    const club = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs

    return {
      id: row.id,
      clubId: row.club_id,
      clubName: String(club?.name ?? '').trim(),
      clubLogoUrl: String(club?.logo_url ?? '').trim(),
      teamId: row.team_id,
      teamName: String(team?.name ?? player?.team ?? '').trim(),
      playerId: row.player_id,
      playerName: String(player?.player_name ?? '').trim(),
      playerSection: String(player?.section ?? '').trim(),
      linkType: String(row.link_type ?? 'parent').trim(),
    }
  })
}

async function getAuthenticatedUser(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw new Error('Login is required.')
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data?.user?.id) {
    throw new Error('Login is required.')
  }

  return data.user
}

async function getPlatformAdmin(authUser) {
  const email = normalizeEmail(authUser.email)

  const [{ data: accessRows, error: accessError }, { data: userProfile, error: profileError }] = await Promise.all([
    supabaseAdmin
      .from('platform_admins')
      .select('id, email, name, status')
      .or(`id.eq.${authUser.id},email.eq.${email}`)
      .limit(1),
    supabaseAdmin
      .from('users')
      .select('id, email, username, name, display_name, role, role_label, role_rank, status, suspended_at')
      .eq('id', authUser.id)
      .maybeSingle(),
  ])

  if (accessError && accessError.code !== '42P01') {
    throw accessError
  }

  if (profileError) {
    throw profileError
  }

  const access = accessRows?.[0] ?? null
  const hasAccess = access?.status === 'active' || userProfile?.role === 'super_admin'

  if (!hasAccess) {
    return null
  }

  if (!access?.id) {
    await supabaseAdmin.from('platform_admins').upsert(
      {
        id: authUser.id,
        email,
        name: getDisplayName(authUser, userProfile),
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
  }

  return {
    id: authUser.id,
    email,
    name: access?.name || getDisplayName(authUser, userProfile),
  }
}

async function switchToPlatformAdmin(authUser, platformAdmin) {
  const name = platformAdmin.name || getDisplayName(authUser)
  const email = platformAdmin.email || normalizeEmail(authUser.email)
  const [clubOptions, parentPortalLinks] = await Promise.all([
    getUserClubMemberships(authUser),
    getParentPortalLinks(authUser),
  ])

  const { data, error } = await supabaseAdmin
    .from('users')
    .upsert(
      {
        id: authUser.id,
        email,
        username: name,
        name,
        display_name: name,
        role: 'super_admin',
        role_label: 'Super Admin',
        role_rank: 100,
        club_id: null,
        club_name: null,
        status: 'active',
        suspended_at: null,
      },
      { onConflict: 'id' },
    )
    .select('id, email, username, name, display_name, role, role_label, role_rank, status, suspended_at')
    .single()

  if (error) {
    throw error
  }

  return {
    id: data.id,
    email: data.email,
    username: data.username,
    name: data.name,
    displayName: data.display_name,
    role: data.role,
    roleLabel: data.role_label,
    roleRank: data.role_rank,
    accountStatus: data.status || 'active',
    suspendedAt: data.suspended_at || '',
    clubId: '',
    clubName: 'Platform',
    clubOptions,
    parentPortalLinks,
  }
}

export async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const authUser = await getAuthenticatedUser(event)
    const platformAdmin = await getPlatformAdmin(authUser)

    if (!platformAdmin) {
      return json(200, { success: true, hasPlatformAdminAccess: false })
    }

    if (event.httpMethod === 'POST') {
      const user = await switchToPlatformAdmin(authUser, platformAdmin)
      return json(200, { success: true, hasPlatformAdminAccess: true, user })
    }

    return json(200, { success: true, hasPlatformAdminAccess: true, platformAdmin })
  } catch (error) {
    console.error(error)
    return json(error.message === 'Login is required.' ? 401 : 400, {
      success: false,
      message: error.message || 'Platform admin access could not be checked.',
    })
  }
}
