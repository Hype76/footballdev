import { createSupabaseAdminClient } from './lib/_supabase.js'
import {
  digestInvitationValue,
  getBearerToken,
  normalizeInvitationValue,
} from './lib/_club-owner-invitation.js'
import { assertPasswordPolicy } from '../../src/lib/password-policy.js'
import { normalizePlanKey } from '../../src/lib/plans.js'
import { getWorkspaceInviteRedirect, getWorkspaceScope } from '../../src/lib/workspace-scope.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
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

function getDisplayName(email, fallback = 'Workspace owner') {
  return String(email ?? '').split('@')[0]?.replace(/[._-]+/g, ' ').trim() || fallback
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
    .select('id, club_id, team_id, invited_email, billing_mode, plan_key, invite_scope, intended_role_key, intended_role_label, intended_role_rank, expires_at, accepted_at, accepted_user_id, revoked_at, replaced_at, status, clubs:club_id (plan_key), teams:team_id (id, club_id)')
    .eq('token_digest', tokenDigest)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('Workspace invite could not be accepted.'), { statusCode: 404 })
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
  const { data, error } = await supabaseAdmin.rpc('accept_workspace_owner_invite_v3', {
    p_token_digest: tokenDigest,
    p_auth_user_id: authUserId,
  })

  if (error || !data?.completed) {
    throw error || new Error('Workspace owner invitation acceptance failed.')
  }

  return data
}

export async function createWorkspaceOwnerAccountResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
} = {}) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed', 'method_not_allowed')
  }

  const contentType = String(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase()

  if (!contentType.startsWith('application/json')) {
    return failureResponse(415, 'Unsupported Media Type', 'unsupported_media_type')
  }

  let createdAuthUserId = ''

  try {
    const body = JSON.parse(event.body || '{}')
    const token = normalizeInvitationValue(body.token)
    const password = String(body.password ?? '')

    if (!token) {
      return failureResponse(400, 'Workspace invite could not be accepted.')
    }

    const tokenDigest = digestInvitationValue(token)
    const invite = await getInvite(supabaseAdmin, tokenDigest)
    const workspaceScope = getWorkspaceScope(invite.plan_key)
    const planKey = normalizePlanKey(invite.plan_key)
    const club = Array.isArray(invite.clubs) ? invite.clubs[0] : invite.clubs
    const team = Array.isArray(invite.teams) ? invite.teams[0] : invite.teams
    const invitedEmail = normalizeEmail(invite.invited_email)
    const provenUser = await proveBearerIdentity(supabaseAdmin, event)

    if (!workspaceScope.supported
      || normalizePlanKey(club?.plan_key) !== planKey
      || workspaceScope.key !== invite.invite_scope
      || workspaceScope.ownerRole.key !== invite.intended_role_key
      || workspaceScope.ownerRole.label !== invite.intended_role_label
      || workspaceScope.ownerRole.rank !== Number(invite.intended_role_rank)
      || (workspaceScope.createInitialTeam
        ? !(team?.id && String(team.id) === String(invite.team_id) && String(team.club_id) === String(invite.club_id))
        : Boolean(invite.team_id))) {
      return failureResponse(403, 'Workspace invite could not be accepted.')
    }

    if (invite.status === 'accepted' && invite.accepted_user_id) {
      if (!provenUser || provenUser.id !== invite.accepted_user_id || normalizeEmail(provenUser.email) !== invitedEmail) {
        return failureResponse(409, `${workspaceScope.errorSubject} is no longer available.`, 'invitation_not_available')
      }

      const accepted = await acceptInviteTransaction(supabaseAdmin, tokenDigest, provenUser.id)
      return jsonResponse(200, {
        success: true,
        idempotent: Boolean(accepted.idempotent),
        email: invitedEmail,
        scope: workspaceScope.key,
        roleLabel: workspaceScope.ownerRole.label,
        billingMode: invite.billing_mode === 'unpaid' ? 'unpaid' : 'paid',
        redirectPath: getWorkspaceInviteRedirect(invite.plan_key, invite.billing_mode),
      })
    }

    if (!isActiveInvite(invite)) {
      return failureResponse(410, `${workspaceScope.errorSubject} is no longer available.`, 'invitation_not_available')
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
        return failureResponse(403, 'Workspace invite could not be accepted.')
      }

      try {
        assertPasswordPolicy(password)
      } catch (error) {
        return failureResponse(400, error.message, 'invalid_password')
      }

      const displayName = getDisplayName(invitedEmail, workspaceScope.ownerRole.label)
      const { data: createdAuthUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email: invitedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          username: displayName,
          name: displayName,
          display_name: displayName,
          account_type: workspaceScope.accountType,
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

        return failureResponse(400, `${workspaceScope.ownerRole.label} account could not be created.`, 'account_creation_failed')
      }

      createdAuthUserId = createdAuthUser?.user?.id || ''
      ownerUserId = createdAuthUserId
    }

    if (!ownerUserId) {
      return failureResponse(400, `${workspaceScope.ownerRole.label} account could not be created.`, 'account_creation_failed')
    }

    const accepted = await acceptInviteTransaction(supabaseAdmin, tokenDigest, ownerUserId)
    createdAuthUserId = ''

    return jsonResponse(200, {
      success: true,
      idempotent: Boolean(accepted.idempotent),
      email: invitedEmail,
      scope: workspaceScope.key,
      roleLabel: workspaceScope.ownerRole.label,
      billingMode: invite.billing_mode === 'unpaid' ? 'unpaid' : 'paid',
      redirectPath: getWorkspaceInviteRedirect(invite.plan_key, invite.billing_mode),
    })
  } catch (error) {
    const isDefinitiveDatabaseRejection = /^[0-9A-Z]{5}$/.test(String(error?.code || ''))

    if (createdAuthUserId && supabaseAdmin && isDefinitiveDatabaseRejection) {
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId)

      if (deleteError) {
        console.error('Club owner account compensation failed', { code: deleteError.code || 'unknown' })
      }
    }

    console.error('Workspace owner invitation acceptance failed', {
      code: error?.code || 'unknown',
      statusCode: error?.statusCode || 500,
    })
    return failureResponse(error?.statusCode || 400, 'Workspace invite could not be accepted.')
  }
}

export async function handler(event) {
  return createWorkspaceOwnerAccountResult(event)
}
