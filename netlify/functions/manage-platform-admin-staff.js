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

function cleanText(value, maxLength = 120) {
  return String(value ?? '').replace(/[<>\r\n]/g, '').trim().slice(0, maxLength)
}

async function getAuthenticatedSuperAdmin(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw new Error('Login is required.')
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw new Error('Login is required.')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, email, name, role')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (profile?.role !== 'super_admin') {
    throw new Error('Only platform admins can manage platform admin staff.')
  }

  return profile
}

async function findAuthUserByEmail(email) {
  let page = 1
  const perPage = 1000

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })

    if (error) {
      throw error
    }

    const match = data.users.find((authUser) => normalizeEmail(authUser.email) === email)

    if (match) {
      return match
    }

    if (data.users.length < perPage) {
      return null
    }

    page += 1
  }

  return null
}

async function createOrPromotePlatformAdmin(event, adminUser) {
  const body = JSON.parse(event.body || '{}')
  const email = normalizeEmail(body.email)
  const name = cleanText(body.name || body.email)
  const password = String(body.password ?? '')

  if (!email) {
    throw new Error('Enter an email address.')
  }

  if (password.length < 8) {
    throw new Error('Enter a temporary password with at least 8 characters.')
  }

  let authUser = await findAuthUserByEmail(email)
  let action = 'platform_admin_created'

  if (authUser?.id) {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        name,
      },
    })

    if (error) {
      throw error
    }

    authUser = data.user
    action = 'platform_admin_promoted'
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
      },
    })

    if (error) {
      throw error
    }

    authUser = data.user
  }

  if (!authUser?.id) {
    throw new Error('Platform admin auth account could not be created.')
  }

  const { data: savedProfile, error: profileError } = await supabaseAdmin
    .from('users')
    .upsert(
      {
        id: authUser.id,
        email,
        name,
        display_name: name,
        role: 'super_admin',
        role_label: 'Super Admin',
        role_rank: 100,
        club_id: null,
        status: 'active',
        suspended_at: null,
      },
      { onConflict: 'id' },
    )
    .select('id, email, name, role, role_label, role_rank, status, created_at')
    .single()

  if (profileError) {
    throw profileError
  }

  await supabaseAdmin.from('platform_admins').upsert(
    {
      id: authUser.id,
      email,
      name,
      status: 'active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )

  await supabaseAdmin.from('audit_logs').insert({
    actor_id: adminUser.id,
    actor_email: adminUser.email,
    actor_role: adminUser.role,
    actor_role_rank: 100,
    action,
    entity_type: 'user',
    entity_id: savedProfile.id,
    metadata: {
      email,
      name,
      role: 'super_admin',
    },
  })

  return {
    id: savedProfile.id,
    email: savedProfile.email,
    name: savedProfile.name,
    role: savedProfile.role,
    roleLabel: savedProfile.role_label,
    roleRank: savedProfile.role_rank,
    status: savedProfile.status,
    createdAt: savedProfile.created_at,
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  try {
    const adminUser = await getAuthenticatedSuperAdmin(event)
    const platformAdmin = await createOrPromotePlatformAdmin(event, adminUser)

    return json(200, { success: true, platformAdmin })
  } catch (error) {
    console.error(error)
    return json(error.message === 'Login is required.' ? 401 : 400, {
      success: false,
      message: error.message || 'Platform admin staff could not be saved.',
    })
  }
}
