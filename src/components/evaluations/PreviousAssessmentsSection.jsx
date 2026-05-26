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
      storageKey="development-record-previous-records-v2"
      title="Previous development records"
      description="Use this while recording an existing player. These notes are for reference only and are not added to the new record."
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold leading-6 text-[#5f7468]">
          {previousEvaluations.length} previous development record{previousEvaluations.length === 1 ? '' : 's'} found for this player.
        </p>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-4 py-3 text-sm font-bold text-[#101828] transition hover:bg-[#f8fdf9]"
        >
          {isOpen ? 'Hide Previous Records' : 'View Previous Records'}
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
    <div className="rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-black text-[#101828]">{evaluation.date || 'No date entered'}</p>
        <p className="text-sm font-black text-[#067a46]">
          Score: {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : '-'}
        </p>
      </div>
      <div className="mt-2 grid gap-1 text-sm font-semibold text-[#5f7468] sm:grid-cols-2">
        <p>Session: {evaluation.session || 'No session entered'}</p>
        <p>Section: {evaluation.section || 'No section entered'}</p>
        <p>Team: {evaluation.team || 'No team entered'}</p>
        <p>Coach: {evaluation.coach || 'No coach entered'}</p>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {previousAssessmentItems.length > 0 ? (
          previousAssessmentItems.map((item) => (
            <div key={item.label} className="rounded-lg border border-[#d7eadf] bg-white px-3 py-2">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[#067a46]">{item.label}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-[#5f7468]">{item.value}</p>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-[#d7eadf] bg-white px-3 py-2 text-sm font-semibold text-[#5f7468] md:col-span-2">
            No development details were entered.
          </div>
        )}
      </div>
    </div>
  )
}
