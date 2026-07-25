import { randomUUID } from 'node:crypto'
import { buildClubOwnerInviteUrl, digestInvitationValue, generateInvitationValue, getBearerToken } from './lib/_club-owner-invitation.js'
import { createFromAddress, getPublicEmailErrorMessage, sendEmail } from './lib/_email-provider.js'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'

const ACCESS_ROLES = {
  admin: { label: 'Club Admin', rank: 90 },
  head_manager: { label: 'Team Admin', rank: 70 },
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeEmail(value))
}

function maskEmail(value) {
  const email = normalizeEmail(value)
  const [local = '', domain = ''] = email.split('@')

  if (!local || !domain) {
    return ''
  }

  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

function safeName(value) {
  return normalizeText(value).slice(0, 120)
}

function safeHeader(value, fallback = 'Football Player') {
  const cleaned = safeName(value)
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127 && !'<>{}[]"\'`;\\'.includes(character)
    })
    .join('')
    .trim()
  return cleaned || fallback
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getBaseUrl(event) {
  const forwardedHost = normalizeText(event.headers?.['x-forwarded-host'] || event.headers?.host)
  const forwardedProtocol = normalizeText(event.headers?.['x-forwarded-proto']) || 'https'
  return forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : 'https://footballplayer.online'
}

function isReservedNonDeliveryRecipient(email) {
  return normalizeEmail(email).endsWith('@example.invalid')
}

function isSyntheticClubName(name) {
  return /^FP TEST\b/i.test(normalizeText(name))
}

function getProviderMessageId(response) {
  return normalizeText(response?.data?.id || response?.id)
}

function publicError(code) {
  const messages = {
    active_membership_exists: 'This recipient already has the selected access.',
    assignment_exists: 'This assignment already exists.',
    club_not_found: 'The selected club is not available.',
    cross_club_team: 'Every selected team must belong to this club.',
    delivery_state_conflict: 'Invitation delivery state changed. Refresh before trying again.',
    final_administrator: 'This is the final active Club Admin. Add and activate a replacement first.',
    invitation_not_cancellable: 'This invitation can no longer be cancelled.',
    pending_invitation_exists: 'A matching pending invitation already exists.',
    removed_assignment_not_found: 'This removed assignment is no longer available to restore.',
    source_not_replaceable: 'This invitation can no longer be replaced.',
    target_identity_mismatch: 'The existing account could not be safely matched.',
    team_required: 'Select at least one team.',
  }
  return messages[code] || 'The access change could not be completed safely.'
}

async function getPlatformAdmin(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Platform Admin login is required.'), { statusCode: 401 })
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data?.user?.id) {
    throw Object.assign(new Error('Platform Admin login is required.'), { statusCode: 401 })
  }

  const profile = await loadActiveAuthorityProfile(supabaseAdmin, data.user, {
    select: 'id, email, username, name, display_name, role, role_label, role_rank, club_id, status',
  })

  if (profile.role !== 'super_admin') {
    throw Object.assign(new Error('Platform Admin access is required.'), { statusCode: 403 })
  }

  return {
    id: profile.id,
    email: normalizeEmail(profile.email || data.user.email),
    name: safeName(profile.display_name || profile.name || profile.username || data.user.email || 'Platform Admin'),
  }
}

async function findAuthUserByEmail(email) {
  let page = 1

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })

    if (error) {
      throw error
    }

    const match = (data?.users || []).find((user) => normalizeEmail(user.email) === email)

    if (match) {
      return match
    }

    if ((data?.users || []).length < 1000) {
      return null
    }

    page += 1
  }

  throw new Error('Existing account lookup exceeded the supported page limit.')
}

async function getClub(clubId) {
  const { data, error } = await supabaseAdmin
    .from('clubs')
    .select('id, name, status, plan_key')
    .eq('id', clubId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data?.id || normalizeText(data.status || 'active') !== 'active') {
    throw Object.assign(new Error('The selected club is not available.'), { statusCode: 404 })
  }

  return data
}

async function loadClubAccess(clubId) {
  const club = await getClub(clubId)
  const [
    membershipsResult,
    teamsResult,
    teamStaffResult,
    ownerInvitesResult,
    staffInvitesResult,
    inviteTeamsResult,
    removedResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('user_club_memberships')
      .select('id, auth_user_id, email, name, username, role, role_label, role_rank, updated_at')
      .eq('club_id', clubId)
      .order('role_rank', { ascending: false }),
    supabaseAdmin
      .from('teams')
      .select('id, name, status')
      .eq('club_id', clubId)
      .eq('status', 'active')
      .order('name'),
    supabaseAdmin
      .from('team_staff')
      .select('id, team_id, user_id, created_at, teams!inner(club_id, name)')
      .eq('teams.club_id', clubId),
    supabaseAdmin
      .from('club_owner_invites')
      .select('id, invited_email, status, expires_at, accepted_at, invite_sent_at, delivery_status, provider_message_id, created_at, accepted_user_id, replaced_at, cancelled_at')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('club_user_invites')
      .select('id, email, role_key, role_label, role_rank, status, expires_at, accepted_at, invite_sent_at, delivery_status, provider_message_id, created_at, replaced_at, cancelled_at')
      .eq('club_id', clubId)
      .in('role_key', ['admin', 'head_manager'])
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('club_user_invite_teams')
      .select('invite_id, team_id, teams:team_id(name), club_user_invites!inner(club_id)')
      .eq('club_user_invites.club_id', clubId),
    supabaseAdmin
      .from('platform_access_assignment_history')
      .select('id, target_user_id, assignment_type, team_id, role_key, role_label, role_rank, state, removed_at, restored_at, teams:team_id(name)')
      .eq('club_id', clubId)
      .eq('state', 'removed')
      .order('removed_at', { ascending: false }),
  ])

  const firstError = [
    membershipsResult,
    teamsResult,
    teamStaffResult,
    ownerInvitesResult,
    staffInvitesResult,
    inviteTeamsResult,
    removedResult,
  ].find((result) => result.error)?.error

  if (firstError) {
    throw firstError
  }

  const memberships = membershipsResult.data || []
  const teamAssignments = teamStaffResult.data || []
  const inviteTeams = inviteTeamsResult.data || []
  const ownerAcceptedUserIds = new Set(
    (ownerInvitesResult.data || []).filter((invite) => invite.accepted_at && invite.accepted_user_id).map((invite) => invite.accepted_user_id),
  )

  const normalizeMember = (membership) => ({
    id: membership.auth_user_id,
    displayName: safeName(membership.name || membership.username || 'Adult user'),
    maskedEmail: maskEmail(membership.email),
    role: normalizeText(membership.role),
    roleLabel: normalizeText(membership.role_label),
    roleRank: Number(membership.role_rank || 0),
    status: 'active',
    assignedTeams: teamAssignments
      .filter((assignment) => assignment.user_id === membership.auth_user_id)
      .map((assignment) => ({
        assignmentId: assignment.id,
        id: assignment.team_id,
        name: normalizeText(Array.isArray(assignment.teams) ? assignment.teams[0]?.name : assignment.teams?.name),
      })),
  })

  const administrators = memberships.filter((membership) => Number(membership.role_rank) >= 90)
  const ownerMembership = administrators.find((membership) => ownerAcceptedUserIds.has(membership.auth_user_id)) || administrators[0] || null

  const normalizeInvite = (invite, roleKey, emailField, source) => ({
    id: invite.id,
    source,
    maskedEmail: maskEmail(invite[emailField]),
    role: roleKey,
    roleLabel: ACCESS_ROLES[roleKey]?.label || normalizeText(invite.role_label),
    status: invite.status,
    deliveryStatus: invite.delivery_status,
    sentAt: invite.invite_sent_at,
    expiresAt: invite.expires_at,
    acceptedAt: invite.accepted_at,
    replacedAt: invite.replaced_at,
    cancelledAt: invite.cancelled_at,
    providerAccepted: Boolean(invite.provider_message_id && invite.delivery_status === 'provider_accepted'),
    assignedTeams: source === 'staff'
      ? inviteTeams
          .filter((assignment) => assignment.invite_id === invite.id)
          .map((assignment) => ({
            id: assignment.team_id,
            name: normalizeText(Array.isArray(assignment.teams) ? assignment.teams[0]?.name : assignment.teams?.name),
          }))
      : [],
  })

  return {
    club: { id: club.id, name: club.name },
    owner: ownerMembership ? normalizeMember(ownerMembership) : null,
    clubAdmins: administrators
      .filter((membership) => membership.auth_user_id !== ownerMembership?.auth_user_id)
      .map(normalizeMember),
    teamAdmins: memberships.filter((membership) => membership.role === 'head_manager').map(normalizeMember),
    pendingInvitations: [
      ...(ownerInvitesResult.data || []).map((invite) => normalizeInvite(invite, 'admin', 'invited_email', 'owner')),
      ...(staffInvitesResult.data || []).map((invite) => normalizeInvite(invite, invite.role_key, 'email', 'staff')),
    ].filter((invite) => invite.status === 'pending'),
    invitationHistory: [
      ...(ownerInvitesResult.data || []).map((invite) => normalizeInvite(invite, 'admin', 'invited_email', 'owner')),
      ...(staffInvitesResult.data || []).map((invite) => normalizeInvite(invite, invite.role_key, 'email', 'staff')),
    ].filter((invite) => invite.status !== 'pending'),
    removedAccess: (removedResult.data || []).map((item) => ({
      id: item.id,
      targetUserId: item.target_user_id,
      assignmentType: item.assignment_type,
      role: item.role_key,
      roleLabel: item.role_label,
      teamId: item.team_id,
      teamName: normalizeText(Array.isArray(item.teams) ? item.teams[0]?.name : item.teams?.name),
      status: item.state,
      removedAt: item.removed_at,
    })),
    teams: teamsResult.data || [],
  }
}

async function getInvitationTarget({ inviteId, roleKey }) {
  if (roleKey === 'admin') {
    const { data, error } = await supabaseAdmin
      .from('club_owner_invites')
      .select('id, club_id, invited_email, status, accepted_at, revoked_at, replaced_at')
      .eq('id', inviteId)
      .maybeSingle()

    if (error) throw error
    return data ? { ...data, email: data.invited_email } : null
  }

  const { data, error } = await supabaseAdmin
    .from('club_user_invites')
    .select('id, club_id, email, role_key, status, accepted_at, cancelled_at, replaced_at')
    .eq('id', inviteId)
    .maybeSingle()

  if (error) throw error
  return data
}

async function createInvite({ actor, club, email, roleKey, teamIds, sourceInviteId, correlationId }) {
  const role = ACCESS_ROLES[roleKey]
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const ownerToken = roleKey === 'admin' ? generateInvitationValue() : ''
  const staffToken = roleKey === 'head_manager' ? randomUUID() : ''
  const { data, error } = await supabaseAdmin.rpc('platform_create_access_invite_v1', {
    p_actor_id: actor.id,
    p_club_id: club.id,
    p_email: email,
    p_role_key: roleKey,
    p_team_ids: teamIds,
    p_token_digest: ownerToken ? digestInvitationValue(ownerToken) : '',
    p_token_value: staffToken,
    p_source_invite_id: sourceInviteId || null,
    p_expires_at: expiresAt,
    p_correlation_id: correlationId,
  })

  if (error) {
    throw error
  }

  if (!data?.allowed) {
    throw Object.assign(new Error(publicError(data?.code)), { code: data?.code, statusCode: 409 })
  }

  return {
    ...data,
    role,
    token: ownerToken || staffToken,
  }
}

async function recordDelivery({ actor, invite, response, status, errorCode, correlationId }) {
  const providerMessageId = getProviderMessageId(response)
  const { data, error } = await supabaseAdmin.rpc('platform_record_access_invite_delivery_v1', {
    p_actor_id: actor.id,
    p_invite_id: invite.inviteId,
    p_role_key: invite.roleKey,
    p_provider_message_id: providerMessageId,
    p_delivery_status: status,
    p_error_code: errorCode || '',
    p_correlation_id: correlationId,
  })

  if (error) {
    throw error
  }

  return { ...data, providerMessageId }
}

async function claimDelivery({ actor, invite, correlationId }) {
  const { error } = await supabaseAdmin.rpc('platform_claim_access_invite_delivery_v1', {
    p_actor_id: actor.id,
    p_invite_id: invite.inviteId,
    p_role_key: invite.roleKey,
    p_correlation_id: correlationId,
  })

  if (error) {
    throw error
  }
}

async function sendAccessInvite({ actor, club, invite, event, teamNames }) {
  const roleLabel = invite.roleLabel
  const safeClubName = escapeHtml(safeName(club.name))
  const safeRoleLabel = escapeHtml(roleLabel)
  const inviteUrl = invite.roleKey === 'admin'
    ? buildClubOwnerInviteUrl(getBaseUrl(event), invite.token)
    : `${getBaseUrl(event).replace(/\/$/, '')}/staff-invite/${encodeURIComponent(invite.token)}`
  const teamCopy = teamNames.length > 0
    ? `<p>Assigned teams: ${teamNames.map((name) => escapeHtml(safeName(name))).join(', ')}</p>`
    : ''
  const html = `
    <p>You have been invited to join ${safeClubName} as ${safeRoleLabel}.</p>
    ${teamCopy}
    <p><a href="${inviteUrl}" style="display:inline-block;background:#047857;color:#ffffff;padding:12px 16px;border-radius:8px;text-decoration:none;font-weight:700">Accept invitation</a></p>
    <p>This invitation expires in 14 days.</p>
  `

  return sendEmail({
    from: createFromAddress(`${safeHeader(club.name)} via Football Player`),
    to: [invite.recipient],
    subject: `${safeHeader(club.name)} ${safeHeader(roleLabel)} invitation`,
    html,
  }, {
    context: {
      emailType: invite.roleKey === 'admin' ? 'club_owner_invite' : 'staff_invite',
      userRole: 'super_admin',
      actorId: actor.id,
      actorEmail: actor.email,
      clubId: club.id,
      targetEntityType: invite.roleKey === 'admin' ? 'club_owner_invite' : 'club_user_invite',
      targetEntityId: invite.inviteId,
    },
    publicMessage: 'The invitation email could not be sent.',
  })
}

async function handleInviteAction({ actor, body, event, replace }) {
  const roleKey = normalizeText(body.roleKey)
  let clubId = normalizeText(body.clubId)
  let email = normalizeEmail(body.email)
  let sourceInviteId = ''

  if (!ACCESS_ROLES[roleKey]) {
    return json(400, { success: false, message: 'Choose a supported access role.' })
  }

  if (replace) {
    sourceInviteId = normalizeText(body.inviteId)
    const source = await getInvitationTarget({ inviteId: sourceInviteId, roleKey })

    if (!source?.id) {
      return json(404, { success: false, message: 'The invitation could not be found.' })
    }

    clubId = source.club_id
    email = normalizeEmail(source.email)
  }

  if (!isValidEmail(email)) {
    return json(400, { success: false, message: 'Enter a valid recipient email address.' })
  }

  const club = await getClub(clubId)
  const teamIds = roleKey === 'head_manager'
    ? [...new Set((Array.isArray(body.teamIds) ? body.teamIds : []).map(normalizeText).filter(Boolean))]
    : []
  const correlationId = randomUUID()
  const existingAuthUser = await findAuthUserByEmail(email)

  if (!replace && existingAuthUser?.id) {
    const { data, error } = await supabaseAdmin.rpc('platform_assign_existing_access_v1', {
      p_actor_id: actor.id,
      p_club_id: club.id,
      p_target_user_id: existingAuthUser.id,
      p_email: email,
      p_role_key: roleKey,
      p_team_ids: teamIds,
      p_correlation_id: correlationId,
    })

    if (error) {
      throw error
    }

    if (!data?.allowed) {
      return json(409, { success: false, code: data?.code, message: publicError(data?.code) })
    }

    return json(200, {
      success: true,
      result: 'existing_user_assigned',
      roleLabel: ACCESS_ROLES[roleKey].label,
      maskedEmail: maskEmail(email),
      communicationSent: false,
    })
  }

  const invite = await createInvite({
    actor,
    club,
    email,
    roleKey,
    teamIds,
    sourceInviteId,
    correlationId,
  })
  const nonDeliveryRequested = body.deliveryMode === 'reserved_test'

  if (nonDeliveryRequested) {
    if (!isSyntheticClubName(club.name) || !isReservedNonDeliveryRecipient(email)) {
      throw Object.assign(new Error('Reserved non-delivery mode is limited to FP TEST clubs and example.invalid recipients.'), { statusCode: 403 })
    }

    return json(200, {
      success: true,
      result: replace ? 'invitation_replaced_without_delivery' : 'invitation_created_without_delivery',
      inviteId: invite.inviteId,
      roleLabel: invite.roleLabel,
      maskedEmail: maskEmail(email),
      expiresAt: invite.expiresAt,
      deliveryStatus: 'unsent',
      communicationSent: false,
    })
  }

  try {
    await claimDelivery({ actor, invite, correlationId })
    const access = await loadClubAccess(club.id)
    const teamNames = access.teams.filter((team) => teamIds.includes(team.id)).map((team) => team.name)
    const response = await sendAccessInvite({ actor, club, invite, event, teamNames })
    const recorded = await recordDelivery({
      actor,
      invite,
      response,
      status: 'provider_accepted',
      errorCode: '',
      correlationId,
    })

    return json(200, {
      success: true,
      result: replace ? 'invitation_replaced' : 'invitation_created',
      inviteId: invite.inviteId,
      roleLabel: invite.roleLabel,
      maskedEmail: maskEmail(email),
      expiresAt: invite.expiresAt,
      sentAt: new Date().toISOString(),
      deliveryStatus: recorded.deliveryStatus,
      providerAccepted: Boolean(recorded.providerMessageId),
      communicationSent: true,
    })
  } catch (error) {
    await recordDelivery({
      actor,
      invite,
      response: null,
      status: 'failed',
      errorCode: normalizeText(error.code || 'provider_error').slice(0, 120),
      correlationId,
    }).catch((recordError) => {
      console.error('platform_club_access_delivery_failure_record_failed', {
        inviteId: invite.inviteId,
        correlationId,
        code: recordError?.code || 'unknown',
      })
    })

    throw Object.assign(new Error(getPublicEmailErrorMessage(error, 'The invitation email could not be sent.')), {
      statusCode: error.statusCode || 502,
    })
  }
}

async function handleCancel({ actor, body }) {
  const roleKey = normalizeText(body.roleKey)
  const inviteId = normalizeText(body.inviteId)
  const correlationId = randomUUID()
  const { data, error } = await supabaseAdmin.rpc('platform_cancel_access_invite_v1', {
    p_actor_id: actor.id,
    p_invite_id: inviteId,
    p_role_key: roleKey,
    p_correlation_id: correlationId,
  })

  if (error) throw error
  if (!data?.allowed) return json(409, { success: false, code: data?.code, message: publicError(data?.code) })
  return json(200, { success: true, status: 'cancelled', communicationSent: false })
}

async function handleAssignmentChange({ actor, body }) {
  const correlationId = randomUUID()
  const { data, error } = await supabaseAdmin.rpc('platform_change_access_assignment_v1', {
    p_actor_id: actor.id,
    p_club_id: normalizeText(body.clubId),
    p_target_user_id: normalizeText(body.targetUserId),
    p_assignment_type: normalizeText(body.assignmentType),
    p_team_id: normalizeText(body.teamId) || null,
    p_action: normalizeText(body.action),
    p_history_id: normalizeText(body.historyId) || null,
    p_correlation_id: correlationId,
  })

  if (error) throw error
  if (!data?.allowed) return json(409, { success: false, code: data?.code, message: publicError(data?.code) })
  return json(200, { success: true, ...data, communicationSent: false })
}

async function handleOwnershipTransferAttempt({ actor, body }) {
  const { error } = await supabaseAdmin.rpc('platform_record_access_denial_v1', {
    p_actor_id: actor.id,
    p_club_id: normalizeText(body.clubId),
    p_target_user_id: normalizeText(body.targetUserId) || null,
    p_action: 'platform_access_ownership_transfer_attempted',
    p_denial_code: 'ownership_transfer_requires_dedicated_workflow',
    p_correlation_id: randomUUID(),
  })

  if (error) throw error
  return json(409, {
    success: false,
    code: 'ownership_transfer_requires_dedicated_workflow',
    message: 'Ownership transfer requires a separate deliberate workflow and is not available here.',
  })
}

export async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const actor = await getPlatformAdmin(event)

    if (event.httpMethod === 'GET') {
      const clubId = normalizeText(event.queryStringParameters?.clubId)

      if (!clubId) {
        return json(400, { success: false, message: 'Choose a club.' })
      }

      return json(200, { success: true, access: await loadClubAccess(clubId) })
    }

    const body = JSON.parse(event.body || '{}')
    const action = normalizeText(body.action)

    if (action === 'invite') {
      return handleInviteAction({ actor, body, event, replace: false })
    }

    if (action === 'replace_invitation') {
      return handleInviteAction({ actor, body, event, replace: true })
    }

    if (action === 'cancel_invitation') {
      return handleCancel({ actor, body })
    }

    if (action === 'remove' || action === 'restore') {
      return handleAssignmentChange({ actor, body: { ...body, action } })
    }

    if (action === 'transfer_owner') {
      return handleOwnershipTransferAttempt({ actor, body })
    }

    return json(400, { success: false, message: 'Choose a supported access action.' })
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0) || (error?.code === '42501' ? 403 : 500)
    console.error('platform_club_access_failed', {
      code: error?.code || 'unknown',
      statusCode,
    })
    return json(statusCode, {
      success: false,
      code: normalizeText(error?.code),
      message: statusCode >= 500 ? 'Club access could not be updated safely.' : error.message,
    })
  }
}
