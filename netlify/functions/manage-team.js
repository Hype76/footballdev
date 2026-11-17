import { createLimitUpgradeMessage, getPlanLimit } from '../../src/lib/plans.js'
import { getWorkspaceScope, WORKSPACE_SCOPES } from '../../src/lib/workspace-scope.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { assertPlanFeature, getAuthenticatedPlanProfile } from './lib/_plan-gate.js'

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
    tvPublicAnnouncements: row?.tv_public_announcements !== false,
    tvGoalCelebrations: row?.tv_goal_celebrations !== false,
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

function isComped(profile) {
  return Boolean(profile?.isPlanComped)
}

async function assertWorkspaceTeamAuthority(profile, action, teamId) {
  if (profile.role === 'super_admin') {
    return
  }

  const workspaceScope = getWorkspaceScope(profile)

  if (!workspaceScope.supported) {
    throw Object.assign(new Error('This workspace plan does not permit Team management.'), { statusCode: 403 })
  }

  if (workspaceScope.key === WORKSPACE_SCOPES.club) {
    if (profile.role !== 'admin' || Number(profile.roleRank ?? 0) < 90) {
      throw Object.assign(new Error('Only Club Admins can manage Club teams.'), { statusCode: 403 })
    }

    return
  }

  if (!['update', 'replace-staff'].includes(action)) {
    throw Object.assign(new Error('This workspace owns one Team and cannot create or delete additional Teams.'), { statusCode: 403 })
  }

  const currentTeam = await getTeamForClub(teamId, profile.clubId)
  const { data: assignment, error } = await supabaseAdmin
    .from('team_staff')
    .select('id, role_key, role_rank')
    .eq('team_id', currentTeam.id)
    .eq('user_id', profile.id)
    .eq('role_key', workspaceScope.ownerRole.key)
    .gte('role_rank', workspaceScope.ownerRole.rank)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!assignment?.id) {
    throw Object.assign(new Error(`Only the ${workspaceScope.ownerRole.label} can manage this Team.`), { statusCode: 403 })
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

async function getTeamLimitOverride(clubId) {
  const { data, error } = await supabaseAdmin
    .from('club_team_limit_overrides')
    .select('team_limit_override')
    .eq('club_id', clubId)
    .maybeSingle()

  if (error) {
    throw error
  }

  const override = Number(data?.team_limit_override)
  return Number.isInteger(override) && override > 0 ? override : undefined
}

async function assertCanCreateTeam(profile) {
  if (isComped(profile) && !['matchday', 'team', 'club'].includes(profile.planKey)) {
    return
  }

  const [currentTeamCount, teamLimitOverride] = await Promise.all([
    getTeamCount(profile.clubId),
    getTeamLimitOverride(profile.clubId),
  ])
  const planProfile = teamLimitOverride === undefined
    ? profile
    : {
        ...profile,
        teamLimitOverride,
      }
  const teamLimit = getPlanLimit(planProfile, 'teams')
  const planIsActive = profile.planStatus === 'active' || profile.planStatus === 'trialing'

  if (!planIsActive) {
    if (currentTeamCount === 0) {
      return
    }

    throw Object.assign(new Error('Your billing plan needs to be active before adding another team.'), { statusCode: 403 })
  }

  if (teamLimit !== null && teamLimit !== undefined && currentTeamCount >= Number(teamLimit)) {
    throw Object.assign(new Error(createLimitUpgradeMessage(planProfile, 'teams', 'Teams')), { statusCode: 403 })
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

function teamTvColumns(body, required = false) {
  const { tvPublicAnnouncements, tvGoalCelebrations } = body
  if (!required && tvPublicAnnouncements === undefined && tvGoalCelebrations === undefined) return {}
  if (typeof tvPublicAnnouncements !== 'boolean' || typeof tvGoalCelebrations !== 'boolean') {
    throw Object.assign(new Error('Choose both Matchday TV settings.'), { statusCode: 400 })
  }
  return { tv_public_announcements: tvPublicAnnouncements, tv_goal_celebrations: tvGoalCelebrations }
}

function allowedTeamTvColumns(body, profile, required = false) {
  const columns = teamTvColumns(body, required)
  if (Object.keys(columns).length) assertPlanFeature(profile, 'clubAdministration')
  return columns
}

async function createTeam({ name, profile, tvSettings }) {
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
      ...tvSettings,
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

async function updateTeam({ settings, profile, teamId }) {
  const currentTeam = await getTeamForClub(teamId, profile.clubId)

  const { data, error } = await supabaseAdmin
    .from('teams')
    .update({
      ...settings,
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

async function replaceStaffAssignments({ profile, teamId, userIds, inviteIds = [], removeUserId }) {
  const currentTeam = await getTeamForClub(teamId, profile.clubId)
  const workspaceScope = getWorkspaceScope(profile)
  assertPlanFeature({ ...profile, teamId: currentTeam.id, activeTeamId: currentTeam.id }, 'teamStaffRoles')
  const normalizedUserIds = [...new Set((Array.isArray(userIds) ? userIds : [])
    .map((userId) => normalizeText(userId))
    .filter(Boolean))]
  const normalizedInviteIds = [...new Set((Array.isArray(inviteIds) ? inviteIds : [])
    .map((inviteId) => normalizeText(inviteId).replace(/^invite:/, ''))
    .filter(Boolean))]

  if (workspaceScope.key !== WORKSPACE_SCOPES.club && !normalizedUserIds.includes(profile.id)) {
    throw Object.assign(new Error(`${workspaceScope.ownerRole.label} access cannot be removed from its owned Team.`), { statusCode: 403 })
  }

  const { data: currentRows, error: currentError } = await supabaseAdmin
    .from('team_staff').select('user_id').eq('team_id', currentTeam.id)
  if (currentError) throw currentError

  const currentIds = new Set((currentRows ?? []).map(row => row.user_id))
  const requestedIds = new Set(normalizedUserIds)
  const additions = normalizedUserIds.filter(id => !currentIds.has(id))
  const omitted = [...currentIds].filter(id => !requestedIds.has(id))
  const removals = []
  if (additions.length || omitted.length) {
    const { data: userRows, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, club_id, role')
      .in('id', [...additions, ...omitted])

    if (usersError) {
      throw usersError
    }

    const users = new Map((userRows ?? []).map(row => [row.id, row]))
    const isTeamStaff = (row) => row && !['admin', 'super_admin'].includes(row.role)
    if (additions.some(id => !isTeamStaff(users.get(id)) || users.get(id).club_id !== profile.clubId)) {
      throw Object.assign(new Error('One or more selected Coaches cannot be assigned to a team.'), { statusCode: 403 })
    }
    if (omitted.length) {
      const { data: memberships, error } = await supabaseAdmin.from('user_club_memberships')
        .select('auth_user_id,club_id,role').in('auth_user_id', omitted)
      if (error) throw error
      const membershipByUser = new Map()
      for (const membership of memberships ?? []) {
        const clubs = membershipByUser.get(membership.auth_user_id) ?? new Map()
        clubs.set(membership.club_id, membership)
        membershipByUser.set(membership.auth_user_id, clubs)
      }
      for (const id of omitted) {
        const user = users.get(id)
        const clubs = membershipByUser.get(id)
        const localMembership = clubs?.get(profile.clubId)
        const localProfile = user?.club_id === profile.clubId ? user : null
        if (!isTeamStaff(localMembership ?? localProfile)) continue
        // A selected workspace can change the profile's club and role.
        const sharedAccount = (clubs?.size ?? 0) > 1 || !localProfile
        const explicitClubAdminRemoval = id === removeUserId && ['admin', 'super_admin'].includes(profile.role)
        if (!sharedAccount || explicitClubAdminRemoval) removals.push(id)
      }
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

  if (additions.length) {
    const { error } = await supabaseAdmin.from('team_staff')
      .upsert(additions.map(userId => ({ team_id: currentTeam.id, user_id: userId })), {
        onConflict: 'team_id,user_id', ignoreDuplicates: true,
      })
    if (error) throw error
  }
  if (removals.length) {
    const { error } = await supabaseAdmin.from('team_staff').delete()
      .eq('team_id', currentTeam.id).in('user_id', removals)
    if (error) throw error
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

  const { data, error } = await supabaseAdmin
    .from('team_staff')
    .select('*')
    .eq('team_id', currentTeam.id)

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
    await assertWorkspaceTeamAuthority(profile, action, body.teamId)

    let team = null

    if (action === 'create') {
      team = await createTeam({ name: body.name, profile, tvSettings: allowedTeamTvColumns(body, profile) })
    } else if (action === 'update') {
      const name = normalizeText(body.name)
      if (!name) throw Object.assign(new Error('Team name is required.'), { statusCode: 400 })
      team = await updateTeam({ settings: { name }, profile, teamId: body.teamId })
    } else if (action === 'update-tv') {
      team = await updateTeam({ settings: allowedTeamTvColumns(body, profile, true), profile, teamId: body.teamId })
    } else if (action === 'delete') {
      team = await deleteTeam({ profile, teamId: body.teamId })
    } else if (action === 'replace-staff') {
      const assignments = await replaceStaffAssignments({
        profile, teamId: body.teamId, userIds: body.userIds, inviteIds: body.inviteIds, removeUserId: normalizeText(body.removeUserId),
      })
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
