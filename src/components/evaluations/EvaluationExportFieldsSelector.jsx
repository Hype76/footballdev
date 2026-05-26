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
  const orderedResponseItems = (() => {
    if (!Array.isArray(selectedExportLabels)) {
      return responseItems
    }

    const selectedLabels = selectedExportLabels.map((label) => String(label ?? '').trim()).filter(Boolean)
    const itemByLabel = new Map(responseItems.map((item) => [String(item.label ?? '').trim(), item]))
    const orderedItems = selectedLabels
      .map((label) => itemByLabel.get(label))
      .filter(Boolean)
    const orderedLabelSet = new Set(orderedItems.map((item) => String(item.label ?? '').trim()))
    const remainingItems = responseItems.filter((item) => !orderedLabelSet.has(String(item.label ?? '').trim()))

    return [...orderedItems, ...remainingItems]
  })()

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
            'inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-xs font-black transition',
            isDragLocked
              ? 'border-[#bddcca] bg-white text-[#10231a] hover:border-[#20a464] hover:bg-[#f0fdf6]'
              : 'border-[#abefc6] bg-[#ecfdf3] text-[#067a46]',
          ].join(' ')}
        >
          {isDragLocked ? 'Unlock drag' : 'Lock drag'}
        </button>
      </div>

      <div className={gridClassName}>
        {orderedResponseItems.map((item) => {
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
                'flex min-h-11 items-start gap-3 rounded-lg border bg-white px-4 py-3 text-sm font-semibold text-[#10231a] shadow-sm shadow-[#067a46]/10 transition',
                isDragLocked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                draggedLabel === itemLabel ? 'opacity-60' : '',
                dragOverLabel === itemLabel
                  ? 'border-[#20a464] ring-2 ring-[#d7f8e5]'
                  : 'border-[#bddcca]',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleExportField(itemLabel, responseItems)}
                className="mt-1 h-4 w-4 accent-[#067a46]"
              />
              <span className="min-w-0">
                <span className="block font-black">{itemLabel}</span>
                <span className="block break-words text-xs font-semibold leading-5 text-[#456653]">
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
