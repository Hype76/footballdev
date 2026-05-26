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
  const selectedChildLabel = selectedLink
    ? [selectedLink.playerName, selectedLink.teamName, selectedLink.clubName].filter(Boolean).join(' | ')
    : 'No child selected'
  const familySummary = [
    {
      label: 'Linked children',
      value: links.length,
      caption: 'Children available to this parent account.',
    },
    {
      label: 'Accepted access',
      value: familyLinks.length,
      caption: 'Family members who can currently open this child.',
    },
    {
      label: 'Selected child',
      value: selectedLink?.playerName || 'Not selected',
      caption: selectedLink?.teamName || 'Choose a child before sharing.',
    },
  ]

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

      <section className="grid gap-4 md:grid-cols-3">
        {familySummary.map((item) => (
          <article key={item.label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">{item.label}</p>
            <p className="mt-3 break-words text-3xl font-black tracking-tight text-slate-950">{isLoadingFamilyLinks ? '...' : item.value}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 rounded-lg border border-emerald-200 bg-[#f2fbf6] p-5 shadow-sm shadow-emerald-100/70 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Sharing rule</p>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">Share one child with one controlled link.</h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
            A family link opens only the selected child. It does not expose other children, staff tools, messages for another player, or club admin records.
          </p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-white p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Current selection</p>
          <p className="mt-2 break-words text-lg font-black text-slate-950">{selectedChildLabel}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            Create a new link after selecting the child you want a family member to access.
          </p>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Family link not created" message={errorMessage} /> : null}

      <SectionCard title="Share access" description="Links are created one at a time so you control what child is shared.">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-950">Child</span>
            <select
              value={selectedLinkId}
              onChange={(event) => {
                setSelectedLinkId(event.target.value)
                setShareUrl('')
              }}
              className="min-h-12 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
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
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? 'Creating...' : 'Create Share Link'}
          </button>
        </div>

        {shareUrl ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-[#f2fbf6] p-4">
            <p className="text-sm font-black text-slate-950">Share this link</p>
            <p className="mt-2 break-all rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">{shareUrl}</p>
            <button
              type="button"
              onClick={handleCopy}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-50"
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
          <p className="rounded-lg border border-slate-200 bg-[#f8fafc] p-4 text-sm font-semibold text-slate-600">
            Loading Friends and Family access...
          </p>
        ) : familyLinks.length > 0 ? (
          <div className="space-y-3">
            {familyLinks.map((familyLink) => (
              <div
                key={familyLink.id}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/70 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="break-all text-sm font-black text-slate-950">
                    {familyLink.email || 'Email not recorded'}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Accepted {familyLink.acceptedAt ? new Date(familyLink.acceptedAt).toLocaleString() : 'date not recorded'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeFamilyLink(familyLink)}
                  disabled={revokeLinkId === familyLink.id}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {revokeLinkId === familyLink.id ? 'Removing...' : 'Revoke Access'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-[#f8fafc] p-5">
            <p className="text-sm font-black text-slate-950">No accepted access yet</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              Create a link above and share it with the family member who should be able to open this child.
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
