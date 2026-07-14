import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteParentChatMessage,
  getParentChatMessages,
  getParentChatRooms,
  markParentChatRoomRead,
  PARENT_CHAT_ROOM_TYPES,
  sendParentChatMessage,
  subscribeToParentChatRoom,
} from '../../lib/supabase.js'

const groupOrder = [
  { key: PARENT_CHAT_ROOM_TYPES.parentStaff, label: 'Chat with Staff' },
  { key: PARENT_CHAT_ROOM_TYPES.team, label: 'Team Chat' },
  { key: PARENT_CHAT_ROOM_TYPES.matchSquad, label: 'Match Chats' },
]

const panelClass = 'rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10'
const bodyClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white transition hover:bg-[#036c4a] disabled:cursor-not-allowed disabled:opacity-60'

function formatDateTime(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatMatchDate(value) {
  if (!value) {
    return 'Date to be confirmed'
  }

  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) {
    return 'Date to be confirmed'
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
  }).format(date)
}

function formatClock(value, isTbc = false) {
  if (isTbc) {
    return 'To be confirmed'
  }

  return String(value || '').slice(0, 5) || 'Not set'
}

function getRoomHeading(room) {
  if (room.type === PARENT_CHAT_ROOM_TYPES.parentStaff) {
    return 'Chat with Staff'
  }

  if (room.type === PARENT_CHAT_ROOM_TYPES.team) {
    return room.teamName ? `${room.teamName} Team Chat` : 'Team Chat'
  }

  return room.opponent ? `Match Squad: ${room.opponent}` : 'Match Squad Chat'
}

function getRoomContext(room) {
  const children = room.childNames.join(', ')

  if (room.type === PARENT_CHAT_ROOM_TYPES.parentStaff) {
    return [room.playerName || children, room.teamName].filter(Boolean).join(', ')
  }

  if (room.type === PARENT_CHAT_ROOM_TYPES.team) {
    return [room.teamName, children].filter(Boolean).join(', ')
  }

  return [formatMatchDate(room.matchDate), room.teamName, children].filter(Boolean).join(', ')
}

function getRoomEmptyCopy(room) {
  if (room.type === PARENT_CHAT_ROOM_TYPES.parentStaff) {
    return 'No messages yet. Use this room for practical questions about your child and team.'
  }

  if (room.type === PARENT_CHAT_ROOM_TYPES.team) {
    return 'No messages yet. Team updates shared here stay inside footballplayer.online.'
  }

  return 'No messages yet. This room is available only to the selected squad families and authorised team staff.'
}

export function ParentChatWorkspace({ onUnreadCountChange, user, variant = 'parent' }) {
  const [rooms, setRooms] = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [isLoadingRooms, setIsLoadingRooms] = useState(true)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [activeDeleteId, setActiveDeleteId] = useState('')
  const [error, setError] = useState('')
  const [realtimeStatus, setRealtimeStatus] = useState('')
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? null
  const totalUnread = rooms.reduce((total, room) => total + room.unreadCount, 0)
  const groupedRooms = useMemo(() => groupOrder.map((group) => ({
    ...group,
    rooms: rooms.filter((room) => room.type === group.key),
  })), [rooms])

  const loadRooms = useCallback(async ({ keepError = false } = {}) => {
    if (!keepError) {
      setError('')
    }

    try {
      const nextRooms = await getParentChatRooms()
      setRooms(nextRooms)
      setSelectedRoomId((currentRoomId) => {
        if (nextRooms.some((room) => room.id === currentRoomId)) {
          return currentRoomId
        }
        return ''
      })
      return nextRooms
    } catch (loadError) {
      console.error(loadError)
      setRooms([])
      setSelectedRoomId('')
      setError(loadError.message || 'Chat rooms could not be loaded.')
      return []
    } finally {
      setIsLoadingRooms(false)
    }
  }, [])

  const loadMessages = useCallback(async (roomId, { keepError = false } = {}) => {
    if (!roomId) {
      setMessages([])
      return
    }

    setIsLoadingMessages(true)
    if (!keepError) {
      setError('')
    }

    try {
      const nextMessages = await getParentChatMessages({ roomId })
      setMessages(nextMessages)
      await markParentChatRoomRead({ roomId })
      setRooms((currentRooms) => currentRooms.map((room) => (
        room.id === roomId ? { ...room, unreadCount: 0 } : room
      )))
    } catch (loadError) {
      console.error(loadError)
      setMessages([])
      setError(loadError.message || 'This Chat room is no longer available.')
      await loadRooms({ keepError: true })
    } finally {
      setIsLoadingMessages(false)
    }
  }, [loadRooms])

  useEffect(() => {
    void loadRooms()
  }, [loadRooms])

  useEffect(() => {
    if (!selectedRoomId) {
      setMessages([])
      return
    }

    void loadMessages(selectedRoomId)
  }, [loadMessages, selectedRoomId])

  useEffect(() => {
    onUnreadCountChange?.(totalUnread)
  }, [onUnreadCountChange, totalUnread])

  useEffect(() => {
    if (!selectedRoomId) {
      return undefined
    }

    return subscribeToParentChatRoom({
      roomId: selectedRoomId,
      onChange: async () => {
        await loadMessages(selectedRoomId, { keepError: true })
        await loadRooms({ keepError: true })
      },
      onStatusChange: setRealtimeStatus,
    })
  }, [loadMessages, loadRooms, selectedRoomId])

  const handleSend = async (event) => {
    event.preventDefault()
    if (!selectedRoom?.id || !draft.trim() || isSending) {
      return
    }

    setIsSending(true)
    setError('')

    try {
      await sendParentChatMessage({
        body: draft,
        roomId: selectedRoom.id,
        user,
      })
      setDraft('')
      await loadMessages(selectedRoom.id, { keepError: true })
      await loadRooms({ keepError: true })
    } catch (sendError) {
      console.error(sendError)
      setError(sendError.message || 'Your message could not be sent.')
    } finally {
      setIsSending(false)
    }
  }

  const handleDelete = async (message) => {
    if (!message?.id || activeDeleteId) {
      return
    }

    setActiveDeleteId(message.id)
    setError('')

    try {
      await deleteParentChatMessage({ messageId: message.id, user })
      await loadMessages(selectedRoomId, { keepError: true })
      await loadRooms({ keepError: true })
    } catch (deleteError) {
      console.error(deleteError)
      setError(deleteError.message || 'This message could not be removed.')
    } finally {
      setActiveDeleteId('')
    }
  }

  return (
    <section className={`${panelClass} overflow-hidden`} aria-label={variant === 'staff' ? 'Parent Chat workspace' : 'Chat'}>
      <div className="border-b border-[#d7e5dc] bg-white px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">
          {variant === 'staff' ? 'Parent communication' : 'Family communication'}
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-[#101828]">
          {variant === 'staff' ? 'Parent Chat' : 'Chat'}
        </h1>
        <p className={`mt-2 max-w-3xl ${bodyClass}`}>
          {variant === 'staff'
            ? 'Use the controlled child, team and selected squad rooms available for your current staff assignment.'
            : 'Keep child, team and selected match conversations inside footballplayer.online.'}
        </p>
      </div>

      {error ? (
        <p role="alert" className="mx-4 mt-4 rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] sm:mx-5">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-[34rem] bg-[#f7faf8] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={`${selectedRoom ? 'hidden lg:block' : 'block'} border-r-0 border-[#d7e5dc] bg-white p-4 lg:border-r sm:p-5`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-[#101828]">Your rooms</p>
              <p className="mt-1 text-xs font-semibold text-[#4b5f55]">{totalUnread} unread</p>
            </div>
            <button
              type="button"
              onClick={() => void loadRooms()}
              disabled={isLoadingRooms}
              className="min-h-10 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:opacity-60"
            >
              Refresh
            </button>
          </div>

          {isLoadingRooms ? (
            <p className={`mt-4 ${bodyClass}`}>Loading Chat rooms...</p>
          ) : rooms.length === 0 ? (
            <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
              <p className="text-sm font-black text-[#101828]">No Chat rooms available</p>
              <p className={`mt-2 ${bodyClass}`}>
                Rooms appear automatically from active child, team, staff and selected squad relationships.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              {groupedRooms.map((group) => (
                <div key={group.key}>
                  <h2 className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">{group.label}</h2>
                  {group.rooms.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {group.rooms.map((room) => (
                        <RoomButton
                          key={room.id}
                          isSelected={room.id === selectedRoomId}
                          onSelect={() => setSelectedRoomId(room.id)}
                          room={room}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs font-semibold text-[#667085]">No rooms in this group.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className={`${selectedRoom ? 'flex' : 'hidden lg:flex'} min-w-0 flex-col bg-[#f7faf8]`}>
          {selectedRoom ? (
            <>
              <RoomHeader
                onBack={() => setSelectedRoomId('')}
                realtimeStatus={realtimeStatus}
                room={selectedRoom}
              />
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6" aria-live="polite">
                {selectedRoom.type === PARENT_CHAT_ROOM_TYPES.parentStaff ? (
                  <div className="mb-4 rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-semibold leading-6 text-[#285143]">
                    This conversation is visible to you, your child's linked guardians and authorised staff for this team.
                  </div>
                ) : null}

                {isLoadingMessages ? (
                  <p className={bodyClass}>Loading messages...</p>
                ) : messages.length === 0 ? (
                  <div className="rounded-lg border border-[#d7e5dc] bg-white p-5 text-center">
                    <p className="text-sm font-black text-[#101828]">Start the conversation</p>
                    <p className={`mt-2 ${bodyClass}`}>{getRoomEmptyCopy(selectedRoom)}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        isDeleting={activeDeleteId === message.id}
                        message={message}
                        onDelete={() => void handleDelete(message)}
                        ownMessage={message.senderId === user?.id}
                      />
                    ))}
                  </div>
                )}
              </div>
              <MessageComposer
                canPost={selectedRoom.canPost}
                draft={draft}
                isSending={isSending}
                onChange={setDraft}
                onSubmit={handleSend}
                roomStatus={selectedRoom.status}
              />
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div>
                <p className="text-lg font-black text-[#101828]">Choose a Chat room</p>
                <p className={`mt-2 ${bodyClass}`}>Select a child, team or match conversation to view its messages.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function RoomButton({ isSelected, onSelect, room }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full rounded-lg border p-3 text-left transition ${isSelected
        ? 'border-[#047857] bg-[#ecfdf5]'
        : 'border-[#d7e5dc] bg-white hover:border-[#047857] hover:bg-[#f7faf8]'}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-black text-[#101828]">{getRoomHeading(room)}</span>
          <span className="mt-1 block truncate text-xs font-semibold text-[#4b5f55]">{getRoomContext(room)}</span>
        </span>
        {room.unreadCount > 0 ? (
          <span className="inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[#047857] px-2 text-xs font-black text-white">
            {room.unreadCount > 99 ? '99+' : room.unreadCount}
          </span>
        ) : null}
      </span>
      <span className="mt-2 block truncate text-xs font-semibold text-[#667085]">
        {room.latestMessage || 'No messages yet'}
      </span>
      <span className="mt-1 flex items-center justify-between gap-2 text-xs font-bold text-[#667085]">
        <span>{room.latestMessageAt ? formatDateTime(room.latestMessageAt) : 'Ready when you are'}</span>
        {room.status !== 'active' ? <span className="text-[#b54708]">Read-only</span> : null}
      </span>
    </button>
  )
}

function RoomHeader({ onBack, realtimeStatus, room }) {
  return (
    <header className="border-b border-[#d7e5dc] bg-white px-4 py-4 sm:px-6">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] lg:hidden"
        >
          Rooms
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-black text-[#101828]">{getRoomHeading(room)}</h2>
              <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{getRoomContext(room)}</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-black ${room.status === 'active'
              ? 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
              : 'border-[#fedf89] bg-[#fffaeb] text-[#b54708]'}`}
            >
              {room.status === 'active' ? 'Open' : 'Read-only'}
            </span>
          </div>
          {room.type === PARENT_CHAT_ROOM_TYPES.matchSquad ? (
            <dl className="mt-3 grid gap-2 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <RoomFact label="Fixture" value={room.opponent || 'Opponent to be confirmed'} />
              <RoomFact label="Kickoff" value={formatClock(room.kickoffTime, room.kickoffTimeTbc)} />
              <RoomFact label="Meet time" value={formatClock(room.meetTime)} />
              <RoomFact label="Venue" value={room.venueName || 'Not set'} />
              <RoomFact label="Status" value={room.fixtureStatus || 'Scheduled'} />
              <RoomFact label="Selected child" value={room.childNames.join(', ') || 'Selected squad'} />
            </dl>
          ) : null}
          {realtimeStatus && realtimeStatus !== 'SUBSCRIBED' ? (
            <p className="mt-2 text-xs font-semibold text-[#667085]">Refreshing Chat connection...</p>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function RoomFact({ label, value }) {
  return (
    <div>
      <dt className="font-black uppercase tracking-[0.12em] text-[#667085]">{label}</dt>
      <dd className="mt-1 font-bold text-[#101828]">{value}</dd>
    </div>
  )
}

function MessageBubble({ isDeleting, message, onDelete, ownMessage }) {
  return (
    <article className={`flex ${ownMessage ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] rounded-lg border px-4 py-3 shadow-sm sm:max-w-[78%] ${ownMessage
        ? 'border-[#047857] bg-[#ecfdf5]'
        : 'border-[#d7e5dc] bg-white'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs font-black text-[#101828]">
            {message.senderName}
            {message.senderRole ? <span className="ml-2 font-semibold text-[#4b5f55]">{message.senderRole}</span> : null}
          </p>
          <time className="text-xs font-semibold text-[#667085]" dateTime={message.createdAt}>
            {formatDateTime(message.createdAt)}
          </time>
        </div>
        {message.deletedAt ? (
          <p className="mt-2 text-sm italic text-[#667085]">Message removed.</p>
        ) : (
          <SafeMessageText body={message.body} />
        )}
        {message.canDelete && !message.deletedAt ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="mt-2 text-xs font-black text-[#b42318] underline decoration-transparent underline-offset-2 transition hover:decoration-current disabled:opacity-60"
          >
            {isDeleting ? 'Removing...' : 'Remove message'}
          </button>
        ) : null}
      </div>
    </article>
  )
}

function SafeMessageText({ body }) {
  const parts = String(body || '').split(/(https?:\/\/[^\s]+)/gi)

  return (
    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#285143]">
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) {
          return part
        }

        try {
          const url = new URL(part)
          if (!['http:', 'https:'].includes(url.protocol)) {
            return part
          }
        } catch {
          return part
        }

        return (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            className="font-black text-[#047857] underline underline-offset-2"
          >
            {part}
          </a>
        )
      })}
    </p>
  )
}

function MessageComposer({ canPost, draft, isSending, onChange, onSubmit, roomStatus }) {
  if (!canPost) {
    return (
      <div className="border-t border-[#d7e5dc] bg-white px-4 py-4 sm:px-6">
        <p className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm font-black text-[#b54708]">
          {roomStatus === 'active'
            ? 'You no longer have permission to send messages in this room.'
            : 'This room is read-only. The message history remains available while your current relationship allows access.'}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="border-t border-[#d7e5dc] bg-white px-4 py-4 sm:px-6">
      <label htmlFor="parent-chat-message" className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
        Message
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <textarea
          id="parent-chat-message"
          value={draft}
          onChange={(event) => onChange(event.target.value.slice(0, 2000))}
          rows={3}
          maxLength={2000}
          placeholder="Write a message"
          className="min-h-24 flex-1 resize-y rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3 text-base font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
        />
        <button
          type="submit"
          disabled={isSending || !draft.trim()}
          className={`${primaryButtonClass} sm:min-w-28`}
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
      <p className="mt-2 text-right text-xs font-semibold text-[#667085]">{draft.length} / 2000</p>
    </form>
  )
}
