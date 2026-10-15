import { createSupabaseAdminClient as createAdminClient } from './lib/_supabase.js'
import { createFreshSignupHandler } from './lib/_fresh-coach-signup.js'

export const handler = createFreshSignupHandler({ createAdminClient, triggerWorker: async (requestId, signature) => {
  const response = await fetch('https://footballplayer.online/.netlify/functions/fresh-coach-signup-background', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signature}` }, body: JSON.stringify({ requestId }), signal: AbortSignal.timeout(5000),
  })
  if (response.status !== 202) throw new Error('Signup delivery could not be queued')
} })
