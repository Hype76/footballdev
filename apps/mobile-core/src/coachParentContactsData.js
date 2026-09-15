import { CAPABILITIES } from '../../../src/lib/paywall-access.js'
import { isParentPortalInviteEligiblePlayer, normalizeParentPortalInviteEmail } from '../../../src/lib/parent-portal-invite-actions.js'
import { assertCoachCapability, assertCoachOperationalMutation, assertCoachOperationalRead } from './coachOperationalData'
import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout, joinApiPath } from './http'
import { getAccessToken, supabase } from './supabase'

const LINK_COLUMNS = 'id,player_id,email,status,invite_sent_at,expires_at,link_type'

function scope(query, user, playerId) {
  return query.eq('club_id', user.clubId).eq('team_id', user.activeTeamId).eq('player_id', playerId)
}

export async function getCoachParentLinks(user, playerId) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const { data, error } = await scope(supabase.from('parent_player_links').select(LINK_COLUMNS), user, playerId)
    .eq('link_type', 'parent').neq('status', 'revoked').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function getCurrentPlayer(user, playerId) {
  assertCoachOperationalMutation(user, { requiresTeam: true })
  const { data, error } = await supabase.from('players').select('id,section,status,parent_contacts,parent_email')
    .eq('id', playerId).eq('club_id', user.clubId).eq('team_id', user.activeTeamId).single()
  if (error) throw error
  if (!isParentPortalInviteEligiblePlayer(data)) throw new Error('Parent access can only be managed for active Trial or Squad players.')
  return data
}

export async function sendCoachParentInvite(user, playerId, contact) {
  const player = await getCurrentPlayer(user, playerId)
  assertCoachCapability(user, CAPABILITIES.parentInvitations)
  const email = normalizeParentPortalInviteEmail(contact?.email)
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Add a valid parent email first.')
  const contacts = Array.isArray(player.parent_contacts) && player.parent_contacts.length
    ? player.parent_contacts : [{ email: player.parent_email }]
  if (!contacts.some((row) => normalizeParentPortalInviteEmail(row.email ?? row.parentEmail) === email)) {
    throw new Error('Save this contact on the player before sending an invite.')
  }
  const links = await getCoachParentLinks(user, playerId)
  if (links.some((link) => normalizeParentPortalInviteEmail(link.email) === email && link.status === 'active')) return { alreadyLinked: true }
  let invite = links.find((link) => normalizeParentPortalInviteEmail(link.email) === email && ['pending', 'uninvited'].includes(link.status))
  if (invite?.status === 'uninvited') {
    const { data, error } = await scope(supabase.from('parent_player_links').update({
      status: 'pending', expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      invited_by: user.id, invited_by_name: user.displayName || user.name || user.email,
      updated_at: new Date().toISOString(),
    }), user, playerId).eq('id', invite.id).eq('link_type', 'parent').eq('status', 'uninvited')
      .select(LINK_COLUMNS).single()
    if (error) throw error
    if (!data?.id) throw new Error('Parent invite changed. Refresh the player and try again.')
    invite = data
  }
  if (invite?.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
    const { error } = await scope(supabase.from('parent_player_links').update({ status: 'revoked', updated_at: new Date().toISOString() }), user, playerId)
      .eq('id', invite.id).eq('status', 'pending')
    if (error) throw error
    invite = null
  }
  if (!invite) {
    const { data, error } = await supabase.from('parent_player_links').insert({
      club_id: user.clubId, team_id: user.activeTeamId, player_id: playerId,
      link_type: 'parent', email, status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      invited_by: user.id, invited_by_name: user.displayName || user.name || user.email,
    }).select(LINK_COLUMNS).single()
    if (error) throw error
    invite = data
  }
  const token = await getAccessToken()
  if (!token) throw new Error('Sign in again before sending a Parent invite.')
  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(getMobileRuntimeConfig('coach').apiBaseUrl, '.netlify/functions/send-parent-portal-invite'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteLinkId: invite.id }),
  })
  if (!ok || result.success !== true) throw new Error(result.message || 'Parent invite could not be sent. Please try again.')
  return result
}

export async function revokeCoachParentAccess(user, playerId, linkId) {
  await getCurrentPlayer(user, playerId)
  const { data, error } = await scope(supabase.from('parent_player_links').update({
    status: 'revoked', auth_user_id: null, accepted_at: null, updated_at: new Date().toISOString(),
  }), user, playerId).eq('id', linkId).eq('link_type', 'parent').neq('status', 'revoked').select('id').single()
  if (error) throw error
  if (!data?.id) throw new Error('Parent access could not be removed. Refresh and try again.')
}
