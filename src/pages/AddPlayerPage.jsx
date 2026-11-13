import { useEffect, useRef, useState } from 'react'
import { AddPlayerFormSection } from '../components/players/AddPlayerFormSection.jsx'
import { useClubPlayerTypes } from '../hooks/players/useClubPlayerTypes.js'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import { CAPABILITIES } from '../lib/paywall-access.js'
import { canUseUiFeature, createUiFeatureUnavailableMessage } from '../lib/paywall-ui.js'
import { sendAdultPlayerSetupInvite, sendParentPortalInvite } from '../lib/email-builder.js'
import { getAdultPlayerSetupEmail, isAdultPlayerBirthDate } from '../lib/adult-player-setup.js'
import { getPlayerParentInviteContacts } from '../lib/parent-portal-invite-actions.js'
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

export function AddPlayerPage() {
  const { user } = useAuth()
  const playerTypes = useClubPlayerTypes(user?.clubId)
  const { showToast } = useToast()
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'all'
  const canCreatePlayers = canUseUiFeature(user, CAPABILITIES.players)
  const canCreateTrialPlayers = canUseUiFeature(user, CAPABILITIES.trialPlayers)
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
  const [isUpdatingEvents, setIsUpdatingEvents] = useState(false)
  const [eventSetupPlayer, setEventSetupPlayer] = useState(null)
  const [addFutureEventsForNewPlayer, setAddFutureEventsForNewPlayer] = useState(false)
  const [sendEventInvitationsForNewPlayer, setSendEventInvitationsForNewPlayer] = useState(true)
  const [savedPlayerForRetry, setSavedPlayerForRetry] = useState(null)
  const saveLock = useRef(false)
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
          section: current.section === 'Trial' && !canCreateTrialPlayers ? 'Squad' : current.section,
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
  }, [cacheKey, canCreateTrialPlayers, user, userScopeKey])

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
    if (saveLock.current) return
    saveLock.current = true
    setIsAddingPlayer(true)
    setMessage('')
    setErrorMessage('')

    try {
      if (savedPlayerForRetry) {
        await finishPlayerSave(savedPlayerForRetry)
        return
      }
      if (!canCreatePlayers) throw new Error(createUiFeatureUnavailableMessage(user, CAPABILITIES.players))
      if (String(playerForm.section).toLowerCase() === 'trial' && !canCreateTrialPlayers) {
        throw new Error(createUiFeatureUnavailableMessage(user, CAPABILITIES.trialPlayers))
      }
      if (!isWithinPlanLimit(user, 'players', players.length)) {
        throw new Error(createLimitUpgradeMessage(user, 'players', 'Players'))
      }

      const form = {
        ...playerForm,
        parentContacts: ensureContactsForType(playerForm.parentContacts, playerForm.contactType, playerForm.playerName),
        dateOfBirth: playerForm.contactType === 'self' ? playerForm.dateOfBirth : '',
      }
      if (form.dateOfBirth && !isAdultPlayerBirthDate(form.dateOfBirth)) {
        throw new Error('Enter a date of birth confirming the player is 18 or over.')
      }
      if (form.contactType === 'self' && form.parentContacts.some(contact => contact.email.trim()) && !getAdultPlayerSetupEmail(form)) {
        throw new Error('Enter one valid email address for the adult player.')
      }
      const createdPlayer = await createPlayer({ user, player: form })
      const nextPlayers = [...players.filter((player) => player.id !== createdPlayer.id), createdPlayer].sort((left, right) =>
        left.playerName.localeCompare(right.playerName),
      )

      setPlayers(nextPlayers)
      writeViewCache(cacheKey, {
        players: nextPlayers,
        availableTeams,
      })
      setMessage('Player added.')
      await finishPlayerSave(createdPlayer)
    } catch (error) {
      console.error(error)
      const message = String(error.message ?? '')
      setErrorMessage(
        message.includes('duplicate key value')
          ? 'This player already exists. Open the existing player profile or refresh the list and try again.'
          : message || 'Could not add player.',
      )
    } finally {
      saveLock.current = false
      setIsAddingPlayer(false)
    }
  }

  const sendParentPortalInvitesForPlayer = async (player) => {
    const contacts = getPlayerParentInviteContacts(player)
    if (!contacts.length || !canUseUiFeature(user, CAPABILITIES.parentInvitations, { teamId: player.teamId })) return 0
    const invites = await createParentPortalInvites({ user, player, contacts, automatic: true })
    const results = await Promise.allSettled(invites.map(invite =>
      sendParentPortalInvite({ inviteLinkId: invite.id, senderEmail: user.email, automatic: true }),
    ))
    if (results.some(result => result.status === 'rejected')) throw new Error('A Parent app invitation could not be sent.')
    return results.filter(result => result.status === 'fulfilled' && !result.value.skipped).length
  }

  const finishPlayerSave = async (player) => {
    const adultReady = Boolean(getAdultPlayerSetupEmail(player)) && isAdultPlayerBirthDate(player.dateOfBirth)
    const results = await Promise.allSettled([
      sendParentPortalInvitesForPlayer(player),
      adultReady ? sendAdultPlayerSetupInvite(player.id) : null,
    ])
    const failure = results.find(result => result.status === 'rejected')
    if (failure) {
      setSavedPlayerForRetry(player)
      setErrorMessage(`Player saved. ${failure.reason?.message || 'An invitation could not be sent.'} Select Save Player to retry.`)
      return
    }

    const parentCount = results[0].value
    const summary = [
      parentCount ? `${parentCount} Parent app invite${parentCount === 1 ? '' : 's'} sent.` : '',
      results[1].value?.state === 'sent' ? 'Player login invitation sent.' : '',
      player.contactType === 'self' && !adultReady
        ? 'Player login requires one Player email and a date of birth confirming they are 18 or over.'
        : '',
    ].filter(Boolean).join(' ')
    setSavedPlayerForRetry(null)
    setMessage(summary || 'Player added.')
    showToast({ title: 'Player saved', message: summary || `${player.playerName} has been added.` })
    setPlayerForm(current => ({
      ...createInitialPlayerForm(),
      section: current.section,
      teamId: current.teamId,
      team: current.team,
    }))
    setAddFutureEventsForNewPlayer(false)
    setSendEventInvitationsForNewPlayer(true)
    setEventSetupPlayer(player)
  }

  const confirmFutureEventSetup = async () => {
    if (!eventSetupPlayer?.id || !addFutureEventsForNewPlayer) {
      setEventSetupPlayer(null)
      return
    }

    setIsUpdatingEvents(true)
    setErrorMessage('')
    try {
      const result = await addPlayerToFutureTeamEvents({
        player: eventSetupPlayer,
        sendInvitations: sendEventInvitationsForNewPlayer,
        user,
      })
      const count = result?.addedCount || 0
      showToast({ title: 'Future events updated', message: `${count} future event${count === 1 ? '' : 's'} added.` })
      setEventSetupPlayer(null)
    } catch (error) {
      setErrorMessage(error.message || 'Future team events could not be updated.')
    } finally {
      setIsUpdatingEvents(false)
    }
  }

  const canAddMorePlayers = Boolean(savedPlayerForRetry) || (canCreatePlayers && isWithinPlanLimit(user, 'players', players.length))
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
          title={savedPlayerForRetry ? 'Invitation could not be sent' : 'Player setup data is not fully available'}
          message={errorMessage}
        />
      ) : null}

      {message ? (
        <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#047857] shadow-sm shadow-[#047857]/10">
          {message}
        </div>
      ) : null}

      <AddPlayerFormSection
        playerTypes={playerTypes}
        availableTeams={availableTeams}
        canAddMorePlayers={canAddMorePlayers}
        contactGroups={contactGroups}
        isAddingPlayer={isAddingPlayer}
        isLoading={isLoading}
        normalizedContactType={normalizedContactType}
        onAddParentContact={handleAddParentContact}
        onAddPlayer={handleAddPlayer}
        onSkipFailedInvitation={savedPlayerForRetry ? () => {
          setSavedPlayerForRetry(null)
          setEventSetupPlayer(savedPlayerForRetry)
          setErrorMessage('')
          setMessage('Player saved. Open their profile and save again to retry the invitation.')
          setPlayerForm(current => ({ ...createInitialPlayerForm(), section: current.section, teamId: current.teamId, team: current.team }))
        } : null}
        onAddPosition={handleAddPosition}
        onChange={handlePlayerFormChange}
        onParentContactChange={handleParentContactChange}
        onRemoveParentContact={handleRemoveParentContact}
        onRemovePosition={handleRemovePosition}
        playerForm={playerForm}
        playerLimitMessage={playerLimitMessage}
        preparedContacts={preparedContacts}
        allowTrialPlayers={canCreateTrialPlayers}
      />

      <ConfirmModal
        isOpen={Boolean(eventSetupPlayer)}
        isBusy={isUpdatingEvents}
        title="Add player to future events?"
        message="You can add this player to upcoming team events and choose whether to send event invitations."
        items={[
          `Player: ${eventSetupPlayer?.playerName || 'Selected player'}`,
          `Team: ${eventSetupPlayer?.team || 'No team entered'}`,
        ]}
        cancelLabel="Not now"
        confirmLabel="Apply selected options"
        onCancel={() => setEventSetupPlayer(null)}
        onConfirm={() => void confirmFutureEventSetup()}
      >
        <div className="space-y-3">
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
