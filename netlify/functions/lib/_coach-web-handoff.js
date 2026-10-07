import { createHmac } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(body) })
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode })

export function createCoachWebHandoffHandler({ client, loadProfile, assertUpgrade, secret, clientIp = () => 'unknown' }) {
  return async (event, context) => {
    if (event.httpMethod !== 'POST') return reply(405, { message: 'Method not allowed.' })
    try {
      if (String(event.body || '').length > 1024) throw fail('Invalid request.', 400)
      let body
      try { body = JSON.parse(event.body || '{}') } catch { throw fail('Invalid request.', 400) }
      if (!body || Array.isArray(body) || Object.keys(body).some(key => !['purpose', 'teamId'].includes(key))
        || !['badge', 'upgrade'].includes(body.purpose) || (body.purpose === 'badge' && !UUID.test(body.teamId || ''))) throw fail('Invalid request.', 400)
      const header = event.headers?.authorization || event.headers?.Authorization || ''
      if (!header.startsWith('Bearer ')) throw fail('Sign in to continue.', 401)
      const { data, error } = await client.auth.getUser(header.slice(7))
      const actor = data?.user
      if (error || !actor?.id || !actor.email || !actor.email_confirmed_at
        || (actor.banned_until && Date.parse(actor.banned_until) > Date.now())) throw fail('Sign in to continue.', 401)
      const profile = await loadProfile(client, actor)
      if (!profile?.club_id) throw fail('An active Coach account is required.', 403)
      if (body.purpose === 'badge') {
        const { data: team, error: teamError } = await client.from('teams').select('id,club_id').eq('id', body.teamId).maybeSingle()
        if (teamError || !team || team.club_id !== profile.club_id) throw fail('Team badge access is required.', 403)
        const { data: management, error: scopeError } = await client.rpc('read_first_250_team_branding_management', {
          actor_value: actor.id, team_value: team.id, club_value: team.club_id,
        })
        if (scopeError || !management?.enabled || management.logoAllowed !== true) throw fail('Team badge access is required.', 403)
      } else await assertUpgrade({ clubId: profile.club_id, profile })
      if (!secret) throw fail('Website access is temporarily unavailable.', 503)
      const digest = (purpose, value) => createHmac('sha256', secret).update(`coach-web-handoff:${purpose}:${value}`).digest('hex')
      const { data: limit, error: limitError } = await client.rpc('consume_password_recovery_rate_limit', {
        p_email_digest: digest('actor', actor.id), p_ip_digest: digest('ip', clientIp(event, context)),
        p_email_limit: 10, p_ip_limit: 50, p_window_seconds: 900,
      })
      if (limitError || limit?.allowed !== true) throw fail('Wait a moment before opening the website again.', 429)
      const { data: link, error: linkError } = await client.auth.admin.generateLink({ type: 'magiclink', email: actor.email })
      const tokenHash = link?.properties?.hashed_token
      if (linkError || link?.user?.id !== actor.id || !/^[a-f0-9]{56}$/i.test(tokenHash || '')) throw fail('Website access could not be prepared. Try again.', 503)
      // Mint a new single-use sign-in credential. Never expose the native access/refresh tokens or action link.
      return reply(200, { purpose: body.purpose, actorId: actor.id, ...(body.purpose === 'badge' ? { teamId: body.teamId } : {}), tokenHash })
    } catch (failure) { return reply(failure.statusCode || 403, { message: failure.statusCode ? failure.message : 'Website access could not be authorised.' }) }
  }
}
