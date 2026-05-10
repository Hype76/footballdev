import { useEffect, useState } from 'react'
import { AddPlayerFormSection } from '../components/players/AddPlayerFormSection.jsx'
import { RecentlyAddedPlayersSection } from '../components/players/RecentlyAddedPlayersSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useAuth } from '../lib/auth.js'
import { createLimitUpgradeMessage, isWithinPlanLimit } from '../lib/plans.js'
import {
  RECENT_PLAYER_PAGE_SIZE,
  createInitialPlayerForm,
  ensureContactsForType,
  getContactGroups,
} from '../hooks/players/addPlayerUtils.js'
import {
  createPlayer,
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
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}` : ''
  const cacheKey = user ? `add-player:${user.id}:${user.clubId || 'platform'}` : ''
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
  const [recentPlayerPage, setRecentPlayerPage] = useState(1)
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
        setPlayerForm((current) => ({
          ...current,
          team: current.team || nextTeams[0]?.name || '',
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
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => ({
      ...current,
      [name]: name === 'contactType' ? normalizePlayerContactType(value) : value,
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
        team: playerForm.team,
      })
      setMessage('Player added.')
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

  const recentPlayers = [...players]
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
  const paginatedRecentPlayers = getPaginatedItems(recentPlayers, recentPlayerPage, RECENT_PLAYER_PAGE_SIZE)
  const canAddMorePlayers = isWithinPlanLimit(user, 'players', players.length)
  const playerLimitMessage = createLimitUpgradeMessage(user, 'players', 'Players')
  const normalizedContactType = normalizePlayerContactType(playerForm.contactType)
  const contactGroups = getContactGroups(normalizedContactType)
  const preparedContacts = ensureContactsForType(playerForm.parentContacts, normalizedContactType, playerForm.playerName)

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Add Player"
        title="Add player"
        description="Create a Trial or Squad player record, assign the team, and add the right contact details."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Player setup data is not fully available"
          message={errorMessage}
        />
      ) : null}

      {message ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
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

      <RecentlyAddedPlayersSection
        onPageChange={setRecentPlayerPage}
        pageSize={RECENT_PLAYER_PAGE_SIZE}
        paginatedRecentPlayers={paginatedRecentPlayers}
        recentPlayerPage={recentPlayerPage}
        recentPlayers={recentPlayers}
      />
    </div>
  )
}
