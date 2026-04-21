import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { StatusBadge } from '../components/ui/StatusBadge.jsx'
import { useAuth } from '../lib/auth.js'
import {
  EVALUATION_SECTIONS,
  createPlayer,
  getAvailableTeamsForUser,
  getEvaluations,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function getScoreIndicator(averageScore) {
  if (averageScore === null) {
    return 'Average'
  }

  const isFivePointScale = averageScore <= 5
  const isStrong = isFivePointScale ? averageScore >= 4 : averageScore >= 8
  const needsWork = isFivePointScale ? averageScore < 3 : averageScore < 6

  if (isStrong) {
    return 'Strong'
  }

  if (needsWork) {
    return 'Needs Work'
  }

  return 'Average'
}

function isNewEvaluation(evaluation) {
  const timestamp = Number(evaluation.createdAt ?? evaluation.id)

  if (Number.isNaN(timestamp)) {
    return false
  }

  return Date.now() - timestamp <= 10 * 60 * 1000
}

export function DashboardPage() {
  const { user } = useAuth()
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}` : ''
  const cacheKey = user ? `dashboard:${user.id}:${user.clubId || 'platform'}` : ''
  const [selectedTeam, setSelectedTeam] = useState('All')
  const [selectedSection, setSelectedSection] = useState('Trial')
  const [playerForm, setPlayerForm] = useState({
    playerName: '',
    section: 'Trial',
    team: '',
    parentName: '',
    parentEmail: '',
  })
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [availableTeams, setAvailableTeams] = useState(() => {
    const cachedTeams = readViewCacheValue(cacheKey, 'availableTeams', [])
    return Array.isArray(cachedTeams) ? cachedTeams : []
  })
  const [evaluations, setEvaluations] = useState(() => {
    const cachedEvaluations = readViewCacheValue(cacheKey, 'evaluations', [])
    return Array.isArray(cachedEvaluations) ? cachedEvaluations : []
  })
  const [isLoading, setIsLoading] = useState(() => evaluations.length === 0 && players.length === 0)
  const [isAddingPlayer, setIsAddingPlayer] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadDashboardData = async () => {
      setErrorMessage('')

      try {
        const [evaluationsResult, playersResult, teamsResult] = await Promise.allSettled([
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load evaluations.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getAvailableTeamsForUser(user), 'Could not load teams.'),
        ])

        if (!isMounted) {
          return
        }

        const nextEvaluations = evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : []
        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : []
        const hasFailure =
          evaluationsResult.status === 'rejected' || playersResult.status === 'rejected' || teamsResult.status === 'rejected'

        if (evaluationsResult.status === 'rejected') {
          console.error(evaluationsResult.reason)
        }

        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }

        if (teamsResult.status === 'rejected') {
          console.error(teamsResult.reason)
        }

        setEvaluations(nextEvaluations)
        setPlayers(nextPlayers)
        setAvailableTeams(nextTeams)
        writeViewCache(cacheKey, {
          evaluations: nextEvaluations,
          players: nextPlayers,
          availableTeams: nextTeams,
        })
        setPlayerForm((current) => ({
          ...current,
          team: current.team || nextTeams[0]?.name || '',
        }))

        if (hasFailure) {
          setErrorMessage('Some dashboard data could not be refreshed.')
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (!cachedValue?.evaluations) {
            setEvaluations([])
          }
          if (!cachedValue?.players) {
            setPlayers([])
          }
          setErrorMessage(error.message || 'Could not load evaluations.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadDashboardData()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, user, userScopeKey])

  const filteredBySection = useMemo(
    () => evaluations.filter((evaluation) => (selectedSection ? evaluation.section === selectedSection : true)),
    [evaluations, selectedSection],
  )

  const sectionPlayers = useMemo(
    () => players.filter((player) => player.section === selectedSection),
    [players, selectedSection],
  )
  const teamOptions = [
    'All',
    ...new Set([
      ...availableTeams.map((team) => team.name).filter(Boolean),
      ...sectionPlayers.map((player) => player.team).filter(Boolean),
      ...filteredBySection.map((evaluation) => evaluation.team).filter(Boolean),
    ]),
  ]
  const filteredEvaluations =
    selectedTeam === 'All'
      ? filteredBySection
      : filteredBySection.filter((evaluation) => evaluation.team === selectedTeam)

  const filteredPlayers =
    selectedTeam === 'All'
      ? sectionPlayers
      : sectionPlayers.filter((player) => player.team === selectedTeam)

  const playerSummaries = Array.from(
    [...filteredPlayers, ...filteredEvaluations].reduce((map, item) => {
      const playerName = item.playerName
      const existing = map.get(playerName)
      const matchingEvaluation = filteredEvaluations.find((evaluation) => evaluation.playerName === playerName)

      map.set(playerName, {
        playerName,
        lastScore: matchingEvaluation?.averageScore ?? item.averageScore ?? existing?.lastScore ?? null,
        team: item.team || matchingEvaluation?.team || existing?.team || '',
        section: item.section || matchingEvaluation?.section || selectedSection,
        parentName: item.parentName || existing?.parentName || '',
        parentEmail: item.parentEmail || existing?.parentEmail || '',
      })

      return map
    }, new Map()).values(),
  )

  const handlePlayerFormChange = (event) => {
    const { name, value } = event.target
    setMessage('')
    setErrorMessage('')
    setPlayerForm((current) => ({
      ...current,
      [name]: value,
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
        evaluations,
        players: nextPlayers,
        availableTeams,
      })
      setPlayerForm({
        playerName: '',
        section: selectedSection,
        team: playerForm.team,
        parentName: '',
        parentEmail: '',
      })
      setMessage('Player added.')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not add player.')
    } finally {
      setIsAddingPlayer(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title="Club assessments"
        description="Switch between Trial and Squad sections, then start a new assessment or review recent activity."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Recent assessments are unavailable right now"
          message="The dashboard could not refresh live data. If this club is new, add your first assessment. Otherwise try again in a moment."
        />
      ) : null}

      {message ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {message}
        </div>
      ) : null}

      <SectionCard
        title="Sections"
        description="Trial and Squad stay separate so each workflow keeps its own player list and recent assessments."
      >
        <div className="flex flex-wrap gap-3">
          {EVALUATION_SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setSelectedSection(section)}
              className={[
                'inline-flex min-h-11 items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition',
                selectedSection === section
                  ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                  : 'border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
              ].join(' ')}
            >
              {section}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Add player"
        description="Add a player to Trial or Squad before creating an assessment. Parent details can be edited later."
      >
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={handleAddPlayer}>
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
              disabled={isAddingPlayer || availableTeams.length === 0}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAddingPlayer ? 'Adding...' : 'Add Player'}
            </button>
          </div>
          <label className="block xl:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Parent Name</span>
            <input
              type="text"
              name="parentName"
              value={playerForm.parentName}
              onChange={handlePlayerFormChange}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block xl:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Parent Email</span>
            <input
              type="email"
              name="parentEmail"
              value={playerForm.parentEmail}
              onChange={handlePlayerFormChange}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
        </form>
      </SectionCard>

      <SectionCard
        title={`${selectedSection} players`}
        description="Start a new evaluation from the player list, then use recent evaluations as a secondary review view."
      >
        <div className="mb-6 w-full xl:max-w-xs">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team filter</span>
            <select
              value={selectedTeam}
              onChange={(event) => setSelectedTeam(event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              {teamOptions.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? (
          <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center text-sm font-medium text-[var(--text-muted)]">
            Loading evaluations...
          </div>
        ) : playerSummaries.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Dashboard</p>
            <p className="mt-3 text-xl font-semibold text-[var(--text-primary)]">No players in this section yet.</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Add a player above, then start an evaluation when ready.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="overflow-hidden rounded-[20px] border border-[var(--border-color)]">
              <div className="grid grid-cols-[1.4fr_0.8fr_1fr] bg-[var(--panel-soft)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)] lg:grid-cols-[1.5fr_1fr_1fr] lg:px-5 lg:py-4 lg:text-xs lg:tracking-[0.18em]">
                <span>Player</span>
                <span>Last score</span>
                <span>Action</span>
              </div>

              <div className="divide-y divide-[var(--border-color)]">
                {playerSummaries.map((player) => (
                  <div
                    key={player.playerName}
                    className="grid grid-cols-[1.4fr_0.8fr_1fr] items-center gap-3 px-4 py-4 text-xs text-[var(--text-muted)] lg:grid-cols-[1.5fr_1fr_1fr] lg:px-5 lg:text-sm"
                  >
                    <Link
                      to={`/player/${encodeURIComponent(player.playerName)}`}
                      className="font-semibold text-[var(--text-primary)] transition hover:text-[var(--accent)]"
                    >
                      {player.playerName}
                    </Link>
                    <span>{player.lastScore !== null ? player.lastScore.toFixed(1) : '-'}</span>
                    <div>
                      <Link
                        to={`/create?player=${encodeURIComponent(player.playerName)}&team=${encodeURIComponent(player.team || '')}&section=${encodeURIComponent(selectedSection)}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                      >
                        New Evaluation
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden overflow-hidden rounded-[20px] border border-[var(--border-color)] md:block">
              <div className="grid grid-cols-[1.35fr_0.9fr_0.9fr_0.9fr_0.9fr_0.8fr_0.8fr] bg-[var(--panel-soft)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)] lg:grid-cols-[1.45fr_1fr_1fr_1fr_1fr_0.9fr_0.9fr] lg:px-5 lg:py-4 lg:text-xs lg:tracking-[0.18em]">
                <span>Player</span>
                <span>Team</span>
                <span>Session</span>
                <span>Date</span>
                <span>Coach</span>
                <span>Average</span>
                <span>Status</span>
              </div>

              <div className="divide-y divide-[var(--border-color)]">
                {filteredEvaluations.map((evaluation) => (
                  <Link
                    key={evaluation.id}
                    to={`/player/${encodeURIComponent(evaluation.playerName)}`}
                    className="grid grid-cols-[1.35fr_0.9fr_0.9fr_0.9fr_0.9fr_0.8fr_0.8fr] items-center px-4 py-3 text-xs text-[var(--text-muted)] transition hover:bg-[var(--panel-soft)] lg:grid-cols-[1.45fr_1fr_1fr_1fr_1fr_0.9fr_0.9fr] lg:px-5 lg:py-4 lg:text-sm"
                  >
                    <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                      <span>{evaluation.playerName}</span>
                      {isNewEvaluation(evaluation) ? (
                        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">
                          New
                        </span>
                      ) : null}
                    </span>
                    <span>{evaluation.team}</span>
                    <span className="truncate">{evaluation.session || '-'}</span>
                    <span>{evaluation.date || 'No date entered'}</span>
                    <span>{evaluation.coach}</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {evaluation.averageScore !== null ? `${evaluation.averageScore.toFixed(1)} | ${getScoreIndicator(evaluation.averageScore)}` : '-'}
                    </span>
                    <span>
                      <StatusBadge status={evaluation.status} />
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:hidden">
              {filteredEvaluations.map((evaluation) => (
                <Link
                  key={evaluation.id}
                  to={`/player/${encodeURIComponent(evaluation.playerName)}`}
                  className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 transition hover:bg-[var(--panel-soft)] sm:p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-semibold text-[var(--text-primary)]">{evaluation.playerName}</p>
                        {isNewEvaluation(evaluation) ? (
                          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-text)]">
                            New
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">{evaluation.team}</p>
                      {evaluation.session ? <p className="mt-1 text-sm text-[var(--text-muted)]">{evaluation.session}</p> : null}
                    </div>
                    <StatusBadge status={evaluation.status} />
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Date</p>
                      <p className="mt-2 text-[var(--text-muted)]">{evaluation.date || 'No date entered'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Coach</p>
                      <p className="mt-2 text-[var(--text-muted)]">{evaluation.coach}</p>
                    </div>
                  </div>

                  <div className="mt-5 text-sm font-semibold text-[var(--text-primary)]">
                    {evaluation.averageScore !== null ? `${evaluation.averageScore.toFixed(1)} | ${getScoreIndicator(evaluation.averageScore)}` : '-'}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
