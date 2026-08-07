import { createSupabaseAdminClient } from './lib/_supabase.js'
import { digestInvitationValue, normalizeInvitationValue } from './lib/_club-owner-invitation.js'
import { getPlanName, normalizePlanKey } from '../../src/lib/plans.js'
import { getWorkspaceScope } from '../../src/lib/workspace-scope.js'

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

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function logInviteLookup(reason, details = {}) {
  console.warn('workspace_invite_lookup', JSON.stringify({
    reason,
    status: details.status || '',
    scope: details.scope || '',
    tokenLength: Number(details.tokenLength || 0),
  }))
}

export async function getWorkspaceOwnerInviteResult(event, {
  supabaseAdmin = createSupabaseAdminClient(event),
} = {}) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const token = normalizeInvitationValue(body.token)

    if (!token) {
      logInviteLookup('missing_token')
      return failureResponse(400, 'Workspace invite could not be opened.')
    }

    const { data, error } = await supabaseAdmin
      .from('club_owner_invites')
      .select('id, club_id, team_id, invited_email, billing_mode, plan_key, invite_scope, intended_role_key, intended_role_label, intended_role_rank, status, expires_at, accepted_at, revoked_at, replaced_at, clubs:club_id (name, logo_url, contact_email, plan_key), teams:team_id (id, name, club_id)')
      .eq('token_digest', digestInvitationValue(token))
      .maybeSingle()

    if (error || !data) {
      logInviteLookup(error ? 'database_lookup_failed' : 'token_not_found', { tokenLength: token.length })
      return failureResponse(404, 'Workspace invite could not be opened.')
    }

    const planKey = normalizePlanKey(data.plan_key)
    const workspaceScope = getWorkspaceScope(planKey)
    const club = Array.isArray(data.clubs) ? data.clubs[0] : data.clubs
    const team = Array.isArray(data.teams) ? data.teams[0] : data.teams
    const scopeIsConsistent = workspaceScope.supported
      && normalizePlanKey(club?.plan_key) === planKey
      && workspaceScope.key === data.invite_scope
      && workspaceScope.ownerRole.key === data.intended_role_key
      && workspaceScope.ownerRole.label === data.intended_role_label
      && workspaceScope.ownerRole.rank === Number(data.intended_role_rank)
      && (
        workspaceScope.createInitialTeam
          ? Boolean(team?.id && String(team.id) === String(data.team_id) && String(team.club_id) === String(data.club_id))
          : !data.team_id
      )

    if (!scopeIsConsistent) {
      logInviteLookup('scope_integrity_failed', { scope: data.invite_scope, status: data.status, tokenLength: token.length })
      return failureResponse(404, 'Workspace invite could not be opened.')
    }

    if (data.accepted_at || data.status === 'accepted') {
      logInviteLookup('already_accepted', { scope: workspaceScope.key, status: data.status, tokenLength: token.length })
      return failureResponse(409, `${workspaceScope.errorSubject} is no longer available.`)
    }

    if (data.status !== 'pending' || data.revoked_at || data.replaced_at) {
      logInviteLookup('inactive_invite', { scope: workspaceScope.key, status: data.status, tokenLength: token.length })
      return failureResponse(410, `${workspaceScope.errorSubject} is no longer available.`)
    }

    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      logInviteLookup('expired_invite', { scope: workspaceScope.key, status: data.status, tokenLength: token.length })
      return failureResponse(410, `${workspaceScope.errorSubject} is no longer available.`)
    }

    logInviteLookup('opened', { scope: workspaceScope.key, status: data.status, tokenLength: token.length })

    return jsonResponse(200, {
      success: true,
      invite: {
        invitedEmail: normalizeEmail(data.invited_email),
        billingMode: data.billing_mode === 'unpaid' ? 'unpaid' : 'paid',
        planKey,
        planName: getPlanName(planKey),
        scope: workspaceScope.key,
        inviteType: workspaceScope.inviteType,
        roleKey: workspaceScope.ownerRole.key,
        roleLabel: workspaceScope.ownerRole.label,
        roleRank: workspaceScope.ownerRole.rank,
        teamId: team?.id || '',
        teamName: String(team?.name ?? '').trim(),
        workspaceName: workspaceScope.createInitialTeam
          ? String(team?.name ?? club?.name ?? '').trim()
          : String(club?.name ?? '').trim(),
        setupEyebrow: workspaceScope.setupEyebrow,
        setupTitle: workspaceScope.setupTitle,
        setupDescription: workspaceScope.setupDescription,
        errorSubject: workspaceScope.errorSubject,
        clubName: String(club?.name ?? '').trim(),
        logoUrl: String(club?.logo_url ?? '').trim(),
        contactEmail: normalizeEmail(club?.contact_email),
        expiresAt: data.expires_at ?? '',
      },
    })
  } catch (error) {
    console.error('workspace_invite_lookup_failed', { code: error?.code || 'unknown' })
    return failureResponse(500, 'Workspace invite could not be loaded.')
  }
}

export async function handler(event) {
  return getWorkspaceOwnerInviteResult(event)
}
