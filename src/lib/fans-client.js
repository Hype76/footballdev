import { supabase } from './supabase-client.js'
import { fetchFansJson } from './fans-fetch.js'
export async function fanRpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}
export async function fanRequest(body) {
  const { data } = await supabase.auth.getSession()
  return fetchFansJson('/.netlify/functions/fans', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data?.session?.access_token || ''}` }, body: JSON.stringify(body) })
}
