import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useAuth } from '../lib/auth.js'
import { getParentPortalMessages, markParentPortalMessageRead } from '../lib/supabase.js'
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

export function ParentPortalPage() {
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
  const otherLinks = links.filter((link) => link.id !== selectedLink?.id)

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
        title={selectedLink?.playerName || 'My Child'}
        description="Parent access only shows linked child information. Coaching and club tools are not available in this view."
      />

      <SectionCard title="Linked child" description="This is the child and team currently linked to your parent portal.">
        {selectedLink ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard label="Child" value={selectedLink.playerName} />
            <InfoCard label="Team" value={selectedLink.teamName || 'No team entered'} />
            <InfoCard label="Club" value={selectedLink.clubName || 'No club entered'} />
            <InfoCard label="Section" value={selectedLink.playerSection || 'Not recorded'} />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No child links are active for this parent account.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Messages" description="Emails sent by the club for this child appear here.">
        {messages.some((message) => !message.readAt) ? (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => void handleMarkAllMessagesRead()}
              disabled={isMarkingAllRead}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isMarkingAllRead ? 'Marking...' : 'Mark all as read'}
            </button>
          </div>
        ) : null}

        {messageError ? (
          <p className="rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-100">
            {messageError}
          </p>
        ) : isLoadingMessages ? (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
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
                selectedLink={selectedLink}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No emails have been shared in the parent portal for this child yet.
          </p>
        )}
      </SectionCard>

      {otherLinks.length > 0 ? (
        <SectionCard title="Other child links" description="If this email is linked to more than one child or team, select a child to view their details.">
          <div className="space-y-2">
            {otherLinks.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => setSelectedLinkId(link.id)}
                className="block w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-left transition hover:border-[var(--accent)] hover:bg-[var(--panel-soft)]"
              >
                <p className="text-sm font-semibold text-[var(--text-primary)]">{link.playerName}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{link.teamName || 'No team'} | {link.clubName || 'No club'}</p>
              </button>
            ))}
          </div>
        </SectionCard>
      ) : null}
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
    <article className={`rounded-lg border bg-[var(--panel-alt)] transition ${
      isUnread ? 'border-[var(--accent)]' : 'border-[var(--border-color)]'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="block w-full px-4 py-4 text-left transition hover:bg-[var(--panel-soft)]"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {subject}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {formatMessageDate(message.createdAt)} | {message.senderName || message.senderEmail || 'Club staff'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isUnread ? (
              <span className="inline-flex w-fit rounded-full border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-black">
                Unread
              </span>
            ) : null}
            {hasAttachment ? (
              <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                PDF attached
              </span>
            ) : null}
            <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
              {isOpen ? 'Hide email' : 'View email'}
            </span>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div className="min-w-0">
          <div className="border-t border-[var(--border-color)] px-4 py-4">
            {templateName ? (
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                {templateName}
              </p>
            ) : null}

            {body ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">
                {body}
              </p>
            ) : (
              <p className="text-sm leading-6 text-[var(--text-muted)]">No email body was recorded for this message.</p>
            )}

            {assessmentFields.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Assessment details</p>
                {assessmentFields.map((field) => (
                  <div key={field.label} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      {field.label}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-muted)]">
                      {String(field.value ?? '')}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {hasAttachment ? (
              <div className="mt-4">
                {canDownloadPdf ? (
                  <button
                    type="button"
                    onClick={onDownloadPdf}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                  >
                    Download PDF
                  </button>
                ) : (
                  <p className="text-sm leading-6 text-[var(--text-muted)]">
                    A PDF was attached to this email, but the download source was not recorded for this older message.
                  </p>
                )}
              </div>
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

function InfoCard({ label, value }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  )
}
