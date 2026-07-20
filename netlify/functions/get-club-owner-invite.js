import { createSupabaseAdminClient } from './lib/_supabase.js'
import { digestInvitationValue, normalizeInvitationValue } from './lib/_club-owner-invitation.js'
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
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient(event)
    const body = JSON.parse(event.body || '{}')
    const token = normalizeInvitationValue(body.token)

    if (!token) {
      return failureResponse(400, 'Club invite could not be opened.')
    }

    const { data, error } = await supabaseAdmin
      .from('club_owner_invites')
      .select('id, club_id, invited_email, billing_mode, plan_key, status, expires_at, accepted_at, revoked_at, replaced_at, clubs:club_id (name, logo_url, contact_email)')
      .eq('token_digest', digestInvitationValue(token))
      .maybeSingle()

    if (error || !data) {
      return failureResponse(404, 'Club invite could not be opened.')
    }

    if (data.accepted_at || data.status === 'accepted') {
      return failureResponse(409, 'Club invite is no longer available.')
    }

    if (data.status !== 'pending' || data.revoked_at || data.replaced_at) {
      return failureResponse(410, 'Club invite is no longer available.')
    }

    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return failureResponse(410, 'Club invite is no longer available.')
    }

    const club = Array.isArray(data.clubs) ? data.clubs[0] : data.clubs
    const planKey = normalizePlanKey(data.plan_key, { mapMissingToFree: true })

    return jsonResponse(200, {
      success: true,
      invite: {
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
