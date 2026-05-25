import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import { sendParentPortalInvite } from '../lib/email-builder.js'
import {
  createParentPortalInvites,
  createParentPortalInvitesForPlayers,
  getParentLinkingPlayers,
  getParentLinksForPlayer,
  revokeParentPortalLink,
} from '../lib/supabase.js'

function getPlayerContacts(player) {
  const contacts = Array.isArray(player?.parentContacts) && player.parentContacts.length > 0
    ? player.parentContacts
    : [{ name: player?.parentName || '', email: player?.parentEmail || '' }]

  return contacts
    .map((contact, index) => ({
      id: `${player?.id || 'player'}:${index}`,
      name: String(contact?.name ?? '').trim(),
      email: String(contact?.email ?? '').trim().toLowerCase(),
    }))
    .filter((contact) => contact.email)
}

function isSquadPlayer(player) {
  return String(player?.section ?? '').trim().toLowerCase() === 'squad'
}

const labelClass = 'mb-2 block text-sm font-bold text-slate-950'
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
const emptyStateClass = 'rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-600'

export function ParentLinkingPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [players, setPlayers] = useState([])
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [selectedContactIds, setSelectedContactIds] = useState([])
  const [links, setLinks] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRevokingLink, setIsRevokingLink] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')

  const selectedPlayer = useMemo(
    () => players.find((player) => String(player.id) === String(selectedPlayerId)) ?? null,
    [players, selectedPlayerId],
  )
  const selectedContacts = useMemo(() => getPlayerContacts(selectedPlayer), [selectedPlayer])
  const activeLinks = useMemo(() => links.filter((link) => link.status !== 'revoked'), [links])

  useEffect(() => {
    let isMounted = true

    const loadData = async () => {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const nextPlayers = (await getParentLinkingPlayers({ user })).filter(isSquadPlayer)

        if (!isMounted) {
          return
        }

        setPlayers(nextPlayers)
        const nextSelectedPlayerId = nextPlayers[0]?.id || ''
        setSelectedPlayerId(nextSelectedPlayerId)
      } catch (error) {
        console.error(error)
        if (isMounted) {
          setErrorMessage(error.message || 'Parent linking details could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadData()
    }

    return () => {
      isMounted = false
    }
  }, [user])

  useEffect(() => {
    setSelectedContactIds(selectedContacts.map((contact) => contact.id))
  }, [selectedContacts])

  useEffect(() => {
    let isMounted = true

    const loadLinks = async () => {
      if (!selectedPlayerId) {
        setLinks([])
        return
      }

      try {
        const nextLinks = await getParentLinksForPlayer({ playerId: selectedPlayerId })
        if (isMounted) {
          setLinks(nextLinks)
        }
      } catch (error) {
        console.error(error)
      }
    }

    void loadLinks()

    return () => {
      isMounted = false
    }
  }, [selectedPlayerId])

  const sendInvites = async (invites) => {
    await Promise.all(
      invites.map((invite) =>
        sendParentPortalInvite({
          clubId: invite.clubId,
          inviteLinkId: invite.id,
          parentEmail: invite.email,
          senderEmail: user.email,
          displayName: user.displayName || user.username || user.name,
          teamName: invite.teamName,
          clubName: invite.clubName || user.clubName,
          playerName: invite.playerName,
          subject: `Parent portal invite for ${invite.playerName}`,
          inviteUrl: invite.inviteUrl,
        }),
      ),
    )
  }

  const handleSendSelected = async () => {
    if (!selectedPlayer) {
      setErrorMessage('Choose a player before sending parent invites.')
      return
    }

    const contacts = selectedContacts.filter((contact) => selectedContactIds.includes(contact.id))

    setIsSending(true)
    setErrorMessage('')

    try {
      const invites = await createParentPortalInvites({
        user,
        player: selectedPlayer,
        contacts,
      })

      if (invites.length > 0) {
        await sendInvites(invites)
      }

      setLinks(await getParentLinksForPlayer({ playerId: selectedPlayer.id }))
      showToast({
        title: invites.length > 0 ? 'Invites sent' : 'No new invites needed',
        message: invites.length > 0
          ? `${invites.length} parent invite${invites.length === 1 ? '' : 's'} sent.`
          : 'Every selected parent already has an invite or link for this team.',
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Parent invites could not be sent.')
    } finally {
      setIsSending(false)
    }
  }

  const handleInviteAll = async () => {
    setIsSending(true)
    setErrorMessage('')

    try {
      const playersWithContacts = players.filter((player) => getPlayerContacts(player).length > 0)
      const invites = await createParentPortalInvitesForPlayers({
        user,
        players: playersWithContacts,
      })

      if (invites.length > 0) {
        await sendInvites(invites)
      }

      if (selectedPlayerId) {
        setLinks(await getParentLinksForPlayer({ playerId: selectedPlayerId }))
      }

      showToast({
        title: invites.length > 0 ? 'Invites sent' : 'No new invites needed',
        message: invites.length > 0
          ? `${invites.length} parent invite${invites.length === 1 ? '' : 's'} sent for this team.`
          : 'Every parent email in this team already has an invite or link.',
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Parent invites could not be sent.')
    } finally {
      setIsSending(false)
    }
  }

  const handleRevokeParentLink = async () => {
    if (!revokeTarget?.id) {
      return
    }

    setIsRevokingLink(true)
    setErrorMessage('')

    try {
      await revokeParentPortalLink({ linkId: revokeTarget.id })
      const nextLinks = selectedPlayerId ? await getParentLinksForPlayer({ playerId: selectedPlayerId }) : []
      setLinks(nextLinks)
      showToast({
        title: 'Parent access removed',
        message: `${revokeTarget.email || 'Parent'} can no longer access this player in the parent portal.`,
      })
      setRevokeTarget(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Parent access could not be removed.')
    } finally {
      setIsRevokingLink(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Parent Portal"
        title="Parent Linking"
        description="Invite parents for squad players in your team. Trial players are not available for parent portal links."
      />

      {errorMessage ? <NoticeBanner title="Parent linking not completed" message={errorMessage} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Squad players', value: players.length },
          { label: 'Selected contacts', value: selectedContactIds.length },
          { label: 'Active links', value: activeLinks.length },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">{item.label}</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-black text-emerald-950">Parent portal rule</p>
        <p className="mt-1 text-sm leading-6 text-emerald-900">
          Parent access is only created for squad players. Select the exact parent emails that should receive access, then revoke links here when access needs to stop.
        </p>
      </div>

      <SectionCard
        title="Send parent invites"
        description="Choose one squad player and select parents, or invite every squad parent email in your current team."
        actions={
          <button
            type="button"
            onClick={handleInviteAll}
            disabled={isLoading || isSending || players.length === 0}
            title={isSending ? 'Please wait while parent invites are sent.' : players.length === 0 ? 'No squad players are available for this team.' : undefined}
            className={`${primaryButtonClass} w-full sm:w-auto`}
          >
            {isSending ? 'Sending...' : 'Send Invite To All'}
          </button>
        }
      >
        {isLoading ? (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-600">
            Loading parent linking...
          </p>
        ) : players.length === 0 ? (
          <p className={emptyStateClass}>
            No squad players are available for parent portal links yet.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
            <div className="space-y-4">
              <label className="block">
                <span className={labelClass}>Player</span>
                <select
                  value={selectedPlayerId}
                  onChange={(event) => setSelectedPlayerId(event.target.value)}
                  className={inputClass}
                >
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.playerName} | {player.team || 'No team'} | {player.section || 'Trial'}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-slate-950">Parent emails</p>
                    <p className="mt-1 text-sm text-slate-600">Only selected emails will receive this player invite.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedContactIds(selectedContacts.map((contact) => contact.id))}
                    className={secondaryButtonClass}
                  >
                    Select All
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedContacts.length > 0 ? selectedContacts.map((contact) => (
                    <label key={contact.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 transition hover:bg-white">
                      <input
                        type="checkbox"
                        checked={selectedContactIds.includes(contact.id)}
                        onChange={() =>
                          setSelectedContactIds((current) =>
                            current.includes(contact.id)
                              ? current.filter((item) => item !== contact.id)
                              : [...current, contact.id],
                          )
                        }
                        className="mt-1 h-4 w-4 accent-emerald-700"
                      />
                      <span>
                        <span className="block font-bold">{contact.name || 'Parent'}</span>
                        <span className="block text-xs font-medium text-slate-600">{contact.email}</span>
                      </span>
                    </label>
                  )) : (
                    <p className={emptyStateClass}>
                      This player does not have parent emails saved yet.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSendSelected}
                  disabled={isSending || selectedContactIds.length === 0}
                  title={selectedContactIds.length === 0 ? 'Select at least one parent email first.' : isSending ? 'Please wait while the invite is sent.' : undefined}
                  className={`${primaryButtonClass} mt-4 w-full sm:w-auto`}
                >
                  {isSending ? 'Sending...' : 'Send Selected Invites'}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-black text-slate-950">Existing links for this player</p>
              <div className="mt-4 space-y-2">
                {links.length > 0 ? links.map((link) => (
                  <div key={link.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold text-slate-950">{link.email || 'Link only'}</p>
                        <p className="mt-1 text-xs font-medium text-slate-600">{link.status} | {link.linkType}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(link)}
                        disabled={isSending || isRevokingLink || link.status === 'revoked'}
                        title={link.status === 'revoked' ? 'This parent access has already been removed.' : undefined}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Remove Access
                      </button>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm font-medium text-slate-600">No parent links created for this player yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      <ConfirmModal
        isOpen={Boolean(revokeTarget)}
        isBusy={isRevokingLink}
        title="Remove parent access"
        message="This removes this parent from the parent portal for the selected player."
        items={[
          `Parent: ${revokeTarget?.email || 'Selected parent'}`,
          `Player: ${selectedPlayer?.playerName || 'Selected player'}`,
        ]}
        confirmLabel="Remove Access"
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void handleRevokeParentLink()}
      />
    </div>
  )
}
