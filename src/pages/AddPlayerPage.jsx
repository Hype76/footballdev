import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { useAuth } from '../lib/auth.js'
import {
  EVALUATION_SECTIONS,
  createPlayer,
  getAvailableTeamsForUser,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function createInitialPlayerForm() {
  return {
    playerName: '',
    section: 'Trial',
    team: '',
    positions: [],
    positionDraft: '',
    parentContacts: [{ name: '', email: '' }],
  }
}

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
      [name]: value,
    }))
  }

  const handleParentContactChange = (index, fieldName, value) => {
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => ({
      ...current,
      parentContacts: current.parentContacts.map((contact, contactIndex) =>
        contactIndex === index
          ? {
              ...contact,
              [fieldName]: value,
            }
          : contact,
      ),
    }))
  }

  const handleAddParentContact = () => {
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => ({
      ...current,
      parentContacts: [...current.parentContacts, { name: '', email: '' }],
    }))
  }

  const handleRemoveParentContact = (index) => {
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => ({
      ...current,
      parentContacts:
        current.parentContacts.length > 1
          ? current.parentContacts.filter((_, contactIndex) => contactIndex !== index)
          : [{ name: '', email: '' }],
    }))
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
      setErrorMessage(error.message || 'Could not add player.')
    } finally {
      setIsAddingPlayer(false)
    }
  }

  const recentPlayers = [...players]
    .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
    .slice(0, 8)

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Add Player"
        title="Add player"
        description="Create a Trial or Squad player record, assign the team, and add parent contact details."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Player setup data is not fully available"
          message={errorMessage}
        />
      ) : null}

      {message ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {message}
        </div>
      ) : null}

      <SectionCard
        title="Player details"
        description="Add the player once, then start assessments from the player profile."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading player setup...
          </div>
        ) : availableTeams.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No teams are available yet. Create a team first, then add players into Trial or Squad.
          </div>
        ) : (
          <form className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4" onSubmit={handleAddPlayer}>
            <label className="block xl:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Name</span>
              <input
                type="text"
                name="playerName"
                value={playerForm.playerName}
                onChange={handlePlayerFormChange}
                required
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Section</span>
              <select
                name="section"
                value={playerForm.section}
                onChange={handlePlayerFormChange}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {EVALUATION_SECTIONS.map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
              <select
                name="team"
                value={playerForm.team}
                onChange={handlePlayerFormChange}
                required
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                <option value="">Select team</option>
                {availableTeams.map((team) => (
                  <option key={team.id} value={team.name}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isAddingPlayer}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAddingPlayer ? 'Adding...' : 'Add Player'}
              </button>
            </div>

            <div className="lg:col-span-2 xl:col-span-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">Parent Contacts</span>
                <button
                  type="button"
                  onClick={handleAddParentContact}
                  className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                >
                  Add Parent
                </button>
              </div>
              <div className="space-y-3">
                {playerForm.parentContacts.map((contact, index) => (
                  <div key={index} className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Name</span>
                        <input
                          type="text"
                          value={contact.name}
                          onChange={(event) => handleParentContactChange(index, 'name', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Email</span>
                        <input
                          type="email"
                          value={contact.email}
                          onChange={(event) => handleParentContactChange(index, 'email', event.target.value)}
                          className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveParentContact(index)}
                      className="mt-3 inline-flex min-h-10 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                    >
                      Remove Parent
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-2 xl:col-span-4">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Player Positions</span>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  name="positionDraft"
                  value={playerForm.positionDraft}
                  onChange={handlePlayerFormChange}
                  placeholder="Add position, for example Striker"
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={handleAddPosition}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
                >
                  Add Position
                </button>
              </div>
              {playerForm.positions.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {playerForm.positions.map((position) => (
                    <button
                      key={position}
                      type="button"
                      onClick={() => handleRemovePosition(position)}
                      className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                    >
                      {position} remove
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Add one or more positions for this player.</p>
              )}
            </div>

          </form>
        )}
      </SectionCard>

      <SectionCard
        title="Recently added"
        description="Open a player profile to edit details or start an assessment."
      >
        {recentPlayers.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No player records yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {recentPlayers.map((player) => (
              <Link
                key={player.id}
                to={`/player/${encodeURIComponent(player.playerName)}`}
                className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 transition hover:bg-[var(--panel-soft)]"
              >
                <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
                <p className="mt-2 text-sm text-[var(--text-muted)]">{player.section} | {player.team || 'No team'}</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
