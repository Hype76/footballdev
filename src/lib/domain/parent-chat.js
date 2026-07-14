import { supabase } from '../supabase-client.js'
import { blockDemoMutation } from './demo-guards.js'

export const PARENT_CHAT_ROOM_TYPES = Object.freeze({
  parentStaff: 'parent_staff',
  team: 'team',
  matchSquad: 'match_squad',
})

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeChildNames(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(normalizeText).filter(Boolean))]
    : []
}

export function normalizeParentChatRoom(row) {
  return {
    id: row.id ?? '',
    type: normalizeText(row.room_type ?? row.type),
    status: normalizeText(row.status) || 'active',
    title: normalizeText(row.title),
    clubId: row.club_id ?? row.clubId ?? '',
    clubName: normalizeText(row.club_name ?? row.clubName),
    teamId: row.team_id ?? row.teamId ?? '',
    teamName: normalizeText(row.team_name ?? row.teamName),
    playerId: row.player_id ?? row.playerId ?? '',
    playerName: normalizeText(row.player_name ?? row.playerName),
    matchDayId: row.match_day_id ?? row.matchDayId ?? '',
    opponent: normalizeText(row.opponent),
    matchDate: row.match_date ?? row.matchDate ?? '',
    kickoffTime: row.kickoff_time ?? row.kickoffTime ?? '',
    kickoffTimeTbc: Boolean(row.kickoff_time_tbc ?? row.kickoffTimeTbc),
    meetTime: row.meet_time ?? row.meetTime ?? '',
    venueName: normalizeText(row.venue_name ?? row.venueName),
    fixtureStatus: normalizeText(row.fixture_status ?? row.fixtureStatus),
    childNames: normalizeChildNames(row.child_names ?? row.childNames),
    latestMessage: normalizeText(row.latest_message ?? row.latestMessage),
    latestMessageAt: row.latest_message_at ?? row.latestMessageAt ?? '',
    unreadCount: Number(row.unread_count ?? row.unreadCount ?? 0),
    canPost: Boolean(row.can_post ?? row.canPost),
  }
}

export function normalizeParentChatMessage(row) {
  return {
    id: row.id ?? '',
    roomId: row.room_id ?? row.roomId ?? '',
    senderId: row.sender_id ?? row.senderId ?? '',
    senderKind: normalizeText(row.sender_kind ?? row.senderKind),
    senderName: normalizeText(row.sender_name ?? row.senderName) || 'Chat participant',
    senderRole: normalizeText(row.sender_role ?? row.senderRole),
    body: normalizeText(row.body),
    deletedAt: row.deleted_at ?? row.deletedAt ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    canDelete: Boolean(row.can_delete ?? row.canDelete),
  }
}

export async function getParentChatRooms() {
  const { data, error } = await supabase.rpc('get_parent_chat_rooms')

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeParentChatRoom)
}

export async function getParentChatMessages({ roomId } = {}) {
  const normalizedRoomId = normalizeText(roomId)
  if (!normalizedRoomId) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_chat_messages', {
    target_room_id: normalizedRoomId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeParentChatMessage)
}

export async function sendParentChatMessage({ body, roomId, user } = {}) {
  await blockDemoMutation(user)

  const normalizedRoomId = normalizeText(roomId)
  const normalizedBody = normalizeText(body)

  if (!normalizedRoomId) {
    throw new Error('Choose a Chat room before sending a message.')
  }

  if (!normalizedBody) {
    throw new Error('Add a message before sending.')
  }

  if (normalizedBody.length > 2000) {
    throw new Error('Chat messages must be 2000 characters or fewer.')
  }

  const { data, error } = await supabase.rpc('send_parent_chat_message', {
    target_room_id: normalizedRoomId,
    body_value: normalizedBody,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return data ?? ''
}

export async function markParentChatRoomRead({ roomId } = {}) {
  const normalizedRoomId = normalizeText(roomId)
  if (!normalizedRoomId) {
    return ''
  }

  const { data, error } = await supabase.rpc('mark_parent_chat_room_read', {
    target_room_id: normalizedRoomId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return data ?? ''
}

export async function deleteParentChatMessage({ messageId, user } = {}) {
  await blockDemoMutation(user)

  const normalizedMessageId = normalizeText(messageId)
  if (!normalizedMessageId) {
    return
  }

  const { error } = await supabase.rpc('delete_parent_chat_message', {
    target_message_id: normalizedMessageId,
  })

  if (error) {
    console.error(error)
    throw error
  }
}

export function subscribeToParentChatRoom({ onChange, onStatusChange, roomId } = {}) {
  const normalizedRoomId = normalizeText(roomId)
  if (!normalizedRoomId || typeof onChange !== 'function') {
    return () => {}
  }

  const channel = supabase
    .channel(`parent-chat-room:${normalizedRoomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        filter: `room_id=eq.${normalizedRoomId}`,
        schema: 'public',
        table: 'parent_chat_messages',
      },
      () => onChange(),
    )
    .subscribe((status) => {
      if (typeof onStatusChange === 'function') {
        onStatusChange(status)
      }
    })

  return () => {
    void supabase.removeChannel(channel)
  }
}
