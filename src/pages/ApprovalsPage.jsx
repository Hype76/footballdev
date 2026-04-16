import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canAccessApprovals, useAuth } from '../lib/auth.js'
import { getEvaluations, updateEvaluationStatus } from '../lib/supabase.js'

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

  useEffect(() => {
    let isMounted = true

    const loadSubmittedEvaluations = async () => {
      setIsLoading(true)

      try {
        const nextEvaluations = await getEvaluations({
          user,
          status: 'Submitted',
        })

        if (!isMounted) {
          return
        }

        setSubmittedEvaluations(nextEvaluations)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setSubmittedEvaluations([])
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
  }, [user])

  if (!canAccessApprovals(user)) {
    return <Navigate to="/dashboard" replace />
  }

  const teamOptions = [
    'All',
    ...new Set(submittedEvaluations.map((evaluation) => evaluation.team).filter(Boolean)),
  ]
  const filteredEvaluations =
    selectedTeam === 'All'
      ? submittedEvaluations
      : submittedEvaluations.filter((evaluation) => evaluation.team === selectedTeam)

  const handleStatusChange = async (evaluationId, nextStatus) => {
    setIsUpdatingId(evaluationId)

    try {
      await updateEvaluationStatus(evaluationId, nextStatus, user?.clubId)
      setSubmittedEvaluations((current) => current.filter((evaluation) => evaluation.id !== evaluationId))
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
        description="Review submitted coaching notes and move them cleanly through approval."
      />

      <SectionCard
        title="Pending review"
        description="Only submitted evaluations appear here, and they cannot be edited from this queue."
      >
        <div className="mb-6 w-full md:max-w-xs">
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

        {isLoading ? (
          <div className="rounded-[24px] border border-[#dbe3d6] bg-[#f8faf7] px-6 py-10 text-center text-sm font-medium text-slate-600">
            Loading approvals...
          </div>
        ) : filteredEvaluations.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[#cfd8c9] bg-[#f7faf5] px-6 py-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Approvals</p>
            <p className="mt-3 text-xl font-semibold text-slate-900">No pending approvals</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              New submitted evaluations will appear here for decision once coaches save them.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-[20px] border border-[#dbe3d6] md:block">
              <div className="grid grid-cols-[1.4fr_1fr_0.9fr_0.9fr_1fr] bg-[#f2f6ef] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5a6b5b] lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] lg:px-5 lg:py-4 lg:text-xs lg:tracking-[0.18em]">
                <span>Player</span>
                <span>Team</span>
                <span>Coach</span>
                <span>Average</span>
                <span>Actions</span>
              </div>

              <div className="divide-y divide-[#e5ebe1]">
                {filteredEvaluations.map((evaluation) => (
                  <div
                    key={evaluation.id}
                    className="grid grid-cols-[1.4fr_1fr_0.9fr_0.9fr_1fr] items-center gap-3 px-4 py-4 text-xs text-slate-700 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] lg:px-5 lg:text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{evaluation.playerName}</p>
                      <p className="mt-1 truncate text-slate-500">{evaluation.date || new Date().toLocaleDateString()}</p>
                    </div>
                    <span className="truncate">{evaluation.team || 'Unassigned Team'}</span>
                    <span className="truncate">{evaluation.coach || 'Unknown Coach'}</span>
                    <span>{evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : '-'}</span>
                    <div className="flex flex-col gap-2 lg:flex-row">
                      <button
                        type="button"
                        disabled={isUpdatingId === evaluation.id}
                        onClick={() => handleStatusChange(evaluation.id, 'Rejected')}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:bg-slate-100"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={isUpdatingId === evaluation.id}
                        onClick={() => handleStatusChange(evaluation.id, 'Approved')}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 md:hidden">
              {filteredEvaluations.map((evaluation) => (
                <div
                  key={evaluation.id}
                  className="rounded-[24px] border border-[#dbe3d6] bg-[#fcfdfb] p-4 sm:p-5"
                >
                  <div className="max-w-3xl">
                    <p className="text-lg font-semibold text-slate-900">{evaluation.playerName}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500">
                      <span>Team: {evaluation.team || 'Unassigned Team'}</span>
                      <span>Coach: {evaluation.coach || 'Unknown Coach'}</span>
                      <span>Date: {evaluation.date || new Date().toLocaleDateString()}</span>
                      <span>Average: {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : '-'}</span>
                      <span>Decision: {evaluation.decision || 'Progress'}</span>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-600">
                      {getScoreSummary(evaluation.scores) || 'No scores submitted.'}
                    </p>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      disabled={isUpdatingId === evaluation.id}
                      onClick={() => handleStatusChange(evaluation.id, 'Rejected')}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:bg-slate-100 sm:w-auto"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={isUpdatingId === evaluation.id}
                      onClick={() => handleStatusChange(evaluation.id, 'Approved')}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500 sm:w-auto"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>
    </div>
  )
}
