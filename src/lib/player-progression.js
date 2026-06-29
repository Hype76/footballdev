import { formatUkDateWords, formatUkMonthYear, normalizeDateOnly } from './date-format.js'

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

const explicitDateFields = [
  'date',
  'reportDate',
  'report_date',
  'assessmentDate',
  'assessment_date',
  'developmentDate',
  'development_date',
]

const linkedDateFields = [
  'sessionDate',
  'session_date',
  'eventDate',
  'event_date',
  'matchDate',
  'match_date',
  'trainingDate',
  'training_date',
  'session',
]

const savedDateFields = [
  'savedDate',
  'saved_date',
  'recordDate',
  'record_date',
]

function getFirstDateCandidate(evaluation, fields) {
  for (const field of fields) {
    const dateKey = normalizeDateOnly(evaluation?.[field])

    if (dateKey) {
      return {
        date: toDateValue(dateKey),
        key: dateKey,
        source: field,
      }
    }
  }

  return null
}

export function resolveProgressionRecordDate(evaluation) {
  return (
    getFirstDateCandidate(evaluation, explicitDateFields) ||
    getFirstDateCandidate(evaluation, linkedDateFields) ||
    getFirstDateCandidate(evaluation, savedDateFields) ||
    getFirstDateCandidate(evaluation, ['createdAt', 'created_at']) ||
    {
      date: null,
      key: '',
      source: 'missing',
    }
  )
}

function getEvaluationDateKey(evaluation) {
  if (evaluation?.__progressionDateKey) {
    return evaluation.__progressionDateKey
  }

  return resolveProgressionRecordDate(evaluation).key
}

function formatProgressDate(value) {
  const date = toDateValue(value)
  return date ? formatUkDateWords(date.toISOString().slice(0, 10), 'No date entered') : 'No date entered'
}

function getEvaluationProgressionLabel(evaluation) {
  return evaluation?.__progressionLabel || formatProgressDate(getEvaluationDateKey(evaluation))
}

function formatProgressMonthYear(date) {
  return date ? formatUkMonthYear(date.toISOString().slice(0, 10), 'No date entered') : 'No date entered'
}

function isNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value))
}

function normalizeFieldLabel(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isProgressionNumericField(field = {}) {
  const type = String(field.type ?? '').trim()

  if (!['score_1_5', 'score_1_10', 'number'].includes(type)) {
    return false
  }

  return true
}

function isProgressionScoreField(field = {}) {
  if (!isProgressionNumericField(field)) {
    return false
  }

  if (field.includeInProgressChart !== undefined) {
    return Boolean(field.includeInProgressChart)
  }

  return Boolean(field.isDefault)
}

function normalizeScoreToTen(value, field = {}) {
  if (!isNumericValue(value)) {
    return null
  }

  const score = Number(value)

  if (!Number.isFinite(score) || score <= 0) {
    return null
  }

  if (field.type === 'score_1_5') {
    return Math.min(10, score * 2)
  }

  return Math.min(10, score)
}

function getChartFieldMap(fields = []) {
  const chartFields = Array.isArray(fields) ? fields.filter(isProgressionScoreField) : []

  return new Map(chartFields.map((field) => [normalizeFieldLabel(field.label), field]))
}

export function getProgressionNumericFieldMap(fields = []) {
  const numericFields = Array.isArray(fields) ? fields.filter(isProgressionNumericField) : []

  return new Map(numericFields.map((field) => [normalizeFieldLabel(field.label), field]))
}

function getProgressionNumericFields(fields = []) {
  const seenLabels = new Set()

  return (Array.isArray(fields) ? fields : [])
    .filter(isProgressionNumericField)
    .filter((field) => {
      const key = normalizeFieldLabel(field.label)

      if (!key || seenLabels.has(key)) {
        return false
      }

      seenLabels.add(key)
      return true
    })
}

function getEvaluationFeedbackFormSnapshot(evaluation = {}) {
  const snapshot = evaluation.feedbackFormSnapshot ?? evaluation.feedback_form_snapshot
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null
}

function getEvaluationFeedbackFormId(evaluation = {}) {
  const snapshot = getEvaluationFeedbackFormSnapshot(evaluation)
  return String(evaluation.feedbackFormId ?? evaluation.feedback_form_id ?? snapshot?.formId ?? snapshot?.form_id ?? '').trim()
}

function getEvaluationFeedbackFormName(evaluation = {}) {
  const snapshot = getEvaluationFeedbackFormSnapshot(evaluation)
  return String(evaluation.feedbackFormName ?? evaluation.feedback_form_name ?? snapshot?.formName ?? snapshot?.form_name ?? '').trim()
}

function getSnapshotGraphFields(evaluation = {}) {
  const snapshot = getEvaluationFeedbackFormSnapshot(evaluation)
  const fields = Array.isArray(snapshot?.fields) ? snapshot.fields : []
  return fields.filter(isProgressionScoreField)
}

function getEvaluationResponseForField(evaluation = {}, field = {}) {
  if (isNumericValue(field.value)) {
    return field.value
  }

  const responses = evaluation.formResponses ?? evaluation.form_responses ?? {}
  const label = String(field.label ?? '').trim()

  if (Object.prototype.hasOwnProperty.call(responses, label)) {
    return responses[label]
  }

  const normalizedFieldId = String(field.id ?? '').trim()
  if (normalizedFieldId && Object.prototype.hasOwnProperty.call(responses, normalizedFieldId)) {
    return responses[normalizedFieldId]
  }

  return null
}

function getEvaluationChartScore(evaluation, chartFieldMap) {
  if (getEvaluationFeedbackFormId(evaluation)) {
    const values = getSnapshotGraphFields(evaluation)
      .map((field) => normalizeScoreToTen(getEvaluationResponseForField(evaluation, field), field))
      .filter((value) => Number.isFinite(value))

    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  }

  if (!chartFieldMap.size) {
    return isNumericValue(evaluation.averageScore) ? Number(evaluation.averageScore) : null
  }

  const values = Object.entries(evaluation.formResponses ?? {})
    .map(([label, value]) => {
      const field = chartFieldMap.get(normalizeFieldLabel(label))
      return field ? normalizeScoreToTen(value, field) : null
    })
    .filter((value) => Number.isFinite(value))

  if (!values.length) {
    return isNumericValue(evaluation.averageScore) ? Number(evaluation.averageScore) : null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function hasAnyProgressionScore(evaluation, numericFieldMap = new Map(), chartFieldMap = new Map()) {
  if (getEvaluationFeedbackFormId(evaluation)) {
    return Number.isFinite(getEvaluationChartScore(evaluation, chartFieldMap))
  }

  if (Number.isFinite(getEvaluationChartScore(evaluation, chartFieldMap))) {
    return true
  }

  return Object.entries(evaluation.formResponses ?? {}).some(([label, value]) => {
    const field = numericFieldMap.get(normalizeFieldLabel(label))

    if (!field) {
      return false
    }

    return Number.isFinite(normalizeScoreToTen(value, field))
  })
}

function normaliseNote(note) {
  return {
    id: note?.id ?? '',
    note: String(note?.note ?? note?.message ?? '').trim(),
    createdAt: note?.createdAt ?? note?.created_at ?? '',
    userName: String(note?.userName ?? note?.createdByName ?? note?.user_name ?? '').trim(),
  }
}

export function buildProgressionFocusAreas(fieldSeries = [], { limit = 4 } = {}) {
  return fieldSeries
    .map((series, index) => {
      const values = Array.isArray(series?.points)
        ? series.points.map((point) => Number(point.value)).filter((value) => Number.isFinite(value))
        : []

      if (!values.length) {
        return null
      }

      const first = values[0]
      const latest = values[values.length - 1]

      return {
        label: series.label,
        latest,
        first,
        movement: latest - first,
        count: values.length,
        order: Number(series.order ?? index),
      }
    })
    .filter(Boolean)
    .sort((left, right) =>
      left.latest - right.latest ||
      left.movement - right.movement ||
      left.order - right.order ||
      left.label.localeCompare(right.label))
    .slice(0, limit)
}

function buildCategoryTrendLines(chronologicalEvaluations, fields = []) {
  const numericFields = getProgressionNumericFields(fields)
  const seriesMap = new Map(numericFields.map((field, index) => [
    normalizeFieldLabel(field.label),
    {
      field,
      key: `field-${normalizeFieldLabel(field.label).replace(/[^a-z0-9]+/g, '-')}`,
      label: String(field.label ?? '').trim(),
      order: index,
      points: [],
    },
  ]))

  chronologicalEvaluations.forEach((evaluation) => {
    const dateKey = getEvaluationDateKey(evaluation)
    const label = getEvaluationProgressionLabel(evaluation)
    const feedbackFormId = getEvaluationFeedbackFormId(evaluation)

    if (feedbackFormId) {
      const feedbackFormName = getEvaluationFeedbackFormName(evaluation) || 'Feedback form'

      getSnapshotGraphFields(evaluation).forEach((field, fieldIndex) => {
        const fieldLabel = String(field.label ?? '').trim()
        const normalizedScore = normalizeScoreToTen(getEvaluationResponseForField(evaluation, field), field)

        if (!fieldLabel || !Number.isFinite(normalizedScore)) {
          return
        }

        const fieldId = String(field.id ?? '').trim() || normalizeFieldLabel(fieldLabel)
        const seriesKey = `form-${feedbackFormId}-field-${fieldId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
        const existingSeries = seriesMap.get(seriesKey)
        const series = existingSeries || {
          field,
          key: seriesKey,
          label: `${feedbackFormName}: ${fieldLabel}`,
          formId: feedbackFormId,
          formName: feedbackFormName,
          fieldId,
          fieldLabel,
          order: numericFields.length + seriesMap.size + fieldIndex,
          points: [],
        }

        series.points.push({
          id: `${evaluation.id || dateKey}-${seriesKey}`,
          evaluationId: evaluation.id,
          dateKey,
          label,
          value: normalizedScore,
          session: String(evaluation.session ?? '').trim(),
          team: String(evaluation.team ?? '').trim(),
          formId: feedbackFormId,
          formName: feedbackFormName,
          fieldId,
          fieldLabel,
        })

        if (!existingSeries) {
          seriesMap.set(seriesKey, series)
        }
      })

      return
    }

    Object.entries(evaluation.formResponses ?? {}).forEach(([responseLabel, value]) => {
      const series = seriesMap.get(normalizeFieldLabel(responseLabel))

      if (!series) {
        return
      }

      const normalizedScore = normalizeScoreToTen(value, series.field)

      if (!Number.isFinite(normalizedScore)) {
        return
      }

      series.points.push({
        id: `${evaluation.id || dateKey}-${series.label}`,
        evaluationId: evaluation.id,
        dateKey,
        label,
        value: normalizedScore,
        session: String(evaluation.session ?? '').trim(),
        team: String(evaluation.team ?? '').trim(),
      })
    })
  })

  return Array.from(seriesMap.values())
    .map((series) => {
      const publicSeries = { ...series }
      delete publicSeries.field
      return publicSeries
    })
    .filter((series) => series.points.length > 0)
}

export function buildProgressionTrendLines({ scoreTrend = [], fieldSeries = [] } = {}) {
  const overallLine = {
    key: 'overall',
    label: 'Overall score',
    kind: 'overall',
    order: -1,
    points: Array.isArray(scoreTrend) ? scoreTrend : [],
  }
  const categoryLines = fieldSeries.map((series, index) => ({
    key: series.key || `field-${normalizeFieldLabel(series.label).replace(/[^a-z0-9]+/g, '-')}`,
    label: series.label,
    kind: 'category',
    order: Number(series.order ?? index),
    points: series.points,
  }))

  return [overallLine, ...categoryLines].filter((line) => line.points.length > 0)
}

export function buildPlayerProgressionData({ evaluations = [], staffNotes = [], fields = [], currentDate } = {}) {
  const today = toDateValue(currentDate) || new Date()
  const todayKey = today.toISOString().slice(0, 10)
  const chartFieldMap = getChartFieldMap(fields)
  const numericFieldMap = getProgressionNumericFieldMap(fields)
  const eligibilityRecords = (Array.isArray(evaluations) ? evaluations : []).map((evaluation, index) => {
    const resolvedDate = resolveProgressionRecordDate(evaluation)
    const chartScore = getEvaluationChartScore(evaluation, chartFieldMap)
    const hasScore = hasAnyProgressionScore(evaluation, numericFieldMap, chartFieldMap)
    const isFutureDated = Boolean(resolvedDate.key && resolvedDate.key > todayKey)
    const isDated = Boolean(resolvedDate.key)
    const isChartEligible = hasScore && isDated && !isFutureDated

    return {
      evaluation,
      index,
      date: resolvedDate.date,
      dateKey: resolvedDate.key,
      dateSource: resolvedDate.source,
      chartScore,
      hasScore,
      isDated,
      isFutureDated,
      isChartEligible,
    }
  })
  const chartEligibleRecords = eligibilityRecords.filter((record) => record.isChartEligible)
  const sortedChartEligibleRecords = [...chartEligibleRecords].sort((left, right) =>
    left.dateKey.localeCompare(right.dateKey) ||
    left.index - right.index)
  const sameDayTotals = new Map()
  sortedChartEligibleRecords.forEach((record) => {
    sameDayTotals.set(record.dateKey, (sameDayTotals.get(record.dateKey) ?? 0) + 1)
  })
  const sameDaySeen = new Map()
  const chronologicalRecords = sortedChartEligibleRecords.map((record) => {
    const dayIndex = (sameDaySeen.get(record.dateKey) ?? 0) + 1
    sameDaySeen.set(record.dateKey, dayIndex)
    const sameDayTotal = sameDayTotals.get(record.dateKey) ?? 0
    const sequenceSuffix = sameDayTotal > 1 ? ` #${dayIndex}` : ''

    return {
      ...record,
      evaluation: {
        ...record.evaluation,
        __progressionDateKey: sameDayTotal > 1 ? `${record.dateKey}#${String(dayIndex).padStart(2, '0')}` : record.dateKey,
        __progressionLabel: `${formatProgressDate(record.dateKey)}${sequenceSuffix}`,
      },
    }
  })
  const chronologicalEvaluations = chronologicalRecords.map((record) => record.evaluation)
  const eligibilityBreakdown = {
    totalDevelopmentRecords: eligibilityRecords.length,
    scoredRecords: eligibilityRecords.filter((record) => record.hasScore).length,
    datedScoredRecords: eligibilityRecords.filter((record) => record.hasScore && record.isDated && !record.isFutureDated).length,
    undatedScoredRecords: eligibilityRecords.filter((record) => record.hasScore && !record.isDated).length,
    futureDatedScoredRecords: eligibilityRecords.filter((record) => record.hasScore && record.isFutureDated).length,
    textOnlyRecordsExcluded: eligibilityRecords.filter((record) => !record.hasScore).length,
    chartEligibleRecords: chartEligibleRecords.length,
  }
  const scoreTrend = chronologicalEvaluations
    .map((evaluation) => {
      const chartScore = getEvaluationChartScore(evaluation, chartFieldMap)
      const dateKey = getEvaluationDateKey(evaluation)

      if (!Number.isFinite(chartScore)) {
        return null
      }

      return {
        id: evaluation.id,
        evaluationId: evaluation.id,
        dateKey,
        label: getEvaluationProgressionLabel(evaluation),
        value: chartScore,
        session: String(evaluation.session ?? '').trim(),
        team: String(evaluation.team ?? '').trim(),
        formId: getEvaluationFeedbackFormId(evaluation),
        formName: getEvaluationFeedbackFormName(evaluation),
      }
    })
    .filter(Boolean)
  const notes = staffNotes.map(normaliseNote).filter((note) => note.note)
  const latestNote = [...notes]
    .sort((left, right) => (toDateValue(right.createdAt)?.getTime() ?? 0) - (toDateValue(left.createdAt)?.getTime() ?? 0))[0] ?? null
  const evaluationMonths = new Map()

  chronologicalEvaluations.forEach((evaluation) => {
    const resolvedDate = resolveProgressionRecordDate(evaluation)
    const date = resolvedDate.date
    if (!date || !resolvedDate.key) {
      return
    }

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const current = evaluationMonths.get(key) ?? {
      key,
      label: formatProgressMonthYear(date),
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

  const fieldSeries = buildCategoryTrendLines(chronologicalEvaluations, fields)
  const focusAreas = buildProgressionFocusAreas(fieldSeries)
  const trendLines = buildProgressionTrendLines({ scoreTrend, fieldSeries })

  const latestEvaluation = [...chronologicalEvaluations].reverse()[0] ?? null
  const latestComments = latestEvaluation?.comments ?? {}

  return {
    hasAnyData: eligibilityBreakdown.totalDevelopmentRecords > 0 || notes.length > 0,
    hasScoreTrend: scoreTrend.length >= 2,
    eligibilityBreakdown,
    scoreTrend,
    trendLines,
    fieldSeries,
    involvementByMonth: Array.from(evaluationMonths.values()).slice(-6),
    latestNote,
    latestEvaluation,
    latestComments,
    focusAreas,
    nextFocusAreas: focusAreas,
    evaluationCount: scoreTrend.length,
    historicalEvaluationCount: eligibilityBreakdown.totalDevelopmentRecords,
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
    const historicalEvaluationCount = Number(progressionData.historicalEvaluationCount ?? progressionData.evaluationCount ?? 0)
    items.push({
      key: 'attendanceSummary',
      title: 'Attendance summary',
      body: `${historicalEvaluationCount} development record${historicalEvaluationCount === 1 ? '' : 's'} logged. Training involvement: ${progressionData.trainingCount}. Match involvement: ${progressionData.matchCount}.`,
    })
  }

  if (enabled.progressionChart) {
    items.push({
      key: 'progressionChart',
      title: 'Progression chart',
      body: 'Scores are charted oldest to newest out of 10.',
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
