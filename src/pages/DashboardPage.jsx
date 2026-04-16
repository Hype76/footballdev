import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { StatusBadge } from '../components/ui/StatusBadge.jsx'
import { useAuth } from '../lib/auth.js'
import { getEvaluations } from '../lib/supabase.js'

function getScoreIndicator(averageScore) {
  if (averageScore === null) {
    return {
      label: 'Average',
      rowClassName: 'bg-transparent',
      cardClassName: 'bg-[#fcfdfb]',
      badgeClassName: 'bg-[#eef1ec] text-slate-700',
    }
  }

  const isFivePointScale = averageScore <= 5
  const isStrong = isFivePointScale ? averageScore >= 4 : averageScore >= 8
  const needsWork = isFivePointScale ? averageScore < 3 : averageScore < 6

  if (isStrong) {
    return {
      label: 'Strong',
      rowClassName: 'bg-[#f2f8f1]',
      cardClassName: 'bg-[#f2f8f1]',
      badgeClassName: 'bg-[#e5efe2] text-[#46604a]',
    }
  }

  if (needsWork) {
    return {
      label: 'Needs Work',
      rowClassName: 'bg-[#f9f0f0]',
      cardClassName: 'bg-[#f9f0f0]',
      badgeClassName: 'bg-[#f3e5e5] text-[#8b4b4b]',
    }
  }

  return {
    label: 'Average',
    rowClassName: 'bg-transparent',
    cardClassName: 'bg-[#fcfdfb]',
    badgeClassName: 'bg-[#eef1ec] text-slate-700',
  }
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
  const [selectedTeam, setSelectedTeam] = useState('All')
  const [evaluations, setEvaluations] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const loadEvaluations = async () => {
      setIsLoading(true)

      try {
        const nextEvaluations = await getEvaluations({ user })

        if (!isMounted) {
          return
        }

        setEvaluations(nextEvaluations)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setEvaluations([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadEvaluations()
    }

    return () => {
      isMounted = false
    }
  }, [user])

  const teamOptions = ['All', ...new Set(evaluations.map((evaluation) => evaluation.team).filter(Boolean))]
  const filteredEvaluations =
    selectedTeam === 'All'
      ? evaluations
      : evaluations.filter((evaluation) => evaluation.team === selectedTeam)
  const playerSummaries = Array.from(
    filteredEvaluations.reduce((map, evaluation) => {
      if (!map.has(evaluation.playerName)) {
        map.set(evaluation.playerName, {
          playerName: evaluation.playerName,
          lastScore: evaluation.averageScore,
          team: evaluation.team,
        })
      }

      return map
    }, new Map()).values(),
  )
  const teamPlayers = playerSummaries.map((player) => player.playerName)

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title="Recent evaluations"
        description="Review club evaluations and jump straight into player history."
      />

      <SectionCard
        title="Players"
        description="Start a new evaluation from the player list, then use recent evaluations as a secondary review view."
      >
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="w-full xl:max-w-xs">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Team filter</span>
              <select
                value={selectedTeam}
                onChange={(event) => setSelectedTeam(event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              >
                {teamOptions.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex-1 rounded-[20px] border border-[#dbe3d6] bg-[#f8faf7] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">
              Players in this team
            </p>
            {teamPlayers.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No players in this team yet.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {teamPlayers.map((playerName) => (
                  <Link
                    key={playerName}
                    to={`/player/${encodeURIComponent(playerName)}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-[#dbe3d6] bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#eef3ea]"
                  >
                    {playerName}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-[24px] border border-[#dbe3d6] bg-[#f8faf7] px-6 py-10 text-center text-sm font-medium text-slate-600">
            Loading evaluations...
          </div>
        ) : filteredEvaluations.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[#cfd8c9] bg-[#f7faf5] px-6 py-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Dashboard</p>
            <p className="mt-3 text-xl font-semibold text-slate-900">No evaluations yet. Create your first one.</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Start a new evaluation to build a working view for coaches, teams, and player follow-up.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="overflow-hidden rounded-[20px] border border-[#dbe3d6]">
              <div className="grid grid-cols-[1.4fr_0.8fr_1fr] bg-[#f2f6ef] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5a6b5b] lg:grid-cols-[1.5fr_1fr_1fr] lg:px-5 lg:py-4 lg:text-xs lg:tracking-[0.18em]">
                <span>Player</span>
                <span>Last score</span>
                <span>Action</span>
              </div>

              <div className="divide-y divide-[#e5ebe1]">
                {playerSummaries.map((player) => (
                  <div
                    key={player.playerName}
                    className="grid grid-cols-[1.4fr_0.8fr_1fr] items-center gap-3 px-4 py-4 text-xs text-slate-700 lg:grid-cols-[1.5fr_1fr_1fr] lg:px-5 lg:text-sm"
                  >
                    <Link
                      to={`/player/${encodeURIComponent(player.playerName)}`}
                      className="font-semibold text-slate-900 transition hover:text-slate-700"
                    >
                      {player.playerName}
                    </Link>
                    <span>{player.lastScore !== null ? player.lastScore.toFixed(1) : '-'}</span>
                    <div>
                      <Link
                        to={`/create?player=${encodeURIComponent(player.playerName)}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1]"
                      >
                        New Evaluation
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden overflow-hidden rounded-[20px] border border-[#dbe3d6] md:block">
              <div className="grid grid-cols-[1.35fr_0.9fr_0.9fr_0.9fr_0.9fr_0.8fr_0.8fr] bg-[#f2f6ef] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5a6b5b] lg:grid-cols-[1.45fr_1fr_1fr_1fr_1fr_0.9fr_0.9fr] lg:px-5 lg:py-4 lg:text-xs lg:tracking-[0.18em]">
                <span>Player</span>
                <span>Team</span>
                <span>Session</span>
                <span>Date</span>
                <span>Coach</span>
                <span>Average</span>
                <span>Status</span>
              </div>

              <div className="divide-y divide-[#e5ebe1]">
                {filteredEvaluations.map((evaluation) => {
                  const scoreIndicator = getScoreIndicator(evaluation.averageScore)

                  return (
                    <Link
                      key={evaluation.id}
                      to={`/player/${encodeURIComponent(evaluation.playerName)}`}
                      className={[
                        'grid grid-cols-[1.35fr_0.9fr_0.9fr_0.9fr_0.9fr_0.8fr_0.8fr] items-center px-4 py-3 text-xs text-slate-700 transition hover:bg-[#f8faf7] lg:grid-cols-[1.45fr_1fr_1fr_1fr_1fr_0.9fr_0.9fr] lg:px-5 lg:py-4 lg:text-sm',
                        scoreIndicator.rowClassName,
                      ].join(' ')}
                    >
                      <span className="flex items-center gap-2 font-semibold text-slate-900">
                        <span>{evaluation.playerName}</span>
                        {isNewEvaluation(evaluation) ? (
                          <span className="rounded-full bg-[#e8f1ff] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#365c91]">
                            New
                          </span>
                        ) : null}
                      </span>
                      <span>{evaluation.team}</span>
                      <span className="truncate">{evaluation.session || '-'}</span>
                      <span>{evaluation.date}</span>
                      <span>{evaluation.coach}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-semibold text-slate-900">
                          {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : '-'}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold lg:px-3 lg:text-xs ${scoreIndicator.badgeClassName}`}>
                          {scoreIndicator.label}
                        </span>
                      </span>
                      <span>
                        <StatusBadge status={evaluation.status} />
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-4 md:hidden">
              {filteredEvaluations.map((evaluation) => {
                const scoreIndicator = getScoreIndicator(evaluation.averageScore)

                return (
                  <Link
                    key={evaluation.id}
                    to={`/player/${encodeURIComponent(evaluation.playerName)}`}
                    className={[
                      'rounded-[20px] border border-[#dbe3d6] p-4 transition hover:bg-[#f8faf7] sm:p-5',
                      scoreIndicator.cardClassName,
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-lg font-semibold text-slate-900">{evaluation.playerName}</p>
                          {isNewEvaluation(evaluation) ? (
                            <span className="rounded-full bg-[#e8f1ff] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#365c91]">
                              New
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{evaluation.team}</p>
                        {evaluation.session ? (
                          <p className="mt-1 text-sm text-slate-500">{evaluation.session}</p>
                        ) : null}
                      </div>
                      <StatusBadge status={evaluation.status} />
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Date</p>
                        <p className="mt-2 text-slate-700">{evaluation.date}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Coach</p>
                        <p className="mt-2 text-slate-700">{evaluation.coach}</p>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold text-slate-900">
                        {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : '-'}
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${scoreIndicator.badgeClassName}`}>
                        {scoreIndicator.label}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
