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

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const inputClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-bold text-[#101828] outline-none transition focus:border-[#0f9f6e] focus:ring-2 focus:ring-[#bbf7d0]'
const chipClass = 'inline-flex w-fit whitespace-nowrap rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-3 py-1 text-xs font-black text-[#4b5f55] shadow-sm shadow-[#047857]/10'

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
    ? selectedLink.playerName
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
      caption: selectedLink ? `Team: ${selectedLink.teamName || 'No team assigned'}, Club: ${selectedLink.clubName || 'No club assigned'}` : 'Choose a child before sharing.',
    },
  ]
  const accessRules = [
    {
      title: 'One child only',
      description: 'The link opens the selected child and nothing else.',
    },
    {
      title: 'Parent portal access',
      description: 'Family members cannot see staff tools, club settings, or another child.',
    },
    {
      title: 'Revocable',
      description: 'Accepted access can be removed from this screen at any time.',
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
      <FamilyAccessHero
        accessRules={accessRules}
        familySummary={familySummary}
        isLoading={isLoadingFamilyLinks}
        selectedChildLabel={selectedChildLabel}
      />

      {errorMessage ? <NoticeBanner title="Family link not created" message={errorMessage} /> : null}

      <SectionCard title="Create family access" description="Choose the child, create one link, then send it to the family member who should receive access.">
        <div className="grid gap-4 rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 shadow-sm shadow-[#047857]/10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#101828]">Child to share</span>
            <select
              value={selectedLinkId}
              onChange={(event) => {
                setSelectedLinkId(event.target.value)
                setShareUrl('')
              }}
              className={inputClass}
            >
              {links.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.playerName}, Team: {link.teamName || 'No team assigned'}, Club: {link.clubName || 'No club assigned'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleCreateLink}
            disabled={isCreating || !selectedLink}
            title={isCreating ? 'Please wait while the family link is created.' : !selectedLink ? 'No child link is available.' : undefined}
            className={primaryButtonClass}
          >
            {isCreating ? 'Creating...' : 'Create family link'}
          </button>
        </div>

        {shareUrl ? (
          <div className="mt-5 rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 shadow-sm shadow-[#047857]/10">
            <p className="text-sm font-black text-[#101828]">Family link ready</p>
            <p className={`mt-2 ${bodyTextClass}`}>
              Send this to the family member. Once they accept it, they will appear in the accepted access list below.
            </p>
            <p className="mt-3 break-all rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-bold text-[#334155]">{shareUrl}</p>
            <button
              type="button"
              onClick={handleCopy}
              className={`mt-4 ${secondaryButtonClass}`}
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
          <p className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 text-sm font-bold text-[#4b5f55]">
            Loading family access...
          </p>
        ) : familyLinks.length > 0 ? (
          <div className="space-y-3">
            {familyLinks.map((familyLink) => (
              <div
                key={familyLink.id}
                className="flex flex-col gap-3 rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <span className={chipClass}>Accepted access</span>
                  <p className="mt-3 break-all text-sm font-black text-[#101828]">
                    {familyLink.email || 'Email not recorded'}
                  </p>
                  <p className="mt-1 text-xs font-bold text-[#4b5f55]">
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
          <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-5">
            <p className="text-sm font-black text-[#101828]">No accepted access yet</p>
            <p className={`mt-2 ${bodyTextClass}`}>
              Create a link above and share it with the family member who should be able to open this child.
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

function FamilyAccessHero({ accessRules, familySummary, isLoading, selectedChildLabel }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="px-5 py-6 sm:px-6 lg:px-8">
          <div className="max-w-5xl">
            <p className={eyebrowClass}>Family access</p>
            <h1 className="mt-3 text-3xl font-black leading-[1.06] tracking-tight text-[#101828] sm:text-4xl">
              Share one child without opening the whole club.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
              Create controlled parent-portal access for a grandparent, carer, or trusted family member who needs match day and development updates.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {familySummary.map((item) => (
                <FamilyMetric key={item.label} isLoading={isLoading} {...item} />
              ))}
            </div>
          </div>
        </div>

        <aside className="border-t border-[#d7e5dc] bg-[#ecfdf5] p-5 sm:p-6 xl:border-l xl:border-t-0">
          <div className={panelClass}>
            <p className={eyebrowClass}>Current child</p>
            <p className="mt-3 break-words text-2xl font-black tracking-tight text-[#101828]">{selectedChildLabel}</p>
            <p className="mt-2 text-sm font-black text-[#4b5f55]">
              {familySummary.find((item) => item.label === 'Selected child')?.caption}
            </p>
            <p className={`mt-3 ${bodyTextClass}`}>
              Choose the child before creating a link. Each accepted family account stays tied to that child until access is revoked.
            </p>
          </div>
          <div className="mt-4 space-y-2">
            {accessRules.map((rule) => (
              <article key={rule.title} className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-4 w-4 shrink-0 rounded-lg border border-[#0f9f6e] bg-[#bbf7d0]" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-black text-[#101828]">{rule.title}</p>
                    <p className={`mt-1 ${bodyTextClass}`}>{rule.description}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}

function FamilyMetric({ caption, isLoading, label, value }) {
  return (
    <article className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 shadow-sm shadow-[#047857]/10">
      <p className={eyebrowClass}>{label}</p>
      <p className="mt-3 break-words text-3xl font-black tracking-tight text-[#101828]">{isLoading ? '...' : value}</p>
      <p className={`mt-2 ${bodyTextClass}`}>{caption}</p>
    </article>
  )
}
