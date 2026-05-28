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

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-3 py-2 text-xs font-black text-[#b42318] transition hover:border-[#fda29b] hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'
const sectionHeaderClass = 'border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10'

const parentAccessRules = [
  {
    label: 'Squad players only',
    body: 'Portal access starts from saved squad player records so families only see players in the active football workspace.',
  },
  {
    label: 'One login per parent',
    body: 'Each parent email gets its own portal access. Staff accounts are never shared with families.',
  },
  {
    label: 'Access can be removed',
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
          subject: `Family portal invite for ${invite.playerName}`,
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
        message: `${revokeTarget.email || 'Parent'} can no longer access this player in the family portal.`,
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
      <section
        className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10"
        data-tour-id="parent-linking-section"
      >
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div>
            <div className="px-5 py-6 sm:px-6 lg:px-8">
              <p className={eyebrowClass}>Guardian access</p>
              <h1 className="mt-3 max-w-5xl text-3xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-4xl">
                Give every parent the right child record.
              </h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
                Invite saved parent emails, keep access tied to squad players, and remove links when a family should no longer see a player.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {parentAccessRules.map((item) => (
                  <article key={item.label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">{item.label}</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <div className="grid content-between border-t border-[#d7e5dc] bg-[#ecfdf5] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">Access state</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
                {players.length} squad players available
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                {playersWithContacts.length} have parent emails ready for invite.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ParentMetric label="Squad" value={players.length} isLoading={isLoading} />
              <ParentMetric label="With email" value={playersWithContacts.length} isLoading={isLoading} />
              <ParentMetric label="Emails" value={totalParentEmails} isLoading={isLoading} />
              <ParentMetric label="Active" value={activeLinks.length} isLoading={isLoading} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-[#4b5f55]">
              Guardian access should mirror real squad access, not staff permissions.
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
          <div key={item.label} className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#047857]">{item.label}</p>
            <p className="mt-2 text-3xl font-black text-[#101828]">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className={sectionHeaderClass}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className={eyebrowClass}>Parent invites</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Send and control guardian access</h2>
              <p className={`mt-2 max-w-3xl ${bodyTextClass}`}>
                Choose one squad player and selected saved contacts, or invite every squad parent email in the current team.
              </p>
            </div>
            <button
              type="button"
              onClick={handleInviteAll}
              disabled={isLoading || isSending || players.length === 0}
              title={isSending ? 'Please wait while parent invites are sent.' : players.length === 0 ? 'Create a squad player before sending parent invites.' : undefined}
              className={`${primaryButtonClass} w-full sm:w-auto`}
            >
              {isSending ? 'Sending...' : 'Invite all guardians'}
            </button>
          </div>
        </div>

        <div className="px-5 py-5 sm:px-6">
          {isLoading ? (
            <ParentAccessStatePanel
              action="Keep this page open while squad players, contacts, and existing links are checked."
              body="The invite controls need the current team, squad list, saved parent emails, and active portal links before access can be changed."
              eyebrow="Loading parent access"
              title="Checking who can be invited."
            />
          ) : players.length === 0 ? (
            <ParentAccessStatePanel
              action="Move the first player into Squad, add parent emails, then return here to invite families."
              body="Family portal access is limited to squad players so families only see footballers who are part of the active team."
              eyebrow="Setup required"
              title="No squad players are ready for parent access."
            />
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
                        {player.playerName}, Team: {player.team || 'No team assigned'}, Section: {player.section || 'Trial'}
                      </option>
                    ))}
                  </select>
                </label>

                <div className={panelClass}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-[#101828]">Parent emails</p>
                      <p className="mt-1 text-sm font-semibold text-[#4b5f55]">Only selected saved contacts will receive access for this player.</p>
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
                      <label key={contact.id} className="flex items-start gap-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5]">
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
                          className="mt-1 h-4 w-4 accent-[#047857]"
                        />
                        <span>
                          <span className="block font-black">{contact.name || 'Parent'}</span>
                          <span className="block text-xs font-semibold text-[#4b5f55]">{contact.email}</span>
                        </span>
                      </label>
                    )) : (
                      <ParentAccessStatePanel
                        action="Open the player profile, add at least one parent email, then return to send the invite."
                        body="The portal invite must go to a saved parent email. Staff should not create shared family access from memory."
                        eyebrow="Missing contact"
                        title="This player has no parent emails saved."
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleSendSelected}
                    disabled={isSending || selectedContactIds.length === 0}
                    title={selectedContactIds.length === 0 ? 'Select at least one parent email first.' : isSending ? 'Please wait while the invite is sent.' : undefined}
                    className={`${primaryButtonClass} mt-4 w-full sm:w-auto`}
                  >
                    {isSending ? 'Sending...' : 'Send selected access'}
                  </button>
                </div>
              </div>

              <div className={panelClass}>
                <p className="text-sm font-black text-[#101828]">Existing links for this player</p>
                <div className="mt-4 space-y-2">
                  {links.length > 0 ? links.map((link) => (
                    <div key={link.id} className="rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-black text-[#101828]">{link.email || 'Link only'}</p>
                          <p className="mt-1 text-xs font-semibold text-[#4b5f55]">Status: {link.status}, Access: {link.linkType}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRevokeTarget(link)}
                          disabled={isSending || isRevokingLink || link.status === 'revoked'}
                          title={link.status === 'revoked' ? 'This parent access has already been removed.' : undefined}
                          className={dangerButtonClass}
                        >
                          Remove access
                        </button>
                      </div>
                    </div>
                  )) : (
                    <ParentAccessStatePanel
                      action="Select parent emails and send the first invite for this player."
                      body="Existing links appear here after a parent invite is created. Use this panel to check who can still access the player."
                      eyebrow="No active access"
                      title="No parent links exist for this player yet."
                    />
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
        message="This removes this parent from the family portal for the selected player."
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
    <div className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 shadow-sm shadow-[#047857]/10">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{isLoading ? '...' : value}</p>
    </div>
  )
}

function ParentAccessStatePanel({ action, body, eyebrow = 'Parent access', title }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
      <div className="flex gap-3">
        <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white text-sm font-black text-[#047857]">
          FP
        </span>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">{eyebrow}</p>
          <p className="mt-2 text-base font-black text-[#101828]">{title}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{body}</p>
          {action ? (
            <p className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828]">
              {action}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
