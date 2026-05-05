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
  return items.filter((item) => selectedLabelSet.has(normaliseLabel(item.label)))
}
