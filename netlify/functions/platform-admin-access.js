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
