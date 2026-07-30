import {
  formatAssessmentScore,
  getAssessmentScoreGuideLabel,
  getAssessmentScoreMax,
  isAssessmentScoreFieldType,
} from './assessment-scoring.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function parseScoreDisplay(value) {
  const match = normalizeText(value).match(
    /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s*[-|]\s*(.+))?$/i,
  )

  if (!match) {
    return {
      numericScore: null,
      maxScore: null,
      ratingLabel: '',
    }
  }

  return {
    numericScore: normalizeNumber(match[1]),
    maxScore: normalizeNumber(match[2]),
    ratingLabel: normalizeText(match[3]),
  }
}

function isScoreWithinScale(numericScore, maxScore, type) {
  if (numericScore === null || maxScore === null || maxScore <= 0) {
    return false
  }

  if (isAssessmentScoreFieldType(type)) {
    return numericScore >= 1 && numericScore <= maxScore
  }

  return numericScore >= 0 && numericScore <= maxScore
}

export function formatDevelopmentScore({
  maxScore,
  numericScore,
  ratingLabel = '',
} = {}) {
  const normalizedScore = normalizeNumber(numericScore)
  const normalizedMax = normalizeNumber(maxScore)

  if (normalizedScore === null || normalizedMax === null || normalizedMax <= 0) {
    return ''
  }

  return `${formatAssessmentScore(normalizedScore)} / ${formatAssessmentScore(normalizedMax)}${normalizeText(ratingLabel) ? ` - ${normalizeText(ratingLabel)}` : ''}`
}

export function normalizeDevelopmentScorePresentation(item = {}) {
  const type = normalizeText(item.type || item.fieldType)
  const parsedDisplay = parseScoreDisplay(item.displayValue ?? item.value)
  const explicitScore = normalizeNumber(item.numericScore)
  const rawScore = normalizeNumber(item.rawValue)
  const numericScore = explicitScore
    ?? (isAssessmentScoreFieldType(type) ? rawScore : null)
    ?? (isAssessmentScoreFieldType(type) ? parsedDisplay.numericScore : null)
  const explicitMax = normalizeNumber(item.maxScore)
  const maxScore = explicitMax && explicitMax > 0
    ? explicitMax
    : isAssessmentScoreFieldType(type)
      ? getAssessmentScoreMax(type)
      : parsedDisplay.maxScore
  const validNumericScore = isScoreWithinScale(numericScore, maxScore, type)
    ? numericScore
    : null
  const ratingLabel = validNumericScore === null
    ? ''
    : normalizeText(item.ratingLabel)
      || parsedDisplay.ratingLabel
      || (isAssessmentScoreFieldType(type)
        ? getAssessmentScoreGuideLabel(validNumericScore)
        : '')
  const displayValue = validNumericScore === null
    ? normalizeText(item.displayValue ?? item.value)
    : formatDevelopmentScore({
        numericScore: validNumericScore,
        maxScore,
        ratingLabel,
      })

  return {
    type: type || 'text',
    displayValue,
    numericScore: validNumericScore,
    maxScore: validNumericScore === null ? null : maxScore,
    ratingLabel,
    isScored: validNumericScore !== null && maxScore !== null,
  }
}
