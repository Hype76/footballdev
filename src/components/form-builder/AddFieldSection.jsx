import {
  createScoreOptions,
  FIELD_TYPE_OPTIONS,
  isScoreType,
} from '../../hooks/form-builder/formBuilderUtils.js'
import { createFeatureUpgradeMessage } from '../../lib/plans.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const fieldClass = 'min-h-11 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#dbeafe]'
const labelClass = 'mb-2 block text-sm font-black text-[#0f172a]'
const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#2563eb] px-5 py-3 text-sm font-black text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'

export function AddFieldSection({
  canUseCustomFields,
  fieldForm,
  isSaving,
  onAddField,
  onFormChange,
}) {
  const addFieldDisabledReason = isSaving
    ? 'Please wait while this field is being saved.'
    : !canUseCustomFields
      ? createFeatureUpgradeMessage('customFormFields')
      : undefined

  return (
    <SectionCard
      title="Add field"
      tourId="add-field-section"
      description={
        canUseCustomFields
          ? 'Create one useful field at a time. Prefer fields that a coach can complete quickly.'
          : createFeatureUpgradeMessage('customFormFields')
      }
    >
      <form className="rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10" onSubmit={onAddField}>
        <div className="mb-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">New field</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">
            Name the exact information coaches need, then choose the lowest-friction input type.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Label</span>
            <input
              type="text"
              name="label"
              value={fieldForm.label}
              onChange={onFormChange}
              required
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Type</span>
            <select
              name="type"
              value={fieldForm.type}
              onChange={onFormChange}
              className={fieldClass}
            >
              {FIELD_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {fieldForm.type === 'select' ? (
            <label className="block md:col-span-2">
              <span className={labelClass}>Options</span>
              <input
                type="text"
                name="options"
                value={fieldForm.options}
                onChange={onFormChange}
                placeholder="Option A, Option B, Option C"
                className={fieldClass}
              />
            </label>
          ) : null}

          {isScoreType(fieldForm.type) ? (
            <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 shadow-sm shadow-[#2563eb]/10 md:col-span-2">
              <p className="text-sm font-black text-[#0f172a]">Score options</p>
              <p className="mt-2 text-sm font-semibold text-[#475569]">{createScoreOptions(fieldForm.type).join(', ')}</p>
            </div>
          ) : null}

          <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-black text-[#0f172a]">
            <input
              type="checkbox"
              name="required"
              checked={fieldForm.required}
              onChange={onFormChange}
              className="h-4 w-4 rounded border-[#cbd5e1] bg-white accent-[#2563eb]"
            />
            <span>Required field</span>
          </label>
        </div>

        <div className="mt-5">
          <button
            type="submit"
            disabled={isSaving || !canUseCustomFields}
            title={addFieldDisabledReason}
            className={primaryButtonClass}
          >
            {isSaving ? 'Saving...' : 'Add field'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
