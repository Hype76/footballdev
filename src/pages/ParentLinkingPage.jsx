import { useEffect, useMemo, useState } from 'react'
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
const inputClass = 'min-h-12 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60'
const emptyStateClass = 'rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-bold text-slate-600'

const parentAccessRules = [
  {
    label: 'Squad only',
    body: 'Parent portal access is created only for squad players. Trial players stay private until the club moves them.',
  },
  {
    label: 'One parent, one link',
    body: 'Each parent email gets its own portal access. Do not share staff logins with families.',
  },
  {
    label: 'Remove when needed',
    body: 'Revoke a link when a parent should no longer see that player in the portal.',
  },
]

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
  const playersWithContacts = useMemo(
    () => players.filter((player) => getPlayerContacts(player).length > 0),
    [players],
  )
  const totalParentEmails = useMemo(
    () => players.reduce((total, player) => total + getPlayerContacts(player).length, 0),
    [players],
  )

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
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/80">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Parent access</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
              Give parents a clean match-day portal, not a staff login.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-slate-700">
              Invite the exact parent emails attached to squad players, then remove links when access should stop.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {parentAccessRules.map((item) => (
                <article key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
          <div className="grid content-between rounded-lg border border-slate-200 bg-slate-50 p-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Portal state</p>
              <p className="mt-2 text-xl font-black tracking-tight text-slate-950">
                {players.length} squad players available
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                {playersWithContacts.length} have parent emails ready for invite.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ParentMetric label="Squad" value={players.length} isLoading={isLoading} />
              <ParentMetric label="With email" value={playersWithContacts.length} isLoading={isLoading} />
              <ParentMetric label="Emails" value={totalParentEmails} isLoading={isLoading} />
              <ParentMetric label="Active" value={activeLinks.length} isLoading={isLoading} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">
              Parent access should mirror real squad access, not staff permissions.
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Parent linking not completed" message={errorMessage} /> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Squad players', value: players.length },
          { label: 'Selected contacts', value: selectedContactIds.length },
          { label: 'Active links', value: activeLinks.length },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">{item.label}</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Parent invites</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Send and manage access</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Choose one squad player and select parents, or invite every squad parent email in your current team.
              </p>
            </div>
            <button
              type="button"
              onClick={handleInviteAll}
              disabled={isLoading || isSending || players.length === 0}
              title={isSending ? 'Please wait while parent invites are sent.' : players.length === 0 ? 'No squad players are available for this team.' : undefined}
              className={`${primaryButtonClass} w-full sm:w-auto`}
            >
              {isSending ? 'Sending...' : 'Send invite to all'}
            </button>
          </div>
        </div>

        <div className="px-5 py-5 sm:px-6">
          {isLoading ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-bold text-slate-600">
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
                      {player.playerName} / {player.team || 'No team'} / {player.section || 'Trial'}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
                    Select all
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedContacts.length > 0 ? selectedContacts.map((contact) => (
                    <label key={contact.id} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 transition hover:bg-white">
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
                  {isSending ? 'Sending...' : 'Send selected invites'}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-black text-slate-950">Existing links for this player</p>
              <div className="mt-4 space-y-2">
                {links.length > 0 ? links.map((link) => (
                  <div key={link.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold text-slate-950">{link.email || 'Link only'}</p>
                        <p className="mt-1 text-xs font-medium text-slate-600">{link.status} / {link.linkType}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(link)}
                        disabled={isSending || isRevokingLink || link.status === 'revoked'}
                        title={link.status === 'revoked' ? 'This parent access has already been removed.' : undefined}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Remove access
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
        </div>
      </section>

      <ConfirmModal
        isOpen={Boolean(revokeTarget)}
        isBusy={isRevokingLink}
        title="Remove parent access"
        message="This removes this parent from the parent portal for the selected player."
        items={[
          `Parent: ${revokeTarget?.email || 'Selected parent'}`,
          `Player: ${selectedPlayer?.playerName || 'Selected player'}`,
        ]}
        confirmLabel="Remove access"
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void handleRevokeParentLink()}
      />
    </div>
  )
}

function ParentMetric({ isLoading, label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{isLoading ? '...' : value}</p>
    </div>
  )
}
