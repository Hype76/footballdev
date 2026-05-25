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
      description="Switch between default fields and custom fields so the form setup stays clear."
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => {
            onSetFieldGroup('default')
            onPageChange(1)
          }}
          className={[
            'inline-flex min-h-11 items-center justify-center rounded-md px-4 py-3 text-sm font-bold transition',
            fieldGroup === 'default'
              ? 'bg-emerald-700 text-white'
              : 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50',
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
            'inline-flex min-h-11 items-center justify-center rounded-md px-4 py-3 text-sm font-bold transition',
            fieldGroup === 'custom'
              ? 'bg-emerald-700 text-white'
              : 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50',
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
            'inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60',
            isDragLocked
              ? 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900',
          ].join(' ')}
        >
          {isDragLocked ? 'Unlock drag' : 'Lock drag'}
        </button>
      </div>

      {isLoading ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-600">
          Loading fields...
        </div>
      ) : fields.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-600">
          No fields found for this club.
        </div>
      ) : visibleFields.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-600">
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
        'rounded-md border bg-white p-4 shadow-sm transition',
        isSaving || isDragLocked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        isDragging ? 'opacity-60' : '',
        isDragOver ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-slate-200',
      ].join(' ')}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="grid gap-4 md:grid-cols-2">
          {field.isDefault ? (
            <>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Label</p>
                <p className="mt-2 text-sm font-bold text-slate-950">{field.label}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Type</p>
                <p className="mt-2 text-sm font-bold text-slate-950">{getFieldTypeLabel(field.type)}</p>
              </div>
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-950">Label</span>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(event) => onDraftChange(field.id, 'label', event.target.value)}
                  className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-950">Type</span>
                <select
                  value={draft.type}
                  onChange={(event) => onDraftChange(field.id, 'type', event.target.value)}
                  className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
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
                  <span className="mb-2 block text-sm font-bold text-slate-950">Options</span>
                  <input
                    type="text"
                    value={draft.options}
                    onChange={(event) => onDraftChange(field.id, 'options', event.target.value)}
                    placeholder="Option A, Option B, Option C"
                    className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                  />
                </label>
              ) : null}

              {isScoreType(draft.type) ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Score options</p>
                  <p className="mt-2 text-sm font-semibold text-slate-600">{createScoreOptions(draft.type).join(', ')}</p>
                </div>
              ) : null}

              <label className="inline-flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800">
                <input
                  type="checkbox"
                  checked={draft.required}
                  onChange={(event) => onDraftChange(field.id, 'required', event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 bg-white"
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
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Move up
          </button>
          <button
            type="button"
            disabled={isSaving || fieldIndex === fieldsCount - 1}
            title={moveDownDisabledReason}
            onClick={() => onMoveField(field.id, 1)}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Move down
          </button>
          <button
            type="button"
            disabled={isSaving}
            title={savingDisabledReason}
            onClick={() => onToggleEnabled(field)}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {draft.isEnabled ? 'Disable' : 'Enable'}
          </button>
          {field.isDefault ? (
            <div className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
              Default field
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={isSaving}
                title={savingDisabledReason}
                onClick={() => onSaveField(field)}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                disabled={isSaving}
                title={savingDisabledReason}
                onClick={() => onDeleteField(field.id)}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
        <span className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-1">{field.isDefault ? 'Default' : 'Custom'}</span>
        <span className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-1">{draft.isEnabled ? 'Enabled' : 'Disabled'}</span>
        <span className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-1">{draft.required ? 'Required' : 'Optional'}</span>
      </div>
    </div>
  )
}
