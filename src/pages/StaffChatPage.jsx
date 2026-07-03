import { useCallback, useEffect, useMemo, useState } from 'react'
import { canUseClubStaffChat, canUseStaffChat, useAuth } from '../lib/auth.js'
import {
  archiveStaffChatConversation,
  createStaffChatConversation,
  deleteStaffChatMessage,
  getStaffChatConversations,
  getStaffChatMessages,
  getStaffChatStaffDirectory,
  getStaffChatTeams,
  markStaffChatConversationRead,
  sendStaffChatMessage,
} from '../lib/supabase.js'

const conversationTabs = [
  { key: 'club_staff', label: 'Club Staff' },
  { key: 'team_staff', label: 'Team Staff' },
  { key: 'group', label: 'Groups' },
  { key: 'direct', label: 'Direct Messages' },
]

function formatTime(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(date)
}

function getConversationTitle(conversation, currentUserId) {
  if (conversation.title) {
    return conversation.title
  }

  if (conversation.type === 'club_staff') {
    return 'Club Staff'
  }

  if (conversation.type === 'team_staff') {
    return 'Team Staff'
  }

  if (conversation.type === 'direct') {
    const otherMember = conversation.members.find((member) => member.userId !== currentUserId)
    return otherMember?.user?.name || otherMember?.user?.email || 'Direct message'
  }

  return 'Staff group'
}

function getConversationMeta(conversation) {
  const memberCount = conversation.members.length

  if (conversation.type === 'club_staff') {
    return `${memberCount} club staff`
  }

  if (conversation.type === 'team_staff') {
    return `${memberCount} team staff`
  }

  if (conversation.type === 'direct') {
    return '1-to-1 staff chat'
  }

  return `${memberCount} staff members`
}

export function StaffChatPage() {
  const { user } = useAuth()
  const [activeType, setActiveType] = useState('club_staff')
  const [conversations, setConversations] = useState([])
  const [selectedConversationId, setSelectedConversationId] = useState('')
  const [messages, setMessages] = useState([])
  const [staff, setStaff] = useState([])
  const [teams, setTeams] = useState([])
  const [draftMessage, setDraftMessage] = useState('')
  const [groupTitle, setGroupTitle] = useState('')
  const [selectedMembers, setSelectedMembers] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const canOpenStaffChat = canUseStaffChat(user)
  const canOpenClubStaffChat = canUseClubStaffChat(user)
  const availableConversationTabs = useMemo(() => (
    canOpenClubStaffChat
      ? conversationTabs
      : conversationTabs.filter((tab) => tab.key !== 'club_staff')
  ), [canOpenClubStaffChat])
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
  const visibleConversations = conversations.filter((conversation) => conversation.type === activeType)
  const activeStaff = staff.filter((person) => person.id !== user?.id)
  const selectedMemberSet = useMemo(() => new Set(selectedMembers), [selectedMembers])

  const loadStaffChat = useCallback(async () => {
    if (!canOpenStaffChat) {
      setConversations([])
      setMessages([])
      setStaff([])
      setTeams([])
      setSelectedConversationId('')
      setStatus('ready')
      return
    }

    setStatus('loading')
    setErrorMessage('')

    try {
      const [nextConversations, nextStaff, nextTeams] = await Promise.all([
        getStaffChatConversations({ user }),
        getStaffChatStaffDirectory({ user }),
        getStaffChatTeams({ user }),
      ])
      setConversations(nextConversations)
      setStaff(nextStaff)
      setTeams(nextTeams)
      setSelectedConversationId((current) => {
        if (current && nextConversations.some((conversation) => conversation.id === current && conversation.type === activeType)) {
          return current
        }

        return nextConversations.find((conversation) => conversation.type === activeType)?.id ?? nextConversations[0]?.id ?? ''
      })
      setStatus('ready')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Staff Chat could not be loaded.')
      setStatus('ready')
    }
  }, [activeType, canOpenStaffChat, user])

  useEffect(() => {
    void loadStaffChat()
  }, [loadStaffChat])

  useEffect(() => {
    if (availableConversationTabs.some((tab) => tab.key === activeType)) {
      return
    }

    setMessages([])
    setSelectedConversationId('')
    setActiveType(availableConversationTabs[0]?.key ?? 'team_staff')
  }, [activeType, availableConversationTabs])

  useEffect(() => {
    setMessages([])
    setSelectedConversationId('')
  }, [user?.activeTeamId, user?.clubId, user?.id])

  useEffect(() => {
    const nextConversation = conversations.find((conversation) => conversation.type === activeType)

    if (!selectedConversation || selectedConversation.type !== activeType) {
      setMessages([])
      setSelectedConversationId(nextConversation?.id ?? '')
    }
  }, [activeType, conversations, selectedConversation])

  useEffect(() => {
    let isMounted = true

    async function loadMessages() {
      if (!selectedConversationId || !canOpenStaffChat) {
        setMessages([])
        return
      }

      setMessages([])

      try {
        const nextMessages = await getStaffChatMessages({ conversationId: selectedConversationId, user })

        if (isMounted) {
          setMessages(nextMessages)
          await markStaffChatConversationRead({ conversationId: selectedConversationId, user })
          setConversations((current) => current.map((conversation) => (
            conversation.id === selectedConversationId ? { ...conversation, unreadCount: 0 } : conversation
          )))
        }
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(error.message || 'Messages could not be loaded.')
        }
      }
    }

    void loadMessages()

    return () => {
      isMounted = false
    }
  }, [canOpenStaffChat, selectedConversationId, user])

  const toggleMember = (memberId) => {
    if (activeType === 'direct') {
      setSelectedMembers([memberId])
      return
    }

    setSelectedMembers((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ))
  }

  const createConversation = async (type) => {
    if (isCreating) {
      return
    }

    setIsCreating(true)
    setErrorMessage('')

    try {
      let conversationId = ''

      if (type === 'club_staff') {
        conversationId = await createStaffChatConversation({ type, title: 'Club Staff', user })
      } else if (type === 'team_staff') {
        conversationId = await createStaffChatConversation({ type, teamId: selectedTeamId || user.activeTeamId || teams[0]?.id, user })
      } else if (type === 'direct') {
        if (selectedMembers.length !== 1) {
          throw new Error('Choose one staff member for a direct message.')
        }
        conversationId = await createStaffChatConversation({ type, memberIds: selectedMembers, user })
      } else {
        if (selectedMembers.length === 0) {
          throw new Error('Choose at least one staff member for the group.')
        }
        conversationId = await createStaffChatConversation({ type, title: groupTitle || 'Staff group', memberIds: selectedMembers, user })
      }

      setGroupTitle('')
      setSelectedMembers([])
      setSelectedTeamId('')
      await loadStaffChat()
      setActiveType(type)
      setSelectedConversationId(conversationId)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Conversation could not be created.')
    } finally {
      setIsCreating(false)
    }
  }

  const sendMessage = async (event) => {
    event.preventDefault()

    if (!selectedConversationId || isSending) {
      return
    }

    setIsSending(true)
    setErrorMessage('')

    try {
      const nextMessage = await sendStaffChatMessage({
        body: draftMessage,
        conversationId: selectedConversationId,
        user,
      })
      setMessages((current) => [...current, nextMessage])
      setDraftMessage('')
      await loadStaffChat()
      setSelectedConversationId(selectedConversationId)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Message could not be sent.')
    } finally {
      setIsSending(false)
    }
  }

  const archiveConversation = async () => {
    if (!selectedConversationId) {
      return
    }

    try {
      await archiveStaffChatConversation({ conversationId: selectedConversationId, user })
      setSelectedConversationId('')
      await loadStaffChat()
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Conversation could not be hidden.')
    }
  }

  const deleteMessage = async (messageId) => {
    try {
      await deleteStaffChatMessage({ messageId, user })
      setMessages((current) => current.map((message) => (
        message.id === messageId
          ? { ...message, body: '', deletedAt: new Date().toISOString(), deletedBy: user.id }
          : message
      )))
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Message could not be deleted.')
    }
  }

  if (!canOpenStaffChat) {
    return (
      <section className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--accent)]">Staff Chat</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-[var(--text-primary)]">Staff access required</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-[var(--text-muted)]">
          Staff Chat is available only to authorised club and team staff.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <header className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--accent)]">Staff only</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--text-primary)]">Staff Chat</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[var(--text-muted)]">
              Club and team staff conversations stay inside the authorised club workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadStaffChat()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-2 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)]"
          >
            Refresh
          </button>
        </div>
      </header>

      {errorMessage ? (
        <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <aside className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3 shadow-sm">
          <div className="grid grid-cols-2 gap-2">
            {availableConversationTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveType(tab.key)}
                className={[
                  'min-h-11 rounded-lg border px-3 py-2 text-sm font-black transition',
                  activeType === tab.key
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                    : 'border-[var(--border-color)] bg-[var(--panel-alt)] text-[var(--text-primary)] hover:border-[var(--accent)]',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-2">
            {status === 'loading' ? (
              <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-4 text-sm font-bold text-[var(--text-muted)]">
                Loading Staff Chat...
              </p>
            ) : null}

            {status !== 'loading' && visibleConversations.length === 0 ? (
              <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-4 text-sm font-bold text-[var(--text-muted)]">
                No conversations in this view yet.
              </p>
            ) : null}

            {visibleConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedConversationId(conversation.id)}
                className={[
                  'min-h-20 rounded-lg border px-3 py-3 text-left transition',
                  selectedConversationId === conversation.id
                    ? 'border-[var(--accent)] bg-[var(--panel-alt)] shadow-sm'
                    : 'border-[var(--border-color)] bg-[var(--panel-bg)] hover:border-[var(--accent)]',
                ].join(' ')}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-[var(--text-primary)]">
                      {getConversationTitle(conversation, user.id)}
                    </span>
                    <span className="mt-1 block truncate text-xs font-bold text-[var(--text-muted)]">
                      {getConversationMeta(conversation)}
                    </span>
                  </span>
                  {conversation.unreadCount > 0 ? (
                    <span className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-lg bg-[var(--accent)] px-2 text-xs font-black text-white">
                      {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                    </span>
                  ) : null}
                </span>
                {conversation.messages[0] ? (
                  <span className="mt-2 block truncate text-xs font-semibold text-[var(--text-muted)]">
                    {conversation.messages[0].deletedAt ? 'Message deleted' : conversation.messages[0].body}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <CreateConversationPanel
            activeStaff={activeStaff}
            activeType={activeType}
            groupTitle={groupTitle}
            isCreating={isCreating}
            onCreate={createConversation}
            onGroupTitleChange={setGroupTitle}
            onSelectedTeamChange={setSelectedTeamId}
            onToggleMember={toggleMember}
            selectedMemberSet={selectedMemberSet}
            selectedTeamId={selectedTeamId}
            teams={teams}
            user={user}
          />
        </aside>

        <main className="min-h-[34rem] rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] shadow-sm">
          {selectedConversation ? (
            <div className="flex min-h-[34rem] flex-col">
              <div className="flex flex-col gap-3 border-b border-[var(--border-color)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--accent)]">{getConversationMeta(selectedConversation)}</p>
                  <h2 className="mt-1 text-xl font-black text-[var(--text-primary)]">{getConversationTitle(selectedConversation, user.id)}</h2>
                </div>
                <button
                  type="button"
                  onClick={archiveConversation}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)]"
                >
                  Hide
                </button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.length === 0 ? (
                  <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm font-bold text-[var(--text-muted)]">
                    No messages yet. Start the staff conversation when you are ready.
                  </div>
                ) : null}

                {messages.map((message) => {
                  const isOwnMessage = message.senderId === user.id
                  return (
                    <article
                      key={message.id}
                      className={[
                        'max-w-[44rem] rounded-lg border px-4 py-3',
                        isOwnMessage
                          ? 'ml-auto border-[var(--accent)] bg-[var(--panel-alt)]'
                          : 'border-[var(--border-color)] bg-[var(--panel-bg)]',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--accent)]">
                          {message.sender?.name || message.sender?.email || 'Staff'}
                        </p>
                        <p className="text-xs font-bold text-[var(--text-muted)]">{formatTime(message.createdAt)}</p>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[var(--text-primary)]">
                        {message.deletedAt ? 'This message was deleted.' : message.body}
                      </p>
                      {isOwnMessage && !message.deletedAt ? (
                        <button
                          type="button"
                          onClick={() => void deleteMessage(message.id)}
                          className="mt-3 text-xs font-black uppercase tracking-[0.12em] text-[var(--danger-text)]"
                        >
                          Delete
                        </button>
                      ) : null}
                    </article>
                  )
                })}
              </div>

              <form onSubmit={sendMessage} className="border-t border-[var(--border-color)] p-4">
                <label className="sr-only" htmlFor="staff-chat-message">Message</label>
                <textarea
                  id="staff-chat-message"
                  value={draftMessage}
                  onChange={(event) => setDraftMessage(event.target.value)}
                  placeholder="Write a staff-only message"
                  rows={3}
                  className="min-h-24 w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSending || !draftMessage.trim()}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-2 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="grid min-h-[34rem] place-items-center px-4 py-8 text-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--accent)]">Staff Chat</p>
                <h2 className="mt-2 text-2xl font-black text-[var(--text-primary)]">Choose or create a conversation</h2>
                <p className="mt-2 max-w-md text-sm font-semibold leading-6 text-[var(--text-muted)]">
                  Staff Chat keeps V1 communication scoped to authorised club and team staff.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}

function CreateConversationPanel({
  activeStaff,
  activeType,
  groupTitle,
  isCreating,
  onCreate,
  onGroupTitleChange,
  onSelectedTeamChange,
  onToggleMember,
  selectedMemberSet,
  selectedTeamId,
  teams,
  user,
}) {
  if (activeType === 'club_staff') {
    return (
      <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-3">
        <p className="text-sm font-black text-[var(--text-primary)]">Club Staff</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">Create a staff-only club conversation for authorised staff in this club.</p>
        <button
          type="button"
          onClick={() => void onCreate('club_staff')}
          disabled={isCreating}
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-3 py-2 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Create Club Staff Chat
        </button>
      </div>
    )
  }

  if (activeType === 'team_staff') {
    const defaultTeamId = selectedTeamId || user.activeTeamId || teams[0]?.id || ''

    return (
      <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-3">
        <p className="text-sm font-black text-[var(--text-primary)]">Team Staff</p>
        <select
          value={defaultTeamId}
          onChange={(event) => onSelectedTeamChange(event.target.value)}
          className="mt-3 min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void onCreate('team_staff')}
          disabled={isCreating || !defaultTeamId}
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-3 py-2 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Create Team Staff Chat
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-3">
      <p className="text-sm font-black text-[var(--text-primary)]">
        {activeType === 'direct' ? 'Direct Messages' : 'Groups'}
      </p>
      {activeType === 'group' ? (
        <input
          type="text"
          value={groupTitle}
          onChange={(event) => onGroupTitleChange(event.target.value)}
          placeholder="Group name"
          className="mt-3 min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-bold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
        />
      ) : null}

      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
        {activeStaff.map((person) => (
          <label
            key={person.id}
            className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2"
          >
            <input
              type={activeType === 'direct' ? 'radio' : 'checkbox'}
              checked={selectedMemberSet.has(person.id)}
              onChange={() => onToggleMember(person.id)}
              className="h-4 w-4"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-[var(--text-primary)]">{person.name}</span>
              <span className="block truncate text-xs font-bold text-[var(--text-muted)]">{person.roleLabel || person.email}</span>
            </span>
          </label>
        ))}
        {activeStaff.length === 0 ? (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-4 text-sm font-bold text-[var(--text-muted)]">
            No other staff are visible to this account yet.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void onCreate(activeType)}
        disabled={isCreating || selectedMemberSet.size === 0}
        className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-3 py-2 text-sm font-black text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {activeType === 'direct' ? 'Start Direct Message' : 'Create Group Chat'}
      </button>
    </div>
  )
}
