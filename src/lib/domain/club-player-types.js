import { supabase } from '../supabase-client.js'
import { invalidateMemoryCacheByPrefix } from './cache-store.js'
import { normalizeClubPlayerType } from '../player-participation.js'
export { attachPlayerTypeRules, normalizeClubPlayerType } from '../player-participation.js'

export async function getClubPlayerTypes(clubId) {
  if (!clubId) return []
  const { data, error } = await supabase.from('club_player_types').select('*').eq('club_id', clubId).order('name')
  if (error) throw error
  return (data || []).map(normalizeClubPlayerType)
}

export async function saveClubPlayerType(user, type) {
  if (!user?.clubId || user.role !== 'admin') throw new Error('Club admin access is required.')
  const name = String(type.name || '').trim()
  if (name.length < 2 || name.length > 40) throw new Error('Enter a player type name of 2 to 40 characters.')
  const payload = {
    club_id: user.clubId,
    name,
    can_training: Boolean(type.canTraining),
    can_friendly: Boolean(type.canFriendly),
    can_cup: Boolean(type.canCup),
    can_league: Boolean(type.canLeague),
    chat_group: type.chatGroup || 'none',
  }
  const query = type.id
    ? supabase.from('club_player_types').update({
      name: payload.name,
      can_training: payload.can_training,
      can_friendly: payload.can_friendly,
      can_cup: payload.can_cup,
      can_league: payload.can_league,
      chat_group: payload.chat_group,
    }).eq('id', type.id).eq('club_id', user.clubId)
    : supabase.from('club_player_types').insert(payload)
  const { data, error } = await query.select('*').single()
  if (error) throw error
  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  return normalizeClubPlayerType(data)
}

export async function deleteClubPlayerType(user, type) {
  if (!user?.clubId || user.role !== 'admin' || !type?.id || type.isDefault) {
    throw new Error('Only a club admin can remove a custom player type.')
  }
  const { data, error } = await supabase.from('club_player_types').delete()
    .eq('id', type.id).eq('club_id', user.clubId).eq('is_default', false).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('The player type could not be removed.')
  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
}
