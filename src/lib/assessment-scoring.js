export const DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE = 'score_1_10'
export const LEGACY_ASSESSMENT_SCORE_FIELD_TYPE = 'score_1_5'

export const DEFAULT_ASSESSMENT_SCORE_LABELS = [
  'Technical',
  'Tactical',
  'Physical',
  'Mentality',
  'Coachability',
]

export const DEFAULT_ASSESSMENT_SCORE_GUIDE = [
  {
    score: 1,
    label: 'Well Below Standard',
    description: 'The player is currently well below the expected level and needs significant support.',
  },
  {
    score: 2,
    label: 'Below Standard',
    description: 'The player is below the expected level and needs clear improvement.',
  },
  {
    score: 3,
    label: 'Needs Improvement',
    description: 'The player shows some understanding but is not yet meeting expectations consistently.',
  },
  {
    score: 4,
    label: 'Developing',
    description: 'The player is progressing but still has gaps to work on.',
  },
  {
    score: 5,
    label: 'Expected Level',
    description: 'The player is broadly meeting the expected level for their age/team.',
  },
  {
    score: 6,
    label: 'Slightly Above Expected',
    description: 'The player is a little above the expected level and showing positive consistency.',
  },
  {
    score: 7,
    label: 'Good',
    description: 'The player is performing well and often meets a strong standard.',
  },
  {
    score: 8,
    label: 'Very Good',
    description: 'The player is performing at a very strong level and is consistently effective.',
  },
  {
    score: 9,
    label: 'Excellent',
    description: 'The player is performing at an excellent level and regularly stands out.',
  },
  {
    score: 10,
    label: 'Exceptional',
    description: 'The player is performing at an exceptional level for this context.',
  },
]

export function isDefaultAssessmentScoreLabel(label) {
  const normalizedLabel = String(label ?? '').trim().toLowerCase()
  return DEFAULT_ASSESSMENT_SCORE_LABELS.some((item) => item.toLowerCase() === normalizedLabel)
}

export function isAssessmentScoreFieldType(type) {
  return type === LEGACY_ASSESSMENT_SCORE_FIELD_TYPE || type === DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE
}

export function getAssessmentScoreMax(type) {
  return type === DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE ? 10 : 5
}

export function getDefaultAssessmentScoreOptions() {
  return DEFAULT_ASSESSMENT_SCORE_GUIDE.map((item) => ({
    value: String(item.score),
    label: `${item.score} - ${item.label}`,
    shortLabel: item.label,
  }))
}

export function getAssessmentScoreGuideLabel(value) {
  const score = Number(value)
  return DEFAULT_ASSESSMENT_SCORE_GUIDE.find((item) => item.score === score)?.label || ''
}

export function formatAssessmentScore(value) {
  const score = Number(value)

  if (!Number.isFinite(score)) {
    return ''
  }

  return Number.isInteger(score) ? String(score) : score.toFixed(1).replace(/\.0$/, '')
}

export function isDefaultAssessmentScoreValue(value) {
  const score = Number(value)
  return Number.isFinite(score) && score > 0 && score <= 10
}

export function formatDefaultAssessmentScoreForParent(value) {
  if (!isDefaultAssessmentScoreValue(value)) {
    return ''
  }

  const label = getAssessmentScoreGuideLabel(value)
  return `${formatAssessmentScore(value)} / 10${label ? ` - ${label}` : ''}`
}
