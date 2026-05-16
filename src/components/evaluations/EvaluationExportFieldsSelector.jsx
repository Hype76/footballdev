import { useState } from 'react'

export function EvaluationExportFieldsSelector({
  gridClassName = 'mt-4 grid gap-2 md:grid-cols-2',
  hasSavedExportSelection,
  onReorderExportField,
  onToggleExportField,
  responseItems,
  selectedExportLabels,
}) {
  const [isDragLocked, setIsDragLocked] = useState(true)
  const [draggedLabel, setDraggedLabel] = useState('')
  const [dragOverLabel, setDragOverLabel] = useState('')

  const resetDrag = () => {
    setDraggedLabel('')
    setDragOverLabel('')
  }

  if (responseItems.length === 0) {
    return null
  }

  return (
    <>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setIsDragLocked((current) => !current)
            resetDrag()
          }}
          className={[
            'inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold transition',
            isDragLocked
              ? 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]'
              : 'border-[var(--accent)] bg-[var(--panel-soft)] text-[var(--text-primary)]',
          ].join(' ')}
        >
          {isDragLocked ? 'Unlock drag' : 'Lock drag'}
        </button>
      </div>

      <div className={gridClassName}>
        {responseItems.map((item) => {
          const isSelected = hasSavedExportSelection
            ? selectedExportLabels.includes(item.label)
            : true
          const itemLabel = item.label

          return (
            <label
              key={itemLabel}
              draggable={!isDragLocked}
              onDragStart={(event) => {
                if (isDragLocked) {
                  event.preventDefault()
                  return
                }

                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', itemLabel)
                setDraggedLabel(itemLabel)
              }}
              onDragEnd={resetDrag}
              onDragOver={(event) => {
                if (isDragLocked) {
                  return
                }

                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                if (itemLabel !== draggedLabel) {
                  setDragOverLabel(itemLabel)
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget) && dragOverLabel === itemLabel) {
                  setDragOverLabel('')
                }
              }}
              onDrop={(event) => {
                if (isDragLocked) {
                  return
                }

                event.preventDefault()
                const sourceLabel = event.dataTransfer.getData('text/plain')
                resetDrag()
                onReorderExportField(sourceLabel, itemLabel, responseItems)
              }}
              className={[
                'flex min-h-11 items-start gap-3 rounded-lg border bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] transition',
                isDragLocked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                draggedLabel === itemLabel ? 'opacity-60' : '',
                dragOverLabel === itemLabel
                  ? 'border-[var(--accent)] ring-2 ring-[var(--accent)] ring-opacity-40'
                  : 'border-[var(--border-color)]',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleExportField(itemLabel, responseItems)}
                className="mt-1 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="min-w-0">
                <span className="block font-semibold">{itemLabel}</span>
                <span className="block break-words text-xs leading-5 text-[var(--text-muted)]">
                  {String(item.value ?? '').trim() || 'No data entered'}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </>
  )
}
