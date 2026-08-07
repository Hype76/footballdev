import { normalizePlanKey, PLAN_KEYS } from './plans.js'

export const PUBLIC_FREE_SIGNUP_PLAN_KEY = PLAN_KEYS.individual
export const PUBLIC_FREE_SIGNUP_PATH = `/sign-in?mode=signup&plan=${PUBLIC_FREE_SIGNUP_PLAN_KEY}`

export function getPublicFreeSignupPlanKey(value) {
  const planKey = normalizePlanKey(value)
  return planKey === PUBLIC_FREE_SIGNUP_PLAN_KEY ? planKey : ''
}

export function hasPublicFreeSignupMetadata(authUser) {
  const metadata = authUser?.user_metadata ?? authUser?.raw_user_meta_data ?? {}
  const clubName = String(metadata.club_name ?? metadata.clubName ?? '').trim()
  const planKey = getPublicFreeSignupPlanKey(metadata.signup_plan_key)

  return Boolean(clubName && planKey)
}
