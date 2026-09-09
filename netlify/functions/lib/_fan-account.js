import { assertPasswordPolicy } from '../../../src/lib/password-policy.js'
import { buildFanEmail } from './_fan-email.js'
import { loadFanInvitingParent } from './_fan-access.js'

const json = (statusCode, payload) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(payload) })
const reportFailure = (phase, error) => console.error('fan_account_failed', {
  phase,
  code: /^[a-z_]{1,80}$/.test(error?.code || '') ? error.code : 'unknown',
  status: Number.isInteger(error?.status) ? error.status : null,
})

function passwordRejectionMessage(error) {
  const reasons = Array.isArray(error.reasons) ? error.reasons : []
  const messages = []
  if (reasons.includes('pwned')) {
    messages.push('This password has appeared in a known data breach. Choose a different, unique password.')
  }
  if (reasons.includes('length')) {
    // Extract only the provider's numeric minimum, never return its raw message.
    const minimum = typeof error.message === 'string' ? error.message.match(/Password should be at least ([1-9][0-9]?) characters\./)?.[1] : null
    messages.push(minimum ? `Password must be at least ${minimum} characters.` : 'This password is too short. Choose a longer password.')
  }
  if (reasons.includes('characters')) {
    messages.push('Password must include an uppercase letter, a lowercase letter, a number, and a symbol such as ! or @.')
  }
  return messages.join(' ') || 'The sign-in service rejected this password without giving a specific reason. Choose a different password and try again.'
}

export function createFanAccountHandler({ createClient, sendEmail, createFromAddress }) {
  return async (event) => {
    if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' })
    if ((event.body || '').length > 4096) return json(413, { message: 'Request is too large.' })
    let body
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { message: 'Use a valid invitation and password.' }) }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body?.token || '') || typeof body?.password !== 'string') return json(400, { message: 'Use a valid invitation and password.' })
    try { assertPasswordPolicy(body.password) } catch (error) { return json(400, { code: 'weak_password', message: error.message }) }
    try {
      const client = createClient(event)
      const { data: invite, error } = await client.from('fan_connections').select('id, name, email, expires_at, parent_link_id, invited_by, player_id, club_id')
        .eq('invite_token', body.token).eq('email', String(body.email || '').trim().toLowerCase()).eq('status', 'pending').eq('relationship_type', 'fan').maybeSingle()
      if (error) throw error
      if (!invite || !Number.isFinite(Date.parse(invite.expires_at)) || Date.parse(invite.expires_at) <= Date.now()) return json(403, { message: 'This invitation is not available for that email address. Check the invited email or ask the Parent for a new invitation.' })
      const club = await loadFanInvitingParent(client, invite)
      const { data, error: signupError } = await client.auth.admin.generateLink({ type: 'signup', email: invite.email, password: body.password,
        options: { redirectTo: `https://parent.footballplayer.online/fan-invite/${body.token}`, data: { name: invite.name, display_name: invite.name, account_type: 'fan' } } })
      if (signupError) {
        reportFailure('signup', signupError)
        if (['email_exists', 'user_already_exists'].includes(signupError.code)) return json(409, { code: 'account_exists', message: 'An account is already registered with this email. Confirm your email if you have not done so, then choose Sign in. You can use Forgot password if needed.' })
        if (signupError.code === 'weak_password') return json(400, { code: 'weak_password', message: passwordRejectionMessage(signupError) })
        if (signupError.status === 429) return json(429, { code: 'signup_rate_limited', message: 'Account creation is temporarily limited. Wait a few minutes, then try Create account again.' })
        throw signupError
      }
      if (!data?.properties?.hashed_token || !data?.user?.id) throw new Error('missing_signup_confirmation')
      // Keep the invitation in the email URL instead of relying on Auth redirect configuration.
      // The fragment is not sent to web servers or included in referrer headers.
      const confirmationUrl = `https://parent.footballplayer.online/fan-invite/${body.token}#fan_confirmation=${encodeURIComponent(data.properties.hashed_token)}`
      try {
        await sendEmail({ from: createFromAddress('Football Player'), to: [invite.email], ...buildFanEmail({ club, fan: invite, url: confirmationUrl, verification: true }) },
          { idempotencyKey: `fan-account-${invite.id}`, context: { emailType: 'fan_account_confirmation', targetEntityType: 'fan_connection', targetEntityId: invite.id } })
      } catch (error) {
        reportFailure('confirmation_email', error)
        return json(502, { code: 'confirmation_email_failed', message: 'Account setup started, but the confirmation email could not be sent. Please contact support before trying to sign in.' })
      }
      return json(200, { needsEmailVerification: true, message: 'Check your email to confirm your account, then return to this invitation.' })
    } catch (error) {
      reportFailure('account_setup', error)
      if (error.statusCode === 403) return json(403, { message: 'This invitation is no longer available. Ask the Parent for a new invitation.' })
      return json(502, { code: 'signup_failed', message: 'Account creation could not be completed. Please try Create account again. If it still fails, contact support.' })
    }
  }
}
