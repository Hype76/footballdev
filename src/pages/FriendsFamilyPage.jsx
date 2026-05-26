import { useEffect, useState } from 'react'
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
  const accessRules = [
    'The link opens one selected child only.',
    'It does not show staff tools, club settings, or another child.',
    'Accepted access can be removed by the parent at any time.',
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
      <section className="overflow-hidden rounded-lg border border-[#d7eadf] bg-white shadow-sm shadow-[#d7eadf]/70">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Parent portal</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black leading-[1.04] tracking-tight text-[#10231a] sm:text-5xl">
              Give family access without opening the whole club.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4d6458]">
              Create a controlled link for the selected child. Use it when a grandparent, carer, or trusted family member needs match day and development updates.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {familySummary.map((item) => (
                <article key={item.label} className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-4 py-4 shadow-sm shadow-[#d7eadf]/60">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">{item.label}</p>
                  <p className="mt-2 break-words text-2xl font-black tracking-tight text-[#10231a]">
                    {isLoadingFamilyLinks ? '...' : item.value}
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{item.caption}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-[#bfe8cd] bg-[#effbf3] p-5 shadow-sm shadow-[#d7eadf]/70">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Current child</p>
              <p className="mt-3 break-words text-2xl font-black tracking-tight text-[#10231a]">{selectedChildLabel}</p>
              <p className="mt-3 text-sm font-semibold leading-6 text-[#4d6458]">
                Select the child first. Every family link is tied to that child and can be revoked after it has been accepted.
              </p>
            </div>
            <ul className="mt-5 space-y-2">
              {accessRules.map((rule) => (
                <li key={rule} className="flex gap-3 rounded-lg border border-[#bfe8cd] bg-white px-3 py-3 text-sm font-bold leading-5 text-[#234331]">
                  <span className="mt-1 h-4 w-4 shrink-0 rounded-full border-4 border-white bg-[#20c76a] shadow-sm shadow-[#9edbb5]" aria-hidden="true" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Family link not created" message={errorMessage} /> : null}

      <SectionCard title="Create family access" description="Choose the child, create one link, then send it to the family member who should receive access.">
        <div className="grid gap-4 rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#10231a]">Child to share</span>
            <select
              value={selectedLinkId}
              onChange={(event) => {
                setSelectedLinkId(event.target.value)
                setShareUrl('')
              }}
              className="min-h-12 w-full rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-bold text-[#10231a] outline-none transition focus:border-[#067a46] focus:ring-2 focus:ring-[#bfe8cd]"
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
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05653a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? 'Creating...' : 'Create family link'}
          </button>
        </div>

        {shareUrl ? (
          <div className="mt-5 rounded-lg border border-[#bfe8cd] bg-[#effbf3] p-4">
            <p className="text-sm font-black text-[#10231a]">Family link ready</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4d6458]">
              Send this to the family member. Once they accept it, they will appear in the accepted access list below.
            </p>
            <p className="mt-3 break-all rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-bold text-[#234331]">{shareUrl}</p>
            <button
              type="button"
              onClick={handleCopy}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-black text-[#10231a] transition hover:bg-[#f8fdf9]"
            >
              Copy link
            </button>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Accepted Friends and Family"
        description="These people can currently open the selected child in the parent portal."
      >
        {isLoadingFamilyLinks ? (
          <p className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-4 text-sm font-bold text-[#5f7468]">
            Loading family access...
          </p>
        ) : familyLinks.length > 0 ? (
          <div className="space-y-3">
            {familyLinks.map((familyLink) => (
              <div
                key={familyLink.id}
                className="flex flex-col gap-3 rounded-lg border border-[#d7eadf] bg-white p-4 shadow-sm shadow-[#d7eadf]/70 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="break-all text-sm font-black text-[#10231a]">
                    {familyLink.email || 'Email not recorded'}
                  </p>
                  <p className="mt-1 text-xs font-bold text-[#5f7468]">
                    Accepted {familyLink.acceptedAt ? new Date(familyLink.acceptedAt).toLocaleString() : 'date not recorded'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeFamilyLink(familyLink)}
                  disabled={revokeLinkId === familyLink.id}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#f2b8b5] bg-[#fff4f3] px-4 py-2 text-sm font-black text-[#9b1c17] transition hover:bg-[#ffe7e5] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {revokeLinkId === familyLink.id ? 'Removing...' : 'Revoke access'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-5">
            <p className="text-sm font-black text-[#10231a]">No accepted access yet</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">
              Create a link above and share it with the family member who should be able to open this child.
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
