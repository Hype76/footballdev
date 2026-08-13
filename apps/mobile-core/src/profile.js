import { supabase } from './supabase'
import { getSelectedParentLink } from './parentLinks'
import { applyCoachContext, normalizeCoachContext, resolveCoachStaffContext } from './coachContextCore'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function isPastDate(value) {
  if (!value) {
    return false
  }

  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

function getRelatedRow(row, key) {
  const value = row?.[key]
  return Array.isArray(value) ? value[0] : value
}

export function isPlanAccessActive(profile) {
  if (!profile) {
    return false
  }

  if (profile.role === 'parent_portal' || profile.role === 'super_admin') {
    return true
  }

  if (profile.testerAccessExpired) {
    return false
  }

  return profile.isPlanComped || ['active', 'trialing'].includes(profile.planStatus)
}

function normalizeStaffProfile(row) {
  const club = getRelatedRow(row, 'clubs')
  const testerAccessExpiresAt = club?.tester_access_expires_at || ''

  return {
    accountStatus: normalizeText(row.status || 'active') || 'active',
    clubId: row.club_id || '',
    clubLogoUrl: normalizeText(club?.logo_url),
    clubName: normalizeText(club?.name || 'Club workspace'),
    clubStatus: normalizeText(club?.status || 'active') || 'active',
    displayName: normalizeText(row.display_name || row.name || row.username || row.email),
    email: normalizeEmail(row.email),
    hasActivePlanAccess: false,
    id: row.id,
    isPlanComped: Boolean(club?.is_plan_comped),
    name: normalizeText(row.name || row.username || row.email),
    planKey: normalizeText(club?.plan_key || 'small_club'),
    planStatus: normalizeText(club?.plan_status || 'active') || 'active',
    role: normalizeText(row.role),
    roleLabel: normalizeText(row.role_label || row.role || 'User'),
    roleRank: Number(row.role_rank || 0),
    teamOptions: [],
    testerAccessExpired: isPastDate(testerAccessExpiresAt),
    testerAccessExpiresAt,
    themeAccent: normalizeText(club?.theme_accent),
    themeButtonStyle: normalizeText(club?.theme_button_style || 'solid'),
  }
}

function getPlanAccessFromClub(club) {
  const testerAccessExpiresAt = normalizeText(club?.tester_access_expires_at)
  return Boolean(club?.is_plan_comped)
    || (!isPastDate(testerAccessExpiresAt) && ['active', 'trialing'].includes(normalizeText(club?.plan_status || 'active')))
}

function getWorkspaceScopeFromPlanKey(value) {
  const planKey = normalizeText(value).toLowerCase()
  if (planKey === 'individual') return 'individual'
  if (planKey === 'single_team') return 'team'
  return 'club'
}

function normalizeMembershipContext(row) {
  const club = getRelatedRow(row, 'clubs')
  const clubId = normalizeText(row.club_id || club?.id)
  const role = normalizeText(row.role)
  if (!clubId || role !== 'admin') return null

  return normalizeCoachContext({
    authorityId: row.id,
    authoritySource: 'user_club_memberships',
    clubAccent: club?.theme_accent,
    clubButtonStyle: club?.theme_button_style,
    clubId,
    clubLogoUrl: club?.logo_url,
    clubName: club?.name,
    clubStatus: club?.status,
    hasActivePlanAccess: getPlanAccessFromClub(club),
    id: `club:${clubId}`,
    planKey: club?.plan_key,
    planStatus: club?.plan_status,
    role,
    roleLabel: row.role_label,
    roleRank: row.role_rank,
    workspaceScope: getWorkspaceScopeFromPlanKey(club?.plan_key),
  })
}

function normalizeAssignmentContext(row) {
  const team = getRelatedRow(row, 'teams')
  const club = getRelatedRow(team, 'clubs')
  const teamId = normalizeText(row.team_id || team?.id)
  const clubId = normalizeText(team?.club_id || club?.id)
  if (!teamId || !clubId) return null

  return normalizeCoachContext({
    archivedAt: team?.archived_at,
    authorityId: row.id,
    authoritySource: 'team_staff',
    clubAccent: club?.theme_accent,
    clubButtonStyle: club?.theme_button_style,
    clubId,
    clubLogoUrl: club?.logo_url,
    clubName: club?.name,
    clubStatus: club?.status,
    hasActivePlanAccess: getPlanAccessFromClub(club),
    id: `team:${teamId}`,
    planKey: club?.plan_key,
    planStatus: club?.plan_status,
    role: row.role_key,
    roleLabel: row.role_label,
    roleRank: row.role_rank,
    teamAccent: team?.theme_accent,
    teamButtonStyle: team?.theme_button_style,
    teamId,
    teamName: team?.name,
    teamStatus: 'active',
    workspaceScope: getWorkspaceScopeFromPlanKey(club?.plan_key),
  })
}

function normalizeAdminTeamContext(row, membership) {
  const club = getRelatedRow(membership, 'clubs')
  const teamId = normalizeText(row.id)
  const clubId = normalizeText(row.club_id || club?.id)
  if (!teamId || !clubId) return null

  return normalizeCoachContext({
    archivedAt: row.archived_at,
    authorityId: membership.id,
    authoritySource: 'user_club_memberships',
    clubAccent: club?.theme_accent,
    clubButtonStyle: club?.theme_button_style,
    clubId,
    clubLogoUrl: club?.logo_url,
    clubName: club?.name,
    clubStatus: club?.status,
    hasActivePlanAccess: getPlanAccessFromClub(club),
    id: `team:${teamId}`,
    planKey: club?.plan_key,
    planStatus: club?.plan_status,
    role: membership.role,
    roleLabel: membership.role_label,
    roleRank: membership.role_rank,
    teamAccent: row.theme_accent,
    teamButtonStyle: row.theme_button_style,
    teamId,
    teamName: row.name,
    teamStatus: 'active',
    workspaceScope: getWorkspaceScopeFromPlanKey(club?.plan_key),
  })
}

async function fetchStaffContexts(authUserId) {
  const [{ data: memberships, error: membershipsError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    supabase
      .from('user_club_memberships')
      .select('id, club_id, role, role_label, role_rank, clubs:club_id (id, name, logo_url, status, plan_key, plan_status, is_plan_comped, tester_access_expires_at, theme_accent, theme_button_style)')
      .eq('auth_user_id', authUserId)
      .order('created_at', { ascending: true }),
    supabase
      .from('team_staff')
      .select('id, team_id, role_key, role_label, role_rank, teams:team_id (id, club_id, name, archived_at, theme_accent, theme_button_style, clubs:club_id (id, name, logo_url, status, plan_key, plan_status, is_plan_comped, tester_access_expires_at, theme_accent, theme_button_style))')
      .eq('user_id', authUserId)
      .order('created_at', { ascending: true }),
  ])

  if (membershipsError) throw membershipsError
  if (assignmentsError) throw assignmentsError

  const membershipRows = Array.isArray(memberships) ? memberships : []
  const contexts = (Array.isArray(assignments) ? assignments : [])
    .map(normalizeAssignmentContext)
    .filter(Boolean)
  const adminMemberships = membershipRows.filter((membership) => normalizeText(membership.role) === 'admin')

  for (const membership of adminMemberships) {
    const clubContext = normalizeMembershipContext(membership)
    if (clubContext) contexts.push(clubContext)
    const { data: teams, error: teamsError } = await supabase
      .from('teams')
      .select('id, club_id, name, archived_at, theme_accent, theme_button_style')
      .eq('club_id', membership.club_id)
      .order('name', { ascending: true })
    if (teamsError) throw teamsError
    contexts.push(...(teams || []).map((team) => normalizeAdminTeamContext(team, membership)).filter(Boolean))
  }

  return contexts.filter((context, index, values) => values.findIndex((candidate) => candidate.id === context.id) === index)
}

function normalizeParentLink(row) {
  const player = getRelatedRow(row, 'players')
  const team = getRelatedRow(row, 'teams')
  const club = getRelatedRow(row, 'clubs')

  return {
    clubId: row.club_id || '',
    clubLogoUrl: normalizeText(club?.logo_url),
    clubName: normalizeText(club?.name || 'Parent Portal'),
    id: row.id,
    linkType: normalizeText(row.link_type || 'parent'),
    playerId: row.player_id || '',
    playerName: normalizeText(player?.player_name || 'Linked player'),
    playerSection: normalizeText(player?.section || ''),
    teamId: row.team_id || '',
    teamName: normalizeText(team?.name || player?.team || ''),
    themeAccent: normalizeText(club?.theme_accent || team?.theme_accent),
    themeButtonStyle: normalizeText(club?.theme_button_style || team?.theme_button_style || 'solid'),
    themeMode: normalizeText(team?.theme_mode),
  }
}

function normalizeParentProfile(authUser, links) {
  const selectedLink = getSelectedParentLink({ parentPortalLinks: links })

  return {
    accountStatus: 'active',
    activeTeamId: selectedLink?.teamId || '',
    activeTeamName: selectedLink?.teamName || '',
    clubId: selectedLink?.clubId || '',
    clubName: selectedLink?.clubName || 'Parent Portal',
    displayName: normalizeText(authUser.user_metadata?.display_name || authUser.user_metadata?.name || authUser.email),
    email: normalizeEmail(authUser.email),
    hasParentAccess: Boolean(selectedLink?.id),
    hasActivePlanAccess: true,
    id: authUser.id,
    name: normalizeText(authUser.user_metadata?.name || authUser.email),
    parentPortalLinks: links,
    planStatus: 'active',
    role: 'parent_portal',
    roleLabel: 'Parent',
    roleRank: 0,
    selectedParentLinkId: selectedLink?.id || '',
    selectedPlayerId: selectedLink?.playerId || '',
    selectedPlayerName: selectedLink?.playerName || '',
  }
}

async function fetchStaffProfile(authUser) {
  const email = normalizeEmail(authUser.email)
  const { data, error } = await supabase
    .from('users')
    .select('id, email, username, name, display_name, role, role_label, role_rank, club_id, status, clubs:club_id (name, logo_url, status, plan_key, plan_status, is_plan_comped, tester_access_expires_at, theme_accent, theme_button_style)')
    .or(`id.eq.${authUser.id},email.eq.${email}`)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (data) {
    const profile = normalizeStaffProfile(data)
    const coachContexts = await fetchStaffContexts(authUser.id)
    const contextResult = resolveCoachStaffContext({
      profile: {
        ...profile,
        coachContexts,
      },
    })

    if (!contextResult.allowed) {
      const error = new Error(contextResult.code)
      error.code = contextResult.code
      throw error
    }

    const profileWithContexts = {
      ...profile,
      coachContexts: contextResult.contexts,
      hasParentAccess: Boolean(authUser.user_metadata?.has_parent_access),
      teamOptions: contextResult.contexts
        .filter((context) => context.teamId)
        .map((context) => ({
          assignmentRole: context.role,
          assignmentRoleLabel: context.roleLabel,
          assignmentRoleRank: context.roleRank,
          id: context.teamId,
          name: context.teamName,
        })),
    }

    return applyCoachContext(profileWithContexts, contextResult.context)
  }

  throw new Error('This login is not linked to a coach account.')
}

async function fetchParentProfile(authUser) {
  const { data, error } = await supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name, logo_url, theme_accent, theme_button_style)')
    .eq('auth_user_id', authUser.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  const links = (data || []).map(normalizeParentLink)

  return normalizeParentProfile(authUser, links)
}

export async function fetchMobileProfile(authUser, appRole) {
  if (!authUser?.id) {
    return null
  }

  if (appRole === 'parent') {
    return fetchParentProfile(authUser)
  }

  return fetchStaffProfile(authUser)
}
