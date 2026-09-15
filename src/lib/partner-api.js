import { supabase } from './supabase-client.js'

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw new Error(error.message)
  return data
}
export function managePartners(app, action = 'load', payload = {}) {
  return rpc('partner_admin', { p_app:app, p_action:action, p_payload:payload })
}
export function partnerStats(app, start, end, accounts = false, offset = 0) {
  return rpc('partner_stats', { p_app:app, p_start:start, p_end:end, p_accounts:accounts, p_offset:offset })
}
export async function uploadPartnerImage(fileOrUrl) {
  const { data } = await supabase.auth.getSession()
  let body
  if (typeof fileOrUrl === 'string') body = { url:fileOrUrl }
  else {
    if (fileOrUrl.size > 2 * 1024 * 1024) throw new Error('Use PNG, JPG or WebP images smaller than 2MB.')
    const dataUrl = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(fileOrUrl) })
    body = { dataBase64:String(dataUrl).split(',')[1], mimeType:fileOrUrl.type, fileName:fileOrUrl.name }
  }
  const response = await fetch('/.netlify/functions/partner-image',{ method:'POST',headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${data.session?.access_token || ''}` },body:JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || 'Image upload failed.')
  return result.url
}
