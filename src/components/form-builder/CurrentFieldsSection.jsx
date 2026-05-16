import {
  createDraftFromField,
  createScoreOptions,
  FIELD_PAGE_SIZE,
  FIELD_TYPE_OPTIONS,
  getFieldTypeLabel,
  isScoreType,
} from '../../hooks/form-builder/formBuilderUtils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function CurrentFieldsSection({
  customFields,
  defaultFields,
  fieldDrafts,
  fieldGroup,
  fieldPage,
  fields,
  isLoading,
  isSaving,
  onDeleteField,
  onDraftChange,
  onMoveField,
  onPageChange,
  onSaveField,
  onSetFieldGroup,
  onToggleEnabled,
  paginatedFields,
  visibleFields,
}) {
  return (
    <SectionCard
      title="Current fields"
      tourId="current-fields-section"
      description="Switch between default fields and custom fields so the form setup stays clear."
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            onSetFieldGroup('default')
            onPageChange(1)
          }}
          className={[
            'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold transition',
            fieldGroup === 'default'
              ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
              : 'border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
          ].join(' ')}
        >
          Default Fields ({defaultFields.length})
        </button>
        <button
          type="button"
          onClick={() => {
            onSetFieldGroup('custom')
            onPageChange(1)
          }}
          className={[
            'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold transition',
            fieldGroup === 'custom'
              ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
              : 'border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
          ].join(' ')}
        >
          Custom Fields ({customFields.length})
        </button>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading fields...
        </div>
      ) : fields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No fields found for this club.
        </div>
      ) : visibleFields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          {fieldGroup === 'default'
            ? 'No default fields are configured yet. Load the default form to start.'
            : 'No custom fields have been added yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedFields.items.map((field) => {
            const draft = fieldDrafts[field.id] ?? createDraftFromField(field)
            const fieldIndex = fields.findIndex((item) => item.id === field.id)

            return (
              <FormFieldCard
                key={field.id}
                draft={draft}
                field={field}
                fieldIndex={fieldIndex}
                fieldsCount={fields.length}
                isSaving={isSaving}
                onDeleteField={onDeleteField}
                onDraftChange={onDraftChange}
                onMoveField={onMoveField}
                onSaveField={onSaveField}
                onToggleEnabled={onToggleEnabled}
              />
            )
          })}
          <Pagination
            currentPage={fieldPage}
            onPageChange={onPageChange}
            pageSize={FIELD_PAGE_SIZE}
            totalItems={visibleFields.length}
          />
        </div>
      )}
    </SectionCard>
  )
}

function FormFieldCard({
  draft,
  field,
  fieldIndex,
  fieldsCount,
  isSaving,
  onDeleteField,
  onDraftChange,
  onMoveField,
  onSaveField,
  onToggleEnabled,
}) {
  const moveUpDisabledReason = isSaving
    ? 'Please wait while field changes are being saved.'
    : fieldIndex === 0
      ? 'This field is already at the top.'
      : undefined
  const moveDownDisabledReason = isSaving
    ? 'Please wait while field changes are being saved.'
    : fieldIndex === fieldsCount - 1
      ? 'This field is already at the bottom.'
      : undefined
  const savingDisabledReason = isSaving ? 'Please wait while field changes are being saved.' : undefined

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="grid gap-4 md:grid-cols-2">
          {field.isDefault ? (
            <>
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Label</p>
                <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{field.label}</p>
              </div>
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Type</p>
                <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{getFieldTypeLabel(field.type)}</p>
              </div>
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Label</span>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(event) => onDraftChange(field.id, 'label', event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Type</span>
                <select
                  value={draft.type}
                  onChange={(event) => onDraftChange(field.id, 'type', event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                >
                  {FIELD_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {draft.type === 'select' ? (
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Options</span>
                  <input
                    type="text"
                    value={draft.options}
                    onChange={(event) => onDraftChange(field.id, 'options', event.target.value)}
                    placeholder="Option A, Option B, Option C"
                    className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  />
                </label>
              ) : null}

              {isScoreType(draft.type) ? (
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Score options</p>
                  <p className="mt-2 text-sm text-[var(--text-muted)]">{createScoreOptions(draft.type).join(', ')}</p>
                </div>
              ) : null}

              <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={draft.required}
                  onChange={(event) => onDraftChange(field.id, 'required', event.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--panel-bg)]"
                />
                <span>Required field</span>
              </label>
            </>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:flex xl:flex-col">
          <button
            type="button"
            disabled={isSaving || fieldIndex === 0}
            title={moveUpDisabledReason}
            onClick={() => onMoveField(field.id, -1)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Move up
          </button>
          <button
            type="button"
            disabled={isSaving || fieldIndex === fieldsCount - 1}
            title={moveDownDisabledReason}
            onClick={() => onMoveField(field.id, 1)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Move down
          </button>
          <button
            type="button"
            disabled={isSaving}
            title={savingDisabledReason}
            onClick={() => onToggleEnabled(field)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {draft.isEnabled ? 'Disable' : 'Enable'}
          </button>
          {field.isDefault ? (
            <div className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-muted)]">
              Default field
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={isSaving}
                title={savingDisabledReason}
                onClick={() => onSaveField(field)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                disabled={isSaving}
                title={savingDisabledReason}
                onClick={() => onDeleteField(field.id)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
        <span>{field.isDefault ? 'Default' : 'Custom'}</span>
        <span>{draft.isEnabled ? 'Enabled' : 'Disabled'}</span>
        <span>{draft.required ? 'Required' : 'Optional'}</span>
      </div>
    </div>
  )
}
