import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth.js'
import {
  canDownloadMessagePdf,
  getMessageAssessmentFields,
  getMessageBody,
  getMessagePdfHtml,
  getMessageSubject,
  getMessageTemplateName,
  messageHasAttachment,
} from '../lib/email-message-display.js'
import { exportPdfHtml } from '../lib/pdf.js'
import { getParentPortalMessages, markParentPortalMessageRead } from '../lib/supabase.js'

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-black text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const chipClass = 'inline-flex w-fit whitespace-nowrap rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55] shadow-sm shadow-[#047857]/10'

export function ParentMessagesPage() {
  const { user } = useAuth()
  const links = Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [messages, setMessages] = useState([])
  const [openMessageId, setOpenMessageId] = useState('')
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false)
  const [messageError, setMessageError] = useState('')
  const selectedLink = links.find((link) => link.id === selectedLinkId)
    ?? links.find((link) => link.id === user?.selectedParentLinkId)
    ?? links[0]
  const hasUnreadMessages = messages.some((message) => !message.readAt)
  const unreadCount = messages.filter((message) => !message.readAt).length
  const latestMessage = messages[0]
  const messageSummary = [
    {
      label: 'Linked children',
      value: links.length,
      caption: 'Children this parent account can view.',
    },
    {
      label: 'Messages',
      value: messages.length,
      caption: 'Emails shared into this portal.',
    },
    {
      label: 'Unread',
      value: unreadCount,
      caption: 'Messages still waiting to be opened.',
    },
  ]

  useEffect(() => {
    let isCurrent = true

    async function loadMessages() {
      if (!selectedLink?.id) {
        setMessages([])
        return
      }

      setIsLoadingMessages(true)
      setMessageError('')

      try {
        const nextMessages = await getParentPortalMessages({ parentLinkId: selectedLink.id })

        if (isCurrent) {
          setMessages(nextMessages)
        }
      } catch (error) {
        console.error(error)

        if (isCurrent) {
          setMessages([])
          setMessageError(error.message || 'Messages could not be loaded.')
        }
      } finally {
        if (isCurrent) {
          setIsLoadingMessages(false)
        }
      }
    }

    loadMessages()

    return () => {
      isCurrent = false
    }
  }, [selectedLink?.id])

  useEffect(() => {
    setOpenMessageId('')
  }, [selectedLink?.id])

  const handleToggleMessage = async (message) => {
    const nextOpenMessageId = openMessageId === message.id ? '' : message.id
    setOpenMessageId(nextOpenMessageId)

    if (!nextOpenMessageId || message.readAt || !selectedLink?.id) {
      return
    }

    try {
      const readAt = await markParentPortalMessageRead({
        parentLinkId: selectedLink.id,
        messageId: message.id,
      })

      setMessages((currentMessages) =>
        currentMessages.map((currentMessage) =>
          currentMessage.id === message.id
            ? { ...currentMessage, readAt: readAt || new Date().toISOString() }
            : currentMessage,
        ),
      )
    } catch (error) {
      console.error(error)
    }
  }

  const handleDownloadMessagePdf = async (message) => {
    try {
      await exportPdfHtml({
        clubId: selectedLink?.clubId,
        filename: buildMessagePdfFilename(message, selectedLink),
        html: getMessagePdfHtml(message),
      })
    } catch (error) {
      console.error(error)
      setMessageError(error.message || 'PDF could not be downloaded.')
    }
  }

  const handleMarkAllMessagesRead = async () => {
    const unreadMessages = messages.filter((message) => !message.readAt)

    if (unreadMessages.length === 0 || !selectedLink?.id || isMarkingAllRead) {
      return
    }

    setIsMarkingAllRead(true)
    setMessageError('')

    try {
      const readEntries = await Promise.all(
        unreadMessages.map(async (message) => {
          const readAt = await markParentPortalMessageRead({
            parentLinkId: selectedLink.id,
            messageId: message.id,
          })

          return [message.id, readAt || new Date().toISOString()]
        }),
      )
      const readAtByMessageId = new Map(readEntries)

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          readAtByMessageId.has(message.id)
            ? { ...message, readAt: readAtByMessageId.get(message.id) }
            : message,
        ),
      )
    } catch (error) {
      console.error(error)
      setMessageError(error.message || 'Messages could not be marked as read.')
    } finally {
      setIsMarkingAllRead(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <ParentInboxHero
        isLoading={isLoadingMessages}
        latestMessage={latestMessage}
        selectedLink={selectedLink}
        summary={messageSummary}
      />

      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-4 border-b border-[#d7e5dc] bg-white px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className={eyebrowClass}>Parent inbox</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-[#101828]">Messages for the selected player</h2>
            <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
              Review official club updates, open anything unread, and keep development PDFs with the player record.
            </p>
          </div>

          {messages.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleMarkAllMessagesRead()}
              disabled={isMarkingAllRead || !hasUnreadMessages}
              className={secondaryButtonClass}
            >
              {isMarkingAllRead ? 'Marking...' : hasUnreadMessages ? 'Mark all as read' : 'All read'}
            </button>
          ) : null}
        </div>

        <div className="grid gap-5 bg-[#f7faf8] px-5 py-5 sm:px-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="space-y-4">
            {links.length > 1 ? (
              <div className={panelClass}>
                <label htmlFor="parent-message-child" className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">
                  Child
                </label>
                <select
                  id="parent-message-child"
                  value={selectedLink?.id || ''}
                  onChange={(event) => setSelectedLinkId(event.target.value)}
                  className={inputClass}
                >
                  {links.map((link) => (
                    <option key={link.id} value={link.id}>
                      {link.playerName}, Team: {link.teamName || 'No team assigned'}, Club: {link.clubName || 'No club assigned'}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 shadow-sm shadow-[#047857]/10">
              <p className={eyebrowClass}>Inbox rule</p>
              <p className={`mt-2 ${bodyTextClass}`}>
                This is the official message record for this player. It keeps club updates findable after the email has gone.
              </p>
            </div>

            <div className={panelClass}>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Selected player</p>
              <p className="mt-2 text-lg font-black text-[#101828]">{selectedLink?.playerName || 'No player selected'}</p>
              <p className="mt-1 text-sm font-semibold text-[#4b5f55]">Team: {selectedLink?.teamName || 'No team assigned'}, Club: {selectedLink?.clubName || 'No club assigned'}</p>
            </div>
          </aside>

          <div className="min-w-0">
            {messageError ? (
              <p className="rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]">
                {messageError}
              </p>
            ) : isLoadingMessages ? (
              <p className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
                Loading messages...
              </p>
            ) : messages.length > 0 ? (
              <div className="space-y-3">
                {messages.map((message) => (
                  <MessageCard
                    key={message.id}
                    isOpen={openMessageId === message.id}
                    message={message}
                    onDownloadPdf={() => void handleDownloadMessagePdf(message)}
                    onToggle={() => void handleToggleMessage(message)}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
                No emails have been shared in the parent portal for this child yet.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function ParentInboxHero({ isLoading, latestMessage, selectedLink, summary }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="px-5 py-6 sm:px-6 lg:px-8">
          <div className="max-w-5xl">
            <p className={eyebrowClass}>Family inbox</p>
            <h1 className="mt-3 text-3xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-4xl">
              Keep {selectedLink?.playerName || 'the player'} in step with the club.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
              Use this inbox for practical football updates: development notes, PDF records, team information, and parent actions.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {summary.map((item) => (
                <InboxMetric key={item.label} isLoading={isLoading} {...item} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid content-between border-t border-[#d7e5dc] bg-[#ecfdf5] p-5 sm:p-6 xl:border-l xl:border-t-0">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Latest message</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
              {latestMessage ? getMessageSubject(latestMessage) : 'No message yet'}
            </p>
            <p className={`mt-2 ${bodyTextClass}`}>
              {latestMessage ? formatMessageDate(latestMessage.createdAt) : 'Messages will appear here when the club shares them.'}
            </p>
          </div>
          <div className="mt-5 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
            <p className={eyebrowClass}>Next action</p>
            <p className={`mt-1 ${bodyTextClass}`}>
              Open unread messages first. Download the PDF only when a development attachment exists.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function InboxMetric({ caption, isLoading, label, value }) {
  return (
    <article className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
      <p className={eyebrowClass}>{label}</p>
      <p className="mt-3 text-4xl font-black tracking-tight text-[#101828]">{isLoading ? '...' : value}</p>
      <p className={`mt-2 ${bodyTextClass}`}>{caption}</p>
    </article>
  )
}

function MessageCard({ isOpen, message, onDownloadPdf, onToggle }) {
  const assessmentFields = getMessageAssessmentFields(message)
  const body = getMessageBody(message)
  const canDownloadPdf = canDownloadMessagePdf(message)
  const hasAttachment = messageHasAttachment(message)
  const templateName = getMessageTemplateName(message)
  const subject = getMessageSubject(message)
  const isUnread = !message.readAt

  return (
    <article className={`rounded-lg border bg-white shadow-sm shadow-[#047857]/10 transition ${
      isUnread ? 'border-[#047857]' : 'border-[#d7e5dc]'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="block w-full px-4 py-4 text-left transition hover:bg-[#f7faf8]"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black text-[#101828]">
              {subject}
            </p>
            <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
              Date: {formatMessageDate(message.createdAt)}, Sender: {message.senderName || message.senderEmail || 'Club staff'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isUnread ? (
              <span className="inline-flex w-fit whitespace-nowrap rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-3 py-1 text-xs font-black text-[#047857] shadow-sm shadow-[#047857]/10">
                Unread
              </span>
            ) : null}
            {hasAttachment ? (
              <span className={chipClass}>
                PDF attached
              </span>
            ) : null}
            <span className={chipClass}>
              {isOpen ? 'Hide email' : 'View email'}
            </span>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div className="min-w-0">
          <div className="border-t border-[#d7e5dc] px-4 py-4">
            {templateName ? (
              <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
                {templateName}
              </p>
            ) : null}

            {body ? (
              <p className={`whitespace-pre-wrap break-words ${bodyTextClass}`}>
                {body}
              </p>
            ) : (
              <p className={bodyTextClass}>No email body was recorded for this message.</p>
            )}

            {assessmentFields.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Development details</p>
                {assessmentFields.map((field) => (
                  <div key={field.label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">
                      {field.label}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-[#4b5f55]">
                      {String(field.value ?? '')}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {canDownloadPdf ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={onDownloadPdf}
                  className={primaryButtonClass}
                >
                  Download PDF
                </button>
              </div>
            ) : hasAttachment ? (
              <p className={`mt-4 ${bodyTextClass}`}>
                A PDF was attached to this email, but the download source was not recorded for this older message.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}

function buildMessagePdfFilename(message, selectedLink) {
  const playerName = String(selectedLink?.playerName || message.playerName || 'player-feedback')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'player-feedback'

  return `${playerName}-parent-email.pdf`
}

function formatMessageDate(value) {
  if (!value) {
    return 'Date not recorded'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Date not recorded'
  }

  return date.toLocaleString()
}
