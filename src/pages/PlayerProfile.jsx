import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { StatusBadge } from '../components/ui/StatusBadge.jsx'
import { useAuth } from '../lib/auth.js'
import { getEvaluations } from '../lib/supabase.js'

function buildParentEmailLink(playerName, evaluation) {
  if (!evaluation.parentEmail) {
    return ''
  }

  const summary =
    evaluation.comments?.overall ||
    evaluation.comments?.strengths ||
    evaluation.comments?.improvements ||
    'No written summary provided.'

  const body = [
    `Player: ${playerName}`,
    evaluation.session ? `Session: ${evaluation.session}` : null,
    `Summary: ${summary}`,
    `Decision: ${evaluation.decision || 'Progress'}`,
    '',
    'A PDF download option is also available in the system for sharing feedback.',
  ]
    .filter(Boolean)
    .join('\n')

  const subject = encodeURIComponent('Player Trial Feedback')
  return `mailto:${encodeURIComponent(evaluation.parentEmail)}?subject=${subject}&body=${encodeURIComponent(body)}`
}

export function PlayerProfile() {
  const { id } = useParams()
  const { user } = useAuth()
  const routePlayerName = decodeURIComponent(id)
  const [evaluations, setEvaluations] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const loadEvaluations = async () => {
      setIsLoading(true)

      try {
        const nextEvaluations = await getEvaluations({
          user,
          playerName: routePlayerName,
        })

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
  }, [routePlayerName, user])

  const scoredEvaluations = useMemo(
    () => evaluations.filter((evaluation) => evaluation.averageScore !== null),
    [evaluations],
  )
  const overallAverage =
    scoredEvaluations.length > 0
      ? scoredEvaluations.reduce((sum, evaluation) => sum + evaluation.averageScore, 0) / scoredEvaluations.length
      : null

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Player Profile"
        title={routePlayerName}
        description="Review the evaluation history for this player with role-based Supabase visibility."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[20px] border border-[#dbe3d6] bg-[#fcfdfb] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Total evaluations</p>
          <p className="mt-3 text-2xl font-semibold text-slate-900">{evaluations.length}</p>
        </div>
        <div className="rounded-[20px] border border-[#dbe3d6] bg-[#fcfdfb] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Average score</p>
          <p className="mt-3 text-2xl font-semibold text-slate-900">
            {overallAverage !== null ? overallAverage.toFixed(1) : '-'}
          </p>
        </div>
      </div>

      <SectionCard
        title="Player details"
        description="Basic profile context for the selected player."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-[20px] border border-[#dbe3d6] bg-[#fcfdfb] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Player name</p>
            <p className="mt-3 text-lg font-semibold text-slate-900">{routePlayerName}</p>
          </div>
          <div className="rounded-[20px] border border-[#dbe3d6] bg-[#fcfdfb] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Age group</p>
            <p className="mt-3 text-lg font-semibold text-slate-900">Unknown</p>
          </div>
          <div className="rounded-[20px] border border-[#dbe3d6] bg-[#fcfdfb] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Position</p>
            <p className="mt-3 text-lg font-semibold text-slate-900">Unknown</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Past evaluations"
        description="Supabase history filtered by the current user role."
      >
        {isLoading ? (
          <div className="rounded-[24px] border border-[#dbe3d6] bg-[#f8faf7] px-6 py-10 text-center text-sm font-medium text-slate-600">
            Loading player history...
          </div>
        ) : evaluations.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-[#cfd8c9] bg-[#f7faf5] px-6 py-10 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Player History</p>
            <p className="mt-3 text-xl font-semibold text-slate-900">No history for this player yet</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Once evaluations are saved for this player, the full review trail will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {evaluations.map((evaluation) => (
              <div
                key={evaluation.id}
                className="rounded-[24px] border border-[#dbe3d6] bg-[#fcfdfb] p-4 sm:p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-slate-900">{evaluation.date}</p>
                    <p className="mt-1 text-sm text-slate-500">Decision: {evaluation.decision}</p>
                    {evaluation.session ? (
                      <p className="mt-1 text-sm text-slate-500">Session: {evaluation.session}</p>
                    ) : null}
                  </div>
                  <StatusBadge status={evaluation.status} />
                </div>

                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Scores</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {Object.entries(evaluation.scores).map(([label, score]) => (
                      <li key={label} className="rounded-2xl border border-[#e2e7de] bg-white px-4 py-3 break-words">
                        {`${label.charAt(0).toUpperCase() + label.slice(1)}: ${score}`}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Comments</p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {evaluation.comments?.overall ||
                      evaluation.comments?.strengths ||
                      evaluation.comments?.improvements ||
                      'No comments provided.'}
                  </p>
                </div>

                {evaluation.parentEmail ? (
                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Parent email</p>
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm leading-6 text-slate-600">{evaluation.parentEmail}</p>
                      <a
                        href={buildParentEmailLink(routePlayerName, evaluation)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1]"
                      >
                        Send to Parent
                      </a>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
