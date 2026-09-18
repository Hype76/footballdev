import { isMatchdayCapabilityEnabled } from '../../../src/lib/matchday-policy.js'
import { isCapabilityIncludedForPlan } from '../../../src/lib/paywall-capabilities.js'

export const MATCHDAY_PLAN = 'matchday'
export const TEAM_PLAN = 'team'
export const CLUB_PLAN = 'club'

// Capability names are shared with the server flags object. A missing flag is
// denied for Matchday so a stale or partial config cannot widen access.
const ROUTE_CAPABILITY = Object.freeze({
  calendar: 'teamCalendar', players: 'players', matchday: 'matchDay',
  formation: 'matchDay', sessions: 'trainingEvents', development: 'basicDevelopmentRecords',
  resources: 'resourceLibrary', chat: 'staffChat', messages: 'staffChat', polls: 'teamPolls',
  invites: 'parentInvitations', team: 'basicLogoBranding', club: 'clubAdministration',
})

function normalize(value) { return String(value ?? '').trim().toLowerCase() }

export function resolveMobilePlan(context) {
  const key = normalize(context?.planKey || context?.plan_key)
  if ([MATCHDAY_PLAN, TEAM_PLAN, CLUB_PLAN].includes(key)) return key
  return 'legacy'
}

export function isMatchdayPlan(context) { return resolveMobilePlan(context) === MATCHDAY_PLAN }

export function normalizeMatchdayConfig(value) {
  const flags = value?.flags && typeof value.flags === 'object' ? value.flags : null
  if (!flags) return null
  return Object.freeze({ revision: normalize(value.revision), flags: Object.freeze({ ...flags }) })
}

export function isMobileCapabilityAllowed(context, capability, config) {
  const plan = resolveMobilePlan(context)
  if (plan === MATCHDAY_PLAN) {
    if (!config?.flags || !Object.prototype.hasOwnProperty.call(config.flags, capability)) return false
    return isMatchdayCapabilityEnabled(capability, config)
  }
  if ([TEAM_PLAN, CLUB_PLAN].includes(plan)) return isCapabilityIncludedForPlan(plan, capability)
  return true
}

export function isMobileRouteAllowed(context, route, config) {
  const capability = ROUTE_CAPABILITY[normalize(route)]
  return !capability || isMobileCapabilityAllowed(context, capability, config)
}

export function getMatchdayRouteCapability(route) { return ROUTE_CAPABILITY[normalize(route)] || '' }

export function getMatchdayParentMoreSectionModel(context, sections, config) {
  return (Array.isArray(sections) ? sections : []).filter((section) => isMobileRouteAllowed(context, section.key || section.route || section, config))
}
