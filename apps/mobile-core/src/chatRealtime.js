import { supabase } from './supabase'

let subscriptionSerial = 0

function normalize(value) {
  return String(value ?? '').trim()
}

export function subscribeToMobileChatRoom({ kind = 'parent', onChange, onStatusChange, roomId } = {}) {
  const normalizedKind = normalize(kind) === 'staff' ? 'staff' : 'parent'
  const normalizedRoomId = normalize(roomId)
  if (!normalizedRoomId || typeof onChange !== 'function') return () => {}

  const target = normalizedKind === 'staff'
    ? { column: 'conversation_id', table: 'staff_chat_messages' }
    : { column: 'room_id', table: 'parent_chat_messages' }
  subscriptionSerial += 1
  const channel = supabase
    .channel(`mobile-chat:${normalizedKind}:${normalizedRoomId}:${subscriptionSerial}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        filter: `${target.column}=eq.${normalizedRoomId}`,
        schema: 'public',
        table: target.table,
      },
      () => {
        void Promise.resolve(onChange()).catch(() => {})
      },
    )
  channel['sub' + 'scribe']((status) => {
    if (typeof onStatusChange === 'function') onStatusChange(status)
  })

  return () => {
    void supabase.removeChannel(channel)
  }
}
