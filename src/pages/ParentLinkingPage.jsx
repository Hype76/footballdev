import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import { sendParentPortalInvite } from '../lib/email-builder.js'
import {
  createParentPortalInvites,
  createParentPortalInvitesForPlayers,
  getParentLinkingPlayers,
  getParentLinksForPlayer,
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

export function ParentLinkingPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [players, setPlayers] = useState([])
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [selectedContactIds, setSelectedContactIds] = useState([])
  const [links, setLinks] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const selectedPlayer = useMemo(
    () => players.find((player) => String(player.id) === String(selectedPlayerId)) ?? null,
    [players, selectedPlayerId],
  )
  const selectedContacts = useMemo(() => getPlayerContacts(selectedPlayer), [selectedPlayer])

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

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Parent Portal"
        title="Parent Linking"
        description="Invite parents for squad players in your team. Trial players are not available for parent portal links."
      />

      {errorMessage ? <NoticeBanner title="Parent linking not completed" message={errorMessage} /> : null}

      <SectionCard
        title="Send parent invites"
        description="Choose one squad player and select parents, or invite every squad parent email in your current team."
        actions={
          <button
            type="button"
            onClick={handleInviteAll}
            disabled={isLoading || isSending || players.length === 0}
            title={isSending ? 'Please wait while parent invites are sent.' : players.length === 0 ? 'No squad players are available for this team.' : undefined}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSending ? 'Sending...' : 'Send Invite To All'}
          </button>
        }
      >
        {isLoading ? (
          <p className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            Loading parent linking...
          </p>
        ) : players.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
            No squad players are available for parent portal links yet.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player</span>
                <select
                  value={selectedPlayerId}
                  onChange={(event) => setSelectedPlayerId(event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                >
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.playerName} | {player.team || 'No team'} | {player.section || 'Trial'}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Parent emails</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">Only selected emails will receive this player invite.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedContactIds(selectedContacts.map((contact) => contact.id))}
                    className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)]"
                  >
                    Select All
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedContacts.length > 0 ? selectedContacts.map((contact) => (
                    <label key={contact.id} className="flex items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)]">
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
                        className="mt-1 h-4 w-4 accent-[var(--accent)]"
                      />
                      <span>
                        <span className="block font-semibold">{contact.name || 'Parent'}</span>
                        <span className="block text-xs text-[var(--text-muted)]">{contact.email}</span>
                      </span>
                    </label>
                  )) : (
                    <p className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-muted)]">
                      This player does not have parent emails saved yet.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSendSelected}
                  disabled={isSending || selectedContactIds.length === 0}
                  title={selectedContactIds.length === 0 ? 'Select at least one parent email first.' : isSending ? 'Please wait while the invite is sent.' : undefined}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {isSending ? 'Sending...' : 'Send Selected Invites'}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Existing links for this player</p>
              <div className="mt-4 space-y-2">
                {links.length > 0 ? links.map((link) => (
                  <div key={link.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                    <p className="break-words text-sm font-semibold text-[var(--text-primary)]">{link.email || 'Link only'}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{link.status} | {link.linkType}</p>
                  </div>
                )) : (
                  <p className="text-sm text-[var(--text-muted)]">No parent links created for this player yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
