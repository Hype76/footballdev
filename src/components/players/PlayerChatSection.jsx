import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getPlayerLinkedChatContext,
  startOrReusePlayerChat,
} from '../../lib/supabase.js'

function formatDateTime(value) {
  if (!value) {
    return 'No messages yet'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Message activity recorded'
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function buildConversationPath(conversationType, conversationId) {
  const params = new URLSearchParams()
  params.set('conversationId', conversationId)

  if (conversationType === 'staff') {
    params.set('type', 'player_staff')
    return `/staff-chat?${params.toString()}`
  }

  params.delete('conversationId')
  params.set('roomId', conversationId)
  return `/parent-chat-staff?${params.toString()}`
}

export function PlayerChatSection({ player, user }) {
  const navigate = useNavigate()
  const [context, setContext] = useState(null)
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [activeAction, setActiveAction] = useState('')
  const playerId = String(player?.id ?? '').trim()

  const loadContext = useCallback(async () => {
    if (!playerId) {
      setContext(null)
      setStatus('ready')
      return
    }

    setStatus('loading')
    setErrorMessage('')

    try {
      setContext(await getPlayerLinkedChatContext({ playerId }))
    } catch (error) {
      console.error(error)
      setContext(null)
      setErrorMessage(error.message || 'Player Chat history could not be loaded.')
    } finally {
      setStatus('ready')
    }
  }, [playerId])

  useEffect(() => {
    void loadContext()
  }, [loadContext])

  const conversationTypes = useMemo(
    () => new Set((context?.conversations ?? []).map((conversation) => conversation.conversationType)),
    [context],
  )

  const handleStart = async (conversationType) => {
    if (!playerId || activeAction) {
      return
    }

    setActiveAction(conversationType)
    setErrorMessage('')

    try {
      const result = await startOrReusePlayerChat({ conversationType, playerId, user })
      navigate(buildConversationPath(result.conversationType, result.conversationId))
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'The player conversation could not be opened.')
      await loadContext()
    } finally {
      setActiveAction('')
    }
  }

  if (!playerId) {
    return null
  }

  return (
    <section
      aria-labelledby="player-chat-title"
      className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6"
      data-testid="player-linked-chat-section"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Communications</p>
          <h2 id="player-chat-title" className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
            Player-linked Chat
          </h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
            Only conversations explicitly linked to this player are shown. Parent-visible Chat and Coach-only discussion stay separate.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadContext()}
          disabled={status === 'loading'}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-2 text-sm font-black text-[#101828] transition hover:border-[#047857] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {context?.permissions?.canStartParent && !conversationTypes.has('parent') ? (
          <button
            type="button"
            onClick={() => void handleStart('parent')}
            disabled={Boolean(activeAction)}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {activeAction === 'parent' ? 'Opening parent conversation...' : 'Start parent conversation'}
          </button>
        ) : null}
        {context?.permissions?.canStartStaff && !conversationTypes.has('staff') ? (
          <button
            type="button"
            onClick={() => void handleStart('staff')}
            disabled={Boolean(activeAction)}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#047857] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#065f46] transition hover:bg-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {activeAction === 'staff' ? 'Opening Coaches discussion...' : 'Start Coaches discussion'}
          </button>
        ) : null}
      </div>

      {status === 'loading' ? (
        <p className="mt-5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-bold text-[#4b5f55]">
          Loading player-linked conversations...
        </p>
      ) : null}

      {status === 'ready' && context && context.conversations.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-[#b8cbc0] bg-[#f7faf8] px-4 py-5 text-sm font-bold text-[#4b5f55]">
          No explicitly linked conversations are available for this player yet.
        </p>
      ) : null}

      {context?.conversations?.length > 0 ? (
        <div className="mt-5 grid gap-3">
          {context.conversations.map((conversation) => (
            <article key={`${conversation.conversationType}:${conversation.id}`} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-black text-[#101828]">{conversation.label || conversation.title}</h3>
                    <span className="rounded-full border border-[#b8cbc0] bg-white px-2.5 py-1 text-xs font-black capitalize text-[#4b5f55]">
                      {conversation.status}
                    </span>
                    {conversation.unreadCount > 0 ? (
                      <span className="rounded-full bg-[#047857] px-2.5 py-1 text-xs font-black text-white">
                        {conversation.unreadCount} unread
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-bold text-[#4b5f55]">
                    Participants: {conversation.participants.map((participant) => participant.name).join(', ') || 'No active participants'}
                  </p>
                  <p className="mt-1 text-xs font-bold text-[#60756a]">
                    Last message: {formatDateTime(conversation.lastMessageAt)}
                  </p>
                </div>
                {conversation.canOpen ? (
                  <button
                    type="button"
                    onClick={() => navigate(buildConversationPath(conversation.conversationType, conversation.id))}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-sm font-black text-white transition hover:bg-[#065f46]"
                  >
                    Open conversation
                  </button>
                ) : conversation.conversationType === 'staff' && context.permissions.canStartStaff ? (
                  <button
                    type="button"
                    onClick={() => void handleStart('staff')}
                    disabled={Boolean(activeAction)}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[#047857] bg-white px-4 py-2 text-sm font-black text-[#065f46] transition hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reopen discussion
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
