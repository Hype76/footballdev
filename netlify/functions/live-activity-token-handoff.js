import { createHash } from 'node:crypto'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hexToken = /^[0-9a-f]{64,256}$/i
const handoff = /^[0-9a-f]{64}$/

export function createHandoffHandler(client = null) {
  return async event => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' }
    if (!event.body || event.body.length > 1200) return { statusCode: 400, body: '' }
    let input
    try { input = JSON.parse(event.body) } catch { return { statusCode: 400, body: '' } }
    if (!input || !uuid.test(input.followId || '') || !handoff.test(input.handoffToken || '')
      || !hexToken.test(input.activityToken || '')) return { statusCode: 400, body: '' }
    const hash = createHash('sha256').update(input.handoffToken).digest('hex')
    const database = client || (await import('./lib/_supabase.js')).createSupabaseAdminClient(event)
    const { data, error } = await database.rpc('attach_live_match_activity_from_push', {
      follow_id_value: input.followId, handoff_secret_hash_value: hash,
      activity_token_value: input.activityToken,
    })
    if (error) return { statusCode: 503, body: '' }
    return { statusCode: data === true ? 200 : 404, body: '' }
  }
}

export const handler = createHandoffHandler()
