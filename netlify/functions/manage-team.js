import { createLimitUpgradeMessage, getPlanLimit, PLAN_KEYS } from '../../src/lib/plans.js'
import { supabaseAdmin } from './_supabase.js'
import { getAuthenticatedPlanProfile } from './_plan-gate.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeTeamRow(row) {
  return {
    id: row?.id ?? '',
    clubId: row?.club_id ?? '',
    name: normalizeText(row?.name),
    requireApproval: Boolean(row?.require_approval ?? true),
    approvalPrompt: normalizeText(row?.approval_prompt),
    approvalPrimaryLabel: normalizeText(row?.approval_primary_label),
    approvalSecondaryLabel: normalizeText(row?.approval_secondary_label),
    logoUrl: normalizeText(row?.logo_url),
    themeMode: normalizeText(row?.theme_mode || 'light'),
    themeAccent: normalizeText(row?.theme_accent || 'green'),
    themeButtonStyle: normalizeText(row?.theme_button_style || 'solid'),
  }
}

function isLargeOrComped(profile) {
  return profile?.planKey === PLAN_KEYS.largeClub || Boolean(profile?.isPlanComped)
}

function assertClubAdmin(profile) {
  if (profile.role === 'super_admin') {
    return
  }

  if (profile.role !== 'admin' || Number(profile.roleRank ?? 0) < 90) {
    throw Object.assign(new Error('Only club admins can manage club teams.'), { statusCode: 403 })
  }
}

async function getTeamCount(clubId) {
  const { count, error } = await supabaseAdmin
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)

  if (error) {
    throw error
  }

  return Number(count ?? 0)
}

async function assertCanCreateTeam(profile) {
  if (isLargeOrComped(profile)) {
    return
  }

  const currentTeamCount = await getTeamCount(profile.clubId)
  const teamLimit = getPlanLimit(profile, 'teams')
  const planIsActive = profile.planStatus === 'active' || profile.planStatus === 'trialing'

  if (!planIsActive) {
    if (currentTeamCount === 0) {
      return
    }

    throw Object.assign(new Error('Your billing plan needs to be active before adding another team.'), { statusCode: 403 })
  }

  if (teamLimit !== null && teamLimit !== undefined && currentTeamCount >= Number(teamLimit)) {
    throw Object.assign(new Error(createLimitUpgradeMessage(profile, 'teams', 'Teams')), { statusCode: 403 })
  }
}

async function getTeamForClub(teamId, clubId) {
  const normalizedTeamId = normalizeText(teamId)

  if (!normalizedTeamId) {
    throw Object.assign(new Error('Team details are required.'), { statusCode: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('teams')
    .select('*')
    .eq('id', normalizedTeamId)
    .eq('club_id', clubId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data) {
    throw Object.assign(new Error('This team is not linked to your club.'), { statusCode: 404 })
  }

  return data
}

async function createTeam({ name, profile }) {
  const teamName = normalizeText(name)

  if (!teamName) {
    throw Object.assign(new Error('Team name is required.'), { statusCode: 400 })
  }

  await assertCanCreateTeam(profile)

  const { data, error } = await supabaseAdmin
    .from('teams')
    .insert({
      club_id: profile.clubId,
      name: teamName,
      created_by: profile.id,
      created_by_email: profile.email,
      created_by_name: profile.name || profile.email,
      updated_by: profile.id,
      updated_by_email: profile.email,
      updated_by_name: profile.name || profile.email,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw Object.assign(new Error('A team with this name already exists.'), { statusCode: 409 })
    }

    throw error
  }

  return normalizeTeamRow(data)
}

async function updateTeam({ name, profile, teamId }) {
  const currentTeam = await getTeamForClub(teamId, profile.clubId)
  const teamName = normalizeText(name)

  if (!teamName) {
    throw Object.assign(new Error('Team name is required.'), { statusCode: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('teams')
    .update({
      name: teamName,
      updated_by: profile.id,
      updated_by_email: profile.email,
      updated_by_name: profile.name || profile.email,
    })
    .eq('id', currentTeam.id)
    .eq('club_id', profile.clubId)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw Object.assign(new Error('A team with this name already exists.'), { statusCode: 409 })
    }

    throw error
  }

  return normalizeTeamRow(data)
}

async function deleteTeam({ profile, teamId }) {
  const currentTeam = await getTeamForClub(teamId, profile.clubId)

  const { error } = await supabaseAdmin
    .from('teams')
    .delete()
    .eq('id', currentTeam.id)
    .eq('club_id', profile.clubId)

  if (error) {
    throw error
  }

  return normalizeTeamRow(currentTeam)
}

function normalizeInviteAssignment(invite) {
  return {
    id: `invite:${invite.id}`,
    team_id: invite.team_id,
    user_id: `invite:${invite.id}`,
    created_at: invite.created_at,
  }
}

async function replaceStaffAssignments({ profile, teamId, userIds, inviteIds = [] }) {
  const currentTeam = await getTeamForClub(teamId, profile.clubId)
  const normalizedUserIds = [...new Set((Array.isArray(userIds) ? userIds : [])
    .map((userId) => normalizeText(userId))
    .filter(Boolean))]
  const normalizedInviteIds = [...new Set((Array.isArray(inviteIds) ? inviteIds : [])
    .map((inviteId) => normalizeText(inviteId).replace(/^invite:/, ''))
    .filter(Boolean))]

  if (normalizedUserIds.length > 0) {
    const { data: userRows, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, club_id, role')
      .in('id', normalizedUserIds)

    if (usersError) {
      throw usersError
    }

    const allowedUserIds = new Set(
      (userRows ?? [])
        .filter((row) => String(row.club_id ?? '') === String(profile.clubId) && !['admin', 'super_admin'].includes(String(row.role ?? '')))
        .map((row) => String(row.id ?? '')),
    )
    const invalidUserIds = normalizedUserIds.filter((userId) => !allowedUserIds.has(userId))

    if (invalidUserIds.length > 0) {
      throw Object.assign(new Error('One or more selected staff members cannot be assigned to a team.'), { statusCode: 403 })
    }
  }

  if (normalizedInviteIds.length > 0) {
    const { data: inviteRows, error: invitesError } = await supabaseAdmin
      .from('club_user_invites')
      .select('id, club_id, accepted_at')
      .eq('club_id', profile.clubId)
      .is('accepted_at', null)
      .in('id', normalizedInviteIds)

    if (invitesError) {
      throw invitesError
    }

    const allowedInviteIds = new Set((inviteRows ?? []).map((row) => String(row.id ?? '')))
    const invalidInviteIds = normalizedInviteIds.filter((inviteId) => !allowedInviteIds.has(inviteId))

    if (invalidInviteIds.length > 0) {
      throw Object.assign(new Error('One or more selected pending invites do not belong to this club.'), { statusCode: 403 })
    }
  }

  const { error: deleteError } = await supabaseAdmin
    .from('team_staff')
    .delete()
    .eq('team_id', currentTeam.id)

  if (deleteError) {
    throw deleteError
  }

  const { error: clearPendingError } = await supabaseAdmin
    .from('club_user_invites')
    .update({ team_id: null })
    .eq('club_id', profile.clubId)
    .eq('team_id', currentTeam.id)
    .is('accepted_at', null)

  if (clearPendingError) {
    throw clearPendingError
  }

  let pendingAssignments = []

  if (normalizedInviteIds.length > 0) {
    const { data: updatedInvites, error: updateInvitesError } = await supabaseAdmin
      .from('club_user_invites')
      .update({ team_id: currentTeam.id })
      .eq('club_id', profile.clubId)
      .is('accepted_at', null)
      .in('id', normalizedInviteIds)
      .select('id, team_id, created_at')

    if (updateInvitesError) {
      throw updateInvitesError
    }

    pendingAssignments = (updatedInvites ?? []).map(normalizeInviteAssignment)
  }

  if (normalizedUserIds.length === 0) {
    return pendingAssignments
  }

  const { data, error } = await supabaseAdmin
    .from('team_staff')
    .insert(normalizedUserIds.map((userId) => ({ team_id: currentTeam.id, user_id: userId })))
    .select('*')

  if (error) {
    throw error
  }

  return [...(data ?? []), ...pendingAssignments]
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method Not Allowed' })
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const clubId = normalizeText(body.clubId)
    const action = normalizeText(body.action)

    if (!clubId) {
      return jsonResponse(400, { success: false, message: 'Club details are required.' })
    }

    const profile = await getAuthenticatedPlanProfile(event, { clubId })
    assertClubAdmin(profile)

    let team = null

    if (action === 'create') {
      team = await createTeam({ name: body.name, profile })
    } else if (action === 'update') {
      team = await updateTeam({ name: body.name, profile, teamId: body.teamId })
    } else if (action === 'delete') {
      team = await deleteTeam({ profile, teamId: body.teamId })
    } else if (action === 'replace-staff') {
      const assignments = await replaceStaffAssignments({ profile, teamId: body.teamId, userIds: body.userIds, inviteIds: body.inviteIds })
      return jsonResponse(200, { success: true, assignments })
    } else {
      return jsonResponse(400, { success: false, message: 'Team action is required.' })
    }

    return jsonResponse(200, { success: true, team })
  } catch (error) {
    console.error('Manage team failed', error)
    return jsonResponse(error.statusCode || 500, {
      success: false,
      message: error.message || 'Team could not be managed.',
    })
  }
}
