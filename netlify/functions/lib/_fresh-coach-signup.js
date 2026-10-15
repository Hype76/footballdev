import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { assertPasswordPolicy } from '../../../src/lib/password-policy.js'
import { buildEmailLogoMarkup } from '../../../src/lib/email-branding.js'
import { createFromAddress, sendEmail } from './_email-provider.js'

const uuid = value => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(value || ''))
const normal = value => String(value || '').trim()
const emailValue = value => normal(value).toLowerCase()
const json = (statusCode, value) => ({ statusCode, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(value) })
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
export const freshSignupDigest = (secret, purpose, value) => createHmac('sha256', secret).update(`${purpose}\0${value}`).digest('hex')
const invalidCode = () => Object.assign(new Error('That code could not be verified. Request another code and use the newest email.'), { statusCode: 400 })
const checked = result => { if (result.error) throw result.error; return result.data }

function trustedIp(event, context) {
  return normal(context?.ip || context?.clientIp) || (process.env.NETLIFY === 'true' ? normal(event.headers?.['x-nf-client-connection-ip']) : '') || 'unknown'
}

export function buildFreshSignupEmail({ code, teamName }) {
  return `${buildEmailLogoMarkup({ altText: 'Football Player', origin: 'https://footballplayer.online' })}<h1>Let's get you started again</h1><p>Enter this code in Football Player to create your new team, <strong>${escape(teamName)}</strong>:</p><p style="font-size:32px;font-weight:bold;letter-spacing:5px">${escape(code)}</p><p>This code expires in 10 minutes. Your old workspace stays deleted, and previous introductory offers cannot be used again.</p><p>If you did not request a fresh signup, you can ignore this email. Your password and access have not been changed.</p>`
}

export function createFreshSignupHandler({ createAdminClient, triggerWorker, secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY, newId = randomUUID } = {}) {
  return async (event = {}, context = {}) => {
    if (event.httpMethod !== 'POST') return json(405, { success: false, message: 'Method not allowed.' })
    let body
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { success: false, message: 'Please check your signup details.' }) }
    if (!body || Array.isArray(body) || typeof body !== 'object' || String(event.body || '').length > 6000) return json(400, { success: false, message: 'Please check your signup details.' })
    const key = normal(secret())
    if (!key) return json(503, { success: false, message: 'Signup is temporarily unavailable. Please try again shortly.' })
    try {
      const db = createAdminClient(event)
      if (body.action === 'request') {
        if (Object.keys(body).some(name => !['action', 'email', 'name', 'teamName'].includes(name))) throw new Error('Please check your signup details.')
        const email = emailValue(body.email), name = normal(body.name), team = normal(body.teamName)
        if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254 || !name || name.length > 100 || !team || team.length > 120) throw new Error('Please enter your name, email and team name.')
        const id = newId()
        const budget = checked(await db.rpc('consume_password_recovery_rate_limit', {
          p_email_digest: freshSignupDigest(key, 'fresh-signup-email', email), p_ip_digest: freshSignupDigest(key, 'fresh-signup-ip', trustedIp(event, context)),
          p_email_limit: 3, p_ip_limit: 20, p_window_seconds: 900,
        }))
        if (budget?.allowed === true) {
          checked(await db.rpc('queue_fresh_coach_signup', { p_id: id, p_email: email, p_name: name, p_team: team }))
          await triggerWorker(id, freshSignupDigest(key, 'fresh-signup-worker', id))
        }
        return json(200, { success: true, requestId: id, message: 'If a fresh signup is available for this email, a verification code has been requested. Check your newest email.' })
      }
      if (body.action !== 'verify' || Object.keys(body).some(name => !['action', 'requestId', 'code', 'password'].includes(name)) || !uuid(body.requestId) || !/^\d{6,10}$/.test(normal(body.code))) throw invalidCode()
      assertPasswordPolicy(body.password)
      const budget = checked(await db.rpc('consume_password_recovery_rate_limit', {
        p_email_digest: freshSignupDigest(key, 'fresh-signup-verify', body.requestId), p_ip_digest: freshSignupDigest(key, 'fresh-signup-verify-ip', trustedIp(event, context)),
        p_email_limit: 5, p_ip_limit: 30, p_window_seconds: 900,
      }))
      if (budget?.allowed !== true) throw invalidCode()
      const request = checked(await db.rpc('claim_fresh_coach_signup_code', { p_id: body.requestId, p_digest: freshSignupDigest(key, 'fresh-signup-code', `${body.requestId}:${normal(body.code)}`) }))
      if (!request) throw invalidCode()
      // The one-use purpose-bound email code proves ownership, without creating an Auth session.
      const candidate = checked(await db.rpc('get_fresh_coach_signup_candidate', { p_email: request.email }))
      if (candidate?.id !== request.user_id || candidate?.email !== request.email) throw invalidCode()
      const changed = await db.auth.admin.updateUserById(request.user_id, { password: body.password, user_metadata: {
        name: request.display_name, display_name: request.display_name, club_name: request.team_name, account_type: 'coach', verification_mode: 'app_code',
        signup_plan_key: 'matchday', club_signup_intent: null, tester_access_code: null, test_signup_plan_key: null,
      } })
      if (changed.error) throw new Error('Your email was verified, but the new password could not be saved. Request another code and try again.')
      checked(await db.rpc('complete_fresh_coach_signup', { p_id: body.requestId, p_actor: request.user_id }))
      return json(200, { success: true })
    } catch (error) {
      // Do not log email addresses, codes, passwords or returned sessions.
      return json(error.statusCode || 400, { success: false, message: error.statusCode === 400 || /^(Please |Password |Choose |Your email|Your team)/.test(error.message || '') ? error.message : 'We could not finish that signup. Request a new code, or sign in if your team was already created.' })
    }
  }
}

export function createFreshSignupWorker({ createAdminClient, deliver = sendEmail, secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY, newCode = () => randomInt(0, 100_000_000).toString().padStart(8, '0') } = {}) {
  return async (event = {}) => {
    let id
    try { id = JSON.parse(event.body || '{}').requestId } catch { return }
    const key = normal(secret())
    const provided = Buffer.from(String(event.headers?.authorization || ''))
    const expected = Buffer.from(`Bearer ${freshSignupDigest(key || 'unavailable', 'fresh-signup-worker', id)}`)
    if (!key || !uuid(id) || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return
    const db = createAdminClient(event)
    try {
      const request = checked(await db.rpc('claim_fresh_coach_signup_delivery', { p_id: id }))
      if (!request) return
      const candidate = checked(await db.rpc('get_fresh_coach_signup_candidate', { p_email: request.email }))
      if (!candidate) { checked(await db.rpc('mark_fresh_coach_signup_delivery', { p_id: id, p_state: 'ineligible' })); return }
      const code = newCode()
      if (!/^\d{8}$/.test(code)) throw new Error('OTP generation failed')
      const saved = checked(await db.rpc('mark_fresh_coach_signup_delivery', { p_id: id, p_state: 'sent', p_actor: candidate.id, p_digest: freshSignupDigest(key, 'fresh-signup-code', `${id}:${code}`) }))
      if (!saved) return
      await deliver({ from: createFromAddress('Football Player'), to: [request.email], subject: 'Your Football Player fresh signup code', emailAppRole: 'coach', html: buildFreshSignupEmail({ code, teamName: request.team_name }) }, { idempotencyKey: `fresh-coach-signup-${id}`, context: { emailType: 'fresh_coach_signup' } })
    } catch {
      await db.rpc('mark_fresh_coach_signup_delivery', { p_id: id, p_state: 'failed' })
    }
  }
}
