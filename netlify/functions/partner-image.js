import { createHash } from 'node:crypto'
import { getAuthenticatedPlanProfile } from './lib/_plan-gate.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { decodeClubLogoBase64, validateAndNormalizeClubLogo } from './lib/_club-logo-validation.js'
import { fetchPartnerImage } from './lib/_partner-image.js'

export async function handler(event) {
  const respond = (statusCode, data) => ({ statusCode, headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' }, body: JSON.stringify(data) })
  if (event.httpMethod !== 'POST') return respond(405, { message:'Method not allowed' })
  try {
    const actor = await getAuthenticatedPlanProfile(event)
    if (actor.role !== 'super_admin') return respond(403, { message:'Platform admin access required' })
    if ((event.body || '').length > 3000000) return respond(413, { message:'Use an image smaller than 2MB.' })
    const body = JSON.parse(event.body || '{}')
    const source = body.url ? await fetchPartnerImage(body.url) : { buffer:decodeClubLogoBase64(body.dataBase64), declaredMimeType:body.mimeType, fileName:body.fileName }
    const image = await validateAndNormalizeClubLogo(source)
    const path = `${createHash('sha256').update(image.buffer).digest('hex')}.png`
    const { error } = await supabaseAdmin.storage.from('partner-images').upload(path,image.buffer,{ contentType:'image/png', upsert:true, cacheControl:'31536000' })
    if (error) throw new Error('The image could not be stored.')
    const { data } = supabaseAdmin.storage.from('partner-images').getPublicUrl(path)
    const { error: assetError } = await supabaseAdmin.from('partner_assets').upsert({ url:data.publicUrl },{ onConflict:'url' })
    if (assetError) throw new Error('The image could not be registered.')
    return respond(200,{ url:data.publicUrl })
  } catch (error) { return respond(error.statusCode || 400,{ message:error.message || 'Image upload failed.' }) }
}
