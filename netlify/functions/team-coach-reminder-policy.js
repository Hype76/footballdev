import process from 'node:process'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { createTeamCoachReminderPolicyHandler } from './lib/_team-coach-reminder-policy.js'

export const handler = createTeamCoachReminderPolicyHandler({
  enabled: () => (globalThis.Netlify?.env?.get?.('ENABLE_COACH_REMINDER_POLICY_SETTINGS') || process.env.ENABLE_COACH_REMINDER_POLICY_SETTINGS) === 'true',
  loadAuthority: loadActiveAuthorityProfile,
  createClients: async (event, token) => {
    const { createPublicSupabaseClient, createSupabaseAdminClient } = await import('./lib/_supabase.js')
    return { adminClient: createSupabaseAdminClient(event), requestClient: createPublicSupabaseClient(event,
      { global: { headers: { Authorization: `Bearer ${token}` } } }) }
  },
})
