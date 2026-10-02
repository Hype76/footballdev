import process from 'node:process'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { createTeamCoachReminderPolicyHandler } from './lib/_team-coach-reminder-policy.js'

const handleEvent = createTeamCoachReminderPolicyHandler({
  enabled: () => (globalThis.Netlify?.env?.get?.('ENABLE_COACH_REMINDER_POLICY_SETTINGS') || process.env.ENABLE_COACH_REMINDER_POLICY_SETTINGS) === 'true',
  loadAuthority: loadActiveAuthorityProfile,
  isDeliveryEnabled:async client=>{
    if((globalThis.Netlify?.env?.get?.('ENABLE_COACH_REMINDER_AUTOMATION') || process.env.ENABLE_COACH_REMINDER_AUTOMATION)!=='true')return false
    const result=await client.from('team_coach_reminder_release_control').select('enabled').eq('singleton',true).single()
    if(result.error)throw result.error
    return result.data?.enabled===true
  },
  createClients: async (event, token) => {
    const { createPublicSupabaseClient, createSupabaseAdminClient } = await import('./lib/_supabase.js')
    return { adminClient: createSupabaseAdminClient(event), requestClient: createPublicSupabaseClient(event,
      { global: { headers: { Authorization: `Bearer ${token}` } } }) }
  },
})

export default async function(request){
  const result=await handleEvent({httpMethod:request.method,headers:Object.fromEntries(request.headers),body:await request.text()})
  return new Response(result.body,{status:result.statusCode,headers:result.headers})
}
