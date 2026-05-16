import { useEffect, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import {
  createFamilyShareLink,
  getFamilyLinksForParentLink,
  revokeFamilyPortalLink,
} from '../lib/supabase.js'

export function FriendsFamilyPage() {
  const { updateCurrentUserDetails, user } = useAuth()
  const { showToast } = useToast()
  const links = Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
  const [selectedLinkId, setSelectedLinkId] = useState(user?.selectedParentLinkId || links[0]?.id || '')
  const [shareUrl, setShareUrl] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [familyLinks, setFamilyLinks] = useState([])
  const [isLoadingFamilyLinks, setIsLoadingFamilyLinks] = useState(false)
  const [revokeLinkId, setRevokeLinkId] = useState('')
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? links[0]

  useEffect(() => {
    let isCurrent = true

    async function loadFamilyLinks() {
      if (!selectedLink?.id) {
        setFamilyLinks([])
        return
      }

      setIsLoadingFamilyLinks(true)

      try {
        const loadedLinks = await getFamilyLinksForParentLink({ parentLinkId: selectedLink.id })

        if (isCurrent) {
          setFamilyLinks(loadedLinks)
        }
      } catch (error) {
        console.error(error)

        if (isCurrent) {
          setErrorMessage(error.message || 'Friends and Family access could not be loaded.')
        }
      } finally {
        if (isCurrent) {
          setIsLoadingFamilyLinks(false)
        }
      }
    }

    loadFamilyLinks()

    return () => {
      isCurrent = false
    }
  }, [selectedLink?.id])

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

  const handleRevokeFamilyLink = async (familyLink) => {
    if (!familyLink?.id) {
      return
    }

    setRevokeLinkId(familyLink.id)
    setErrorMessage('')

    try {
      await revokeFamilyPortalLink({ linkId: familyLink.id })
      setFamilyLinks((currentLinks) => currentLinks.filter((link) => link.id !== familyLink.id))
      showToast({
        title: 'Friends and Family access removed',
        message: familyLink.email ? `${familyLink.email} can no longer open this child.` : 'Access has been removed.',
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Friends and Family access could not be removed.')
    } finally {
      setRevokeLinkId('')
    }
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

      <SectionCard
        title="Accepted Friends and Family"
        description="These people can currently open the selected child in the parent portal."
      >
        {isLoadingFamilyLinks ? (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-sm text-[var(--text-muted)]">
            Loading Friends and Family access...
          </p>
        ) : familyLinks.length > 0 ? (
          <div className="space-y-3">
            {familyLinks.map((familyLink) => (
              <div
                key={familyLink.id}
                className="flex flex-col gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-[var(--text-primary)]">
                    {familyLink.email || 'Email not recorded'}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Accepted {familyLink.acceptedAt ? new Date(familyLink.acceptedAt).toLocaleString() : 'date not recorded'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeFamilyLink(familyLink)}
                  disabled={revokeLinkId === familyLink.id}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-400/50 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {revokeLinkId === familyLink.id ? 'Removing...' : 'Revoke Access'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-sm text-[var(--text-muted)]">
            No Friends and Family access has been accepted for this child yet.
          </p>
        )}
      </SectionCard>
    </div>
  )
}
