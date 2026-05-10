import { getFieldTypeLabel } from '../../hooks/form-builder/formBuilderUtils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function DefaultFormSection({
  defaultTemplateFields,
  fieldsCount,
  isSaving,
  onRefreshFields,
}) {
  return (
    <SectionCard
      title="Default form"
      description="Every club starts from this template. These fields become your editable default form once loaded."
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {defaultTemplateFields.map((field) => (
            <div key={field.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{field.label}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-secondary)]">{getFieldTypeLabel(field.type)}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--text-muted)]">
            {fieldsCount === 0
              ? 'No fields are configured for this club yet. Load the default form to start.'
              : 'Default fields are already available below and can be enabled, disabled, and reordered.'}
          </p>
          <button
            type="button"
            onClick={onRefreshFields}
            disabled={isSaving}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? 'Loading...' : 'Load default form'}
          </button>
        </div>
      </div>
    </SectionCard>
  )
}
