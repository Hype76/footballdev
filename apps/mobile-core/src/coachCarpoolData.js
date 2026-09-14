import { supabase } from './supabase'
import { assertCoachOperationalRead, assertCoachOperationalMutation } from './coachOperationalData'

export async function getCoachCarpoolDefault(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const { data, error } = await supabase.rpc('get_team_carpool_default', { team_id_value: user.activeTeamId })
  if (error) throw error
  if (typeof data !== 'boolean') throw new Error('The saved Car pool preference could not be verified.')
  return data
}

export async function setCoachCarpoolDefault(user, enabled) {
  assertCoachOperationalMutation(user, { minimumRank: 20, requiresTeam: true })
  const { data, error } = await supabase.rpc('set_team_carpool_default', { team_id_value: user.activeTeamId, enabled_value: enabled })
  if (error) throw error
  if (data !== enabled) throw new Error('The Car pool preference was not confirmed. Please retry.')
  return data
}
