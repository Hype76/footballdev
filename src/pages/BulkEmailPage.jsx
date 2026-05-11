import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canSendBulkClubEmail, useAuth } from '../lib/auth.js'
import { getPlayers, readViewCacheValue, withRequestTimeout, writeViewCache } from '../lib/supabase.js'

const AUDIENCES = {
  parent: {
    key: 'parent',
    label: 'Parents',
    description: 'Email parent and guardian contacts saved against active players.',
  },
  self: {
    key: 'self',
    label: 'Players',
    description: 'Email player contacts saved as self contacts on active player records.',
  },
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function getContactType(contact) {
  return String(contact?.type ?? contact?.contactType ?? '').trim().toLowerCase() === 'self' ? 'self' : 'parent'
}

function getFallbackContactType(player) {
  return String(player?.contactType ?? player?.contact_type ?? '').trim().toLowerCase() === 'self' ? 'self' : 'parent'
}

function buildContactOptions(players, audience) {
  const contactsByEmail = new Map()

  players.forEach((player) => {
    const rawContacts = Array.isArray(player.parentContacts) ? player.parentContacts : []
    const contacts = rawContacts.length > 0
      ? rawContacts
      : player.parentEmail
        ? [{ name: player.parentName, email: player.parentEmail, type: getFallbackContactType(player) }]
        : []

    contacts.forEach((contact) => {
      const email = normalizeEmail(contact.email ?? contact.parentEmail)

      if (!email || getContactType(contact) !== audience) {
        return
      }

      const existing = contactsByEmail.get(email)
      const playerName = String(player.playerName ?? '').trim()
      const contactName = String(contact.name ?? contact.parentName ?? '').trim()

      if (existing) {
        existing.players.push(playerName)
        return
      }

      contactsByEmail.set(email, {
        email,
        name: contactName,
        players: playerName ? [playerName] : [],
        team: String(player.team ?? '').trim(),
      })
    })
  })

  return Array.from(contactsByEmail.values())
    .map((contact) => ({
      ...contact,
      players: [...new Set(contact.players.filter(Boolean))],
    }))
    .sort((left, right) => {
      const leftLabel = left.name || left.email
      const rightLabel = right.name || right.email
      return leftLabel.localeCompare(rightLabel)
    })
}

function parseCcInput(value) {
  return String(value ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

export function BulkEmailPage() {
  const { session, user } = useAuth()
  const cacheKey = user ? `bulk-email:${user.id}:${user.clubId || 'platform'}` : ''
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [audience, setAudience] = useState(AUDIENCES.parent.key)
  const [selectedEmails, setSelectedEmails] = useState(() => new Set())
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [cc, setCc] = useState('')
  const [isLoading, setIsLoading] = useState(() => players.length === 0)
  const [isSending, setIsSending] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadPlayers = async () => {
      if (!canSendBulkClubEmail(user)) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')

      try {
        const clubWideUser = {
          ...user,
          activeTeamId: '',
          activeTeamName: '',
        }
        const nextPlayers = await withRequestTimeout(
          () => getPlayers({ user: clubWideUser }),
          'Could not load club contacts.',
        )

        if (!isMounted) {
          return
        }

        setPlayers(nextPlayers)
        writeViewCache(cacheKey, { players: nextPlayers })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Club contacts could not be refreshed right now.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadPlayers()

    return () => {
      isMounted = false
    }
  }, [cacheKey, user])

  const contactOptions = useMemo(() => buildContactOptions(players, audience), [audience, players])
  const selectedCount = contactOptions.filter((contact) => selectedEmails.has(contact.email)).length
  const allVisibleSelected = contactOptions.length > 0 && selectedCount === contactOptions.length
  const ccEmails = useMemo(() => parseCcInput(cc), [cc])

  useEffect(() => {
    setSelectedEmails(new Set(contactOptions.map((contact) => contact.email)))
  }, [contactOptions])

  if (!canSendBulkClubEmail(user)) {
    return <Navigate to="/" replace />
  }

  const toggleSelectAll = () => {
    setSelectedEmails(allVisibleSelected ? new Set() : new Set(contactOptions.map((contact) => contact.email)))
  }

  const toggleEmail = (email) => {
    setSelectedEmails((current) => {
      const next = new Set(current)

      if (next.has(email)) {
        next.delete(email)
      } else {
        next.add(email)
      }

      return next
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!session?.access_token) {
      setErrorMessage('Login again before sending bulk email.')
      return
    }

    const recipients = contactOptions
      .filter((contact) => selectedEmails.has(contact.email))
      .map((contact) => contact.email)

    if (recipients.length === 0) {
      setErrorMessage('Select at least one recipient.')
      return
    }

    setIsSending(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const response = await fetch('/.netlify/functions/send-bulk-club-email', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audience,
          recipients,
          cc: ccEmails,
          subject,
          message,
        }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Bulk email could not be sent.')
      }

      setSuccessMessage(`Bulk email sent to ${result.recipientCount || recipients.length} ${audience === 'parent' ? 'parent' : 'player'} contacts.`)
      setSubject('')
      setMessage('')
      setCc('')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Bulk email could not be sent.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Club Admin"
        title="Bulk email"
        description="Send one club update to selected parent or player contacts. Recipients are hidden from each other and replies go to your account email."
      />

      {errorMessage ? <NoticeBanner title="Bulk email unavailable" message={errorMessage} tone="error" /> : null}
      {successMessage ? <NoticeBanner title="Bulk email sent" message={successMessage} tone="info" /> : null}

      <form className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]" onSubmit={handleSubmit}>
        <SectionCard
          title="Message"
          description={`Reply address: ${user?.email || 'Your account email'}`}
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.values(AUDIENCES).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setAudience(option.key)}
                  className={[
                    'rounded-lg border px-4 py-3 text-left transition',
                    audience === option.key
                      ? 'border-[var(--button-primary)] bg-[var(--panel-soft)] text-[var(--text-primary)]'
                      : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-muted)] hover:bg-[var(--panel-soft)]',
                  ].join(' ')}
                >
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5">{option.description}</span>
                </button>
              ))}
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--button-primary)]"
                placeholder="Training update"
                maxLength={120}
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">CC</span>
              <input
                type="text"
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--button-primary)]"
                placeholder="name@example.com, another@example.com"
              />
              <span className="mt-2 block text-xs leading-5 text-[var(--text-muted)]">
                Separate multiple CC addresses with commas.
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Message</span>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="min-h-56 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm leading-6 text-[var(--text-primary)] outline-none transition focus:border-[var(--button-primary)]"
                placeholder="Write the email message here."
                required
              />
            </label>

            <button
              type="submit"
              disabled={isSending || selectedCount === 0}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSending ? 'Sending...' : `Send to ${selectedCount} contacts`}
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title="Recipients"
          description={`${selectedCount} of ${contactOptions.length} ${audience === 'parent' ? 'parent' : 'player'} contacts selected.`}
          actions={
            <button
              type="button"
              onClick={toggleSelectAll}
              disabled={contactOptions.length === 0}
              className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {allVisibleSelected ? 'Untick all' : 'Select all'}
            </button>
          }
        >
          {isLoading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading contacts...</p>
          ) : contactOptions.length === 0 ? (
            <p className="text-sm leading-6 text-[var(--text-muted)]">
              No {audience === 'parent' ? 'parent' : 'player'} email contacts are saved on active players yet.
            </p>
          ) : (
            <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
              {contactOptions.map((contact) => (
                <label
                  key={contact.email}
                  className="flex cursor-pointer gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-3 transition hover:bg-[var(--panel-soft)]"
                >
                  <input
                    type="checkbox"
                    checked={selectedEmails.has(contact.email)}
                    onChange={() => toggleEmail(contact.email)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--button-primary)]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                      {contact.name || contact.email}
                    </span>
                    <span className="mt-1 block break-words text-xs leading-5 text-[var(--text-muted)]">
                      {contact.email}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">
                      {contact.players.length > 0 ? contact.players.join(', ') : 'No player name linked'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </SectionCard>
      </form>
    </div>
  )
}
