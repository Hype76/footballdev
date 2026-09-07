import { createSupabaseAdminClient } from './lib/_supabase.js'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { assertPasswordPolicy } from '../../src/lib/password-policy.js'
import { buildFanEmail } from './lib/_fan-email.js'
import { loadFanInvitingParent } from './lib/_fan-access.js'
const json = (statusCode, payload) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(payload) })
export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' })
  if ((event.body || '').length > 4096) return json(413, { message: 'Request is too large.' })
  try {
    const body = JSON.parse(event.body || '{}')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.token || '') || typeof body.password !== 'string') return json(400, { message: 'Use a valid invitation and password.' })
    assertPasswordPolicy(String(body.password || ''))
    const client = createSupabaseAdminClient(event)
    const { data: invite, error } = await client.from('fan_connections').select('id, name, email, expires_at, parent_link_id, invited_by, player_id, club_id')
      .eq('invite_token', body.token).eq('email', String(body.email || '').trim().toLowerCase()).eq('status', 'pending').eq('relationship_type', 'fan').maybeSingle()
    if (error || !invite || Date.parse(invite.expires_at) <= Date.now()) return json(403, { message: 'This invitation is not available for that email address.' })
    const club = await loadFanInvitingParent(client, invite)
    const { data, error: signupError } = await client.auth.admin.generateLink({ type: 'signup', email: invite.email, password: body.password,
      options: { redirectTo: `https://parent.footballplayer.online/fan-invite/${body.token}`, data: { name: invite.name, display_name: invite.name, account_type: 'fan' } } })
    if (signupError || !data?.properties?.action_link) return json(409, { message: 'If you already have an account, sign in. Otherwise try again or use password recovery.' })
    await sendEmail({ from: createFromAddress('Football Player'), to: [invite.email], ...buildFanEmail({ club, fan: invite, url: data.properties.action_link, verification: true }) },
    { idempotencyKey: `fan-account-${invite.id}`, context: { emailType: 'fan_account_confirmation', targetEntityType: 'fan_connection', targetEntityId: invite.id } })
    return json(200, { message: 'Check your email to confirm your account, then return to this invitation.' })
  } catch (error) {
    return json(400, { message: error.message || 'Your account could not be created.' })
  }
}
