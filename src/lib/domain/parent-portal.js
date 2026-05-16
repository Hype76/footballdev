import { supabase } from '../supabase-client.js'
import { getPlayers } from './players.js'

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeParentLink(row) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players
  const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
  const club = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs

  return {
    id: row.id,
    clubId: row.club_id,
    clubName: String(club?.name ?? '').trim(),
    teamId: row.team_id,
    teamName: String(team?.name ?? player?.team ?? '').trim(),
    playerId: row.player_id,
    playerName: String(player?.player_name ?? '').trim(),
    playerSection: String(player?.section ?? '').trim(),
    parentLinkId: row.parent_link_id ?? '',
    linkType: String(row.link_type ?? 'parent').trim(),
    email: normalizeEmail(row.email),
    authUserId: row.auth_user_id ?? '',
    inviteToken: row.invite_token,
    status: String(row.status ?? 'pending').trim(),
    invitedByName: String(row.invited_by_name ?? '').trim(),
    acceptedAt: row.accepted_at ?? '',
    createdAt: row.created_at ?? '',
  }
}

function buildInviteUrl(token) {
  const origin = globalThis.location?.origin ?? ''
  return `${origin}/parent-invite/${token}`
}

export async function getParentPortalLinks() {
  const { data, error } = await supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name), clubs:club_id (name)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeParentLink)
}

export async function acceptParentPortalInvite(token) {
  const { data, error } = await supabase.rpc('accept_parent_player_link', {
    invite_token_value: token,
  })

  if (error) {
    console.error(error)
    throw error
  }

  const acceptedRow = Array.isArray(data) ? data[0] : data

  if (!acceptedRow?.id) {
    throw new Error('This parent link could not be opened.')
  }

  const { data: linkedRow, error: linkedError } = await supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name), clubs:club_id (name)')
    .eq('id', acceptedRow.id)
    .single()

  if (linkedError) {
    console.error(linkedError)
    throw linkedError
  }

  return normalizeParentLink(linkedRow)
}

export async function getParentLinkingPlayers({ user } = {}) {
  return getPlayers({ user, status: 'active' })
}

export async function getParentLinksForPlayer({ playerId }) {
  if (!playerId) {
    return []
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name), clubs:club_id (name)')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map((row) => ({
    ...normalizeParentLink(row),
    inviteUrl: buildInviteUrl(row.invite_token),
  }))
}

export async function createParentPortalInvites({ user, player, contacts }) {
  if (!user?.clubId || !player?.id) {
    throw new Error('Choose a player before creating parent links.')
  }

  const normalizedContacts = (contacts ?? [])
    .map((contact) => ({
      name: String(contact?.name ?? '').trim(),
      email: normalizeEmail(contact?.email),
    }))
    .filter((contact) => contact.email)

  if (normalizedContacts.length === 0) {
    throw new Error('Choose at least one parent with an email address.')
  }

  const teamId = player.teamId || user.activeTeamId || null
  const emails = normalizedContacts.map((contact) => contact.email)
  const existingQuery = supabase
    .from('parent_player_links')
    .select('email, auth_user_id')
    .eq('team_id', teamId)
    .eq('player_id', player.id)
    .neq('status', 'revoked')
    .in('email', emails)
  const { data: existingRows, error: existingError } = await existingQuery

  if (existingError) {
    console.error(existingError)
    throw existingError
  }

  const existingEmails = new Set((existingRows ?? []).map((row) => normalizeEmail(row.email)))
  const rows = normalizedContacts
    .filter((contact) => !existingEmails.has(contact.email))
    .map((contact) => ({
    club_id: user.clubId,
    team_id: teamId,
    player_id: player.id,
    link_type: 'parent',
    email: contact.email,
    status: 'pending',
    invited_by: user.id,
    invited_by_name: user.displayName || user.username || user.name || user.email,
  }))

  if (rows.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .insert(rows)
    .select('*, players:player_id (player_name, section, team), teams:team_id (name), clubs:club_id (name)')

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map((row) => ({
    ...normalizeParentLink(row),
    inviteUrl: buildInviteUrl(row.invite_token),
  }))
}

export async function createParentPortalInvitesForPlayers({ user, players }) {
  if (!user?.clubId) {
    throw new Error('Team access is required before creating parent links.')
  }

  const inviteBatches = await Promise.all(
    (players ?? []).map((player) => {
      const contacts = Array.isArray(player.parentContacts) && player.parentContacts.length > 0
        ? player.parentContacts
        : [{ name: player.parentName || '', email: player.parentEmail || '' }]

      return createParentPortalInvites({
        user,
        player,
        contacts,
      })
    }),
  )

  return inviteBatches.flat()
}

export async function createFamilyShareLink({ parentLink }) {
  if (!parentLink?.id) {
    throw new Error('Choose a child before creating a family link.')
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .insert({
      club_id: parentLink.clubId,
      team_id: parentLink.teamId || null,
      player_id: parentLink.playerId,
      parent_link_id: parentLink.id,
      link_type: 'family',
      status: 'pending',
    })
    .select('*, players:player_id (player_name, section, team), teams:team_id (name), clubs:club_id (name)')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return {
    ...normalizeParentLink(data),
    inviteUrl: buildInviteUrl(data.invite_token),
  }
}
