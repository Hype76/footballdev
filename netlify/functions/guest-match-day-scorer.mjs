import { createHash, randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import { createPublicSupabaseClient, supabaseAdmin } from './lib/_supabase.js'
import { sendGuestMatchDayNotifications } from './send-match-day-push.js'

const tokenPattern = /^[a-f0-9]{64}$/
const guestActions = new Set(['claim', 'read', 'start', 'timer', 'extended', 'goal', 'correct_goal', 'remove_goal', 'score', 'shootout'])
const coachActions = new Set(['status', 'create', 'approve', 'revoke'])
export function hashGuestToken(value) {
  if (!tokenPattern.test(String(value || ''))) throw new Error('This scoring link is invalid. Ask the coach for a new QR code.')
  return createHash('sha256').update(value).digest('hex')
}
function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer',
  } })
}
export function createGuestScorerHandler({ admin = supabaseAdmin, publicClient = createPublicSupabaseClient, notify = sendGuestMatchDayNotifications, qr = QRCode.toDataURL } = {}) {
  return async (request) => {
    if (request.method !== 'POST') return response(405, { message: 'Method not allowed.' })
    try {
      const text = await request.text()
      if (text.length > 16000) return response(413, { message: 'The scoring request is too large.' })
      const body = JSON.parse(text)
      let result
      if (body.mode === 'coach') {
        if (!coachActions.has(body.action)) return response(400, { message: 'Unknown coach action.' })
        const bearer = request.headers.get('Authorization') || ''
        const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : ''
        const { data, error } = await admin.auth.getUser(token)
        if (error || !data?.user) return response(401, { message: 'Sign in as a coach to manage guest scoring.' })
        const invite = body.action === 'create' ? randomBytes(32).toString('hex') : null
        const client = publicClient({}, { global: { headers: { Authorization: bearer } } })
        const saved = await client.rpc('manage_match_day_guest_scorer', {
          match_id: body.matchId, action: body.action, invite_hash_value: invite ? hashGuestToken(invite) : null,
          session_id_value: body.sessionId || null,
        })
        if (saved.error) throw saved.error
        result = saved.data
        if (invite) {
          const url = 'https://footballplayer.online/guest-scorer#invite=' + invite
          result = { ...result, url, qr: await qr(url, { width: 320, margin: 4, errorCorrectionLevel: 'M' }) }
        }
      } else {
        if (!guestActions.has(body.action)) return response(400, { message: 'This action is not available to guest scorers.' })
        const details = body.action === 'claim'
          ? { name: body.details?.name, sessionHash: hashGuestToken(body.details?.sessionToken) }
          : body.details || {}
        const saved = await admin.rpc('guest_match_day_scoring', {
          token_hash: hashGuestToken(body.token), action: body.action, details, request_id_value: body.requestId || null,
        })
        if (saved.error) throw saved.error
        result = saved.data
        if (result.saved) {
          try { await notify({ tokenHash: hashGuestToken(body.token), requestId: body.requestId }) }
          catch { result = { ...result, notificationWarning: 'Your change was saved, but a notification could not be delivered. Retry to send it again.' } }
        }
        // Match identity in command receipts is for internal delivery. The scoped match model remains available.
        delete result.matchId
      }
      return response(200, { success: true, ...result })
    } catch (error) {
      const expected = error?.code === 'P0001' || error instanceof SyntaxError || /scoring link is invalid/.test(error?.message || '')
      if (!expected) console.error('Guest scoring request failed', { code: error?.code || 'unknown' })
      return response(expected ? 400 : 503, { success: false, message: expected ? error.message : 'This change could not be confirmed. Please retry the same change.' })
    }
  }
}
export default createGuestScorerHandler()
