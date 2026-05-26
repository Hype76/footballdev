import { getFieldTypeLabel } from '../../hooks/form-builder/formBuilderUtils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const defaultFieldCardClass = 'rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-3 shadow-sm shadow-slate-200/60'
const secondaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'

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
      description="Load the baseline football development fields, then switch off anything your coaches will not use."
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {defaultTemplateFields.map((field) => (
            <div key={field.id} className={defaultFieldCardClass}>
              <p className="text-sm font-black text-[#101828]">{field.label}</p>
              <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">{getFieldTypeLabel(field.type)}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold leading-6 text-[#667085]">
            {fieldsCount === 0
              ? 'No fields are configured for this club yet. Load the default form to start.'
              : 'Default fields are already available below and can be enabled, disabled, and reordered.'}
          </p>
          <button
            type="button"
            onClick={onRefreshFields}
            disabled={isSaving}
            title={refreshDisabledReason}
            className={secondaryButtonClass}
          >
            {isSaving ? 'Loading...' : 'Load default form'}
          </button>
        </div>
      </div>
    </SectionCard>
  )
}
