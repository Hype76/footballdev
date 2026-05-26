import { SectionCard } from '../ui/SectionCard.jsx'

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
              className="flex min-h-11 items-start gap-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] shadow-sm shadow-[#067a46]/10"
            >
              <input
                type="checkbox"
                checked={mergeSelectedIds.includes(evaluation.id)}
                onChange={(event) => onMergeSelectionChange(evaluation.id, event.target.checked)}
                className="mt-1 h-4 w-4 accent-[#067a46]"
              />
              <span className="min-w-0">
                <span className="block font-semibold">{evaluation.date || 'No date entered'}</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-[#456653]">
                  {evaluation.session || 'No session entered'} | {evaluation.section || 'Trial'} | Score {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : 'No score'}
                </span>
              </span>
            </label>
          ))}
        </div>

        {mergeSelectedEvaluations.length >= 2 ? (
          <div className="space-y-4 rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 shadow-sm shadow-[#067a46]/10">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#10231a]">Main details source</span>
              <select
                value={mergeCoreSource?.id || ''}
                onChange={(event) => onMergeSourceChange(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:ring-2 focus:ring-[#d7f8e5]"
              >
                {mergeSelectedEvaluations.map((evaluation) => (
                  <option key={evaluation.id} value={evaluation.id}>
                    {evaluation.date || 'No date entered'} | {evaluation.session || 'No session entered'} | {evaluation.section || 'Trial'}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs font-semibold leading-5 text-[#456653]">
                This is the default source. You can override each merged detail below.
              </p>
            </label>

            <div>
              <p className="text-sm font-semibold text-[#10231a]">Choose report detail sources</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-[#456653]">
                Pick which record supplies non-score details such as parents, session, date, comments, and status.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {mergeDetailFields.map((field) => {
                  const selectedSource =
                    mergeSelectedEvaluations.find(
                      (evaluation) => evaluation.id === (mergeDetailSources[field.key] || mergeCoreSource?.id),
                    ) ?? mergeCoreSource ?? mergeSelectedEvaluations[0]

                  return (
                    <label key={field.key} className="block rounded-lg border border-[#bddcca] bg-white p-3 shadow-sm shadow-[#067a46]/10">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[#067a46]">{field.label}</span>
                      <select
                        value={mergeDetailSources[field.key] || mergeCoreSource?.id || ''}
                        onChange={(event) => onMergeDetailSourceChange(field.key, event.target.value)}
                        className="min-h-11 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
                      >
                        {mergeSelectedEvaluations.map((evaluation) => (
                          <option key={evaluation.id} value={evaluation.id}>
                            {evaluation.date || 'No date entered'} | {evaluation.session || 'No session entered'}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#456653]">
                        {field.preview(selectedSource)}
                      </p>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#10231a]">Choose field sources</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-[#456653]">
                Pick which record should supply each score or text field.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {mergeFieldLabels.map((label) => (
                  <label key={label} className="block rounded-lg border border-[#bddcca] bg-white p-3 shadow-sm shadow-[#067a46]/10">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[#067a46]">{label}</span>
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
                      className="min-h-11 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]"
                    >
                      {mergeSelectedEvaluations
                        .filter((evaluation) => Object.prototype.hasOwnProperty.call(evaluation.formResponses ?? {}, label))
                        .map((evaluation) => (
                          <option key={evaluation.id} value={evaluation.id}>
                            {evaluation.date || 'No date entered'} | {String(evaluation.formResponses?.[label] ?? 'No value')}
                          </option>
                        ))}
                    </select>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-[#456653]">
                      {String(mergePreviewResponses[label] ?? 'No value')}
                    </p>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-[#bddcca] bg-white p-4 shadow-sm shadow-[#067a46]/10 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#10231a]">Merged score preview</p>
                <p className="mt-1 text-sm font-semibold text-[#456653]">
                  {mergePreviewAverage !== null ? mergePreviewAverage.toFixed(1) : 'No numeric scores selected'}
                </p>
              </div>
              <button
                type="button"
                disabled={isMergingEvaluations}
                title={isMergingEvaluations ? 'Please wait while the merged development record is being saved.' : undefined}
                onClick={onCreateMergedEvaluation}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isMergingEvaluations ? 'Saving...' : 'Save Merged Record'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-6 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
            Select at least two development records to build a merged report.
          </div>
        )}
      </div>
    </SectionCard>
  )
}
