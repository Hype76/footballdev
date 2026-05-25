import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
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
      <PageHeader
        eyebrow="Parent Portal"
        title="Messages"
        description="Emails sent by the club for your linked child appear here."
      />

      <section className="grid gap-4 md:grid-cols-3">
        {messageSummary.map((item) => (
          <article key={item.label} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-slate-950">{isLoadingMessages ? '...' : item.value}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="rounded-md border border-sky-200 bg-sky-50 p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">Message rule</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
          This inbox shows club-sent emails for the selected child. It is a record of what was shared, not a replacement for staff conversations.
        </p>
      </section>

      <SectionCard title="Messages" description="Select a child, then open any email to view the content and download an assessment PDF when one is available.">
        {links.length > 1 ? (
          <div className="mb-4">
            <label htmlFor="parent-message-child" className="mb-2 block text-sm font-bold text-slate-950">
              Child
            </label>
            <select
              id="parent-message-child"
              value={selectedLink?.id || ''}
              onChange={(event) => setSelectedLinkId(event.target.value)}
              className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            >
              {links.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.playerName} | {link.teamName || 'No team'} | {link.clubName || 'No club'}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {messages.length > 0 ? (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => void handleMarkAllMessagesRead()}
              disabled={isMarkingAllRead || !hasUnreadMessages}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isMarkingAllRead ? 'Marking...' : hasUnreadMessages ? 'Mark all as read' : 'All read'}
            </button>
          </div>
        ) : null}

        {messageError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {messageError}
          </p>
        ) : isLoadingMessages ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
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
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
            No emails have been shared in the parent portal for this child yet.
          </p>
        )}
      </SectionCard>
    </div>
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
    <article className={`rounded-md border bg-white shadow-sm transition ${
      isUnread ? 'border-emerald-300' : 'border-slate-200'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="block w-full px-4 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-950">
              {subject}
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {formatMessageDate(message.createdAt)} | {message.senderName || message.senderEmail || 'Club staff'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isUnread ? (
              <span className="inline-flex w-fit rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
                Unread
              </span>
            ) : null}
            {hasAttachment ? (
              <span className="inline-flex w-fit rounded-sm border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-600">
                PDF attached
              </span>
            ) : null}
            <span className="inline-flex w-fit rounded-sm border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-600">
              {isOpen ? 'Hide email' : 'View email'}
            </span>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div className="min-w-0">
          <div className="border-t border-slate-200 px-4 py-4">
            {templateName ? (
              <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                {templateName}
              </p>
            ) : null}

            {body ? (
              <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-600">
                {body}
              </p>
            ) : (
              <p className="text-sm font-semibold leading-6 text-slate-600">No email body was recorded for this message.</p>
            )}

            {assessmentFields.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Assessment details</p>
                {assessmentFields.map((field) => (
                  <div key={field.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                      {field.label}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-slate-600">
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
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50"
                >
                  Download PDF
                </button>
              </div>
            ) : hasAttachment ? (
              <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">
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
