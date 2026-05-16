import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import { createFamilyShareLink } from '../lib/supabase.js'

export function FriendsFamilyPage() {
  const { updateCurrentUserDetails, user } = useAuth()
  const { showToast } = useToast()
  const links = Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
  const [selectedLinkId, setSelectedLinkId] = useState(user?.selectedParentLinkId || links[0]?.id || '')
  const [shareUrl, setShareUrl] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? links[0]

  const handleCreateLink = async () => {
    if (!selectedLink) {
      setErrorMessage('Choose a child before creating a family link.')
      return
    }

    setIsCreating(true)
    setErrorMessage('')

    try {
      const familyLink = await createFamilyShareLink({ parentLink: selectedLink })
      setShareUrl(familyLink.inviteUrl)
      showToast({ title: 'Family link created', message: 'The link is ready to share.' })
      updateCurrentUserDetails({
        selectedParentLinkId: selectedLink.id,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Family link could not be created.')
    } finally {
      setIsCreating(false)
    }
  }

  const handleCopy = async () => {
    if (!shareUrl) {
      return
    }

    await navigator.clipboard.writeText(shareUrl)
    showToast({ title: 'Link copied' })
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Parent Portal"
        title="Friends and Family"
        description="Create a share link for family access. The link only opens parent portal access for the selected child."
      />

      {errorMessage ? <NoticeBanner title="Family link not created" message={errorMessage} /> : null}

      <SectionCard title="Share access" description="Links are created one at a time so you control what child is shared.">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Child</span>
            <select
              value={selectedLinkId}
              onChange={(event) => {
                setSelectedLinkId(event.target.value)
                setShareUrl('')
              }}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              {links.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.playerName} | {link.teamName || 'No team'} | {link.clubName || 'No club'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleCreateLink}
            disabled={isCreating || !selectedLink}
            title={isCreating ? 'Please wait while the family link is created.' : !selectedLink ? 'No child link is available.' : undefined}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? 'Creating...' : 'Create Share Link'}
          </button>
        </div>

        {shareUrl ? (
          <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Share this link</p>
            <p className="mt-2 break-all text-sm text-[var(--text-muted)]">{shareUrl}</p>
            <button
              type="button"
              onClick={handleCopy}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
            >
              Copy Link
            </button>
          </div>
        ) : null}
      </SectionCard>
    </div>
  )
}
