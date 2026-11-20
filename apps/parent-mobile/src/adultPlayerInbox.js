import AsyncStorage from '@react-native-async-storage/async-storage'
import { getOwnAdultPlayerInvitations } from '../../../src/lib/adult-player-invitations.js'
import { supabase } from '../../mobile-core/src/supabase'

function preferenceKey(userId, linkId) {
  return `football-player:player-notifications:${JSON.stringify([userId, linkId])}`
}

async function loadPreference(key) {
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(key) || '{}')
    return new Map(Object.entries(saved))
  } catch {
    return new Map()
  }
}

export async function loadAdultPlayerInbox(userId, linkId, { calendar, matches, chat }) {
  const [invitations, rooms, preferences] = await Promise.all([
    calendar || matches ? getOwnAdultPlayerInvitations(supabase) : [],
    chat ? supabase.rpc('get_own_adult_player_chat_rooms') : { data: [] },
    loadPreference(preferenceKey(userId, linkId)),
  ])
  if (rooms.error) throw rooms.error

  const items = invitations
    .filter(invitation => invitation.canRespond && (invitation.eventType === 'match_day' ? matches : calendar))
    .map(invitation => ({
      id: invitation.invitationId,
      title: invitation.eventTitle,
      body: 'Your team has invited you to this event.',
      intentType: 'player_invitation',
      isRead: invitation.responseState !== 'awaiting_response',
      data: { app: 'parent', route: 'invites', invitationId: invitation.invitationId },
    }))

  for (const room of rooms.data || []) {
    if (!room.id || !room.latest_message_at || room.notifications_muted || Number(room.unread_count) < 1) continue
    items.push({
      id: `chat:${room.id}:${room.latest_message_at}`,
      title: room.title || room.team_name || 'Team Chat',
      body: 'You have unread messages.',
      intentType: 'parent_chat',
      createdAt: room.latest_message_at,
      data: { app: 'parent', route: 'chat', roomId: room.id },
    })
  }

  return items.filter(item => preferences.get(item.id) !== 'cleared').map(item => ({
    ...item,
    audience: 'player',
    notificationIds: [item.id],
    isRead: Boolean(item.isRead || preferences.get(item.id) === 'read'),
  }))
}

let pendingPreference = Promise.resolve()

export function updateAdultPlayerInbox(userId, linkId, notificationIds, action) {
  const key = preferenceKey(userId, linkId)
  const nextWrite = pendingPreference.catch(() => {}).then(async () => {
    const previous = await loadPreference(key)
    for (const id of notificationIds) {
      const cleared = action === 'clear_general' || previous.get(id) === 'cleared'
      previous.delete(id)
      previous.set(id, cleared ? 'cleared' : 'read')
    }
    await AsyncStorage.setItem(key, JSON.stringify(Object.fromEntries([...previous].slice(-300))))
    return { notificationIds, readAt: new Date().toISOString() }
  })
  pendingPreference = nextWrite
  return nextWrite
}
