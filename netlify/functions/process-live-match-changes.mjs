import { supabaseAdmin } from './lib/_supabase.js'
import { deliverLiveMatchChange } from './lib/_deliver-live-match-changes.js'

export const config = { schedule: '* * * * *' }

export async function handler() {
  const heartbeat = await supabaseAdmin.rpc('enqueue_live_match_heartbeats')
  if (heartbeat.error) throw heartbeat.error
  const { data: changes, error } = await supabaseAdmin.rpc('claim_live_match_changes', { batch_size: 20 })
  if (error) throw error
  const outcomes = await Promise.all((changes || []).map(async change => {
    let successful = false
    try {
      const provider = {
        teamId: process.env.LIVE_ACTIVITY_APPLE_TEAM_ID,
        keyId: process.env.LIVE_ACTIVITY_APPLE_KEY_ID,
        privateKey: process.env.LIVE_ACTIVITY_APPLE_PRIVATE_KEY,
        production: process.env.LIVE_ACTIVITY_APNS_PRODUCTION === 'true',
      }
      const result = await deliverLiveMatchChange(change.match_day_id, { client: supabaseAdmin, provider })
      successful = result.failed === 0
    } catch { successful = false }
    const result = await supabaseAdmin.rpc('complete_live_match_change', { change_id_value: change.change_id, successful })
    if (result.error) throw result.error
    return successful
  }))
  const completed = outcomes.filter(Boolean).length
  const failed = outcomes.length - completed
  return { statusCode: 200, body: JSON.stringify({ completed, failed }) }
}
