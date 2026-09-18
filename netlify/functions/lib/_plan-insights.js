import { validateMatchdayFlags } from '../../../src/lib/matchday-policy.js'
import { getPlanLimit } from '../../../src/lib/plans.js'

// Call only after the existing workspace billing authority check.
export async function loadPlanInsights(client, club) {
  const results = await Promise.allSettled([
    client.from('teams').select('id', { count: 'exact', head: true }).eq('club_id', club.id).is('archived_at', null),
    client.from('players').select('id', { count: 'exact', head: true }).eq('club_id', club.id).neq('status', 'archived'),
    client.from('club_team_limit_overrides').select('team_limit_override').eq('club_id', club.id).maybeSingle(),
    client.rpc('get_matchday_plan_config'),
  ])
  const data = results.map(result => result.status === 'fulfilled' && !result.value.error ? result.value : null)
  const count = result => Number.isInteger(result?.count) && result.count >= 0 ? result.count : null
  let matchdayPolicy = null
  try {
    if (Number.isInteger(data[3]?.data?.revision)) {
      matchdayPolicy = { revision: data[3].data.revision, flags: validateMatchdayFlags(data[3].data.flags) }
    }
  } catch { /* An invalid policy is unavailable, never replaced with permissive defaults. */ }
  const teamCapacity = data[2] ? getPlanLimit({
    planKey: club.plan_key, planStatus: 'active',
    subscriptionTeamCapacity: club.subscription_team_capacity,
    teamLimitOverride: data[2].data?.team_limit_override,
  }, 'teams') : null
  return { teams: count(data[0]), players: count(data[1]), teamCapacity, teamCapacityUnlimited: Boolean(data[2] && teamCapacity === null), matchdayPolicy, checkedAt: new Date().toISOString() }
}
