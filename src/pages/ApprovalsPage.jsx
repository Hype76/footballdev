import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canAccessApprovals, useAuth } from '../lib/auth.js'
import { getEvaluations, readViewCache, updateEvaluationStatus, withRequestTimeout, writeViewCache } from '../lib/supabase.js'

function getScoreSummary(scores = {}) {
  return Object.entries(scores)
    .map(([label, score]) => `${label.charAt(0).toUpperCase() + label.slice(1)} ${score}`)
    .join(' | ')
}

export function ApprovalsPage() {
  const { user } = useAuth()
  const [selectedTeam, setSelectedTeam] = useState('All')
  const [submittedEvaluations, setSubmittedEvaluations] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdatingId, setIsUpdatingId] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const cacheKey = user ? `approvals:${user.id}:${user.clubId || 'platform'}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    if (cachedValue?.submittedEvaluations) {
      setSubmittedEvaluations(Array.isArray(cachedValue.submittedEvaluations) ? cachedValue.submittedEvaluations : [])
      setIsLoading(false)
    }

    const loadSubmittedEvaluations = async () => {
      setErrorMessage('')

      try {
        const nextEvaluations = await withRequestTimeout(
          () =>
            getEvaluations({
              user,
              status: 'Submitted',
            }),
          'Could not load approvals. No submitted data entered yet, or the request took too long.',
        )

        if (!isMounted) {
          return
        }

        setSubmittedEvaluations(nextEvaluations)
        writeViewCache(cacheKey, {
          submittedEvaluations: nextEvaluations,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (!cachedValue?.submittedEvaluations) {
            setSubmittedEvaluations([])
          }
          setErrorMessage(error.message || 'Could not load approvals.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadSubmittedEvaluations()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, user])

  if (!canAccessApprovals(user)) {
    return <Navigate to="/dashboard" replace />
  }

  const teamOptions = ['All', ...new Set(submittedEvaluations.map((evaluation) => evaluation.team).filter(Boolean))]
  const filteredEvaluations =
    selectedTeam === 'All'
      ? submittedEvaluations
      : submittedEvaluations.filter((evaluation) => evaluation.team === selectedTeam)

  const handleStatusChange = async (evaluationId, nextStatus) => {
    setIsUpdatingId(evaluationId)

    try {
      await updateEvaluationStatus(evaluationId, nextStatus, user?.clubId)
      setSubmittedEvaluations((current) => {
        const nextEvaluations = current.filter((evaluation) => evaluation.id !== evaluationId)
        writeViewCache(cacheKey, {
          submittedEvaluations: nextEvaluations,
        })
        return nextEvaluations
      })
    } catch (error) {
      console.error(error)
    } finally {
      setIsUpdatingId(null)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Approvals"
        title="Submitted evaluations"
        description="Managers and above can unlock sharing for coaches by approving submitted evaluations."
      />

      {errorMessage ? (
        <div className="rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger-text)]">
          {errorMessage}
        </div>
      ) : null}

      <SectionCard
        title="Pending review"
        description="Coaches cannot share this evaluation until approved."
      >
        <div className="mb-6 w-full md:max-w-xs">
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
            Loading approvals...
          </div>
        ) : filteredEvaluations.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-6 py-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Approvals</p>
            <p className="mt-3 text-xl font-semibold text-[var(--text-primary)]">No pending approvals</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              New submitted evaluations will appear here for decision once coaches save them.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredEvaluations.map((evaluation) => (
              <div
                key={evaluation.id}
                className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 sm:p-5"
              >
                <div className="max-w-3xl">
                  <p className="text-lg font-semibold text-[var(--text-primary)]">{evaluation.playerName}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--text-muted)]">
                    <span>Team: {evaluation.team || 'Unassigned Team'}</span>
                    <span>Section: {evaluation.section || 'Trial'}</span>
                    <span>Coach: {evaluation.coach || 'Unknown Coach'}</span>
                    <span>Date: {evaluation.date || 'No date entered'}</span>
                    <span>Average: {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : '-'}</span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
                    {getScoreSummary(evaluation.scores) || 'No scores submitted.'}
                  </p>
                </div>

                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                  Coaches cannot share this evaluation until approved
                </p>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    disabled={isUpdatingId === evaluation.id}
                    onClick={() => handleStatusChange(evaluation.id, 'Rejected')}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={isUpdatingId === evaluation.id}
                    onClick={() => handleStatusChange(evaluation.id, 'Approved')}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    Approve & Unlock Sharing
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
