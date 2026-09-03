import { createPublicSupabaseClient, supabaseAdmin } from './lib/_supabase.js'
import { deliverSquadDecisionNotifications } from './lib/_squad-decision-notifications.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function response(status, value) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' } }) }
export function createSquadNotificationHandler({ admin = supabaseAdmin, publicClient = createPublicSupabaseClient, deliver = deliverSquadDecisionNotifications } = {}) {
  return async (request) => {
    if (request.method !== 'POST') return response(405, { message: 'Method not allowed.' })
    try {
      const bearer = request.headers.get('Authorization') || ''
      if (!bearer.startsWith('Bearer ')) return response(401, { message: 'Sign in as a coach to notify parents.' })
      const { data, error } = await admin.auth.getUser(bearer.slice(7))
      if (error || !data?.user) return response(401, { message: 'Sign in as a coach to notify parents.' })
      const text = await request.text()
      if (text.length > 20000) return response(413, { message: 'The request is too large.' })
      const body = JSON.parse(text)
      const bulk = Array.isArray(body?.decisions)
      const decisions = bulk ? body.decisions : [{ playerId: body?.playerId, revision: body?.revision }]
      if (!uuid.test(String(body?.matchId || '')) || decisions.length < 1 || decisions.length > 100
        || decisions.some((item) => ![item?.playerId, item?.revision].every((id) => uuid.test(String(id || ''))))
        || new Set(decisions.map((item) => item.playerId.toLowerCase())).size !== decisions.length) return response(400, { message: 'Choose saved squad decisions first, with each player included once.' })
      const client = publicClient({}, { global: { headers: { Authorization: bearer } } })
      const { data: result, error: savedError } = await client.rpc(bulk ? 'notify_match_day_squad_decisions' : 'notify_match_day_squad_decision', bulk
        ? { match_id: body.matchId, decisions: decisions.map(({ playerId, revision }) => ({ playerId, revision })) }
        : { match_id: body.matchId, player_id_value: body.playerId, expected_revision: body.revision })
      if (savedError) throw savedError
      // Larger batches use the durable worker so the request stays within its time limit.
      if (!bulk) { try { await deliver(result.notificationIds || []) } catch { /* The saved outbox retries phone delivery. */ } }
      if (bulk) return response(200, { success: true, results: result.results })
      return response(200, { success: true, sent: result.sent, alreadySent: result.alreadySent === true, revision: result.revision })
    } catch (error) {
      const expected = error?.code === 'P0001' || error instanceof SyntaxError
      return response(expected ? 400 : 503, { message: expected && !(error instanceof SyntaxError) ? error.message : 'The notification could not be confirmed. Refresh and try again.' })
    }
  }
}
export default createSquadNotificationHandler()
