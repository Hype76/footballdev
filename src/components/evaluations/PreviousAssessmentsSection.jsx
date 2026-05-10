import { buildPreviousAssessmentItems } from '../../hooks/evaluations/evaluationFormUtils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PreviousAssessmentsSection({
  isOpen,
  onToggle,
  previousEvaluations,
}) {
  if (previousEvaluations.length === 0) {
    return null
  }

  return (
    <SectionCard
      title="Previous assessments"
      description="Use this while assessing an existing player. These notes are for reference only and are not added to the new assessment."
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-[var(--text-muted)]">
          {previousEvaluations.length} previous assessment{previousEvaluations.length === 1 ? '' : 's'} found for this player.
        </p>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
        >
          {isOpen ? 'Hide Previous Assessments' : 'View Previous Assessments'}
        </button>
      </div>
      {isOpen ? (
        <div className="mt-4 grid gap-3">
          {previousEvaluations.map((evaluation) => (
            <PreviousAssessmentCard key={evaluation.id} evaluation={evaluation} />
          ))}
        </div>
      ) : null}
    </SectionCard>
  )
}

function PreviousAssessmentCard({ evaluation }) {
  const previousAssessmentItems = buildPreviousAssessmentItems(evaluation)

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-semibold text-[var(--text-primary)]">{evaluation.date || 'No date entered'}</p>
        <p className="text-sm font-semibold text-[var(--text-secondary)]">
          Score: {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : '-'}
        </p>
      </div>
      <div className="mt-2 grid gap-1 text-sm text-[var(--text-muted)] sm:grid-cols-2">
        <p>Session: {evaluation.session || 'No session entered'}</p>
        <p>Section: {evaluation.section || 'No section entered'}</p>
        <p>Team: {evaluation.team || 'No team entered'}</p>
        <p>Coach: {evaluation.coach || 'No coach entered'}</p>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {previousAssessmentItems.length > 0 ? (
          previousAssessmentItems.map((item) => (
            <div key={item.label} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">{item.label}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{item.value}</p>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm text-[var(--text-muted)] md:col-span-2">
            No assessment details were entered.
          </div>
        )}
      </div>
    </div>
  )
}
