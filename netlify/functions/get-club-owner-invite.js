import { createSupabaseAdminClient } from './lib/_supabase.js'
import { getPlanName, normalizePlanKey } from '../../src/lib/plans.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient(event)
    const token = String(event.queryStringParameters?.token ?? '').trim()

    if (!token) {
      return failureResponse(400, 'Club invite token is required.')
    }

    const { data, error } = await supabaseAdmin
      .from('club_owner_invites')
      .select('id, club_id, invited_email, billing_mode, plan_key, invite_token, status, expires_at, accepted_at, clubs:club_id (name, logo_url, contact_email)')
      .eq('invite_token', token)
      .maybeSingle()

    if (error || !data) {
      return failureResponse(404, 'This club invite could not be found.')
    }

    if (data.accepted_at || data.status === 'accepted') {
      return failureResponse(409, 'This club invite has already been accepted.')
    }

    if (data.status === 'cancelled') {
      return failureResponse(410, 'This club invite has been cancelled.')
    }

    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return failureResponse(410, 'This club invite has expired. Ask Football Player to send a new invite.')
    }

    const club = Array.isArray(data.clubs) ? data.clubs[0] : data.clubs
    const planKey = normalizePlanKey(data.plan_key, { mapMissingToFree: true })

    return jsonResponse(200, {
      success: true,
      invite: {
        token: data.invite_token,
        invitedEmail: normalizeEmail(data.invited_email),
        billingMode: data.billing_mode === 'unpaid' ? 'unpaid' : 'paid',
        planKey,
        planName: getPlanName(planKey),
        clubName: String(club?.name ?? '').trim(),
        logoUrl: String(club?.logo_url ?? '').trim(),
        contactEmail: normalizeEmail(club?.contact_email),
        expiresAt: data.expires_at ?? '',
      },
    })
  } catch (error) {
    console.error(error)
    return failureResponse(500, 'Club invite could not be loaded.')
  }
}
