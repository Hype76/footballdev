import { createSupabaseAdminClient } from './lib/_supabase.js'
import {
  digestInvitationValue,
  getBearerToken,
  normalizeInvitationValue,
} from './lib/_club-owner-invitation.js'
import { assertPasswordPolicy } from '../../src/lib/password-policy.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  }
}

function failureResponse(statusCode, message, code = 'invitation_not_permitted') {
  return jsonResponse(statusCode, { success: false, code, message })
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function getDisplayName(email) {
  return String(email ?? '').split('@')[0]?.replace(/[._-]+/g, ' ').trim() || 'Club Admin'
}

function isExistingUserError(error) {
  const message = String(error?.message ?? '').toLowerCase()
  return message.includes('already registered') || message.includes('already exists') || message.includes('user already')
}

async function findAuthUserByEmail(supabaseAdmin, email) {
  let page = 1

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })

    if (error) {
      throw error
    }

    const user = (data?.users || []).find((candidate) => normalizeEmail(candidate.email) === email)

    if (user) {
      return user
    }

    if ((data?.users || []).length < 1000) {
      return null
    }

    page += 1
  }

  return null
}

async function getInvite(supabaseAdmin, tokenDigest) {
  const { data, error } = await supabaseAdmin
    .from('club_owner_invites')
    .select('id, club_id, invited_email, billing_mode, plan_key, expires_at, accepted_at, accepted_user_id, revoked_at, replaced_at, status')
    .eq('token_digest', tokenDigest)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('Club invite could not be accepted.'), { statusCode: 404 })
  }

  return data
}

function isActiveInvite(invite) {
  return invite.status === 'pending'
    && !invite.accepted_at
    && !invite.revoked_at
    && !invite.replaced_at
    && (!invite.expires_at || new Date(invite.expires_at).getTime() > Date.now())
}

async function proveBearerIdentity(supabaseAdmin, event) {
  const bearerToken = getBearerToken(event)

  if (!bearerToken) {
    return null
  }

  const { data, error } = await supabaseAdmin.auth.getUser(bearerToken)
  return error ? null : data?.user || null
}

async function acceptInviteTransaction(supabaseAdmin, tokenDigest, authUserId) {
  const { data, error } = await supabaseAdmin.rpc('accept_club_owner_invite_v2', {
    p_token_digest: tokenDigest,
    p_auth_user_id: authUserId,
  })

  if (error || !data?.completed) {
    throw error || new Error('Club owner invitation acceptance failed.')
  }

  return data
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed', 'method_not_allowed')
  }

  const contentType = String(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase()

  if (!contentType.startsWith('application/json')) {
    return failureResponse(415, 'Unsupported Media Type', 'unsupported_media_type')
  }

  let createdAuthUserId = ''
  let supabaseAdmin = null

  try {
    const body = JSON.parse(event.body || '{}')
    const token = normalizeInvitationValue(body.token)
    const password = String(body.password ?? '')

    if (!token) {
      return failureResponse(400, 'Club invite could not be accepted.')
    }

    supabaseAdmin = createSupabaseAdminClient(event)
    const tokenDigest = digestInvitationValue(token)
    const invite = await getInvite(supabaseAdmin, tokenDigest)
    const invitedEmail = normalizeEmail(invite.invited_email)
    const provenUser = await proveBearerIdentity(supabaseAdmin, event)

    if (invite.status === 'accepted' && invite.accepted_user_id) {
      if (!provenUser || provenUser.id !== invite.accepted_user_id || normalizeEmail(provenUser.email) !== invitedEmail) {
        return failureResponse(409, 'Club invite is no longer available.', 'invitation_not_available')
      }

      const accepted = await acceptInviteTransaction(supabaseAdmin, tokenDigest, provenUser.id)
      return jsonResponse(200, {
        success: true,
        idempotent: Boolean(accepted.idempotent),
        email: invitedEmail,
        billingMode: invite.billing_mode === 'unpaid' ? 'unpaid' : 'paid',
        redirectPath: invite.billing_mode === 'paid' ? '/billing' : '/club-settings',
      })
    }

    if (!isActiveInvite(invite)) {
      return failureResponse(410, 'Club invite is no longer available.', 'invitation_not_available')
    }

    const existingAuthUser = await findAuthUserByEmail(supabaseAdmin, invitedEmail)
    let ownerUserId = ''

    if (existingAuthUser?.id) {
      if (!provenUser
        || provenUser.id !== existingAuthUser.id
        || normalizeEmail(provenUser.email) !== invitedEmail) {
        return failureResponse(
          409,
          'Sign in with the invited account to continue.',
          'existing_account_authentication_required',
        )
      }

      ownerUserId = existingAuthUser.id
    } else {
      if (provenUser) {
        return failureResponse(403, 'Club invite could not be accepted.')
      }

      try {
        assertPasswordPolicy(password)
      } catch (error) {
        return failureResponse(400, error.message, 'invalid_password')
      }

      const displayName = getDisplayName(invitedEmail)
      const { data: createdAuthUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email: invitedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          username: displayName,
          name: displayName,
          display_name: displayName,
          account_type: 'club_admin',
        },
      })

      if (createAuthError) {
        if (isExistingUserError(createAuthError)) {
          return failureResponse(
            409,
            'Sign in with the invited account to continue.',
            'existing_account_authentication_required',
          )
        }

        return failureResponse(400, 'Club admin account could not be created.', 'account_creation_failed')
      }

      createdAuthUserId = createdAuthUser?.user?.id || ''
      ownerUserId = createdAuthUserId
    }

    if (!ownerUserId) {
      return failureResponse(400, 'Club admin account could not be created.', 'account_creation_failed')
    }

    const accepted = await acceptInviteTransaction(supabaseAdmin, tokenDigest, ownerUserId)
    createdAuthUserId = ''

    return jsonResponse(200, {
      success: true,
      idempotent: Boolean(accepted.idempotent),
      email: invitedEmail,
      billingMode: invite.billing_mode === 'unpaid' ? 'unpaid' : 'paid',
      redirectPath: invite.billing_mode === 'paid' ? '/billing' : '/club-settings',
    })
  } catch (error) {
    const isDefinitiveDatabaseRejection = /^[0-9A-Z]{5}$/.test(String(error?.code || ''))

    if (createdAuthUserId && supabaseAdmin && isDefinitiveDatabaseRejection) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId)

      if (deleteError) {
        console.error('Club owner account compensation failed', { code: deleteError.code || 'unknown' })
      }
    }

    console.error('Club owner invitation acceptance failed', {
      code: error?.code || 'unknown',
      statusCode: error?.statusCode || 500,
    })
    return failureResponse(error?.statusCode || 400, 'Club invite could not be accepted.')
  }
}
