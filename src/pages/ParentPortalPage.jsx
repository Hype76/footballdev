import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useAuth } from '../lib/auth.js'
import { getParentPortalMessages } from '../lib/supabase.js'

export function ParentPortalPage() {
  const { user } = useAuth()
  const links = Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [messages, setMessages] = useState([])
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
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
              <MessageCard key={message.id} message={message} />
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

function MessageCard({ message }) {
  return (
    <article className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {message.subject || 'Email from the club'}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {formatMessageDate(message.createdAt)} | {message.senderName || message.senderEmail || 'Club staff'}
          </p>
        </div>
        {message.hasAttachment ? (
          <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)]">
            PDF attached
          </span>
        ) : null}
      </div>

      {message.body ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">
          {message.body}
        </p>
      ) : null}

      {message.assessmentFields.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Assessment details</p>
          {message.assessmentFields.map((field) => (
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
    </article>
  )
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
