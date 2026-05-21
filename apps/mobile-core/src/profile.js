import { supabase } from './supabase'
import { getSelectedParentLink } from './parentLinks'

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
  }
}

function normalizeTeamOption(row) {
  const team = getRelatedRow(row, 'teams')

  return {
    id: normalizeText(team?.id || row.team_id || row.id),
    name: normalizeText(team?.name || row.name || 'Team'),
  }
}

async function fetchStaffTeamOptions(profile) {
  if (!profile?.clubId) {
    return []
  }

  const isClubWideRole = profile.roleRank >= 50

  if (isClubWideRole) {
    const { data, error } = await supabase
      .from('teams')
      .select('id, name')
      .eq('club_id', profile.clubId)
      .order('name', { ascending: true })

    if (error) {
      throw error
    }

    return (data || []).map(normalizeTeamOption).filter((team) => team.id)
  }

  const { data, error } = await supabase
    .from('team_staff')
    .select('team_id, teams:team_id (id, name)')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return (data || []).map(normalizeTeamOption).filter((team) => team.id)
}

function normalizeParentLink(row) {
  const player = getRelatedRow(row, 'players')
  const team = getRelatedRow(row, 'teams')
  const club = getRelatedRow(row, 'clubs')

  return {
    clubId: row.club_id || '',
    clubName: normalizeText(club?.name || 'Parent Portal'),
    id: row.id,
    linkType: normalizeText(row.link_type || 'parent'),
    playerId: row.player_id || '',
    playerName: normalizeText(player?.player_name || 'Linked player'),
    playerSection: normalizeText(player?.section || ''),
    teamId: row.team_id || '',
    teamName: normalizeText(team?.name || player?.team || ''),
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
    .select('id, email, username, name, display_name, role, role_label, role_rank, club_id, status, clubs:club_id (name, status, plan_key, plan_status, is_plan_comped, tester_access_expires_at)')
    .or(`id.eq.${authUser.id},email.eq.${email}`)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (data) {
    const profile = normalizeStaffProfile(data)
    const teamOptions = await fetchStaffTeamOptions(profile)
    const selectedTeam = teamOptions.length === 1 ? teamOptions[0] : null

    return {
      ...profile,
      activeTeamId: selectedTeam?.id || '',
      activeTeamName: selectedTeam?.name || '',
      hasActivePlanAccess: isPlanAccessActive(profile),
      teamOptions,
    }
  }

  throw new Error('This login is not linked to a coach account.')
}

async function fetchParentProfile(authUser) {
  const { data, error } = await supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name), clubs:club_id (name)')
    .eq('auth_user_id', authUser.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  const links = (data || []).map(normalizeParentLink)

  if (links.length === 0) {
    throw new Error('This login is not linked to a parent account.')
  }

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
