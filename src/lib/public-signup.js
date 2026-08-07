import { normalizePlanKey, PLAN_KEYS } from './plans.js'

export const PUBLIC_FREE_SIGNUP_PLAN_KEY = PLAN_KEYS.individual
export const PUBLIC_FREE_SIGNUP_PATH = `/sign-in?mode=signup&plan=${PUBLIC_FREE_SIGNUP_PLAN_KEY}`

export function getPublicFreeSignupPlanKey(value) {
  const planKey = normalizePlanKey(value)
  return planKey === PUBLIC_FREE_SIGNUP_PLAN_KEY ? planKey : ''
}
