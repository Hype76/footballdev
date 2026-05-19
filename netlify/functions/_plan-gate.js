import { createFeatureUpgradeMessage, hasPlanFeature, isPlanAccessActive } from '../../src/lib/plans.js'
import { supabaseAdmin } from './_supabase.js'

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function isPastDate(value) {
  const rawValue = String(value ?? '').trim()

  if (!rawValue) {
    return false
  }

  const parsedDate = new Date(rawValue)
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.getTime() < Date.now()
}

function normalizePlanProfile(profile, authEmail) {
  const club = Array.isArray(profile.clubs) ? profile.clubs[0] : profile.clubs
  const testerAccessExpiresAt = club?.tester_access_expires_at ?? profile.tester_access_expires_at ?? ''
  const testerAccessExpired = isPastDate(testerAccessExpiresAt)

  return {
    id: profile.id,
    authUserId: profile.auth_user_id,
    email: normalizeEmail(profile.email || authEmail),
    authEmail,
    name: String(profile.name ?? profile.username ?? '').trim(),
    role: String(profile.role ?? '').trim(),
    roleLabel: String(profile.role_label ?? '').trim(),
    roleRank: Number(profile.role_rank ?? 0),
    clubId: String(profile.club_id ?? '').trim(),
    accountStatus: String(profile.status ?? 'active').trim() || 'active',
    clubStatus: String(club?.status ?? 'active').trim() || 'active',
    planKey: String(club?.plan_key ?? profile.plan_key ?? 'small_club').trim() || 'small_club',
    planStatus: String(club?.plan_status ?? profile.plan_status ?? 'active').trim() || 'active',
    isPlanComped: testerAccessExpired ? false : Boolean(club?.is_plan_comped ?? profile.is_plan_comped),
    testerAccessExpired,
    clubName: String(club?.name ?? '').trim(),
    clubContactEmail: String(club?.contact_email ?? '').trim(),
  }
}

export async function getAuthenticatedPlanProfile(event, { clubId = '', userId = '' } = {}) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const authUser = authData.user
  const authEmail = normalizeEmail(authUser.email)
  const normalizedClubId = String(clubId ?? '').trim()
  const normalizedUserId = String(userId ?? '').trim()
  const loadUserProfile = async () => {
    let profileQuery = supabaseAdmin
      .from('users')
      .select('id, email, username, name, role, role_label, role_rank, club_id, status, clubs:club_id (name, contact_email, status, plan_key, plan_status, is_plan_comped, tester_access_expires_at)')
      .limit(1)

    if (normalizedUserId) {
      profileQuery = profileQuery.eq('id', normalizedUserId)
    } else {
      profileQuery = profileQuery.or(`id.eq.${authUser.id},email.eq.${authEmail}`)
    }

    if (normalizedClubId) {
      profileQuery = profileQuery.eq('club_id', normalizedClubId)
    }

    return profileQuery
  }

  const loadMembershipProfile = async () => {
    if (normalizedUserId) {
      return { data: [], error: null }
    }

    let membershipQuery = supabaseAdmin
      .from('user_club_memberships')
      .select('auth_user_id, email, username, name, role, role_label, role_rank, club_id, clubs:club_id (name, contact_email, status, plan_key, plan_status, is_plan_comped, tester_access_expires_at)')
      .limit(1)
      .or(`auth_user_id.eq.${authUser.id},email.eq.${authEmail}`)

    if (normalizedClubId) {
      membershipQuery = membershipQuery.eq('club_id', normalizedClubId)
    }

    return membershipQuery
  }

  const { data: userProfiles, error: userProfileError } = await loadUserProfile()
  let profileError = userProfileError
  let profile = userProfiles?.[0]
    ? {
        ...userProfiles[0],
        auth_user_id: userProfiles[0].id,
      }
    : null

  if (!profile && !userProfileError) {
    const { data: membershipProfiles, error: membershipProfileError } = await loadMembershipProfile()
    profileError = membershipProfileError
    const membershipProfile = membershipProfiles?.[0] ?? null

    if (membershipProfile) {
      profile = {
        ...membershipProfile,
        id: membershipProfile.auth_user_id,
        status: 'active',
      }
    }
  }

  if (profileError || !profile) {
    throw Object.assign(new Error('Your account could not be matched to this club. Sign out and back in, then try again.'), { statusCode: 403 })
  }

  const profileAuthUserId = String(profile.auth_user_id ?? '').trim()
  const profileEmail = normalizeEmail(profile.email)

  if (profileAuthUserId && profileAuthUserId !== String(authUser.id)) {
    throw Object.assign(new Error('Your account could not be matched to this club. Sign out and back in, then try again.'), { statusCode: 403 })
  }

  if (!profileAuthUserId && profileEmail !== authEmail) {
    throw Object.assign(new Error('Your account could not be matched to this club. Sign out and back in, then try again.'), { statusCode: 403 })
  }

  const planProfile = normalizePlanProfile(profile, authEmail)

  if (!planProfile.clubId && planProfile.role !== 'super_admin') {
    throw Object.assign(new Error('Your account is not linked to a club workspace.'), { statusCode: 403 })
  }

  if (planProfile.accountStatus === 'suspended') {
    throw Object.assign(new Error('This account is suspended.'), { statusCode: 403 })
  }

  if (planProfile.clubStatus === 'suspended') {
    throw Object.assign(new Error('This club workspace is suspended.'), { statusCode: 403 })
  }

  return planProfile
}

export async function getAuthenticatedRequestUser(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  return {
    id: String(authData.user.id ?? '').trim(),
    email: normalizeEmail(authData.user.email),
  }
}

export async function getClubPlanProfile(clubId) {
  const normalizedClubId = String(clubId ?? '').trim()

  if (!normalizedClubId) {
    throw Object.assign(new Error('Club details are required.'), { statusCode: 403 })
  }

  const { data: club, error } = await supabaseAdmin
    .from('clubs')
    .select('id, name, contact_email, status, plan_key, plan_status, is_plan_comped, tester_access_expires_at')
    .eq('id', normalizedClubId)
    .maybeSingle()

  if (error || !club) {
    throw Object.assign(new Error('Club details could not be loaded.'), { statusCode: 403 })
  }

  return normalizePlanProfile(
    {
      id: '',
      email: '',
      role: '',
      role_rank: 0,
      club_id: club.id,
      status: 'active',
      clubs: club,
    },
    '',
  )
}

export function assertPlanAccess(planProfile) {
  if (!isPlanAccessActive(planProfile)) {
    throw Object.assign(new Error('Your billing plan needs to be active before you can use this feature.'), { statusCode: 403 })
  }
}

export function assertPlanFeature(planProfile, featureName) {
  assertPlanAccess(planProfile)

  if (!hasPlanFeature(planProfile, featureName)) {
    throw Object.assign(new Error(createFeatureUpgradeMessage(featureName)), { statusCode: 403 })
  }
}
