import { useState } from 'react'
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

const fieldClass = 'min-h-11 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-black text-[#10231a] transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60'

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
  onReorderField,
  onSaveField,
  onSetFieldGroup,
  onToggleEnabled,
  paginatedFields,
  visibleFields,
}) {
  const [isDragLocked, setIsDragLocked] = useState(true)
  const [draggedFieldId, setDraggedFieldId] = useState('')
  const [dragOverFieldId, setDragOverFieldId] = useState('')

  const handleDragStart = (fieldId) => {
    if (isDragLocked) {
      return
    }

    setDraggedFieldId(fieldId)
  }

  const handleDragEnd = () => {
    setDraggedFieldId('')
    setDragOverFieldId('')
  }

  const handleDragOver = (fieldId) => {
    if (!isDragLocked && fieldId !== draggedFieldId) {
      setDragOverFieldId(fieldId)
    }
  }

  const handleDragLeave = (fieldId) => {
    if (dragOverFieldId === fieldId) {
      setDragOverFieldId('')
    }
  }

  const handleDropField = (fieldId, targetFieldId) => {
    setDraggedFieldId('')
    setDragOverFieldId('')

    if (isDragLocked) {
      return
    }

    onReorderField(fieldId, targetFieldId)
  }

  return (
    <SectionCard
      title="Current fields"
      tourId="current-fields-section"
      description="Review the live structure, edit custom fields, and keep field order practical for coaches."
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => {
            onSetFieldGroup('default')
            onPageChange(1)
          }}
          className={[
            'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-3 text-sm font-black transition',
            fieldGroup === 'default'
              ? 'bg-[#067a46] text-white'
              : 'border border-[#bddcca] bg-white text-[#10231a] hover:border-[#20a464] hover:bg-[#f0fdf6]',
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
            'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-3 text-sm font-black transition',
            fieldGroup === 'custom'
              ? 'bg-[#067a46] text-white'
              : 'border border-[#bddcca] bg-white text-[#10231a] hover:border-[#20a464] hover:bg-[#f0fdf6]',
          ].join(' ')}
        >
          Custom Fields ({customFields.length})
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => {
            setIsDragLocked((current) => !current)
            setDraggedFieldId('')
            setDragOverFieldId('')
          }}
          className={[
            'inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60',
            isDragLocked
              ? 'border-[#bddcca] bg-white text-[#10231a] hover:border-[#20a464] hover:bg-[#f0fdf6]'
              : 'border-[#abefc6] bg-[#ecfdf3] text-[#067a46]',
          ].join(' ')}
        >
          {isDragLocked ? 'Unlock drag' : 'Lock drag'}
        </button>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-4 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
          Loading fields...
        </div>
      ) : fields.length === 0 ? (
        <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-6 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
          No fields found for this club.
        </div>
      ) : visibleFields.length === 0 ? (
        <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-6 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
          {fieldGroup === 'default'
            ? 'No default fields are configured yet. Load the default form to start.'
            : 'No custom fields have been added yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedFields.items.map((field) => {
            const draft = fieldDrafts[field.id] ?? createDraftFromField(field)
            const fieldIndex = visibleFields.findIndex((item) => item.id === field.id)

            return (
              <FormFieldCard
                key={field.id}
                draft={draft}
                field={field}
                fieldIndex={fieldIndex}
                fieldsCount={visibleFields.length}
                isDragLocked={isDragLocked}
                isSaving={isSaving}
                isDragOver={dragOverFieldId === field.id}
                isDragging={draggedFieldId === field.id}
                onDeleteField={onDeleteField}
                onDragEnd={handleDragEnd}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDragStart={handleDragStart}
                onDropField={handleDropField}
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
  isDragLocked,
  isSaving,
  isDragOver,
  isDragging,
  onDeleteField,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDropField,
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
    <div
      draggable={!isSaving && !isDragLocked}
      onDragStart={(event) => {
        if (isDragLocked) {
          event.preventDefault()
          return
        }

        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', field.id)
        onDragStart(field.id)
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (isDragLocked) {
          return
        }

        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOver(field.id)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onDragLeave(field.id)
        }
      }}
      onDrop={(event) => {
        if (isDragLocked) {
          return
        }

        event.preventDefault()
        const sourceFieldId = event.dataTransfer.getData('text/plain')
        onDropField(sourceFieldId, field.id)
      }}
      className={[
        'rounded-lg border bg-white p-4 shadow-sm shadow-[#067a46]/10 transition',
        isSaving || isDragLocked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        isDragging ? 'opacity-60' : '',
        isDragOver ? 'border-[#20a464] ring-2 ring-[#d7f8e5]' : 'border-[#bddcca]',
      ].join(' ')}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="grid gap-4 md:grid-cols-2">
          {field.isDefault ? (
            <>
              <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#456653]">Label</p>
                <p className="mt-2 text-sm font-black text-[#10231a]">{field.label}</p>
              </div>
              <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#456653]">Type</p>
                <p className="mt-2 text-sm font-black text-[#10231a]">{getFieldTypeLabel(field.type)}</p>
              </div>
            </>
          ) : (
            <>
              <label className="block">
                <span className={labelClass}>Label</span>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(event) => onDraftChange(field.id, 'label', event.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Type</span>
                <select
                  value={draft.type}
                  onChange={(event) => onDraftChange(field.id, 'type', event.target.value)}
                  className={fieldClass}
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
                  <span className={labelClass}>Options</span>
                  <input
                    type="text"
                    value={draft.options}
                    onChange={(event) => onDraftChange(field.id, 'options', event.target.value)}
                    placeholder="Option A, Option B, Option C"
                    className={fieldClass}
                  />
                </label>
              ) : null}

              {isScoreType(draft.type) ? (
                <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 md:col-span-2">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[#456653]">Score options</p>
                  <p className="mt-2 text-sm font-semibold text-[#456653]">{createScoreOptions(draft.type).join(', ')}</p>
                </div>
              ) : null}

              <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-black text-[#10231a]">
                <input
                  type="checkbox"
                  checked={draft.required}
                  onChange={(event) => onDraftChange(field.id, 'required', event.target.checked)}
                  className="h-4 w-4 rounded border-[#bddcca] bg-white accent-[#067a46]"
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
            className={secondaryButtonClass}
          >
            Move up
          </button>
          <button
            type="button"
            disabled={isSaving || fieldIndex === fieldsCount - 1}
            title={moveDownDisabledReason}
            onClick={() => onMoveField(field.id, 1)}
            className={secondaryButtonClass}
          >
            Move down
          </button>
          <button
            type="button"
            disabled={isSaving}
            title={savingDisabledReason}
            onClick={() => onToggleEnabled(field)}
            className={secondaryButtonClass}
          >
            {draft.isEnabled ? 'Disable' : 'Enable'}
          </button>
          {field.isDefault ? (
            <div className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-black text-[#456653]">
              Default field
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={isSaving}
                title={savingDisabledReason}
                onClick={() => onSaveField(field)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                disabled={isSaving}
                title={savingDisabledReason}
                onClick={() => onDeleteField(field.id)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.14em] text-[#456653]">
        <span className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-1">{field.isDefault ? 'Default' : 'Custom'}</span>
        <span className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-1">{draft.isEnabled ? 'Enabled' : 'Disabled'}</span>
        <span className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-3 py-1">{draft.required ? 'Required' : 'Optional'}</span>
      </div>
    </div>
  )
}
