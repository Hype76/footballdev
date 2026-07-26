import {
  getDevelopmentParentRecipientCandidates,
} from '../development-parent-recipient-contract.js'
import { supabase } from '../supabase-client.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export async function getDevelopmentParentEmailRecipientCandidates({
  user,
  player,
  teamId,
} = {}) {
  const clubId = normalizeText(user?.clubId)
  const playerId = normalizeText(player?.id)
  const resolvedTeamId = normalizeText(teamId || player?.teamId)

  if (!clubId || !playerId || !resolvedTeamId || user?.role === 'super_admin') {
    return []
  }

  const { data, error } = await supabase
    .from('parent_player_links')
    .select(
      'id, club_id, team_id, player_id, email, relationship, primary_contact, receives_communications, status',
    )
    .eq('club_id', clubId)
    .eq('team_id', resolvedTeamId)
    .eq('player_id', playerId)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return getDevelopmentParentRecipientCandidates({
    links: data ?? [],
    clubId,
    teamId: resolvedTeamId,
    playerId,
    parentContacts: player?.parentContacts,
  })
}
