import { supabaseAdmin } from './_supabase.js'
import { json } from './_stripe-billing.js'

const USER_PROFILE_SELECT = [
  'id',
  'email',
  'username',
  'name',
  'role',
  'role_label',
  'role_rank',
  'club_id',
  'status',
  'suspended_at',
  'force_password_change',
  'theme_mode',
  'theme_accent',
  'display_name',
  'team_name',
  'club_name',
  'reply_to_email',
  'onboarding_enabled',
  'onboarding_completed_steps',
  'onboarding_dismissed_at',
].join(', ')

const CLUB_SELECT = 'id, name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at, plan_key, plan_status, is_plan_comped, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, plan_updated_at'
const MEMBERSHIP_CLUB_SELECT = '*, clubs:club_id (name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at, plan_key, plan_status, is_plan_comped, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, plan_updated_at)'

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function normalizeWords(value) {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function getDisplayName(authUser) {
  const metadataName = String(authUser?.user_metadata?.name ?? authUser?.user_metadata?.full_name ?? '').trim()

  if (metadataName) {
    return metadataName
  }

  const emailPrefix = normalizeEmail(authUser?.email).split('@')[0]?.replace(/[._-]+/g, ' ') || 'Coach User'
  return normalizeWords(emailPrefix)
}

function getSignupClubName(authUser, requestedClubName) {
  const explicitClubName = String(requestedClubName ?? '').trim()

  if (explicitClubName) {
    return explicitClubName
  }

  const metadataClubName = String(
    authUser?.user_metadata?.club_name ??
      authUser?.user_metadata?.clubName ??
      authUser?.raw_user_meta_data?.club_name ??
      authUser?.raw_user_meta_data?.clubName ??
      '',
  ).trim()

  if (metadataClubName) {
    return metadataClubName
  }

  const emailDomain = normalizeEmail(authUser?.email).split('@')[1] ?? ''
  const domainName = emailDomain.split('.')[0] ?? ''
  const fallbackName = normalizeWords(domainName.replace(/[-_]+/g, ' '))

  return fallbackName || 'My Club'
}

function getClubFromMembership(membership) {
  return Array.isArray(membership?.clubs) ? membership.clubs[0] : membership?.clubs
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

async function getUserProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select(USER_PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function getClub(clubId) {
  if (!clubId) {
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('clubs')
    .select(CLUB_SELECT)
    .eq('id', clubId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function getFirstMembership(authUser) {
  const email = normalizeEmail(authUser.email)
  const { data, error } = await supabaseAdmin
    .from('user_club_memberships')
    .select(MEMBERSHIP_CLUB_SELECT)
    .or(`auth_user_id.eq.${authUser.id},email.eq.${email}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function getFirstInvite(authUser) {
  const email = normalizeEmail(authUser.email)
  const { data, error } = await supabaseAdmin
    .from('club_user_invites')
    .select(MEMBERSHIP_CLUB_SELECT)
    .eq('email', email)
    .is('accepted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

async function seedDefaultClubRoles(clubId) {
  const { error } = await supabaseAdmin.rpc('seed_default_club_roles', {
    target_club_id: clubId,
  })

  if (error) {
    throw error
  }
}

async function insertClubWithUniqueName(baseName) {
  const normalizedBaseName = String(baseName ?? '').trim() || 'My Club'

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const name = attempt === 0 ? normalizedBaseName : `${normalizedBaseName} (${attempt + 1})`
    const { data, error } = await supabaseAdmin
      .from('clubs')
      .insert({
        name,
      })
      .select(CLUB_SELECT)
      .single()

    if (!error) {
      return data
    }

    if (error.code !== '23505') {
      throw error
    }
  }

  throw new Error('Could not create a unique club name.')
}

async function applyMembership(authUser, membership) {
  const displayName = getDisplayName({
    ...authUser,
    username: membership.username,
    name: membership.name,
  })
  const email = normalizeEmail(authUser.email || membership.email)
  const role = String(membership.role ?? 'coach').trim() || 'coach'
  const roleLabel = String(membership.role_label ?? 'Coach').trim() || 'Coach'
  const roleRank = Number(membership.role_rank ?? 30)

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .upsert(
      {
        id: authUser.id,
        email,
        username: String(membership.username ?? '').trim() || displayName,
        name: String(membership.name ?? '').trim() || displayName,
        display_name: String(membership.name ?? membership.username ?? '').trim() || displayName,
        role,
        role_label: roleLabel,
        role_rank: roleRank,
        club_id: membership.club_id,
      },
      {
        onConflict: 'id',
      },
    )
    .select(USER_PROFILE_SELECT)
    .single()

  if (profileError) {
    throw profileError
  }

  const { error: membershipError } = await supabaseAdmin
    .from('user_club_memberships')
    .update({
      auth_user_id: authUser.id,
      email,
      username: profile.username,
      name: profile.name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', membership.id)

  if (membershipError) {
    throw membershipError
  }

  return {
    profile,
    club: getClubFromMembership(membership) ?? await getClub(membership.club_id),
  }
}

async function applyInvite(authUser, invite) {
  const displayName = getDisplayName(authUser)
  const email = normalizeEmail(authUser.email || invite.email)
  const role = String(invite.role_key ?? 'coach').trim() || 'coach'
  const roleLabel = String(invite.role_label ?? 'Coach').trim() || 'Coach'
  const roleRank = Number(invite.role_rank ?? 30)

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('user_club_memberships')
    .upsert(
      {
        auth_user_id: authUser.id,
        email,
        username: displayName,
        name: displayName,
        role,
        role_label: roleLabel,
        role_rank: roleRank,
        club_id: invite.club_id,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'auth_user_id,club_id',
      },
    )
    .select(MEMBERSHIP_CLUB_SELECT)
    .single()

  if (membershipError) {
    throw membershipError
  }

  const { error: inviteError } = await supabaseAdmin
    .from('club_user_invites')
    .update({
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invite.id)

  if (inviteError) {
    throw inviteError
  }

  return applyMembership(authUser, membership)
}

async function createSignupWorkspace(authUser, requestedClubName) {
  const email = normalizeEmail(authUser.email)
  const clubName = getSignupClubName(authUser, requestedClubName)
  const displayName = getDisplayName(authUser)
  const club = await insertClubWithUniqueName(clubName)

  await seedDefaultClubRoles(club.id)

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .upsert(
      {
        id: authUser.id,
        email,
        username: displayName,
        name: displayName,
        display_name: displayName,
        club_name: club.name,
        reply_to_email: email,
        role: 'admin',
        role_label: 'Club Admin',
        role_rank: 90,
        club_id: club.id,
        force_password_change: false,
      },
      {
        onConflict: 'id',
      },
    )
    .select(USER_PROFILE_SELECT)
    .single()

  if (profileError) {
    throw profileError
  }

  const { error: membershipError } = await supabaseAdmin
    .from('user_club_memberships')
    .upsert(
      {
        auth_user_id: authUser.id,
        email,
        username: displayName,
        name: displayName,
        role: 'admin',
        role_label: 'Club Admin',
        role_rank: 90,
        club_id: club.id,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'auth_user_id,club_id',
      },
    )

  if (membershipError) {
    throw membershipError
  }

  return { profile, club }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const authUser = await getAuthenticatedUser(event)
    const body = JSON.parse(event.body || '{}')
    const existingProfile = await getUserProfile(authUser.id)

    if (existingProfile?.club_id) {
      const club = await getClub(existingProfile.club_id)
      return json(200, { success: true, profile: existingProfile, club })
    }

    const membership = await getFirstMembership(authUser)
    const invite = membership ? null : await getFirstInvite(authUser)
    const result = membership
      ? await applyMembership(authUser, membership)
      : invite
        ? await applyInvite(authUser, invite)
        : await createSignupWorkspace(authUser, body.clubName)

    return json(200, { success: true, ...result })
  } catch (error) {
    console.error(error)
    return json(500, {
      success: false,
      message: error.message || 'Signup workspace could not be created.',
    })
  }
}
