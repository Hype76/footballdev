import { useEffect, useState } from 'react'
import { AddPlayerFormSection } from '../components/players/AddPlayerFormSection.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import { sendParentPortalInvite } from '../lib/email-builder.js'
import { createLimitUpgradeMessage, isWithinPlanLimit } from '../lib/plans.js'
import {
  createInitialPlayerForm,
  ensureContactsForType,
  getContactGroups,
} from '../hooks/players/addPlayerUtils.js'
import {
  addPlayerToFutureTeamEvents,
  createPlayer,
  createParentPortalInvites,
  getAvailableTeamsForUser,
  getPlayers,
  normalizePlayerContactType,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function getPlayerPortalContacts(player) {
  const contacts = Array.isArray(player?.parentContacts) && player.parentContacts.length > 0
    ? player.parentContacts
    : [{ name: player?.parentName || '', email: player?.parentEmail || '' }]

  return contacts
    .map((contact) => ({
      name: String(contact?.name ?? '').trim(),
      email: String(contact?.email ?? '').trim().toLowerCase(),
    }))
    .filter((contact) => contact.email)
}

export function AddPlayerPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'all'
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}:${activeTeamScope}` : ''
  const cacheKey = user ? `add-player:${user.id}:${user.clubId || 'platform'}:${activeTeamScope}` : ''
  const [playerForm, setPlayerForm] = useState(createInitialPlayerForm)
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [availableTeams, setAvailableTeams] = useState(() => {
    const cachedTeams = readViewCacheValue(cacheKey, 'availableTeams', [])
    return Array.isArray(cachedTeams) ? cachedTeams : []
  })
  const [isLoading, setIsLoading] = useState(() => players.length === 0 && availableTeams.length === 0)
  const [isAddingPlayer, setIsAddingPlayer] = useState(false)
  const [isSendingParentPortalLink, setIsSendingParentPortalLink] = useState(false)
  const [parentPortalInviteTarget, setParentPortalInviteTarget] = useState(null)
  const [addFutureEventsForNewPlayer, setAddFutureEventsForNewPlayer] = useState(false)
  const [sendEventInvitationsForNewPlayer, setSendEventInvitationsForNewPlayer] = useState(true)
  const [sendParentInviteForNewPlayer, setSendParentInviteForNewPlayer] = useState(true)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadData = async () => {
      setErrorMessage('')

      try {
        const [playersResult, teamsResult] = await Promise.allSettled([
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getAvailableTeamsForUser(user), 'Could not load teams.'),
        ])

        if (!isMounted) {
          return
        }

        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : []
        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : []

        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }

        if (teamsResult.status === 'rejected') {
          console.error(teamsResult.reason)
        }

        setPlayers(nextPlayers)
        setAvailableTeams(nextTeams)
        const defaultTeam =
          nextTeams.find((team) => String(team.id) === String(user?.activeTeamId || '')) ||
          nextTeams[0] ||
          null
        setPlayerForm((current) => ({
          ...current,
          teamId: current.teamId || defaultTeam?.id || '',
          team: current.team || defaultTeam?.name || '',
        }))
        writeViewCache(cacheKey, {
          players: nextPlayers,
          availableTeams: nextTeams,
        })

        if (playersResult.status === 'rejected' || teamsResult.status === 'rejected') {
          setErrorMessage('Some player setup data could not be refreshed.')
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (!cachedValue?.players) {
            setPlayers([])
          }
          if (!cachedValue?.availableTeams) {
            setAvailableTeams([])
          }
          setErrorMessage(error.message || 'Could not load player setup data.')
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
  }, [cacheKey, user, userScopeKey])

  const handlePlayerFormChange = (event) => {
    const { name, value } = event.target
    const selectedTeam = name === 'team' ? availableTeams.find((team) => String(team.id) === value) : null
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => ({
      ...current,
      [name]: name === 'contactType' ? normalizePlayerContactType(value) : selectedTeam ? selectedTeam.name : value,
      ...(selectedTeam ? { teamId: selectedTeam.id } : {}),
      parentContacts: ensureContactsForType(
        current.parentContacts,
        name === 'contactType' ? value : current.contactType,
        name === 'playerName' ? value : current.playerName,
      ),
    }))
  }

  const handleParentContactChange = (contactType, index, fieldName, value) => {
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => {
      const contacts = ensureContactsForType(current.parentContacts, current.contactType, current.playerName)
      let typedIndex = -1

      return {
        ...current,
        parentContacts: contacts.map((contact) => {
          if (contact.type !== contactType) {
            return contact
          }

          typedIndex += 1
          return typedIndex === index
            ? {
                ...contact,
                [fieldName]: value,
              }
            : contact
        }),
      }
    })
  }

  const handleAddParentContact = (contactType) => {
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => ({
      ...current,
      parentContacts: [...ensureContactsForType(current.parentContacts, current.contactType, current.playerName), { name: '', email: '', type: contactType }],
    }))
  }

  const handleRemoveParentContact = (contactType, index) => {
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => {
      const contacts = ensureContactsForType(current.parentContacts, current.contactType, current.playerName)
      let typedIndex = -1
      const nextContacts = contacts.filter((contact) => {
        if (contact.type !== contactType) {
          return true
        }

        typedIndex += 1
        return typedIndex !== index
      })

      return {
        ...current,
        parentContacts: ensureContactsForType(nextContacts, current.contactType, current.playerName),
      }
    })
  }

  const handleAddPosition = () => {
    const nextPosition = playerForm.positionDraft.trim()

    if (!nextPosition) {
      return
    }

    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => ({
      ...current,
      positions: [...new Set([...(current.positions ?? []), nextPosition])],
      positionDraft: '',
    }))
  }

  const handleRemovePosition = (positionToRemove) => {
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => ({
      ...current,
      positions: (current.positions ?? []).filter((position) => position !== positionToRemove),
    }))
  }

  const handleAddPlayer = async (event) => {
    event.preventDefault()
    setIsAddingPlayer(true)
    setMessage('')
    setErrorMessage('')

    try {
      if (!isWithinPlanLimit(user, 'players', players.length)) {
        throw new Error(createLimitUpgradeMessage(user, 'players', 'Players'))
      }

      const createdPlayer = await createPlayer({
        user,
        player: playerForm,
      })
      const nextPlayers = [...players.filter((player) => player.id !== createdPlayer.id), createdPlayer].sort((left, right) =>
        left.playerName.localeCompare(right.playerName),
      )

      setPlayers(nextPlayers)
      writeViewCache(cacheKey, {
        players: nextPlayers,
        availableTeams,
      })
      setPlayerForm({
        ...createInitialPlayerForm(),
        section: playerForm.section,
        teamId: playerForm.teamId,
        team: playerForm.team,
      })
      setMessage('Player added.')
      showToast({ title: 'Player saved', message: `${createdPlayer.playerName} has been added.` })

      setSendParentInviteForNewPlayer(getPlayerPortalContacts(createdPlayer).length > 0)
      setAddFutureEventsForNewPlayer(false)
      setSendEventInvitationsForNewPlayer(true)
      setParentPortalInviteTarget(createdPlayer)
    } catch (error) {
      console.error(error)
      const message = String(error.message ?? '')
      setErrorMessage(
        message.includes('duplicate key value')
          ? 'This player already exists. Open the existing player profile or refresh the list and try again.'
          : message || 'Could not add player.',
      )
    } finally {
      setIsAddingPlayer(false)
    }
  }

  const sendParentPortalInvitesForPlayer = async (player) => {
    const contacts = getPlayerPortalContacts(player)

    if (contacts.length === 0) {
      return []
    }

    const invites = await createParentPortalInvites({
      user,
      player,
      contacts,
    })

    await Promise.all(
      invites.map((invite) =>
        sendParentPortalInvite({
          clubId: invite.clubId,
          inviteLinkId: invite.id,
          parentEmail: invite.email,
          senderEmail: user.email,
          displayName: user.displayName || user.username || user.name,
          existingParentPortalUser: invite.existingParentPortalUser,
          teamName: invite.teamName,
          clubName: invite.clubName || user.clubName,
          playerName: invite.playerName,
          subject: `Parent portal invite for ${invite.playerName}`,
          inviteUrl: invite.inviteUrl,
        }),
      ),
    )

    return invites
  }

  const confirmNewPlayerSetup = async () => {
    if (!parentPortalInviteTarget?.id) {
      return
    }

    setIsSendingParentPortalLink(true)
    setErrorMessage('')

    try {
      let invites = []
      let eventResult = null

      if (sendParentInviteForNewPlayer) {
        invites = await sendParentPortalInvitesForPlayer(parentPortalInviteTarget)
      }

      if (addFutureEventsForNewPlayer) {
        eventResult = await addPlayerToFutureTeamEvents({
          player: parentPortalInviteTarget,
          sendInvitations: sendEventInvitationsForNewPlayer,
          user,
        })
      }

      showToast({
        title: 'Player setup updated',
        message: [
          sendParentInviteForNewPlayer
            ? invites.length > 0
              ? `${invites.length} Parent app invite${invites.length === 1 ? '' : 's'} sent.`
              : 'No new Parent app invite was needed.'
            : '',
          addFutureEventsForNewPlayer
            ? `${eventResult?.addedCount || 0} future event${eventResult?.addedCount === 1 ? '' : 's'} added.`
            : '',
        ].filter(Boolean).join(' '),
      })
      setParentPortalInviteTarget(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Parent portal invite could not be sent.')
    } finally {
      setIsSendingParentPortalLink(false)
    }
  }

  const canAddMorePlayers = isWithinPlanLimit(user, 'players', players.length)
  const playerLimitMessage = createLimitUpgradeMessage(user, 'players', 'Players')
  const normalizedContactType = normalizePlayerContactType(playerForm.contactType)
  const contactGroups = getContactGroups(normalizedContactType)
  const preparedContacts = ensureContactsForType(playerForm.parentContacts, normalizedContactType, playerForm.playerName)

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[#d7e5dc] bg-white px-5 py-5 shadow-sm shadow-[#101828]/5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Player record</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">Add Player</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
          Create a player record for this team.
        </p>
      </section>

      {errorMessage ? (
        <NoticeBanner
          title="Player setup data is not fully available"
          message={errorMessage}
        />
      ) : null}

      {message ? (
        <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#047857] shadow-sm shadow-[#047857]/10">
          {message}
        </div>
      ) : null}

      <AddPlayerFormSection
        availableTeams={availableTeams}
        canAddMorePlayers={canAddMorePlayers}
        contactGroups={contactGroups}
        isAddingPlayer={isAddingPlayer}
        isLoading={isLoading}
        normalizedContactType={normalizedContactType}
        onAddParentContact={handleAddParentContact}
        onAddPlayer={handleAddPlayer}
        onAddPosition={handleAddPosition}
        onChange={handlePlayerFormChange}
        onParentContactChange={handleParentContactChange}
        onRemoveParentContact={handleRemoveParentContact}
        onRemovePosition={handleRemovePosition}
        playerForm={playerForm}
        playerLimitMessage={playerLimitMessage}
        preparedContacts={preparedContacts}
      />

      <ConfirmModal
        isOpen={Boolean(parentPortalInviteTarget)}
        isBusy={isSendingParentPortalLink}
        title="Finish player setup"
        message={`This player has been added to ${parentPortalInviteTarget?.section || 'the team'}. Choose the access and future calendar actions to apply now.`}
        items={[
          `Player: ${parentPortalInviteTarget?.playerName || 'Selected player'}`,
          `Team: ${parentPortalInviteTarget?.team || 'No team entered'}`,
        ]}
        cancelLabel="Not now"
        confirmLabel="Apply selected options"
        onCancel={() => setParentPortalInviteTarget(null)}
        onConfirm={() => void confirmNewPlayerSetup()}
      >
        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828]">
            <input
              type="checkbox"
              checked={sendParentInviteForNewPlayer}
              disabled={getPlayerPortalContacts(parentPortalInviteTarget).length === 0}
              onChange={(event) => setSendParentInviteForNewPlayer(event.target.checked)}
              className="mt-1 h-4 w-4 accent-[#047857] disabled:cursor-not-allowed"
            />
            <span>
              <span className="block">Send Parent app invite</span>
              <span className="mt-1 block text-xs font-semibold leading-5 text-[#4b5f55]">
                {getPlayerPortalContacts(parentPortalInviteTarget).length > 0
                  ? 'Send the same secure Parent app access used for Trial and Squad players.'
                  : 'Add a parent email to this player before sending Parent app access.'}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828]">
            <input
              type="checkbox"
              checked={addFutureEventsForNewPlayer}
              onChange={(event) => setAddFutureEventsForNewPlayer(event.target.checked)}
              className="mt-1 h-4 w-4 accent-[#047857]"
            />
            <span>
              <span className="block">Add to all future team events</span>
              <span className="mt-1 block text-xs font-semibold leading-5 text-[#4b5f55]">
                Add this player to future fixtures and team calendar events without changing past events.
              </span>
            </span>
          </label>
          {addFutureEventsForNewPlayer ? (
            <label className="flex items-start gap-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828]">
              <input
                type="checkbox"
                checked={sendEventInvitationsForNewPlayer}
                onChange={(event) => setSendEventInvitationsForNewPlayer(event.target.checked)}
                className="mt-1 h-4 w-4 accent-[#047857]"
              />
              <span>
                <span className="block">Send event invitations now</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-[#4b5f55]">
                  Existing invitations are not resent and duplicate messages are blocked.
                </span>
              </span>
            </label>
          ) : null}
        </div>
      </ConfirmModal>
    </div>
  )
}
