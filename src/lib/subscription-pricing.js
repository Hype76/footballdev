export const TEAM_MONTHLY_PENCE = 799
export const TEAM_ANNUAL_PENCE = 7990
export const CLUB_BASE_MONTHLY_PENCE = 5999
export const CLUB_BASE_INCLUDED_TEAMS = 10
export const CLUB_ADDITIONAL_BLOCK_SIZE = 10
export const CLUB_ADDITIONAL_BLOCK_MONTHLY_PENCE = 4990
export const CLUB_ADDITIONAL_BLOCK_ANNUAL_PENCE = 49900
export const CLUB_MAX_CAPACITY = 500

const PLAN_KEYS = new Set(['matchday', 'team', 'club'])
const BILLING_CYCLES = new Set(['monthly', 'annual'])

function invalid(message) {
  throw new RangeError(message)
}

function validateCapacity(planKey, teamCapacity) {
  if (!Number.isInteger(teamCapacity)) {
    invalid('Team capacity must be a whole number.')
  }

  if (planKey === 'matchday' || planKey === 'team') {
    if (teamCapacity !== 1) invalid(`${planKey} supports one team.`)
    return 1
  }

  if (teamCapacity < CLUB_BASE_INCLUDED_TEAMS || teamCapacity > CLUB_MAX_CAPACITY || teamCapacity % CLUB_ADDITIONAL_BLOCK_SIZE !== 0) {
    invalid(`Club capacity must be a whole number of 10 teams between ${CLUB_BASE_INCLUDED_TEAMS} and ${CLUB_MAX_CAPACITY}.`)
  }

  return teamCapacity
}

export function quoteSubscription({ planKey, teamCapacity, billingCycle }) {
  if (!PLAN_KEYS.has(planKey)) invalid('Unsupported subscription plan.')
  if (!BILLING_CYCLES.has(billingCycle)) invalid('Billing cycle must be monthly or annual.')

  const includedTeams = validateCapacity(planKey, teamCapacity)
  const additionalTeamBlocks = planKey === 'club'
    ? (includedTeams - CLUB_BASE_INCLUDED_TEAMS) / CLUB_ADDITIONAL_BLOCK_SIZE
    : 0
  const monthlyPence = planKey === 'matchday'
    ? 0
    : planKey === 'team'
      ? TEAM_MONTHLY_PENCE
      : CLUB_BASE_MONTHLY_PENCE + additionalTeamBlocks * CLUB_ADDITIONAL_BLOCK_MONTHLY_PENCE
  const annualPence = planKey === 'matchday'
    ? 0
    : planKey === 'team'
      ? TEAM_ANNUAL_PENCE
      : monthlyPence * 10
  const chargePence = billingCycle === 'annual' ? annualPence : monthlyPence

  return {
    monthlyPence,
    annualPence,
    chargePence,
    annualSavingsPence: monthlyPence * 12 - annualPence,
    includedTeams,
    additionalTeamBlocks,
    billingCycle,
  }
}
