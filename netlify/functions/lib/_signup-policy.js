import { normalizePlanKey, PLAN_KEYS } from '../../../src/lib/plans.js'

function getMetadataPlanKey(authUser) {
  return normalizePlanKey(
    authUser?.user_metadata?.signup_plan_key ??
      authUser?.raw_user_meta_data?.signup_plan_key ??
      '',
  )
}

export function getPublicFreeSignupPlanKey(authUser, requestedPlanKey = '') {
  const explicitPlanKey = normalizePlanKey(requestedPlanKey)

  if (explicitPlanKey === PLAN_KEYS.individual) {
    return PLAN_KEYS.individual
  }

  return getMetadataPlanKey(authUser) === PLAN_KEYS.individual ? PLAN_KEYS.individual : ''
}

export function hasPublicFreeSignupIntent(authUser, body = {}) {
  const requestedClubName = String(body.clubName ?? '').trim()
  const hasFormSignupIntent = Boolean(body.signupIntent) && Boolean(requestedClubName)
  const hasStoredSignupIntent = Boolean(
    String(
      authUser?.user_metadata?.club_name ??
        authUser?.user_metadata?.clubName ??
        authUser?.raw_user_meta_data?.club_name ??
        authUser?.raw_user_meta_data?.clubName ??
        '',
    ).trim(),
  )

  if (!getPublicFreeSignupPlanKey(authUser, body.planKey)) {
    return false
  }

  return hasFormSignupIntent || hasStoredSignupIntent
}
