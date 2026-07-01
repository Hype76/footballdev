import { supabase } from '../supabase-client.js'
import { getPlayers } from './players.js'
import { buildParentAppUrl } from '../app-origins.js'
import { CAPABILITIES } from '../paywall-access.js'
import { assertClubFeature } from './plan-gates.js'

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
    clubContactEmail: String(club?.contact_email ?? '').trim(),
    teamId: row.team_id,
    teamName: String(team?.name ?? player?.team ?? '').trim(),
    themeMode: String(team?.theme_mode ?? '').trim(),
    themeAccent: String(team?.theme_accent ?? '').trim(),
    themeButtonStyle: String(team?.theme_button_style ?? '').trim(),
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
    inviteSentAt: row.invite_sent_at ?? '',
    expiresAt: row.expires_at ?? '',
    createdAt: row.created_at ?? '',
  }
}

function buildInviteUrl(token) {
  return buildParentAppUrl(`/parent-invite/${token}`)
}

function normalizeParentPortalMessage(row) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}

  return {
    id: row.id,
    playerId: row.player_id ?? '',
    evaluationId: row.evaluation_id ?? '',
    senderName: String(row.sender_name ?? '').trim(),
    senderEmail: normalizeEmail(row.sender_email),
    recipientEmail: String(row.recipient_email ?? '').trim(),
    subject: String(metadata.subject ?? '').trim(),
    body: String(metadata.body ?? '').trim(),
    templateName: String(metadata.templateName ?? '').trim(),
    team: String(metadata.team ?? '').trim(),
    club: String(metadata.club ?? '').trim(),
    hasAttachment: metadata.hasAttachment === true,
    assessmentFields: Array.isArray(metadata.assessmentFields) ? metadata.assessmentFields : [],
    pdfHtml: String(metadata.pdfHtml ?? '').trim(),
    readAt: row.read_at ?? '',
    createdAt: row.created_at ?? '',
  }
}

export async function getParentPortalLinks() {
  const { data, error } = await supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name, contact_email)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeParentLink)
}

export async function updateParentPortalDisplayName({ displayName }) {
  const normalizedDisplayName = String(displayName ?? '').trim()

  if (normalizedDisplayName.length < 2) {
    throw new Error('Enter a display name with at least 2 characters.')
  }

  if (normalizedDisplayName.length > 80) {
    throw new Error('Display name must be 80 characters or fewer.')
  }

  const { data, error } = await supabase.auth.updateUser({
    data: {
      display_name: normalizedDisplayName,
      name: normalizedDisplayName,
      username: normalizedDisplayName,
    },
  })

  if (error) {
    console.error(error)
    throw error
  }

  return {
    displayName: normalizedDisplayName,
    name: normalizedDisplayName,
    username: normalizedDisplayName,
    authEmail: String(data?.user?.email ?? '').trim().toLowerCase(),
  }
}

export async function updateOwnParentPortalLinksEmail({ authUser, email }) {
  const normalizedEmail = normalizeEmail(email)

  if (!authUser?.id || !normalizedEmail) {
    return []
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .update({
      email: normalizedEmail,
      updated_at: new Date().toISOString(),
    })
    .eq('auth_user_id', authUser.id)
    .eq('status', 'active')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name, contact_email)')

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeParentLink)
}

export async function prepareParentPortalEmailChange({ email }) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError) {
    console.error(sessionError)
    throw sessionError
  }

  const accessToken = sessionData?.session?.access_token

  if (!accessToken) {
    throw new Error('Login is required.')
  }

  const response = await fetch('/.netlify/functions/parent-portal-email-change', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ email: normalizedEmail }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Email could not be updated.')
  }

  return {
    action: String(result.action ?? '').trim(),
    email: normalizeEmail(result.email || normalizedEmail),
    message: String(result.message ?? '').trim(),
    transferredLinkIds: Array.isArray(result.transferredLinkIds) ? result.transferredLinkIds : [],
  }
}

export async function getParentPortalMessages({ parentLinkId }) {
  const normalizedParentLinkId = String(parentLinkId ?? '').trim()

  if (!normalizedParentLinkId) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_email_messages', {
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeParentPortalMessage)
}

export async function markParentPortalMessageRead({ parentLinkId, messageId }) {
  const normalizedParentLinkId = String(parentLinkId ?? '').trim()
  const normalizedMessageId = String(messageId ?? '').trim()

  if (!normalizedParentLinkId || !normalizedMessageId) {
    return ''
  }

  const { data, error } = await supabase.rpc('mark_parent_portal_message_read', {
    parent_link_id_value: normalizedParentLinkId,
    communication_log_id_value: normalizedMessageId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return data ?? new Date().toISOString()
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
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name)')
    .eq('id', acceptedRow.id)
    .single()

  if (linkedError) {
    console.error(linkedError)
    throw linkedError
  }

  return normalizeParentLink(linkedRow)
}

export async function getParentLinkingPlayers({ user } = {}) {
  return getPlayers({ user, section: 'Squad', status: 'active' })
}

export async function getParentLinksForPlayer({ playerId, teamId, clubId } = {}) {
  if (!playerId) {
    return []
  }

  let query = supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name)')
    .eq('player_id', playerId)
    .neq('status', 'revoked')
    .order('created_at', { ascending: false })

  if (teamId) {
    query = query.eq('team_id', teamId)
  }

  if (clubId) {
    query = query.eq('club_id', clubId)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map((row) => ({
    ...normalizeParentLink(row),
    inviteUrl: buildInviteUrl(row.invite_token),
  }))
}

export async function revokeParentPortalLink({ linkId }) {
  const normalizedLinkId = String(linkId ?? '').trim()

  if (!normalizedLinkId) {
    throw new Error('Choose a parent link before removing access.')
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .update({
      status: 'revoked',
      auth_user_id: null,
      accepted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', normalizedLinkId)
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name)')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeParentLink(data)
}

export async function getFamilyLinksForParentLink({ parentLinkId }) {
  const normalizedParentLinkId = String(parentLinkId ?? '').trim()

  if (!normalizedParentLinkId) {
    return []
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name)')
    .eq('parent_link_id', normalizedParentLinkId)
    .eq('link_type', 'family')
    .eq('status', 'active')
    .order('accepted_at', { ascending: false })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeParentLink)
}

export async function revokeFamilyPortalLink({ linkId }) {
  const normalizedLinkId = String(linkId ?? '').trim()

  if (!normalizedLinkId) {
    throw new Error('Choose a Friends and Family link before removing access.')
  }

  const { data, error } = await supabase.rpc('revoke_family_player_link', {
    link_id_value: normalizedLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  const revokedRow = Array.isArray(data) ? data[0] : data

  if (!revokedRow?.id) {
    throw new Error('Friends and Family access could not be removed.')
  }

  return normalizeParentLink(revokedRow)
}

export async function createParentPortalInvites({ user, player, contacts, includeSentPending = false }) {
  if (!user?.clubId || !player?.id) {
    throw new Error('Choose a player before creating parent links.')
  }

  if (String(player.section ?? '').trim().toLowerCase() !== 'squad') {
    throw new Error('Family portal links can only be sent for squad players.')
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
  await assertClubFeature({
    user: {
      ...user,
      activeTeamId: teamId,
      teamId,
      playerId: player.id,
    },
    clubId: user.clubId,
    featureName: CAPABILITIES.parentInvitations,
  })

  const emails = normalizedContacts.map((contact) => contact.email)
  const nowIso = new Date().toISOString()

  await supabase
    .from('parent_player_links')
    .update({
      status: 'revoked',
      updated_at: nowIso,
    })
    .eq('team_id', teamId)
    .eq('player_id', player.id)
    .eq('link_type', 'parent')
    .eq('status', 'pending')
    .lt('expires_at', nowIso)

  const existingQuery = supabase
    .from('parent_player_links')
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name)')
    .eq('team_id', teamId)
    .eq('player_id', player.id)
    .neq('status', 'revoked')
    .in('email', emails)
  const { data: existingRows, error: existingError } = await existingQuery

  if (existingError) {
    console.error(existingError)
    throw existingError
  }

  const { data: activeParentRows, error: activeParentError } = await supabase
    .from('parent_player_links')
    .select('email, auth_user_id')
    .eq('club_id', user.clubId)
    .eq('link_type', 'parent')
    .eq('status', 'active')
    .in('email', emails)

  if (activeParentError) {
    console.error(activeParentError)
    throw activeParentError
  }

  const existingActiveParentEmails = new Set(
    (activeParentRows ?? [])
      .filter((row) => row.auth_user_id)
      .map((row) => normalizeEmail(row.email)),
  )
  const existingRowsByEmail = new Map((existingRows ?? []).map((row) => [normalizeEmail(row.email), row]))
  const existingSentOrAcceptedEmails = new Set(
    (existingRows ?? [])
      .filter((row) => row.status === 'active' || row.invite_sent_at)
      .map((row) => normalizeEmail(row.email)),
  )
  const withInviteMetadata = (row) => ({
    ...normalizeParentLink(row),
    existingParentPortalUser: existingActiveParentEmails.has(normalizeEmail(row.email)),
    inviteUrl: buildInviteUrl(row.invite_token),
  })
  const resendRows = normalizedContacts
    .map((contact) => existingRowsByEmail.get(contact.email))
    .filter((row) => row && row.status === 'pending' && (includeSentPending || !row.invite_sent_at))
  const rows = normalizedContacts
    .filter((contact) => !existingRowsByEmail.has(contact.email) && !existingSentOrAcceptedEmails.has(contact.email))
    .map((contact) => ({
      club_id: user.clubId,
      team_id: teamId,
      player_id: player.id,
      link_type: 'parent',
      email: contact.email,
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      invited_by: user.id,
      invited_by_name: user.displayName || user.username || user.name || user.email,
    }))

  if (rows.length === 0) {
    return resendRows.map(withInviteMetadata)
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .insert(rows)
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name)')

  if (error) {
    console.error(error)
    throw error
  }

  return [...resendRows, ...(data ?? [])].map(withInviteMetadata)
}

export async function createParentPortalInvitesForPlayers({ user, players }) {
  if (!user?.clubId) {
    throw new Error('Team access is required before creating parent links.')
  }

  const squadPlayers = (players ?? []).filter(
    (player) => String(player?.section ?? '').trim().toLowerCase() === 'squad',
  )

  const inviteBatches = await Promise.all(
    squadPlayers.map((player) => {
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

  const nowIso = new Date().toISOString()

  await supabase
    .from('parent_player_links')
    .update({
      status: 'revoked',
      updated_at: nowIso,
    })
    .eq('parent_link_id', parentLink.id)
    .eq('link_type', 'family')
    .eq('status', 'pending')

  const { data, error } = await supabase
    .from('parent_player_links')
    .insert({
      club_id: parentLink.clubId,
      team_id: parentLink.teamId || null,
      player_id: parentLink.playerId,
      parent_link_id: parentLink.id,
      link_type: 'family',
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('*, players:player_id (player_name, section, team), teams:team_id (name, theme_mode, theme_accent, theme_button_style), clubs:club_id (name)')
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
