import { CAPABILITY_REGISTRY, isCapabilityIncludedForPlan } from './paywall-capabilities.js'
import { normalizePlanKey } from './plans.js'
import { quoteSubscription } from './subscription-pricing.js'
import { validateMatchdayFlags } from './matchday-policy.js'

export function previewPlanChange({ currentPlanKey, targetPlanKey, teamCapacity, usage, matchdayPolicy }) {
  const current = normalizePlanKey(currentPlanKey)
  if (!current) return { available: false, reason: 'Current plan could not be verified.' }
  const quote = quoteSubscription({ planKey: targetPlanKey, teamCapacity, billingCycle: 'monthly' })
  if ([current, targetPlanKey].includes('matchday')) {
    try { validateMatchdayFlags(matchdayPolicy?.flags) } catch {
      return { available: false, reason: 'Current Matchday settings could not be verified. Reload billing to try again.' }
    }
  }
  const lostFeatures = Object.values(CAPABILITY_REGISTRY)
    .filter(feature => feature.readiness === 'active'
      && isCapabilityIncludedForPlan(current, feature.key, matchdayPolicy)
      && !isCapabilityIncludedForPlan(targetPlanKey, feature.key, matchdayPolicy))
    .map(feature => ({ key: feature.key, label: feature.label }))
  const knownTeams = Number.isInteger(usage?.teams) && usage.teams >= 0
  const excessTeams = knownTeams ? Math.max(0, usage.teams - quote.includedTeams) : null
  return { available: true, lostFeatures, includedTeams: quote.includedTeams, excessTeams, capacityVerified: knownTeams }
}
