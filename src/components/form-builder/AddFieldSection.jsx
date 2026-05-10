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
  return (
    <SectionCard
      title="Add field"
      description={
        canUseCustomFields
          ? 'Create fast-scoring dropdowns, text fields, or custom select fields for your club form.'
          : createFeatureUpgradeMessage('customFormFields')
      }
    >
      <form className="grid gap-4 md:grid-cols-2" onSubmit={onAddField}>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Label</span>
          <input
            type="text"
            name="label"
            value={fieldForm.label}
            onChange={onFormChange}
            required
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Type</span>
          <select
            name="type"
            value={fieldForm.type}
            onChange={onFormChange}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Options</span>
            <input
              type="text"
              name="options"
              value={fieldForm.options}
              onChange={onFormChange}
              placeholder="Option A, Option B, Option C"
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
        ) : null}

        {isScoreType(fieldForm.type) ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 md:col-span-2">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Score options</p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{createScoreOptions(fieldForm.type).join(', ')}</p>
          </div>
        ) : null}

        <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          <input
            type="checkbox"
            name="required"
            checked={fieldForm.required}
            onChange={onFormChange}
            className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--panel-bg)]"
          />
          <span>Required field</span>
        </label>

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={isSaving || !canUseCustomFields}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? 'Saving...' : 'Add field'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
