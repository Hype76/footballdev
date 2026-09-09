import { supabase } from './supabase'
import { assertCoachOperationalRead } from './coachOperationalData'

export async function getCoachNotificationHistory(user) {
  assertCoachOperationalRead(user)
  const { data, error } = await supabase.rpc('get_own_coach_notification_history', {
    club_id_value: user.clubId, team_id_value: user.activeTeamId || null,
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}
