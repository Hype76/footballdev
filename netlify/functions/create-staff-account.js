import { createSupabaseAdminClient } from './lib/_supabase.js'
import { assertPasswordPolicy } from '../../src/lib/password-policy.js'

const inviteTokenPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload),
  }
}

function failureResponse(statusCode, message, code) {
  return jsonResponse(statusCode, { success: false, message, ...(code ? { code } : {}) })
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

async function getPendingInvite(client, token) {
  const { data, error } = await client.from('club_user_invites')
    .select('email, expires_at, accepted_at, status, cancelled_at, replaced_at, clubs!inner(status)')
    .eq('invite_token', token)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const club = Array.isArray(data.clubs) ? data.clubs[0] : data.clubs
  if (club?.status !== 'active' || data.status !== 'pending' || data.accepted_at || data.cancelled_at || data.replaced_at) return null
  if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) return null
  return data
}

export function createStaffAccountHandler({ getClient = createSupabaseAdminClient } = {}) {
  return async function handler(event) {
    if (event.httpMethod !== 'POST') return failureResponse(405, 'Method not allowed.')
    let body
    try {
      body = JSON.parse(event.body || '{}')
    } catch {
      return failureResponse(400, 'Invalid request.')
    }
    const token = String(body?.token ?? '').trim()
    if (!inviteTokenPattern.test(token)) return failureResponse(400, 'A valid Coach invite is required.')
    try {
      const client = getClient(event)
      const authorization = event.headers?.authorization || event.headers?.Authorization || ''
      let account
      if (body.action === 'accept' || authorization) {
        const accessToken = /^Bearer (\S+)$/i.exec(authorization)?.[1]
        if (!accessToken) return failureResponse(401, 'Sign in with the email that received this invite.')
        const { data, error } = await client.auth.getUser(accessToken)
        if (error || !data?.user?.id) return failureResponse(401, 'Sign in again to accept Coach access.')
        account = data.user
        if (!account.email_confirmed_at) return failureResponse(403, 'Confirm your email before accepting Coach access.')
      } else {
        if (body.action && body.action !== 'create') return failureResponse(400, 'Invalid invitation action.')
        const invite = await getPendingInvite(client, token)
        if (!invite) return failureResponse(410, 'This Coach invite is unavailable. Ask the club for a new invite.')
        const email = normalizeEmail(invite.email)
        if (!email || email !== normalizeEmail(body.email)) return failureResponse(403, 'This Coach invite is for a different email address.')
        const password = String(body.password ?? '')
        try {
          assertPasswordPolicy(password)
        } catch (error) {
          return failureResponse(400, error.message)
        }
        const name = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim() || 'Coach'
        const { data, error } = await client.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { username: name, name, display_name: name, account_type: 'staff' },
        })
        if (['email_exists', 'user_already_exists'].includes(error?.code)
          || /already registered|already exists/i.test(error?.message || '')) {
          return failureResponse(409, 'This email already has an account. Sign in with your existing password to accept Coach access.', 'existing_account')
        }
        if (error || !data?.user?.id) throw error || new Error('Auth account creation returned no user')
        account = data.user
      }

      const { data, error } = await client.rpc('claim_staff_invitations_v1', { actor_id: account.id, target_token: token })
      if (error?.code === '42501') return failureResponse(403, 'This account cannot accept the Coach invite.')
      if (error?.code === '22023') return failureResponse(410, 'This Coach invite has no active team assignment. Ask the club for a new invite.')
      if (error) throw error
      if (!Array.isArray(data) || !data.length) {
        return failureResponse(403, 'This invite is unavailable for this account. Use the invited email address or ask the club for a new invite.')
      }
      return jsonResponse(200, { success: true, email: normalizeEmail(account.email) })
    } catch (error) {
      console.error('Coach invitation failed', { code: error?.code || error?.name })
      return failureResponse(503, 'Coach access could not be set up. Please try again.')
    }
  }
}

export const handler = createStaffAccountHandler()
