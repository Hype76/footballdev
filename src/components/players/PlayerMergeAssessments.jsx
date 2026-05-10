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
      title="Merge assessments"
      description="Managers can create one combined assessment from selected reports. Original reports stay in history."
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          {evaluations.map((evaluation) => (
            <label
              key={evaluation.id}
              className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)]"
            >
              <input
                type="checkbox"
                checked={mergeSelectedIds.includes(evaluation.id)}
                onChange={(event) => onMergeSelectionChange(evaluation.id, event.target.checked)}
                className="mt-1 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="min-w-0">
                <span className="block font-semibold">{evaluation.date || 'No date entered'}</span>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">
                  {evaluation.session || 'No session entered'} | {evaluation.section || 'Trial'} | Score {evaluation.averageScore !== null ? evaluation.averageScore.toFixed(1) : 'No score'}
                </span>
              </span>
            </label>
          ))}
        </div>

        {mergeSelectedEvaluations.length >= 2 ? (
          <div className="space-y-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Main details source</span>
              <select
                value={mergeCoreSource?.id || ''}
                onChange={(event) => onMergeSourceChange(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              >
                {mergeSelectedEvaluations.map((evaluation) => (
                  <option key={evaluation.id} value={evaluation.id}>
                    {evaluation.date || 'No date entered'} | {evaluation.session || 'No session entered'} | {evaluation.section || 'Trial'}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                This is the default source. You can override each merged detail below.
              </p>
            </label>

            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Choose report detail sources</p>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                Pick which assessment supplies non-score details such as parents, session, date, comments, and status.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {mergeDetailFields.map((field) => {
                  const selectedSource =
                    mergeSelectedEvaluations.find(
                      (evaluation) => evaluation.id === (mergeDetailSources[field.key] || mergeCoreSource?.id),
                    ) ?? mergeCoreSource ?? mergeSelectedEvaluations[0]

                  return (
                    <label key={field.key} className="block rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{field.label}</span>
                      <select
                        value={mergeDetailSources[field.key] || mergeCoreSource?.id || ''}
                        onChange={(event) => onMergeDetailSourceChange(field.key, event.target.value)}
                        className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                      >
                        {mergeSelectedEvaluations.map((evaluation) => (
                          <option key={evaluation.id} value={evaluation.id}>
                            {evaluation.date || 'No date entered'} | {evaluation.session || 'No session entered'}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">
                        {field.preview(selectedSource)}
                      </p>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Choose field sources</p>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                Pick which assessment should supply each score or text field.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {mergeFieldLabels.map((label) => (
                  <label key={label} className="block rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{label}</span>
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
                      className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                    >
                      {mergeSelectedEvaluations
                        .filter((evaluation) => Object.prototype.hasOwnProperty.call(evaluation.formResponses ?? {}, label))
                        .map((evaluation) => (
                          <option key={evaluation.id} value={evaluation.id}>
                            {evaluation.date || 'No date entered'} | {String(evaluation.formResponses?.[label] ?? 'No value')}
                          </option>
                        ))}
                    </select>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-muted)]">
                      {String(mergePreviewResponses[label] ?? 'No value')}
                    </p>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Merged score preview</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {mergePreviewAverage !== null ? mergePreviewAverage.toFixed(1) : 'No numeric scores selected'}
                </p>
              </div>
              <button
                type="button"
                disabled={isMergingEvaluations}
                onClick={onCreateMergedEvaluation}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isMergingEvaluations ? 'Saving...' : 'Save Merged Assessment'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            Select at least two assessments to build a merged report.
          </div>
        )}
      </div>
    </SectionCard>
  )
}
