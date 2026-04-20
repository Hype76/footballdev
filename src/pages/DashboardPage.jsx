import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { StatusBadge } from '../components/ui/StatusBadge.jsx'
import { useAuth } from '../lib/auth.js'
import { EVALUATION_SECTIONS, getEvaluations, withRequestTimeout } from '../lib/supabase.js'

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
  const [selectedTeam, setSelectedTeam] = useState('All')
  const [selectedSection, setSelectedSection] = useState('Trial')
  const [evaluations, setEvaluations] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadEvaluations = async () => {
      setIsLoading(true)
      setErrorMessage('')

      try {
        const nextEvaluations = await withRequestTimeout(
          () => getEvaluations({ user }),
          'Could not load evaluations. No data entered yet, or the request took too long.',
        )

        if (!isMounted) {
          return
        }

        setEvaluations(nextEvaluations)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setEvaluations([])
          setErrorMessage(error.message || 'Could not load evaluations.')
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

  const filteredBySection = useMemo(
    () => evaluations.filter((evaluation) => (selectedSection ? evaluation.section === selectedSection : true)),
    [evaluations, selectedSection],
  )

  const teamOptions = ['All', ...new Set(filteredBySection.map((evaluation) => evaluation.team).filter(Boolean))]
  const filteredEvaluations =
    selectedTeam === 'All'
      ? filteredBySection
      : filteredBySection.filter((evaluation) => evaluation.team === selectedTeam)

  const playerSummaries = Array.from(
    filteredEvaluations.reduce((map, evaluation) => {
      if (!map.has(evaluation.playerName)) {
        map.set(evaluation.playerName, {
          playerName: evaluation.playerName,
          lastScore: evaluation.averageScore,
          team: evaluation.team,
          section: evaluation.section,
        })
      }

      return map
    }, new Map()).values(),
  )

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title="Club assessments"
        description="Switch between Trial and Squad sections, then start a new assessment or review recent activity."
      />

      {errorMessage ? (
        <div className="rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger-text)]">
          {errorMessage}
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
        ) : filteredEvaluations.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Dashboard</p>
            <p className="mt-3 text-xl font-semibold text-[var(--text-primary)]">No evaluations yet. Create your first one.</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Start a new evaluation to build a working view for coaches, managers, and player follow-up.
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
                      {evaluation.averageScore !== null ? `${evaluation.averageScore.toFixed(1)} · ${getScoreIndicator(evaluation.averageScore)}` : '-'}
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
                    {evaluation.averageScore !== null ? `${evaluation.averageScore.toFixed(1)} · ${getScoreIndicator(evaluation.averageScore)}` : '-'}
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
