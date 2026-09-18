import { isCapabilityIncludedForPlan } from './paywall-capabilities.js'

const SECTION_CAPABILITIES = Object.freeze({
  overview: 'parentPortal',
  calendar: 'teamCalendar',
  invites: 'teamCalendar',
  matches: 'matchDay',
  results: 'matchDay',
  development: 'basicDevelopmentRecords',
  resources: 'resourceLibrary',
  chat: 'parentChat',
  polls: 'teamPolls',
  fans: 'parentPortal',
})

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function getParentLinkPlanKey(link, fallback = '') {
  if (link) return normalize(link.planKey || link.plan_key)
  return normalize(fallback)
}

export function getParentSectionCapability(sectionId) {
  return SECTION_CAPABILITIES[normalize(sectionId)] || ''
}

export function isParentSectionAllowed(link, sectionId, matchdayPolicy, fallbackPlanKey = '') {
  const capability = getParentSectionCapability(sectionId)
  if (!capability) return true

  const planKey = getParentLinkPlanKey(link, fallbackPlanKey)
  if (!planKey) return false
  if (planKey === 'matchday' && !matchdayPolicy?.flags) return false
  if (!['matchday', 'team', 'club'].includes(planKey)) return true
  return isCapabilityIncludedForPlan(planKey, capability, matchdayPolicy)
}

export function getFirstAllowedParentSection(link, matchdayPolicy, fallbackPlanKey = '') {
  return ['overview', 'calendar', 'matches', 'results', 'settings']
    .find((sectionId) => isParentSectionAllowed(link, sectionId, matchdayPolicy, fallbackPlanKey)) || 'settings'
}
