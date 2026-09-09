import { supabase } from './supabase'
import { assertCoachOperationalMutation, assertCoachOperationalRead } from './coachOperationalData'

export function createCoachSquadTemplateStore(user) {
  return async (action = 'list', name = '', playerIds = []) => {
    if (action === 'list') assertCoachOperationalRead(user, { requiresTeam: true })
    else assertCoachOperationalMutation(user, { requiresTeam: true })
    const { data, error } = await supabase.rpc('own_coach_squad_templates', {
      team_id_value: user.activeTeamId, action_value: action, name_value: name, player_ids_value: playerIds,
    })
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Templates could not be confirmed.')
    return data
  }
}
