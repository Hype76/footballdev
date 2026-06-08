import { formatUkDate } from './date-format.js'

export const EMAIL_SECTION_DEFAULTS = {
  latestSessionNotes: true,
  attendanceSummary: true,
  progressionChart: true,
  coachComments: true,
  matchNotes: false,
  nextFocusAreas: true,
}

export const EMAIL_SECTION_OPTIONS = [
  {
    key: 'latestSessionNotes',
    label: 'Latest session notes',
    description: 'Add the newest useful session or staff note.',
  },
  {
    key: 'attendanceSummary',
    label: 'Attendance summary',
    description: 'Show simple session involvement from saved records.',
  },
  {
    key: 'progressionChart',
    label: 'Progression chart',
    description: 'Include the player score trend where there is enough data.',
  },
  {
    key: 'coachComments',
    label: 'Coach comments',
    description: 'Include selected coach comments from the development record.',
  },
  {
    key: 'matchNotes',
    label: 'Match notes',
    description: 'Include match related notes where this record contains them.',
  },
  {
    key: 'nextFocusAreas',
    label: 'Next focus areas',
    description: 'Highlight lower scoring areas as the next coaching focus.',
  },
]

function toDateValue(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'number') {
    const parsedNumberDate = new Date(value)
    return Number.isNaN(parsedNumberDate.getTime()) ? null : parsedNumberDate
  }

  const normalizedValue = String(value ?? '').trim()
  if (!normalizedValue) {
    return null
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function getEvaluationDate(evaluation) {
  return toDateValue(evaluation?.date) || toDateValue(evaluation?.createdAt) || new Date(0)
}

function formatProgressDate(value) {
  const date = toDateValue(value)
  return date ? formatUkDate(date.toISOString().slice(0, 10), 'No date entered') : 'No date entered'
}

function isNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value))
}

function normaliseNote(note) {
  return {
    id: note?.id ?? '',
    note: String(note?.note ?? note?.message ?? '').trim(),
    createdAt: note?.createdAt ?? note?.created_at ?? '',
    userName: String(note?.userName ?? note?.createdByName ?? note?.user_name ?? '').trim(),
  }
}

export function buildPlayerProgressionData({ evaluations = [], staffNotes = [] } = {}) {
  const chronologicalEvaluations = [...evaluations].sort((left, right) => getEvaluationDate(left) - getEvaluationDate(right))
  const scoreTrend = chronologicalEvaluations
    .filter((evaluation) => isNumericValue(evaluation.averageScore))
    .map((evaluation) => ({
      id: evaluation.id,
      label: formatProgressDate(evaluation.date || evaluation.createdAt),
      value: Number(evaluation.averageScore),
      session: String(evaluation.session ?? '').trim(),
      team: String(evaluation.team ?? '').trim(),
    }))
  const notes = staffNotes.map(normaliseNote).filter((note) => note.note)
  const latestNote = [...notes]
    .sort((left, right) => (toDateValue(right.createdAt)?.getTime() ?? 0) - (toDateValue(left.createdAt)?.getTime() ?? 0))[0] ?? null
  const evaluationMonths = new Map()

  chronologicalEvaluations.forEach((evaluation) => {
    const date = getEvaluationDate(evaluation)
    if (!date || date.getTime() === 0) {
      return
    }

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const current = evaluationMonths.get(key) ?? {
      key,
      label: date.toLocaleString('en-GB', { month: 'short', year: '2-digit' }),
      assessments: 0,
      matches: 0,
      training: 0,
    }
    const sessionText = String(evaluation.session ?? '').toLowerCase()
    current.assessments += 1
    if (sessionText.includes('match') || sessionText.includes('vs') || sessionText.includes(' v ')) {
      current.matches += 1
    } else {
      current.training += 1
    }
    evaluationMonths.set(key, current)
  })

  const numericFields = new Map()
  chronologicalEvaluations.forEach((evaluation) => {
    Object.entries(evaluation.formResponses ?? {}).forEach(([label, value]) => {
      if (!isNumericValue(value)) {
        return
      }

      if (!numericFields.has(label)) {
        numericFields.set(label, [])
      }

      numericFields.get(label).push(Number(value))
    })
  })

  const focusAreas = Array.from(numericFields.entries())
    .map(([label, values]) => ({
      label,
      latest: values[values.length - 1],
      first: values[0],
      count: values.length,
    }))
    .sort((left, right) => left.latest - right.latest)
    .slice(0, 4)

  const latestEvaluation = [...chronologicalEvaluations].reverse()[0] ?? null
  const latestComments = latestEvaluation?.comments ?? {}

  return {
    hasAnyData: chronologicalEvaluations.length > 0 || notes.length > 0,
    hasScoreTrend: scoreTrend.length >= 2,
    scoreTrend,
    involvementByMonth: Array.from(evaluationMonths.values()).slice(-6),
    latestNote,
    latestEvaluation,
    latestComments,
    focusAreas,
    evaluationCount: chronologicalEvaluations.length,
    staffNoteCount: notes.length,
    matchCount: Array.from(evaluationMonths.values()).reduce((sum, item) => sum + item.matches, 0),
    trainingCount: Array.from(evaluationMonths.values()).reduce((sum, item) => sum + item.training, 0),
  }
}

export function getEmailSectionState(sections = {}, progressionData = {}) {
  const nextSections = {
    ...EMAIL_SECTION_DEFAULTS,
    ...(sections && typeof sections === 'object' ? sections : {}),
  }
  const disabledReasons = {}

  if (!progressionData.latestNote && !progressionData.latestEvaluation?.session) {
    disabledReasons.latestSessionNotes = 'No session note is available yet.'
    nextSections.latestSessionNotes = false
  }

  if (!progressionData.hasAnyData) {
    disabledReasons.attendanceSummary = 'No saved development activity is available yet.'
    nextSections.attendanceSummary = false
  }

  if (!progressionData.hasScoreTrend) {
    disabledReasons.progressionChart = 'At least two scored records are needed for a progression chart.'
    nextSections.progressionChart = false
  }

  if (!progressionData.latestComments?.overall && !progressionData.latestComments?.strengths && !progressionData.latestComments?.improvements) {
    disabledReasons.coachComments = 'No coach comments are available yet.'
    nextSections.coachComments = false
  }

  if (progressionData.matchCount === 0) {
    disabledReasons.matchNotes = 'No match related records are available yet.'
    nextSections.matchNotes = false
  }

  if (progressionData.focusAreas.length === 0) {
    disabledReasons.nextFocusAreas = 'No scored focus areas are available yet.'
    nextSections.nextFocusAreas = false
  }

  return {
    sections: nextSections,
    disabledReasons,
  }
}

export function buildProgressionEmailSections({ progressionData, sections = {} }) {
  const sectionState = getEmailSectionState(sections, progressionData)
  const enabled = sectionState.sections
  const items = []

  if (enabled.latestSessionNotes) {
    const noteText = progressionData.latestNote?.note || progressionData.latestEvaluation?.session || ''
    items.push({
      key: 'latestSessionNotes',
      title: 'Latest session notes',
      body: noteText || 'No latest session note is available yet.',
    })
  }

  if (enabled.attendanceSummary) {
    items.push({
      key: 'attendanceSummary',
      title: 'Attendance summary',
      body: `${progressionData.evaluationCount} development record${progressionData.evaluationCount === 1 ? '' : 's'} logged. Training involvement: ${progressionData.trainingCount}. Match involvement: ${progressionData.matchCount}.`,
    })
  }

  if (enabled.progressionChart) {
    items.push({
      key: 'progressionChart',
      title: 'Progression chart',
      body: progressionData.scoreTrend.map((point) => `${point.label}: ${point.value.toFixed(1)}`).join(' | '),
      chartPoints: progressionData.scoreTrend,
    })
  }

  if (enabled.coachComments) {
    const comments = progressionData.latestComments
    items.push({
      key: 'coachComments',
      title: 'Coach comments',
      body: [comments.strengths, comments.improvements, comments.overall].map((value) => String(value ?? '').trim()).filter(Boolean).join('\n\n'),
    })
  }

  if (enabled.matchNotes) {
    items.push({
      key: 'matchNotes',
      title: 'Match notes',
      body: `${progressionData.matchCount} match related development record${progressionData.matchCount === 1 ? '' : 's'} found for this player.`,
    })
  }

  if (enabled.nextFocusAreas) {
    items.push({
      key: 'nextFocusAreas',
      title: 'Next focus areas',
      body: progressionData.focusAreas.map((item) => `${item.label}: latest score ${item.latest}`).join('\n'),
    })
  }

  return items.filter((item) => String(item.body ?? '').trim())
}
