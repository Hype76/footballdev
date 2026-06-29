export const FIELD_TYPE_OPTIONS = [
  { value: 'score_1_10', label: 'Score 1 to 10' },
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'select', label: 'Dropdown' },
  { value: 'traffic_light', label: 'Traffic light' },
  { value: 'score_1_5', label: 'Score 1 to 5' },
  { value: 'number', label: 'Number' },
]

export const initialFieldForm = {
  label: '',
  type: 'score_1_5',
  required: false,
  options: '1, 2, 3, 4, 5',
  includeInProgressChart: false,
}

export const FIELD_PAGE_SIZE = 8

function normalizeOptions(optionsText) {
  return optionsText
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)
}

export function isScoreType(type) {
  return type === 'score_1_5' || type === 'score_1_10'
}

export function isGraphableDevelopmentField(fieldOrType) {
  const type = typeof fieldOrType === 'string' ? fieldOrType : fieldOrType?.type

  return isScoreType(type)
}

export function isProgressionChartField(field = {}) {
  return Boolean(field.isEnabled) && isGraphableDevelopmentField(field) && Boolean(field.includeInProgressChart)
}

export function countProgressionChartFields(fields = []) {
  return (Array.isArray(fields) ? fields : []).filter(isProgressionChartField).length
}

export function createScoreOptions(type) {
  const maxValue = type === 'score_1_10' ? 10 : 5
  return Array.from({ length: maxValue }, (_, index) => String(index + 1))
}

export function getOptionsForType(type, optionsText) {
  if (isScoreType(type)) {
    return createScoreOptions(type)
  }

  if (type === 'yes_no') {
    return ['Yes', 'No']
  }

  if (type === 'traffic_light') {
    return ['Green', 'Amber', 'Red']
  }

  if (type === 'select') {
    return normalizeOptions(optionsText)
  }

  return []
}

export function getFieldTypeLabel(type) {
  return FIELD_TYPE_OPTIONS.find((option) => option.value === type)?.label || type
}

export function createDraftFromField(field) {
  return {
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options.join(', '),
    isEnabled: field.isEnabled,
    includeInProgressChart: Boolean(field.includeInProgressChart),
  }
}

export function createDraftMap(fields) {
  return Object.fromEntries(fields.map((field) => [field.id, createDraftFromField(field)]))
}

export function buildReorderedFormFields({ customFields, defaultFields, fieldGroup, nextGroupFields }) {
  const nextFields = fieldGroup === 'default'
    ? [...nextGroupFields, ...customFields]
    : [...defaultFields, ...nextGroupFields]

  return nextFields.map((field, index) => ({
    ...field,
    orderIndex: index + 1,
  }))
}
