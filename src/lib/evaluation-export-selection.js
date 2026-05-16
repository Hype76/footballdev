const EXPORT_SELECTION_KEY_PREFIX = 'player-feedback:evaluation-export-selection'

function normaliseLabel(label) {
  return String(label ?? '').trim()
}

function getStorageKey({ clubId, playerName }) {
  return `${EXPORT_SELECTION_KEY_PREFIX}:${clubId || 'club'}:${normaliseLabel(playerName).toLowerCase()}`
}

function readJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch (error) {
    console.error('Could not read saved export selection', error)
    return fallback
  }
}

export function getSavedEvaluationExportLabels({ clubId, playerName }) {
  const labels = readJson(localStorage.getItem(getStorageKey({ clubId, playerName })), null)

  if (!Array.isArray(labels)) {
    return null
  }

  return labels.map(normaliseLabel).filter(Boolean)
}

export function saveEvaluationExportLabels({ clubId, playerName, labels }) {
  localStorage.setItem(
    getStorageKey({ clubId, playerName }),
    JSON.stringify((labels ?? []).map(normaliseLabel).filter(Boolean)),
  )
}

export function getSelectedEvaluationResponses(responseItems, selectedLabels) {
  const items = Array.isArray(responseItems) ? responseItems : []

  if (!Array.isArray(selectedLabels)) {
    return items
  }

  const selectedLabelSet = new Set(selectedLabels.map(normaliseLabel))
  const itemsByLabel = new Map(items.map((item) => [normaliseLabel(item.label), item]))

  return selectedLabels
    .map(normaliseLabel)
    .filter((label, index, labels) => label && labels.indexOf(label) === index)
    .filter((label) => selectedLabelSet.has(label))
    .map((label) => itemsByLabel.get(label))
    .filter(Boolean)
}

export function reorderEvaluationExportLabels({ sourceLabel, targetLabel, responseItems, selectedLabels }) {
  const allLabels = (responseItems ?? []).map((item) => normaliseLabel(item.label)).filter(Boolean)
  const selectedLabelList = Array.isArray(selectedLabels) ? selectedLabels.map(normaliseLabel).filter(Boolean) : null
  const selectedLabelSet = selectedLabelList ? new Set(selectedLabelList) : null
  const currentLabels = selectedLabelList
    ? [
      ...selectedLabelList,
      ...allLabels.filter((label) => !selectedLabelSet.has(label)),
    ]
    : allLabels
  const sourceIndex = currentLabels.indexOf(normaliseLabel(sourceLabel))
  const targetIndex = currentLabels.indexOf(normaliseLabel(targetLabel))

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return currentLabels
  }

  const nextLabels = [...currentLabels]
  const [movedLabel] = nextLabels.splice(sourceIndex, 1)
  nextLabels.splice(targetIndex, 0, movedLabel)

  return selectedLabelSet
    ? nextLabels.filter((label) => selectedLabelSet.has(label))
    : nextLabels
}
