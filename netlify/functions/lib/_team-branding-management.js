import { createHash } from 'node:crypto'
import { readPublicBrandingOfferCounter } from './_first-250-branding.js'
import { decodeClubLogoBase64, validateAndNormalizeClubLogo } from './_club-logo-validation.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FIELDS = new Set(['action', 'teamId', 'termsVersion', 'accent', 'buttonStyle', 'dataBase64', 'mimeType', 'fileName', 'reason'])
function response(statusCode, value) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(value) }
}
function denied(message, statusCode = 403) { return Object.assign(new Error(message), { statusCode }) }

export function createTeamBrandingManagementHandler({ client, validateLogo = validateAndNormalizeClubLogo }) {
  const rpc = async (name, args = {}) => {
    const { data, error } = await client.rpc(name, args)
    if (error) throw denied('Team branding could not be verified.', error.code === '42501' ? 403 : 409)
    return data
  }
  return async event => {
    try {
      if (event.httpMethod === 'GET') return response(200, await readPublicBrandingOfferCounter(client))
      if (event.httpMethod !== 'POST') return response(405, { message: 'Method Not Allowed' })
      if (String(event.body || '').length > 8 * 1024 * 1024) throw denied('Upload is too large.', 413)
      let body
      try { body = JSON.parse(event.body || '{}') } catch { throw denied('Invalid request.', 400) }
      if (!body || Array.isArray(body) || Object.keys(body).some(key => !FIELDS.has(key))
        || !UUID.test(body.teamId || '') || !['read', 'claim', 'save', 'extend'].includes(body.action)) {
        throw denied('Invalid team branding request.', 400)
      }
      const token = String(event.headers?.authorization || event.headers?.Authorization || '')
      if (!token.startsWith('Bearer ')) throw denied('Sign in to continue.', 401)
      const { data: auth, error: authError } = await client.auth.getUser(token.slice(7))
      const actor = auth?.user
      if (authError || !actor?.id || !actor.email_confirmed_at
        || (actor.banned_until && Date.parse(actor.banned_until) > Date.now())) throw denied('Sign in to continue.', 401)
      const { data: team, error: teamError } = await client.from('teams').select('id,club_id').eq('id', body.teamId).maybeSingle()
      if (teamError || !team?.club_id) throw denied('Team branding could not be verified.')
      const scope = { actor_value: actor.id, team_value: team.id, club_value: team.club_id }
      const management = await rpc('read_first_250_team_branding_management', scope)
      if (!management?.enabled) return response(200, { enabled: false })
      if (body.action === 'claim') {
        if (body.termsVersion !== management.termsVersion) throw denied('Accept the current offer terms.', 400)
        const slot = await rpc('claim_first_250_branding_team', { ...scope, terms_value: body.termsVersion })
        if (slot === null) return response(409, { message: 'All promotional places have been claimed.' })
      } else if (body.action === 'extend') {
        if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) throw denied('An extension reason is required.', 400)
        await rpc('extend_branding_offer_team', { team_id_value: team.id, club_id_value: team.club_id,
          actor_id_value: actor.id, reason_value: body.reason.trim() })
      } else if (body.action === 'save') {
        const hasLogo = body.dataBase64 !== undefined
        const hasColours = body.accent !== undefined || body.buttonStyle !== undefined
        if (!hasLogo && !hasColours) throw denied('Choose a logo or colour.', 400)
        if ((hasLogo && !management.logoAllowed) || (hasColours && !management.coloursAllowed)) throw denied('Branding access is required.')
        if (body.accent !== undefined && !/^(yellow|blue|green|red|purple|#[0-9a-f]{6})$/.test(body.accent)) throw denied('Choose a supported colour.', 400)
        if (body.buttonStyle !== undefined && !['solid', 'gradient'].includes(body.buttonStyle)) throw denied('Choose a supported button style.', 400)
        let logoUrl = null
        if (hasLogo) {
          const validated = await validateLogo({ buffer: decodeClubLogoBase64(body.dataBase64), declaredMimeType: body.mimeType, fileName: body.fileName })
          const hash = createHash('sha256').update(validated.buffer).digest('hex')
          const path = `teams/${team.id}/logos/${hash}.png`
          const bucket = client.storage.from('club-logos')
          const { error } = await bucket.upload(path, validated.buffer, { contentType: validated.contentType, cacheControl: '31536000', upsert: true })
          if (error) throw denied('The logo could not be stored. Your saved artwork was kept.', 502)
          logoUrl = bucket.getPublicUrl(path).data?.publicUrl
          if (!logoUrl) throw denied('The logo display URL could not be verified.', 502)
          // Never delete content-addressed objects on failure: a concurrent valid save may reference them.
        }
        // SQL repeats current authority, scope and entitlement checks after any upload.
        await rpc('save_first_250_team_branding', { ...scope, logo_value: logoUrl,
          accent_value: body.accent ?? null, button_value: body.buttonStyle ?? null })
      }
      return response(200, await rpc('read_first_250_team_branding_management', scope))
    } catch (error) {
      return response(error.statusCode || 503, { message: error.statusCode ? error.message : 'Team branding is temporarily unavailable.' })
    }
  }
}
