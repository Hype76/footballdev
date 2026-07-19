import { getFeatureAccess, normalizePlanKey } from '../../../src/lib/paywall-access.js'
import { loadActiveAuthorityProfile } from './_authority-profile.js'
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

function normalizePlanProfile(profile, authEmail, context = {}) {
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
    planKey: normalizePlanKey(club?.plan_key ?? profile.plan_key, { mapMissingToFree: true }),
    planStatus: String(club?.plan_status ?? profile.plan_status ?? 'active').trim() || 'active',
    isPlanComped: testerAccessExpired ? false : Boolean(club?.is_plan_comped ?? profile.is_plan_comped),
    testerAccessExpired,
    clubName: String(club?.name ?? '').trim(),
    clubContactEmail: String(club?.contact_email ?? '').trim(),
    teamId: String(context.teamId ?? context.team_id ?? '').trim(),
    activeTeamId: String(context.activeTeamId ?? context.active_team_id ?? context.teamId ?? context.team_id ?? '').trim(),
    playerId: String(context.playerId ?? context.player_id ?? '').trim(),
    ownsResource: context.ownsResource === true || context.isOwner === true,
    previewOnly: context.previewOnly === true,
  }
}

export async function getAuthenticatedPlanProfile(event, { clubId = '', userId = '', teamId = '', playerId = '', ownsResource = false } = {}) {
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

  if (normalizedUserId && normalizedUserId !== String(authUser.id)) {
    throw Object.assign(new Error('Your account could not be matched to this club. Sign out and back in, then try again.'), { statusCode: 403 })
  }

  const authorityProfile = await loadActiveAuthorityProfile(supabaseAdmin, authUser, {
    clubId: normalizedClubId,
    select: 'id, email, username, name, role, role_label, role_rank, club_id, status, clubs:club_id (name, contact_email, status, plan_key, plan_status, is_plan_comped, tester_access_expires_at)',
  })
  const profile = {
    ...authorityProfile,
    auth_user_id: authorityProfile.id,
  }

  const planProfile = normalizePlanProfile(profile, authEmail, { teamId, playerId, ownsResource })

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
  const access = getFeatureAccess(planProfile, 'parentEmails')

  if (access.reason === 'invalid_payment_state' || String(access.reason ?? '').startsWith('invalid_payment_state') || access.reason === 'no_subscription') {
    throw Object.assign(new Error('Your billing plan needs to be active before you can use this feature.'), { statusCode: 403 })
  }
}

function createCapabilityDeniedMessage(access) {
  if (!access.known) {
    return 'This feature is not available.'
  }

  if (access.reason === 'role_not_allowed') {
    return `${access.label} is not available for your role.`
  }

  if (String(access.reason ?? '').startsWith('missing_') || access.reason === 'context_not_allowed') {
    return `${access.label} needs the right workspace context before it can be used.`
  }

  if (String(access.reason ?? '').startsWith('invalid_payment_state') || access.reason === 'no_subscription') {
    return 'Your billing plan needs to be active before you can use this feature.'
  }

  if (String(access.reason ?? '').startsWith('setup_required')) {
    return `${access.label} is not active for this workspace yet.`
  }

  if (access.requiredUpgradePlanKey) {
    return `${access.label} is not included in your current plan.`
  }

  return `${access.label} is not available.`
}

export function assertPlanFeature(planProfile, featureName) {
  const access = getFeatureAccess(planProfile, featureName)

  if (!access.allowed) {
    throw Object.assign(new Error(createCapabilityDeniedMessage(access)), { statusCode: 403, access })
  }
}
