import { supabase } from './supabase.js'
import { normalizeMatchdayConfig } from './matchdayPolicyCore.js'

export async function loadMatchdayPlanConfig() {
  const { data, error } = await supabase.rpc('get_matchday_plan_config')
  if (error) throw error
  return normalizeMatchdayConfig(data)
}
