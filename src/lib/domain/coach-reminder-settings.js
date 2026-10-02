import { supabase } from '../supabase-client.js'
import { requestTeamCoachReminderPolicy } from '../coach-reminder-settings.js'

export async function requestOwnTeamCoachReminderPolicy(payload) {
  const session = await supabase.auth.getSession()
  if (session.error) throw session.error
  return requestTeamCoachReminderPolicy({ accessToken:session.data?.session?.access_token,payload })
}
