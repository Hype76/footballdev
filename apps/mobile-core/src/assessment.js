const scoreFieldTypes = ['score_1_5', 'score_1_10', 'number']

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function isAssessmentScoreField(type) {
  return scoreFieldTypes.includes(normalizeText(type))
}

export function getAssessmentFieldMax(field) {
  return field?.type === 'score_1_10' ? 10 : 5
}

function getAssessmentFieldDefault(field) {
  return field?.type === 'score_1_10' ? 5 : 3
}

export function createAssessmentFieldValues(fields, currentValues = {}) {
  const nextValues = { ...currentValues }

  fields.forEach((field) => {
    if (nextValues[field.id] === undefined) {
      nextValues[field.id] = isAssessmentScoreField(field.type) ? getAssessmentFieldDefault(field) : ''
    }
  })

  return nextValues
}

export function resetAssessmentFieldValues(fields, currentValues = {}) {
  const nextValues = {}

  fields.forEach((field) => {
    nextValues[field.id] = isAssessmentScoreField(field.type) ? currentValues[field.id] || getAssessmentFieldDefault(field) : ''
  })

  return nextValues
}
