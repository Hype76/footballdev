import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { StatusBadge } from '../components/ui/StatusBadge.jsx'
import { useAuth } from '../lib/auth.js'
import {
  EVALUATION_SECTIONS,
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
    return 'No score'
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

function isRecentEvaluation(evaluation, days = 7) {
  const timestamp = Number(evaluation.createdAt ?? 0)

  if (!timestamp || Number.isNaN(timestamp)) {
    return false
  }

  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '0%'
  }

  return `${Math.round(value)}%`
}

function StatCard({ label, value, helper }) {
  return (
    <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{value}</p>
      {helper ? <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{helper}</p> : null}
    </div>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const userScopeKey = user ? `${user.id}:${user.clubId || 'platform'}:${user.role}:${user.roleRank}` : ''
  const cacheKey = user ? `dashboard:${user.id}:${user.clubId || 'platform'}` : ''
  const [selectedTeam, setSelectedTeam] = useState('All')
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

        if (
          evaluationsResult.status === 'rejected' ||
          playersResult.status === 'rejected' ||
          teamsResult.status === 'rejected'
        ) {
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
          setErrorMessage(error.message || 'Could not load dashboard data.')
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

  const teamOptions = useMemo(
    () => [
      'All',
      ...new Set([
        ...availableTeams.map((team) => team.name).filter(Boolean),
        ...players.map((player) => player.team).filter(Boolean),
        ...evaluations.map((evaluation) => evaluation.team).filter(Boolean),
      ]),
    ],
    [availableTeams, evaluations, players],
  )

  const filteredPlayers = selectedTeam === 'All' ? players : players.filter((player) => player.team === selectedTeam)
  const filteredEvaluations =
    selectedTeam === 'All' ? evaluations : evaluations.filter((evaluation) => evaluation.team === selectedTeam)

  const averageScore = useMemo(() => {
    const scoredEvaluations = filteredEvaluations
      .map((evaluation) => Number(evaluation.averageScore))
      .filter((score) => !Number.isNaN(score))

    if (scoredEvaluations.length === 0) {
      return null
    }

    return scoredEvaluations.reduce((sum, score) => sum + score, 0) / scoredEvaluations.length
  }, [filteredEvaluations])

  const approvedCount = filteredEvaluations.filter((evaluation) => evaluation.status === 'Approved').length
  const submittedCount = filteredEvaluations.filter((evaluation) => evaluation.status === 'Submitted').length
  const rejectedCount = filteredEvaluations.filter((evaluation) => evaluation.status === 'Rejected').length
  const recentCount = filteredEvaluations.filter((evaluation) => isRecentEvaluation(evaluation)).length
  const trialPlayers = filteredPlayers.filter((player) => player.section === 'Trial').length
  const squadPlayers = filteredPlayers.filter((player) => player.section === 'Squad').length
  const assessedPlayerNames = new Set(filteredEvaluations.map((evaluation) => evaluation.playerName))
  const unassessedPlayers = filteredPlayers.filter((player) => !assessedPlayerNames.has(player.playerName))
  const approvalRate = filteredEvaluations.length ? (approvedCount / filteredEvaluations.length) * 100 : 0
  const pendingShareCount = filteredEvaluations.filter(
    (evaluation) => evaluation.teamRequireApproval && evaluation.status !== 'Approved',
  ).length

  const sectionStats = EVALUATION_SECTIONS.map((section) => {
    const sectionPlayers = filteredPlayers.filter((player) => player.section === section)
    const sectionEvaluations = filteredEvaluations.filter((evaluation) => evaluation.section === section)
    const scored = sectionEvaluations
      .map((evaluation) => Number(evaluation.averageScore))
      .filter((score) => !Number.isNaN(score))

    return {
      section,
      players: sectionPlayers.length,
      evaluations: sectionEvaluations.length,
      average: scored.length ? scored.reduce((sum, score) => sum + score, 0) / scored.length : null,
      pending: sectionEvaluations.filter((evaluation) => evaluation.status === 'Submitted').length,
    }
  })

  const teamStats = teamOptions
    .filter((team) => team !== 'All')
    .map((team) => {
      const teamPlayers = players.filter((player) => player.team === team)
      const teamEvaluations = evaluations.filter((evaluation) => evaluation.team === team)
      const scored = teamEvaluations
        .map((evaluation) => Number(evaluation.averageScore))
        .filter((score) => !Number.isNaN(score))

      return {
        team,
        players: teamPlayers.length,
        evaluations: teamEvaluations.length,
        average: scored.length ? scored.reduce((sum, score) => sum + score, 0) / scored.length : null,
        pending: teamEvaluations.filter((evaluation) => evaluation.status === 'Submitted').length,
      }
    })
    .sort((left, right) => right.evaluations - left.evaluations || left.team.localeCompare(right.team))

  const recentEvaluations = [...filteredEvaluations]
    .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))
    .slice(0, 8)

  const topPlayers = Object.values(
    filteredEvaluations.reduce((map, evaluation) => {
      if (evaluation.averageScore === null) {
        return map
      }

      const existing = map[evaluation.playerName]
      if (!existing || Number(evaluation.averageScore) > Number(existing.averageScore)) {
        map[evaluation.playerName] = evaluation
      }

      return map
    }, {}),
  )
    .sort((left, right) => Number(right.averageScore) - Number(left.averageScore))
    .slice(0, 5)

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title="Club stats"
        description="A live overview of players, assessments, approvals, teams, and coaching activity."
      />

      {errorMessage ? (
        <NoticeBanner
          title="Dashboard data is not fully available"
          message="Some live data could not be refreshed. Cached or empty values are shown until the connection settles."
        />
      ) : null}

      <SectionCard
        title="Filters"
        description="Use the team filter to narrow all dashboard stats."
      >
        <label className="block max-w-sm">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Team</span>
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
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total players" value={filteredPlayers.length} helper={`${trialPlayers} Trial | ${squadPlayers} Squad`} />
        <StatCard label="Evaluations" value={filteredEvaluations.length} helper={`${recentCount} in the last 7 days`} />
        <StatCard
          label="Average score"
          value={averageScore !== null ? averageScore.toFixed(1) : '-'}
          helper={getScoreIndicator(averageScore)}
        />
        <StatCard label="Pending approvals" value={submittedCount} helper={`${pendingShareCount} sharing locked`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Approved" value={approvedCount} helper={`${formatPercent(approvalRate)} approval rate`} />
        <StatCard label="Rejected" value={rejectedCount} helper="Evaluations not moving forward" />
        <StatCard label="Teams" value={teamStats.length} helper={selectedTeam === 'All' ? 'Active team groups' : selectedTeam} />
        <StatCard label="Needs first assessment" value={unassessedPlayers.length} helper="Players with no evaluation yet" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard
          title="Section breakdown"
          description="Trial and Squad activity at a glance."
        >
          <div className="grid gap-3">
            {sectionStats.map((section) => (
              <div
                key={section.section}
                className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold text-[var(--text-primary)]">{section.section}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {section.players} players | {section.evaluations} evaluations
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {section.average !== null ? section.average.toFixed(1) : '-'}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                      {section.pending} pending
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Team performance"
          description="Teams ordered by assessment activity."
        >
          {teamStats.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
              No team data yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-[20px] border border-[var(--border-color)]">
              <div className="grid grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr] bg-[var(--panel-soft)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                <span>Team</span>
                <span>Players</span>
                <span>Avg</span>
                <span>Pending</span>
              </div>
              <div className="divide-y divide-[var(--border-color)]">
                {teamStats.map((team) => (
                  <div
                    key={team.team}
                    className="grid grid-cols-[1.2fr_0.7fr_0.7fr_0.7fr] px-4 py-3 text-sm text-[var(--text-muted)]"
                  >
                    <span className="font-semibold text-[var(--text-primary)]">{team.team}</span>
                    <span>{team.players}</span>
                    <span>{team.average !== null ? team.average.toFixed(1) : '-'}</span>
                    <span>{team.pending}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title="Top performers"
          description="Highest latest recorded scores in the current filter."
        >
          {topPlayers.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
              No scored evaluations yet.
            </div>
          ) : (
            <div className="grid gap-3">
              {topPlayers.map((evaluation) => (
                <Link
                  key={evaluation.id}
                  to={`/player/${encodeURIComponent(evaluation.playerName)}`}
                  className="flex items-center justify-between gap-4 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 transition hover:bg-[var(--panel-soft)]"
                >
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">{evaluation.playerName}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{evaluation.team} | {evaluation.section}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-[var(--text-primary)]">{evaluation.averageScore.toFixed(1)}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{getScoreIndicator(evaluation.averageScore)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent activity"
          description="Latest assessments across the selected team."
        >
          {isLoading ? (
            <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
              Loading stats...
            </div>
          ) : recentEvaluations.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
              No evaluations yet.
            </div>
          ) : (
            <div className="grid gap-3">
              {recentEvaluations.map((evaluation) => (
                <Link
                  key={evaluation.id}
                  to={`/player/${encodeURIComponent(evaluation.playerName)}`}
                  className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 transition hover:bg-[var(--panel-soft)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-[var(--text-primary)]">{evaluation.playerName}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {evaluation.team} | {evaluation.date || 'No date entered'}
                      </p>
                    </div>
                    <StatusBadge status={evaluation.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
