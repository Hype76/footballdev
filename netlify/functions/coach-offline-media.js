import { createSupabaseAdminClient, createPublicSupabaseClient, resolveSupabaseEnvironment } from './lib/_supabase.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) })
const denied = () => Object.assign(new Error('This offline file is no longer available for this Team.'), { statusCode: 403 })

function safePath(path) {
  return typeof path === 'string' && !path.includes('\\') && path.split('/').every(part => part && part !== '.' && part !== '..' && !/%2f|%5c|%2e/i.test(part))
}

export function createCoachOfflineMediaHandler({ createAdmin = createSupabaseAdminClient, createUser = createPublicSupabaseClient, environment = resolveSupabaseEnvironment } = {}) {
  return async event => {
    if (event.httpMethod !== 'POST') return reply(405, { success: false })
    try {
      const token = String(event.headers?.authorization || event.headers?.Authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1]
      if (!token) return reply(401, { success: false, message: 'Sign in to download this file.' })
      let body
      try { body = JSON.parse(event.body || '{}') } catch { return reply(400, { success: false }) }
      if (!uuid.test(body.clubId || '') || !uuid.test(body.teamId || '') || !['file','badge','kit'].includes(body.kind)) return reply(400, { success: false })
      const admin = createAdmin(event)
      const { data: auth, error: authError } = await admin.auth.getUser(token)
      const identity = auth?.user
      if (authError || !identity?.id || !identity.email_confirmed_at || identity.deleted_at || (identity.banned_until && Date.parse(identity.banned_until) > Date.now())) throw denied()
      const authorityParams = {actor_value:identity.id,club_value:body.clubId,team_value:body.teamId}
      const assertAuthority = async () => {
        const {data,error}=await admin.rpc('get_coach_offline_read_authority',authorityParams)
        if(error) {if(error.code==='42501') throw denied();throw error}
        if(!data || data.userId!==identity.id || data.clubId!==body.clubId || data.teamId!==body.teamId) throw denied()
      }
      await assertAuthority()
      let source
      if (body.kind === 'file') {
        if (!uuid.test(body.resourceId || '')) return reply(400, { success: false })
        const { data, error } = await admin.rpc('get_coach_offline_file_source', {
          actor_value: identity.id, club_value: body.clubId, team_value: body.teamId, resource_value: body.resourceId,
        })
        if (error) { if (error.code === '42501') throw denied(); throw error }
        if (!data || data.id !== body.resourceId || data.club_id !== body.clubId || data.team_id !== body.teamId
          || data.storage_bucket !== 'resource-library' || !data.storage_path?.startsWith(`${body.clubId}/${body.teamId}/`) || !safePath(data.storage_path)) throw denied()
        source = { id: data.id, clubId: data.club_id, teamId: data.team_id, storageBucket: data.storage_bucket, storagePath: data.storage_path,
          mimeType: data.mime_type, fileSizeBytes: Number(data.file_size_bytes), updatedAt: data.updated_at || '', expiresAt: data.expires_at || '' }
      } else if(body.kind==='kit') {
        if(!uuid.test(body.resourceId || '')) return reply(400,{success:false})
        const {data,error}=await admin.rpc('get_coach_offline_kit_source',{...authorityParams,version_value:body.resourceId})
        if(error) {if(error.code==='42501') throw denied();throw error}
        if(!data || data.id!==body.resourceId || data.club_id!==body.clubId || data.team_id!==body.teamId || data.storage_bucket!=='club-kits'
          || !data.storage_path?.startsWith(`${body.clubId}/`) || !safePath(data.storage_path)) throw denied()
        source={id:`kit:${data.id}`,sourceId:data.id,clubId:data.club_id,teamId:data.team_id,storageBucket:data.storage_bucket,storagePath:data.storage_path,
          updatedAt:data.updated_at,expiresAt:''}
      } else {
        const user = createUser(event, { global: { headers: { Authorization: `Bearer ${token}` } } })
        const { data: display, error } = await user.rpc('get_team_branding_display', { club_value: body.clubId, team_value: body.teamId })
        if (error) { if (error.code === '42501') throw denied(); throw error }
        if (!display?.logoAllowed || display.teamId !== body.teamId || display.clubId !== body.clubId || !['team','paid_club'].includes(display.source)
          || (display.expiresAt && Date.parse(display.expiresAt) <= Date.now() && display.baseLogoAllowed !== true)) throw denied()
        const url = new URL(display.logoUrl)
        const origin = new URL(environment(event).supabaseUrl).origin
        const prefix = '/storage/v1/object/public/club-logos/'
        const versionKeys=[...url.searchParams.keys()]
        const versionOnly=versionKeys.length===0 || (versionKeys.length===1 && versionKeys[0]==='v' && /^\d+$/.test(url.searchParams.get('v')))
        if (url.protocol !== 'https:' || url.origin !== origin || !url.pathname.startsWith(prefix) || !versionOnly || url.hash || url.username || url.password) throw denied()
        const path = decodeURIComponent(url.pathname.slice(prefix.length))
        if (!safePath(path)) throw denied()
        source = { id: `badge:${body.teamId}`, clubId: body.clubId, teamId: body.teamId, storageBucket: 'club-logos', storagePath: path,
          updatedAt: display.logoUrl, expiresAt: display.expiresAt || '' }
      }
      const bucket = admin.storage.from(source.storageBucket)
      const { data: info, error: infoError } = await bucket.info(source.storagePath)
      if (infoError) throw infoError
      const length = Number(info?.size)
      const mime = info?.contentType
      if (!Number.isSafeInteger(length) || length <= 0 || length > 20 * 1024 * 1024 || typeof mime !== 'string') throw denied()
      if (body.kind === 'file' && (length !== source.fileSizeBytes || mime !== source.mimeType)) throw denied()
      if (body.kind === 'badge' && !['image/png','image/jpeg','image/webp','image/gif'].includes(mime)) throw denied()
      if(body.kind==='kit' && (!['image/png','image/jpeg','image/webp'].includes(mime) || length>2*1024*1024)) throw denied()
      source = { ...source, mimeType: mime, fileSizeBytes: length }
      // Recheck current authority after the Storage lookup, before issuing a URL.
      if (body.kind === 'file') {
        const { data, error } = await admin.rpc('get_coach_offline_file_source', { actor_value: identity.id, club_value: body.clubId, team_value: body.teamId, resource_value: body.resourceId })
        if(error) {if(error.code==='42501') throw denied();throw error}
        if (!data || (data.updated_at || '') !== source.updatedAt || data.storage_path !== source.storagePath) throw denied()
      } else if(body.kind==='kit') {
        const {data,error}=await admin.rpc('get_coach_offline_kit_source',{...authorityParams,version_value:body.resourceId})
        if(error) {if(error.code==='42501') throw denied();throw error}
        if(!data || data.updated_at!==source.updatedAt || data.storage_path!==source.storagePath) throw denied()
      } else {
        const user=createUser(event,{global:{headers:{Authorization:`Bearer ${token}`}}})
        const {data,error}=await user.rpc('get_team_branding_display',{club_value:body.clubId,team_value:body.teamId})
        if(error) {if(error.code==='42501') throw denied();throw error}
        if(!data?.logoAllowed || data.logoUrl!==source.updatedAt) throw denied()
      }
      await assertAuthority()
      const { data: signed, error: signError } = await bucket.createSignedUrl(source.storagePath, 60)
      if (signError || !signed?.signedUrl) throw signError || denied()
      return reply(200, { success: true, signedUrl: signed.signedUrl, expiresInSeconds: 60, resource: source })
    } catch (error) {
      const status = error.statusCode || (error.code === '42501' ? 403 : 503)
      return reply(status, { success: false, message: status === 403 ? 'This offline file is no longer available for this Team.' : 'This file could not be downloaded. Try again when connected.' })
    }
  }
}

export const handler = createCoachOfflineMediaHandler()
