import {
  createScoreOptions,
  FIELD_TYPE_OPTIONS,
  isScoreType,
} from '../../hooks/form-builder/formBuilderUtils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const fieldClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]'
const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'

export function AddFieldSection({
  canUseCustomFields,
  fieldForm,
  featureUnavailableMessage = 'Custom development fields are not available for this workspace.',
  isSaving,
  onAddField,
  onFormChange,
}) {
  const addFieldDisabledReason = isSaving
    ? 'Please wait while this field is being saved.'
    : !canUseCustomFields
      ? featureUnavailableMessage
      : undefined

  return (
    <SectionCard
      title="Add field"
      tourId="add-field-section"
      description={
        canUseCustomFields
          ? 'Create one useful field at a time. Prefer fields that a coach can complete quickly.'
          : featureUnavailableMessage
      }
    >
      <form className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10" onSubmit={onAddField}>
        <div className="mb-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">New field</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
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
            <div className="space-y-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10 md:col-span-2">
              <p className="text-sm font-black text-[#101828]">Score options</p>
              <p className="mt-2 text-sm font-semibold text-[#4b5f55]">{createScoreOptions(fieldForm.type).join(', ')}</p>
              <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828]">
                <input
                  type="checkbox"
                  name="includeInProgressChart"
                  checked={Boolean(fieldForm.includeInProgressChart)}
                  onChange={onFormChange}
                  className="h-5 w-5 rounded border-[#d7e5dc] bg-white accent-[#047857]"
                />
                <span>Include in progression chart</span>
              </label>
              <p className="text-sm font-semibold leading-6 text-[#4b5f55]">
                Use this score when building player progression charts.
              </p>
            </div>
          ) : null}

          <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828]">
            <input
              type="checkbox"
              name="required"
              checked={fieldForm.required}
              onChange={onFormChange}
              className="h-4 w-4 rounded border-[#d7e5dc] bg-white accent-[#047857]"
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
