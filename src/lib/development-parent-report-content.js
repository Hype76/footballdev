import {
  formatDefaultAssessmentScoreForParent,
  isDefaultAssessmentScoreValue,
} from './assessment-scoring.js'
import {
  formatDevelopmentScore,
  normalizeDevelopmentScorePresentation,
} from './development-score-contract.js'

const SUMMARY_ROLE_PATTERNS = Object.freeze([
  { key: 'strengths', pattern: /\b(strengths?|doing well|positive)\b/i },
  { key: 'priority', pattern: /\b(priority|development area|area for development|improv)/i },
  { key: 'trainingFocus', pattern: /\b(training focus|recommended training|practice focus)\b/i },
  { key: 'summary', pattern: /\b(summary|overview|coach comment|development comment)\b/i },
  { key: 'nextReviewDate', pattern: /\b(next review|review due|follow-up date|follow up date)\b/i },
  { key: 'reviewDate', pattern: /\b(review date|date of review)\b/i },
])

function normalizeText(value) {
  return String(value ?? '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join('')
    .trim()
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function normalizeResponseItem(item = {}) {
  if (item.parentVisible === false || item.selected === false) {
    return null
  }

  const scorePresentation = normalizeDevelopmentScorePresentation(item)
  const value = scorePresentation.displayValue ||
    normalizeText(item.displayValue ?? item.value)

  if (!normalizeText(item.label) || !value) {
    return null
  }

  return {
    label: normalizeText(item.label),
    value,
    type: scorePresentation.type,
    numericScore: scorePresentation.numericScore,
    maxScore: scorePresentation.maxScore,
    ratingLabel: scorePresentation.ratingLabel,
    order: Number(item.order) || 0,
  }
}

function normalizeSection(section = {}) {
  const title = normalizeText(section.title)
  const body = normalizeText(section.body)
  const chartPoints = Array.isArray(section.chartPoints)
    ? section.chartPoints
        .map((point) => ({
          label: normalizeText(point?.label),
          value: normalizeScore(point?.value),
        }))
        .filter((point) => point.label && point.value !== null)
    : []

  if (!title || (!body && chartPoints.length < 2)) {
    return null
  }

  return {
    key: normalizeText(section.key),
    title,
    body,
    chartPoints,
  }
}

function getSummaryRole(label) {
  return SUMMARY_ROLE_PATTERNS.find((item) => item.pattern.test(label))?.key || ''
}

function buildFormLabel(form = {}) {
  const name = normalizeText(form.name)
  const version = Number(form.version)

  if (name && Number.isFinite(version) && version > 0) {
    return `${name} (version ${version})`
  }

  return name || 'Development report'
}

function buildOverallAssessment(report = {}, responseItems = []) {
  const overallScore = normalizeScore(report.overallScore)
  const responseMaxima = responseItems
    .map((item) => normalizeScore(item.maxScore))
    .filter((value, index, values) => value !== null && value > 0 && values.indexOf(value) === index)
  const overallMaxScore = normalizeScore(report.overallMaxScore)
    ?? (responseMaxima.length === 1 ? responseMaxima[0] : null)
    ?? 10

  if (overallScore === null) {
    return {
      maxScore: overallMaxScore,
      score: null,
      value: 'Not recorded',
    }
  }

  return {
    maxScore: overallMaxScore,
    score: overallScore,
    value: overallMaxScore === 10 && isDefaultAssessmentScoreValue(overallScore)
      ? formatDefaultAssessmentScoreForParent(overallScore)
      : formatDevelopmentScore({
          numericScore: overallScore,
          maxScore: overallMaxScore,
        }),
  }
}

export function buildDevelopmentParentReportContent(report = {}) {
  const responseItems = (Array.isArray(report.responseItems) ? report.responseItems : [])
    .map(normalizeResponseItem)
    .filter(Boolean)
    .sort((left, right) => left.order - right.order)
  const summaryItems = responseItems
    .map((item) => ({ ...item, summaryRole: getSummaryRole(item.label) }))
    .filter((item) => item.summaryRole)
  const sections = (Array.isArray(report.emailSections) ? report.emailSections : [])
    .map(normalizeSection)
    .filter(Boolean)
  const attendance = sections.find((section) => section.key === 'attendanceSummary') || null
  const progression = sections.find((section) => section.key === 'progressionChart') || null
  const overallAssessment = buildOverallAssessment(report, responseItems)

  return {
    version: 1,
    context: {
      clubName: normalizeText(report.club?.name) || 'Club',
      teamName: normalizeText(report.team?.name) || 'Team',
      playerName: normalizeText(report.player?.name) || 'Player',
      authorName: normalizeText(report.author?.name),
      section: normalizeText(report.section) || 'Development',
      reportDate: normalizeText(report.recordDate),
      formName: buildFormLabel(report.form),
      recipientLabel: Array.isArray(report.recipients) && report.recipients.length === 1
        ? normalizeText(report.recipients[0]?.name) || 'Parent or guardian'
        : 'Parent or guardian',
    },
    overallAssessment,
    responseItems,
    summaryItems,
    sections,
    attendance,
    progression,
    emptySelection: responseItems.length === 0,
  }
}

export function getDevelopmentParentReportSemanticContent(content = {}) {
  return {
    context: {
      teamName: normalizeText(content.context?.teamName),
      playerName: normalizeText(content.context?.playerName),
      reportDate: normalizeText(content.context?.reportDate),
    },
    overallAssessment: {
      maxScore: normalizeScore(content.overallAssessment?.maxScore),
      score: normalizeScore(content.overallAssessment?.score),
      value: normalizeText(content.overallAssessment?.value),
    },
    responseItems: (Array.isArray(content.responseItems) ? content.responseItems : []).map((item) => ({
      label: normalizeText(item.label),
      value: normalizeText(item.value),
      type: normalizeText(item.type),
      numericScore: normalizeScore(item.numericScore),
      maxScore: normalizeScore(item.maxScore),
      ratingLabel: normalizeText(item.ratingLabel),
      order: Number(item.order) || 0,
    })),
    attendance: content.attendance
      ? {
          title: normalizeText(content.attendance.title),
          body: normalizeText(content.attendance.body),
        }
      : null,
    progression: content.progression
      ? {
          title: normalizeText(content.progression.title),
          body: normalizeText(content.progression.body),
          chartPoints: (Array.isArray(content.progression.chartPoints)
            ? content.progression.chartPoints
            : []).map((point) => ({
              label: normalizeText(point.label),
              value: normalizeScore(point.value),
            })),
        }
      : null,
  }
}
