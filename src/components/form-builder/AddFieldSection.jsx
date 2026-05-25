import {
  createScoreOptions,
  FIELD_TYPE_OPTIONS,
  isScoreType,
} from '../../hooks/form-builder/formBuilderUtils.js'
import { createFeatureUpgradeMessage } from '../../lib/plans.js'
import { SectionCard } from '../ui/SectionCard.jsx'

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
          ? 'Create fast-scoring dropdowns, text fields, or custom select fields for your club form.'
          : createFeatureUpgradeMessage('customFormFields')
      }
    >
      <form className="grid gap-4 md:grid-cols-2" onSubmit={onAddField}>
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-950">Label</span>
          <input
            type="text"
            name="label"
            value={fieldForm.label}
            onChange={onFormChange}
            required
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-950">Type</span>
          <select
            name="type"
            value={fieldForm.type}
            onChange={onFormChange}
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
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
            <span className="mb-2 block text-sm font-bold text-slate-950">Options</span>
            <input
              type="text"
              name="options"
              value={fieldForm.options}
              onChange={onFormChange}
              placeholder="Option A, Option B, Option C"
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
            />
          </label>
        ) : null}

        {isScoreType(fieldForm.type) ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
            <p className="text-sm font-bold text-slate-950">Score options</p>
            <p className="mt-2 text-sm text-slate-600">{createScoreOptions(fieldForm.type).join(', ')}</p>
          </div>
        ) : null}

        <label className="inline-flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800">
          <input
            type="checkbox"
            name="required"
            checked={fieldForm.required}
            onChange={onFormChange}
            className="h-4 w-4 rounded border-slate-300 bg-white"
          />
          <span>Required field</span>
        </label>

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={isSaving || !canUseCustomFields}
            title={addFieldDisabledReason}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? 'Saving...' : 'Add field'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
