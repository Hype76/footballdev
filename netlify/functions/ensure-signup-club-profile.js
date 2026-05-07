import { supabaseAdmin } from './_supabase.js'
import { json } from './_stripe-billing.js'
import { getClubAdminRole, promoteClubBillPayerToAdmin, shouldPromoteBillPayer } from './_billing-role-promotion.js'

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

const CLUB_SELECT = 'id, name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at, plan_key, plan_status, is_plan_comped, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, plan_updated_at, tester_access_code_id, tester_access_code, tester_access_email, tester_access_redeemed_at, tester_access_expires_at'
const MEMBERSHIP_CLUB_SELECT = '*, clubs:club_id (name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at, plan_key, plan_status, is_plan_comped, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, plan_updated_at, tester_access_code_id, tester_access_code, tester_access_email, tester_access_redeemed_at, tester_access_expires_at)'
const FREE_PLAN_KEY = 'individual'
const TEAM_MANAGER_ROLE = {
  role: 'head_manager',
  roleLabel: 'Team Admin',
  roleRank: 70,
}
const CLUB_ADMIN_ROLE = {
  role: 'admin',
  roleLabel: 'Club Admin',
  roleRank: 90,
}

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

function normalizeAccessCode(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
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

function getSignupAccessCode(authUser, requestedAccessCode) {
  const explicitAccessCode = normalizeAccessCode(requestedAccessCode)

  if (explicitAccessCode) {
    return explicitAccessCode
  }

  return normalizeAccessCode(
    authUser?.user_metadata?.tester_access_code ??
      authUser?.user_metadata?.access_code ??
      authUser?.raw_user_meta_data?.tester_access_code ??
      authUser?.raw_user_meta_data?.access_code ??
      '',
  )
}

function hasPublicSignupClubMetadata(authUser) {
  return Boolean(
    String(
      authUser?.user_metadata?.club_name ??
        authUser?.user_metadata?.clubName ??
        authUser?.raw_user_meta_data?.club_name ??
        authUser?.raw_user_meta_data?.clubName ??
        '',
    ).trim(),
  )
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

async function getLatestCheckoutRecord(authUser, clubId = '') {
  const email = normalizeEmail(authUser.email)

  if (!email) {
    return null
  }

  let query = supabaseAdmin
    .from('stripe_checkout_records')
    .select('*')
    .ilike('customer_email', email)
    .in('plan_status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)

  if (clubId) {
    query = query.or(`club_id.is.null,club_id.eq.${clubId}`)
  } else {
    query = query.is('club_id', null)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw error
  }

  return data
}

function getSignupRole(planKey) {
  return planKey === FREE_PLAN_KEY ? TEAM_MANAGER_ROLE : CLUB_ADMIN_ROLE
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

async function claimCheckoutRecord(checkoutRecord, clubId) {
  if (!checkoutRecord?.id || !clubId) {
    return checkoutRecord
  }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('stripe_checkout_records')
    .update({
      club_id: clubId,
      claimed_at: checkoutRecord.claimed_at || now,
      updated_at: now,
    })
    .eq('id', checkoutRecord.id)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

async function redeemTesterAccessCode(authUser, requestedAccessCode) {
  const code = getSignupAccessCode(authUser, requestedAccessCode)

  if (!code) {
    return null
  }

  const email = normalizeEmail(authUser.email)
  const now = new Date()
  const { data: accessCode, error } = await supabaseAdmin
    .from('tester_access_codes')
    .select('*')
    .eq('code', code)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!accessCode || !accessCode.is_active) {
    throw new Error('This tester access code is not valid.')
  }

  const expiresAt = new Date(accessCode.expires_at)

  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new Error('This tester access code has expired.')
  }

  const assignedEmail = normalizeEmail(accessCode.assigned_email)

  if (assignedEmail && assignedEmail !== email) {
    throw new Error('This tester access code is assigned to a different email address.')
  }

  if (Number(accessCode.redeemed_count ?? 0) >= Number(accessCode.max_uses ?? 1)) {
    throw new Error('This tester access code has already been used.')
  }

  return accessCode
}

async function markTesterAccessCodeRedeemed(accessCode) {
  if (!accessCode?.id) {
    return
  }

  const { error } = await supabaseAdmin
    .from('tester_access_codes')
    .update({
      redeemed_count: Number(accessCode.redeemed_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accessCode.id)

  if (error) {
    throw error
  }
}

async function updateClubBillingFromCheckout(clubId, checkoutRecord) {
  if (!clubId || !checkoutRecord?.id) {
    return null
  }

  const claimedRecord = await claimCheckoutRecord(checkoutRecord, clubId)
  const { data, error } = await supabaseAdmin
    .from('clubs')
    .update({
      plan_key: claimedRecord.plan_key,
      plan_status: claimedRecord.plan_status,
      is_plan_comped: false,
      stripe_customer_id: claimedRecord.stripe_customer_id || null,
      stripe_subscription_id: claimedRecord.stripe_subscription_id || null,
      stripe_price_id: claimedRecord.stripe_price_id || null,
      current_period_end: claimedRecord.current_period_end || null,
      plan_updated_at: new Date().toISOString(),
    })
    .eq('id', clubId)
    .select(CLUB_SELECT)
    .single()

  if (error) {
    throw error
  }

  return data
}

async function insertClubWithUniqueName(baseName, extraPayload = {}) {
  const normalizedBaseName = String(baseName ?? '').trim() || 'My Club'

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const name = attempt === 0 ? normalizedBaseName : `${normalizedBaseName} (${attempt + 1})`
    const { data, error } = await supabaseAdmin
      .from('clubs')
      .insert({
        name,
        ...extraPayload,
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

async function ensureTeamForProfile({ authUser, club, profile, teamName }) {
  if (!club?.id || !profile?.id) {
    return null
  }

  const { data: existingTeams, error: teamsError } = await supabaseAdmin
    .from('teams')
    .select('*')
    .eq('club_id', club.id)
    .order('created_at', { ascending: true })

  if (teamsError) {
    throw teamsError
  }

  let team = existingTeams?.[0] ?? null

  if (!team) {
    const resolvedTeamName = String(teamName ?? club.name ?? 'My Team').trim() || 'My Team'
    const { data: insertedTeam, error: teamError } = await supabaseAdmin
      .from('teams')
      .insert({
        club_id: club.id,
        name: resolvedTeamName,
        created_by: profile.id,
        created_by_name: profile.name || profile.username || '',
        created_by_email: normalizeEmail(profile.email || authUser.email),
        updated_by: profile.id,
        updated_by_name: profile.name || profile.username || '',
        updated_by_email: normalizeEmail(profile.email || authUser.email),
      })
      .select('*')
      .single()

    if (teamError) {
      throw teamError
    }

    team = insertedTeam
  }

  const { error: staffError } = await supabaseAdmin
    .from('team_staff')
    .upsert(
      {
        team_id: team.id,
        user_id: profile.id,
      },
      {
        onConflict: 'team_id,user_id',
      },
    )

  if (staffError) {
    throw staffError
  }

  return team
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

async function createSignupWorkspace(authUser, requestedClubName, requestedAccessCode = '') {
  const email = normalizeEmail(authUser.email)
  const clubName = getSignupClubName(authUser, requestedClubName)
  const displayName = getDisplayName(authUser)
  const testerAccessCode = await redeemTesterAccessCode(authUser, requestedAccessCode)
  const checkoutRecord = testerAccessCode ? null : await getLatestCheckoutRecord(authUser)
  const planKey = testerAccessCode?.plan_key || checkoutRecord?.plan_key || FREE_PLAN_KEY
  const planStatus = checkoutRecord?.plan_status || 'active'
  const signupRole = getSignupRole(planKey)
  const club = await insertClubWithUniqueName(clubName, {
    plan_key: planKey,
    plan_status: planStatus,
    is_plan_comped: Boolean(testerAccessCode),
    stripe_customer_id: checkoutRecord?.stripe_customer_id || null,
    stripe_subscription_id: checkoutRecord?.stripe_subscription_id || null,
    stripe_price_id: checkoutRecord?.stripe_price_id || null,
    current_period_end: checkoutRecord?.current_period_end || null,
    tester_access_code_id: testerAccessCode?.id || null,
    tester_access_code: testerAccessCode?.code || null,
    tester_access_email: testerAccessCode ? email : null,
    tester_access_redeemed_at: testerAccessCode ? new Date().toISOString() : null,
    tester_access_expires_at: testerAccessCode?.expires_at || null,
    plan_updated_at: new Date().toISOString(),
  })

  if (checkoutRecord?.id) {
    await claimCheckoutRecord(checkoutRecord, club.id)
  }

  if (testerAccessCode?.id) {
    await markTesterAccessCodeRedeemed(testerAccessCode)
  }

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
        role: signupRole.role,
        role_label: signupRole.roleLabel,
        role_rank: signupRole.roleRank,
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
        role: signupRole.role,
        role_label: signupRole.roleLabel,
        role_rank: signupRole.roleRank,
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

  await ensureTeamForProfile({ authUser, club, profile, teamName: clubName })

  return { profile, club }
}

async function repairExistingSignupWorkspace(authUser, existingProfile, body) {
  let club = await getClub(existingProfile.club_id)
  const checkoutRecord = await getLatestCheckoutRecord(authUser, club?.id)
  let profile = existingProfile

  if (checkoutRecord?.id) {
    const previousPlanKey = club?.plan_key
    club = await updateClubBillingFromCheckout(club.id, checkoutRecord)

    if (shouldPromoteBillPayer(previousPlanKey, club?.plan_key)) {
      const promotion = await promoteClubBillPayerToAdmin(supabaseAdmin, {
        clubId: club.id,
        customerEmail: checkoutRecord.customer_email,
        fallbackUserId: authUser.id,
      })

      if (promotion?.userId === existingProfile.id) {
        const clubAdminRole = getClubAdminRole()
        profile = {
          ...profile,
          role: clubAdminRole.role,
          role_label: clubAdminRole.roleLabel,
          role_rank: clubAdminRole.roleRank,
        }
      }
    }
  }

  const hasBillingLink = Boolean(
    club?.stripe_customer_id ||
      club?.stripe_subscription_id ||
      club?.stripe_price_id ||
      checkoutRecord?.id ||
      club?.is_plan_comped,
  )
  const shouldRepairAsFree = club?.plan_key === 'small_club' && !hasBillingLink && hasPublicSignupClubMetadata(authUser)
  if (shouldRepairAsFree) {
    const { data: repairedClub, error: clubError } = await supabaseAdmin
      .from('clubs')
      .update({
        plan_key: FREE_PLAN_KEY,
        plan_status: 'active',
        plan_updated_at: new Date().toISOString(),
      })
      .eq('id', club.id)
      .select(CLUB_SELECT)
      .single()

    if (clubError) {
      throw clubError
    }

    club = repairedClub

    const { data: repairedProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .update({
        role: TEAM_MANAGER_ROLE.role,
        role_label: TEAM_MANAGER_ROLE.roleLabel,
        role_rank: TEAM_MANAGER_ROLE.roleRank,
      })
      .eq('id', existingProfile.id)
      .select(USER_PROFILE_SELECT)
      .single()

    if (profileError) {
      throw profileError
    }

    profile = repairedProfile
  }

  if (club?.plan_key === FREE_PLAN_KEY || club?.plan_key === 'single_team') {
    await ensureTeamForProfile({
      authUser,
      club,
      profile,
      teamName: getSignupClubName(authUser, body.clubName),
    })
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
      const result = await repairExistingSignupWorkspace(authUser, existingProfile, body)
      return json(200, { success: true, ...result })
    }

    const membership = await getFirstMembership(authUser)
    const invite = membership ? null : await getFirstInvite(authUser)
    const result = membership
      ? await applyMembership(authUser, membership)
      : invite
        ? await applyInvite(authUser, invite)
        : await createSignupWorkspace(authUser, body.clubName, body.accessCode)

    return json(200, { success: true, ...result })
  } catch (error) {
    console.error(error)
    return json(500, {
      success: false,
      message: error.message || 'Signup workspace could not be created.',
    })
  }
}
