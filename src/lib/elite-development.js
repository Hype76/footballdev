import { formatUkDateWords } from './date-format.js'
import { resolveProgressionRecordDate } from './player-progression.js'

export const ELITE_CATEGORY_DEFINITIONS = Object.freeze({
  attacking: { key: 'attacking', label: 'Striking and Attacking' },
  defensive: { key: 'defensive', label: 'Defensive' },
  midfield: { key: 'midfield', label: 'Midfield' },
  goalkeeping: { key: 'goalkeeping', label: 'Goalkeeping' },
  conditioning: { key: 'conditioning', label: 'Strength and Conditioning' },
})

export const ELITE_RATING_GUIDANCE = Object.freeze([
  { range: '1-2', description: 'At an early stage for the player’s target level.' },
  { range: '3-4', description: 'Developing but currently inconsistent.' },
  { range: '5-6', description: 'Competent and reasonably consistent.' },
  { range: '7-8', description: 'Strong performance for the target level.' },
  { range: '9', description: 'Exceptional performance for the target level.' },
  { range: '10', description: 'Outstanding and consistently demonstrated.' },
])

export const ELITE_RATING_CONTEXT =
  'Rate each area relative to the player’s age, development stage and competitive level.'

export function isEliteStarterTemplate(template = {}) {
  return String(template.templateKey ?? template.template_key ?? '').startsWith('elite-')
}

export function getStableMetricKey(field = {}) {
  return String(field.metricKey ?? field.metric_key ?? '').trim()
}

export function getStableCategoryKey(field = {}) {
  return String(field.categoryKey ?? field.category_key ?? '').trim()
}

export function getStableCategoryLabel(field = {}) {
  return String(field.categoryLabel ?? field.category_label ?? '').trim()
}

export function getCustomMetricKey(fieldId) {
  const normalizedFieldId = String(fieldId ?? '').trim()
  return normalizedFieldId ? `custom.${normalizedFieldId}` : ''
}

export function isValidEliteRating(value) {
  const score = Number(value)
  return Number.isInteger(score) && score >= 1 && score <= 10
}

export function validateEliteFeedbackFormResponses(form = {}, formResponses = {}) {
  const responses = formResponses && typeof formResponses === 'object' && !Array.isArray(formResponses)
    ? formResponses
    : {}

  for (const field of Array.isArray(form.fields) ? form.fields : []) {
    if (!getStableMetricKey(field)) {
      continue
    }

    const value = responses[field.label]
    if (value === '' || value === null || value === undefined) {
      continue
    }

    if (!isValidEliteRating(value)) {
      throw new Error(`${field.label} must be a whole-number rating from 1 to 10.`)
    }
  }
}

function getSnapshot(evaluation = {}) {
  const snapshot = evaluation.feedbackFormSnapshot ?? evaluation.feedback_form_snapshot
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null
}

function getSnapshotFields(evaluation = {}) {
  const fields = getSnapshot(evaluation)?.fields
  return Array.isArray(fields) ? fields : []
}

function getFieldValue(evaluation, field) {
  if (field.value !== '' && field.value !== null && field.value !== undefined) {
    return field.value
  }

  const responses = evaluation.formResponses ?? evaluation.form_responses ?? {}
  if (Object.prototype.hasOwnProperty.call(responses, field.label)) {
    return responses[field.label]
  }

  return null
}

function formatRecordLabel(dateKey) {
  return formatUkDateWords(dateKey, dateKey || 'No date entered')
}

function getEliteMetricEntries(evaluation) {
  return getSnapshotFields(evaluation)
    .map((field) => {
      const metricKey = getStableMetricKey(field)
      const categoryKey = getStableCategoryKey(field)
      const score = Number(getFieldValue(evaluation, field))

      if (!metricKey || !categoryKey || !isValidEliteRating(score)) {
        return null
      }

      return {
        metricKey,
        metricLabel: String(field.label ?? '').trim() || metricKey,
        categoryKey,
        categoryLabel: getStableCategoryLabel(field) || ELITE_CATEGORY_DEFINITIONS[categoryKey]?.label || categoryKey,
        score,
        fieldId: String(field.id ?? '').trim(),
      }
    })
    .filter(Boolean)
}

export function buildEliteDevelopmentData(evaluations = []) {
  const chronological = (Array.isArray(evaluations) ? evaluations : [])
    .map((evaluation, index) => {
      const resolvedDate = resolveProgressionRecordDate(evaluation)
      const metrics = getEliteMetricEntries(evaluation)
      return {
        evaluation,
        index,
        dateKey: resolvedDate.key,
        label: formatRecordLabel(resolvedDate.key),
        metrics,
      }
    })
    .filter((record) => record.dateKey && record.metrics.length > 0)
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.index - right.index)

  const metricMap = new Map()
  const categoryMap = new Map()

  chronological.forEach((record) => {
    record.metrics.forEach((metric) => {
      const series = metricMap.get(metric.metricKey) ?? {
        key: metric.metricKey,
        label: metric.metricLabel,
        categoryKey: metric.categoryKey,
        categoryLabel: metric.categoryLabel,
        points: [],
      }
      series.label = metric.metricLabel
      series.points.push({
        id: `${record.evaluation.id || record.dateKey}-${metric.metricKey}`,
        evaluationId: record.evaluation.id,
        dateKey: record.dateKey,
        label: record.label,
        value: metric.score,
        fieldLabel: metric.metricLabel,
        formName: String(
          record.evaluation.feedbackFormName ??
          record.evaluation.feedback_form_name ??
          getSnapshot(record.evaluation)?.formName ??
          '',
        ).trim(),
      })
      metricMap.set(metric.metricKey, series)
    })

    const categoryScores = new Map()
    record.metrics.forEach((metric) => {
      const current = categoryScores.get(metric.categoryKey) ?? {
        categoryKey: metric.categoryKey,
        categoryLabel: metric.categoryLabel,
        scores: [],
      }
      current.scores.push(metric.score)
      categoryScores.set(metric.categoryKey, current)
    })

    categoryScores.forEach((category) => {
      if (category.scores.length === 0) {
        return
      }

      const series = categoryMap.get(category.categoryKey) ?? {
        key: category.categoryKey,
        label: category.categoryLabel,
        points: [],
      }
      series.points.push({
        id: `${record.evaluation.id || record.dateKey}-${category.categoryKey}`,
        evaluationId: record.evaluation.id,
        dateKey: record.dateKey,
        label: record.label,
        value: category.scores.reduce((sum, score) => sum + score, 0) / category.scores.length,
        answeredMetricCount: category.scores.length,
      })
      categoryMap.set(category.categoryKey, series)
    })
  })

  const specialistRecords = chronological.filter((record) =>
    new Set(record.metrics.map((metric) => metric.categoryKey)).size === 1)
  const latestSpecialist = specialistRecords.at(-1) ?? null
  const latestProfile = latestSpecialist
    ? {
        evaluationId: latestSpecialist.evaluation.id,
        dateKey: latestSpecialist.dateKey,
        label: latestSpecialist.label,
        formName: String(
          latestSpecialist.evaluation.feedbackFormName ??
          latestSpecialist.evaluation.feedback_form_name ??
          getSnapshot(latestSpecialist.evaluation)?.formName ??
          'Elite specialist review',
        ).trim(),
        categoryKey: latestSpecialist.metrics[0].categoryKey,
        categoryLabel: latestSpecialist.metrics[0].categoryLabel,
        metrics: latestSpecialist.metrics,
      }
    : null

  let previousComparison = null
  if (latestSpecialist) {
    const earlierCompatible = [...specialistRecords]
      .slice(0, -1)
      .reverse()
      .find((record) => record.metrics.some((metric) =>
        latestSpecialist.metrics.some((latestMetric) => latestMetric.metricKey === metric.metricKey)))

    if (earlierCompatible) {
      const previousByKey = new Map(earlierCompatible.metrics.map((metric) => [metric.metricKey, metric]))
      const changes = latestSpecialist.metrics
        .map((metric) => {
          const previous = previousByKey.get(metric.metricKey)
          return previous
            ? {
                metricKey: metric.metricKey,
                label: metric.metricLabel,
                previous: previous.score,
                latest: metric.score,
                change: metric.score - previous.score,
              }
            : null
        })
        .filter(Boolean)

      if (changes.length > 0) {
        previousComparison = {
          previousDateKey: earlierCompatible.dateKey,
          previousLabel: earlierCompatible.label,
          latestDateKey: latestSpecialist.dateKey,
          latestLabel: latestSpecialist.label,
          changes,
        }
      }
    }
  }

  return {
    hasData: chronological.length > 0,
    recordCount: chronological.length,
    metricSeries: Array.from(metricMap.values()),
    categorySeries: Array.from(categoryMap.values()),
    latestProfile,
    previousComparison,
  }
}
