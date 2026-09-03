import { supabaseAdmin } from './lib/_supabase.js'
import { deliverSquadDecisionNotifications } from './lib/_squad-decision-notifications.js'

export default async () => {
  const { data, error } = await supabaseAdmin.from('match_day_squad_notifications').select('id')
    .is('push_finished_at', null).lt('push_attempts', 5).order('created_at').limit(30)
  if (error) throw error
  const result = await deliverSquadDecisionNotifications((data || []).map((row) => row.id))
  return new Response(JSON.stringify(result))
}
export const config = { schedule: '* * * * *' }
