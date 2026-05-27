import { SectionCard } from '../ui/SectionCard.jsx'

function getEvaluationSourceLabel(evaluation, { includeScore = false, includeValue = false, valueLabel = '' } = {}) {
  const parts = [
    `Date: ${evaluation.date || 'No date entered'}`,
    `Session: ${evaluation.session || 'No session entered'}`,
  ]

  if (evaluation.section) {
    parts.push(`Section: ${evaluation.section}`)
  }

  if (includeScore) {
    parts.push(`Score: ${evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : 'No score'}`)
  }

  if (includeValue) {
    parts.push(`${valueLabel || 'Value'}: ${String(evaluation.formResponses?.[valueLabel] ?? 'No value')}`)
  }

  return parts.join(', ')
}

export function PlayerMergeAssessments({
  evaluations,
  isMergingEvaluations,
  mergeCoreSource,
  mergeDetailFields,
  mergeDetailSources,
  mergeFieldLabels,
  mergeFieldSources,
  mergePreviewAverage,
  mergePreviewResponses,
  mergeSelectedEvaluations,
  mergeSelectedIds,
  onCreateMergedEvaluation,
  onMergeDetailSourceChange,
  onMergeFieldSourceChange,
  onMergeSelectionChange,
  onMergeSourceChange,
}) {
  return (
    <SectionCard
      title="Merge development records"
      description="Managers can create one combined development record from selected reports. Original reports stay in history."
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          {evaluations.map((evaluation) => (
            <label
              key={evaluation.id}
              className="flex min-h-11 items-start gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] shadow-sm shadow-[#047857]/10"
            >
              <input
                type="checkbox"
                checked={mergeSelectedIds.includes(evaluation.id)}
                onChange={(event) => onMergeSelectionChange(evaluation.id, event.target.checked)}
                className="mt-1 h-4 w-4 accent-[#047857]"
              />
              <span className="min-w-0">
                <span className="block font-semibold">{evaluation.date || 'No date entered'}</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-[#4b5f55]">
                  {getEvaluationSourceLabel(evaluation, { includeScore: true })}
                </span>
              </span>
            </label>
          ))}
        </div>

        {mergeSelectedEvaluations.length >= 2 ? (
          <div className="space-y-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#101828]">Main details source</span>
              <select
                value={mergeCoreSource?.id || ''}
                onChange={(event) => onMergeSourceChange(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:ring-2 focus:ring-[#d1fae5]"
              >
                {mergeSelectedEvaluations.map((evaluation) => (
                  <option key={evaluation.id} value={evaluation.id}>
                    {getEvaluationSourceLabel(evaluation)}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs font-semibold leading-5 text-[#4b5f55]">
                This is the default source. You can override each merged detail below.
              </p>
            </label>

            <div>
              <p className="text-sm font-semibold text-[#101828]">Choose report detail sources</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
                Pick which record supplies non-score details such as parents, session, date, comments, and status.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {mergeDetailFields.map((field) => {
                  const selectedSource =
                    mergeSelectedEvaluations.find(
                      (evaluation) => evaluation.id === (mergeDetailSources[field.key] || mergeCoreSource?.id),
                    ) ?? mergeCoreSource ?? mergeSelectedEvaluations[0]

                  return (
                    <label key={field.key} className="block rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[#047857]">{field.label}</span>
                      <select
                        value={mergeDetailSources[field.key] || mergeCoreSource?.id || ''}
                        onChange={(event) => onMergeDetailSourceChange(field.key, event.target.value)}
                        className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]"
                      >
                        {mergeSelectedEvaluations.map((evaluation) => (
                          <option key={evaluation.id} value={evaluation.id}>
                            {getEvaluationSourceLabel(evaluation)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#4b5f55]">
                        {field.preview(selectedSource)}
                      </p>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#101828]">Choose field sources</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
                Pick which record should supply each score or text field.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {mergeFieldLabels.map((label) => (
                  <label key={label} className="block rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[#047857]">{label}</span>
                    <select
                      value={
                        mergeFieldSources[label] ||
                        mergeSelectedEvaluations.find((evaluation) =>
                          Object.prototype.hasOwnProperty.call(evaluation.formResponses ?? {}, label),
                        )?.id ||
                        mergeCoreSource?.id ||
                        mergeSelectedEvaluations[0]?.id ||
                        ''
                      }
                      onChange={(event) => onMergeFieldSourceChange(label, event.target.value)}
                      className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]"
                    >
                      {mergeSelectedEvaluations
                        .filter((evaluation) => Object.prototype.hasOwnProperty.call(evaluation.formResponses ?? {}, label))
                        .map((evaluation) => (
                          <option key={evaluation.id} value={evaluation.id}>
                            {getEvaluationSourceLabel(evaluation, { includeValue: true, valueLabel: label })}
                          </option>
                        ))}
                    </select>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#4b5f55]">
                      {String(mergePreviewResponses[label] ?? 'No value')}
                    </p>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#101828]">Merged score preview</p>
                <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                  {mergePreviewAverage !== null ? mergePreviewAverage.toFixed(1) : 'No numeric scores selected'}
                </p>
              </div>
              <button
                type="button"
                disabled={isMergingEvaluations}
                title={isMergingEvaluations ? 'Please wait while the merged development record is being saved.' : undefined}
                onClick={onCreateMergedEvaluation}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isMergingEvaluations ? 'Saving...' : 'Save Merged Record'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-6 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
            Select at least two development records to build a merged report.
          </div>
        )}
      </div>
    </SectionCard>
  )
}
