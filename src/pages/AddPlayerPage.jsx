import { useEffect, useState } from 'react'
import { AddPlayerFormSection } from '../components/players/AddPlayerFormSection.jsx'
import { RecentlyAddedPlayersSection } from '../components/players/RecentlyAddedPlayersSection.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { useToast } from '../components/ui/toast-context.js'
import { useAuth } from '../lib/auth.js'
import { sendParentPortalInvite } from '../lib/email-builder.js'
import { createLimitUpgradeMessage, isWithinPlanLimit } from '../lib/plans.js'
import {
  RECENT_PLAYER_PAGE_SIZE,
  createInitialPlayerForm,
  ensureContactsForType,
  getContactGroups,
} from '../hooks/players/addPlayerUtils.js'
import {
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

const playerIntakeRules = [
  {
    label: 'Search before adding',
    body: 'One footballer should have one record. Use the recent list and register before creating a duplicate.',
  },
  {
    label: 'Start with status',
    body: 'Choose Trial or Squad at intake so sessions, parent invites, and match day know how to use the player.',
  },
  {
    label: 'Contacts unlock parents',
    body: 'Add the right parent or player email now if the portal invite should be available straight away.',
  },
]

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

      if (String(createdPlayer.section ?? '').trim().toLowerCase() === 'squad' && getPlayerPortalContacts(createdPlayer).length > 0) {
        setParentPortalInviteTarget(createdPlayer)
      }
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

  const confirmSendParentPortalLink = async () => {
    if (!parentPortalInviteTarget?.id) {
      return
    }

    setIsSendingParentPortalLink(true)
    setErrorMessage('')

    try {
      const invites = await sendParentPortalInvitesForPlayer(parentPortalInviteTarget)
      showToast({
        title: invites.length > 0 ? 'Parent invite sent' : 'No new invite needed',
        message: invites.length > 0
          ? `${invites.length} parent invite${invites.length === 1 ? '' : 's'} sent.`
          : 'Every parent email already has an invite or link for this team.',
      })
      setParentPortalInviteTarget(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Parent portal invite could not be sent.')
    } finally {
      setIsSendingParentPortalLink(false)
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
  const trialPlayerCount = players.filter((player) => player.section === 'Trial').length
  const squadPlayerCount = players.filter((player) => player.section === 'Squad').length
  const playerContactCount = players.filter((player) => getPlayerPortalContacts(player).length > 0).length
  const remainingPlayerCapacity = canAddMorePlayers ? 'Open' : 'Limit'

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/80">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Player intake</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight text-[#101828] sm:text-5xl">Add player</h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475467]">
              Create one footballer record with a team, Trial or Squad status, positions, and the contacts needed for parent communication.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {playerIntakeRules.map((item) => (
                <article key={item.label} className="rounded-lg border border-slate-200 bg-[#f9fafb] p-4 shadow-sm shadow-slate-200/60">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
          <div className="grid content-between rounded-lg border border-slate-200 bg-[#f9fafb] p-5 shadow-sm shadow-slate-200/70">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#667085]">Intake state</p>
              <p className="mt-2 text-xl font-black tracking-tight text-[#101828]">
                {players.length} footballers already registered
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">
                Add the next player only after the current register has been checked.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <IntakeMetric label="Trial" value={trialPlayerCount} isLoading={isLoading} />
              <IntakeMetric label="Squad" value={squadPlayerCount} isLoading={isLoading} />
              <IntakeMetric label="Contacts" value={playerContactCount} isLoading={isLoading} />
              <IntakeMetric label="Capacity" value={remainingPlayerCapacity} isLoading={isLoading} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-[#667085]">
              Squad players with contact emails can be invited to the parent portal straight after save.
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <NoticeBanner
          title="Player setup data is not fully available"
          message={errorMessage}
        />
      ) : null}

      {message ? (
        <div className="rounded-lg border border-[#b7efce] bg-[#ecfdf3] px-4 py-3 text-sm font-black text-[#067a46] shadow-sm shadow-slate-200/60">
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

      <ConfirmModal
        isOpen={Boolean(parentPortalInviteTarget)}
        isBusy={isSendingParentPortalLink}
        title="Send parent portal link"
        message="This player has been added straight to Squad. Send the parent portal invite now?"
        items={[
          `Player: ${parentPortalInviteTarget?.playerName || 'Selected player'}`,
          `Team: ${parentPortalInviteTarget?.team || 'No team entered'}`,
        ]}
        cancelLabel="Not now"
        confirmLabel="Send parent link"
        onCancel={() => setParentPortalInviteTarget(null)}
        onConfirm={() => void confirmSendParentPortalLink()}
      />
    </div>
  )
}

function IntakeMetric({ isLoading, label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm shadow-slate-200/60">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#067a46]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{isLoading ? '...' : value}</p>
    </div>
  )
}
