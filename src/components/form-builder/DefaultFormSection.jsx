import { getFieldTypeLabel } from '../../hooks/form-builder/formBuilderUtils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function DefaultFormSection({
  defaultTemplateFields,
  fieldsCount,
  isSaving,
  onRefreshFields,
}) {
  const refreshDisabledReason = isSaving ? 'Please wait while the default form is loading.' : undefined

  return (
    <SectionCard
      title="Default form"
      tourId="default-form-section"
      description="Every club starts from this template. These fields become your editable default form once loaded."
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {defaultTemplateFields.map((field) => (
            <div key={field.id} className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-sm font-bold text-slate-950">{field.label}</p>
              <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">{getFieldTypeLabel(field.type)}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold leading-6 text-slate-600">
            {fieldsCount === 0
              ? 'No fields are configured for this club yet. Load the default form to start.'
              : 'Default fields are already available below and can be enabled, disabled, and reordered.'}
          </p>
          <button
            type="button"
            onClick={onRefreshFields}
            disabled={isSaving}
            title={refreshDisabledReason}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? 'Loading...' : 'Load default form'}
          </button>
        </div>
      </div>
    </SectionCard>
  )
}
