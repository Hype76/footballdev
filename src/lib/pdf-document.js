import { buildProgressionChartMarkup } from './progression-chart-markup.js'
import {
  DEFAULT_ASSESSMENT_SCORE_GUIDE,
  formatDefaultAssessmentScoreForParent,
  isDefaultAssessmentScoreLabel,
  isDefaultAssessmentScoreValue,
} from './assessment-scoring.js'
import { validatePdfBranding } from './pdf-branding.js'
import { buildDevelopmentParentReportContent } from './development-parent-report-content.js'
import { normalizeDevelopmentScorePresentation } from './development-score-contract.js'
import {
  FORMATION_BOARD_CANONICAL_ORIENTATION,
  convertFormationPlacementsToPortrait,
  getFormationBoardOrientation,
} from './formation-board-orientation.js'
import { renderFormationPlayerSilhouetteSvg } from './formation-player-marker.js'

export const PDF_DOCUMENT_VERSION = 1

export const PDF_REPORT_TYPES = Object.freeze({
  assessment: 'assessment',
  formationBoard: 'formation-board',
  parentMessage: 'parent-message',
  progressionChart: 'progression-chart',
})

export const PDF_DOCUMENT_LIMITS = Object.freeze({
  maxDocumentBytes: 100_000,
  maxTitleLength: 160,
  maxLabelLength: 120,
  maxTextLength: 4_000,
  maxResponseItems: 60,
  maxEmailSections: 8,
  maxChartPoints: 24,
  maxFormationPlayers: 32,
})

export class PdfDocumentError extends Error {
  constructor(message = 'The PDF request is not valid.', code = 'PDF_INVALID_REQUEST') {
    super(message)
    this.name = 'PdfDocumentError'
    this.code = code
    this.statusCode = 400
  }
}

function invalid(message = 'The PDF request is not valid.', code = 'PDF_INVALID_REQUEST') {
  throw new PdfDocumentError(message, code)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertAllowedKeys(value, allowedKeys, label) {
  if (!isPlainObject(value)) {
    invalid(`${label} must be an object.`)
  }

  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.includes(key))

  if (unexpectedKey) {
    invalid(`${label} contains an unsupported field.`)
  }
}

function normalizeText(value, { label, maxLength, required = false } = {}) {
  if (!['string', 'number'].includes(typeof value) && value !== null && value !== undefined) {
    invalid(`${label} must be text.`)
  }

  const normalizedValue = String(value ?? '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join('')
    .trim()

  if (required && !normalizedValue) {
    invalid(`${label} is required.`)
  }

  if (normalizedValue.length > maxLength) {
    invalid(`${label} is too long.`, 'PDF_LIMIT_EXCEEDED')
  }

  return normalizedValue
}

function normalizeContext(value) {
  assertAllowedKeys(value, [
    'clubName',
    'playerName',
    'teamName',
    'section',
    'session',
    'authorName',
    'reportDate',
    'formName',
    'recipientLabel',
    'overallAssessment',
  ], 'PDF context')

  const context = {
    clubName: normalizeText(value.clubName, {
      label: 'Club name',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
      required: true,
    }),
    playerName: normalizeText(value.playerName, {
      label: 'Player name',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
      required: true,
    }),
    teamName: normalizeText(value.teamName, {
      label: 'Team name',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
    }),
    section: normalizeText(value.section, {
      label: 'Section',
      maxLength: PDF_DOCUMENT_LIMITS.maxLabelLength,
    }),
    session: normalizeText(value.session, {
      label: 'Session',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
    }),
  }
  const optionalContext = {
    authorName: normalizeText(value.authorName, {
      label: 'Author name',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
    }),
    reportDate: normalizeText(value.reportDate, {
      label: 'Report date',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
    }),
    formName: normalizeText(value.formName, {
      label: 'Form name',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
    }),
    recipientLabel: normalizeText(value.recipientLabel, {
      label: 'Recipient wording',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
    }),
    overallAssessment: normalizeText(value.overallAssessment, {
      label: 'Overall assessment',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
    }),
  }

  return Object.entries(optionalContext).reduce(
    (result, [key, normalizedValue]) => normalizedValue
      ? { ...result, [key]: normalizedValue }
      : result,
    context,
  )
}

function normalizeResponseItems(value, label = 'Response items') {
  if (!Array.isArray(value)) {
    invalid(`${label} must be a list.`)
  }

  if (value.length > PDF_DOCUMENT_LIMITS.maxResponseItems) {
    invalid(`${label} contains too many rows.`, 'PDF_LIMIT_EXCEEDED')
  }

  return value.map((item) => {
    assertAllowedKeys(item, [
      'label',
      'value',
      'type',
      'numericScore',
      'maxScore',
      'ratingLabel',
      'order',
    ], 'Response item')
    const scorePresentation = normalizeDevelopmentScorePresentation(item)
    const normalizedItem = {
      label: normalizeText(item.label, {
        label: 'Response label',
        maxLength: PDF_DOCUMENT_LIMITS.maxLabelLength,
        required: true,
      }),
      value: normalizeText(scorePresentation.displayValue || item.value, {
        label: 'Response value',
        maxLength: PDF_DOCUMENT_LIMITS.maxTextLength,
      }),
    }

    if (!scorePresentation.isScored) {
      return normalizedItem
    }

    return {
      ...normalizedItem,
      type: scorePresentation.type,
      numericScore: scorePresentation.numericScore,
      maxScore: scorePresentation.maxScore,
      ratingLabel: normalizeText(scorePresentation.ratingLabel, {
        label: 'Rating label',
        maxLength: PDF_DOCUMENT_LIMITS.maxLabelLength,
      }),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : 0,
    }
  })
}

function normalizeChartPoints(value) {
  if (!Array.isArray(value)) {
    invalid('Chart points must be a list.')
  }

  if (value.length > PDF_DOCUMENT_LIMITS.maxChartPoints) {
    invalid('The chart contains too many points.', 'PDF_LIMIT_EXCEEDED')
  }

  return value.map((point) => {
    assertAllowedKeys(point, ['label', 'value'], 'Chart point')
    const numericValue = Number(point.value)

    if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 10) {
      invalid('Chart values must be between 0 and 10.')
    }

    return {
      label: normalizeText(point.label, {
        label: 'Chart label',
        maxLength: PDF_DOCUMENT_LIMITS.maxLabelLength,
        required: true,
      }),
      value: numericValue,
    }
  })
}

function normalizeEmailSections(value) {
  if (!Array.isArray(value)) {
    invalid('Email sections must be a list.')
  }

  if (value.length > PDF_DOCUMENT_LIMITS.maxEmailSections) {
    invalid('The PDF contains too many sections.', 'PDF_LIMIT_EXCEEDED')
  }

  return value.map((section) => {
    assertAllowedKeys(section, ['title', 'body', 'chartPoints'], 'Email section')

    return {
      title: normalizeText(section.title, {
        label: 'Section title',
        maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
        required: true,
      }),
      body: normalizeText(section.body, {
        label: 'Section body',
        maxLength: PDF_DOCUMENT_LIMITS.maxTextLength,
      }),
      chartPoints: section.chartPoints === undefined ? [] : normalizeChartPoints(section.chartPoints),
    }
  })
}

function validateAssessmentDocument(value) {
  assertAllowedKeys(value, [
    'version',
    'reportType',
    'context',
    'responseItems',
    'summaryItems',
    'emailSections',
  ], 'PDF document')

  return {
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.assessment,
    context: normalizeContext(value.context),
    responseItems: normalizeResponseItems(value.responseItems ?? []),
    summaryItems: normalizeResponseItems(value.summaryItems ?? [], 'Summary items'),
    emailSections: normalizeEmailSections(value.emailSections ?? []),
  }
}

function validateParentMessageDocument(value) {
  assertAllowedKeys(value, ['version', 'reportType', 'context', 'subject', 'body', 'assessmentFields'], 'PDF document')

  return {
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.parentMessage,
    context: normalizeContext(value.context),
    subject: normalizeText(value.subject, {
      label: 'Message subject',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
      required: true,
    }),
    body: normalizeText(value.body, {
      label: 'Message body',
      maxLength: PDF_DOCUMENT_LIMITS.maxTextLength,
    }),
    assessmentFields: normalizeResponseItems(value.assessmentFields ?? [], 'Assessment fields'),
  }
}

function validateProgressionChartDocument(value) {
  assertAllowedKeys(value, ['version', 'reportType', 'points'], 'PDF document')
  const points = normalizeChartPoints(value.points ?? [])

  if (points.length < 2) {
    invalid('A progression chart needs at least two points.')
  }

  return {
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.progressionChart,
    points,
  }
}

function normalizeFormationBoardContext(value) {
  assertAllowedKeys(value, ['clubName', 'teamName', 'reportDate'], 'Formation Board context')

  return {
    clubName: normalizeText(value.clubName, {
      label: 'Club name',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
      required: true,
    }),
    teamName: normalizeText(value.teamName, {
      label: 'Team name',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
      required: true,
    }),
    reportDate: normalizeText(value.reportDate, {
      label: 'Board date',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
    }),
  }
}

function normalizeFormationPlayer(item, { placement = false } = {}) {
  assertAllowedKeys(
    item,
    placement
      ? ['displayName', 'playerId', 'shirtNumber', 'x', 'y']
      : ['displayName', 'playerId', 'shirtNumber'],
    placement ? 'Formation Board placement' : 'Formation Board bench Player',
  )

  const normalized = {
    displayName: normalizeText(item.displayName, {
      label: 'Player name',
      maxLength: PDF_DOCUMENT_LIMITS.maxLabelLength,
      required: true,
    }),
    playerId: normalizeText(item.playerId, {
      label: 'Player reference',
      maxLength: 80,
      required: true,
    }),
    shirtNumber: normalizeText(item.shirtNumber, {
      label: 'Shirt number',
      maxLength: 3,
    }),
  }

  if (!placement) return normalized

  const x = Number(item.x)
  const y = Number(item.y)

  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    invalid('Formation Board marker positions must stay within the pitch.')
  }

  return { ...normalized, x, y }
}

function validateFormationBoardDocument(value) {
  assertAllowedKeys(value, [
    'version',
    'reportType',
    'context',
    'title',
    'description',
    'gameFormat',
    'formation',
    'orientation',
    'placements',
    'bench',
    'unplaced',
    'notes',
  ], 'PDF document')

  const sourceOrientation = getFormationBoardOrientation(value.orientation)
  const portraitPlacements = convertFormationPlacementsToPortrait(value.placements, sourceOrientation)
  const placements = Array.isArray(portraitPlacements)
    ? portraitPlacements.map((item) => normalizeFormationPlayer(item, { placement: true }))
    : invalid('Formation Board placements must be a list.')
  const bench = Array.isArray(value.bench)
    ? value.bench.map((item) => normalizeFormationPlayer(item))
    : invalid('Formation Board bench must be a list.')
  const unplaced = value.unplaced == null
    ? []
    : Array.isArray(value.unplaced)
      ? value.unplaced.map((item) => normalizeFormationPlayer(item))
      : invalid('Formation Board unplaced Players must be a list.')

  if (placements.length + bench.length + unplaced.length > PDF_DOCUMENT_LIMITS.maxFormationPlayers) {
    invalid('The Formation Board contains too many Players.', 'PDF_LIMIT_EXCEEDED')
  }

  return {
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.formationBoard,
    context: normalizeFormationBoardContext(value.context),
    title: normalizeText(value.title, {
      label: 'Board title',
      maxLength: PDF_DOCUMENT_LIMITS.maxTitleLength,
      required: true,
    }),
    description: normalizeText(value.description, {
      label: 'Board description',
      maxLength: 1_000,
    }),
    gameFormat: normalizeText(value.gameFormat, {
      label: 'Game format',
      maxLength: 20,
      required: true,
    }),
    formation: normalizeText(value.formation, {
      label: 'Formation',
      maxLength: 80,
      required: true,
    }),
    orientation: FORMATION_BOARD_CANONICAL_ORIENTATION,
    placements,
    bench,
    unplaced,
    notes: normalizeText(value.notes, {
      label: 'Board notes',
      maxLength: 2_000,
    }),
  }
}

export function validatePdfDocument(value) {
  if (!isPlainObject(value)) {
    invalid()
  }

  if (value.version !== PDF_DOCUMENT_VERSION) {
    invalid('The PDF document version is not supported.')
  }

  let document

  if (value.reportType === PDF_REPORT_TYPES.assessment) {
    document = validateAssessmentDocument(value)
  } else if (value.reportType === PDF_REPORT_TYPES.parentMessage) {
    document = validateParentMessageDocument(value)
  } else if (value.reportType === PDF_REPORT_TYPES.progressionChart) {
    document = validateProgressionChartDocument(value)
  } else if (value.reportType === PDF_REPORT_TYPES.formationBoard) {
    document = validateFormationBoardDocument(value)
  } else {
    invalid('The PDF report type is not supported.')
  }

  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > PDF_DOCUMENT_LIMITS.maxDocumentBytes) {
    invalid('The PDF document is too large.', 'PDF_LIMIT_EXCEEDED')
  }

  return document
}

export function buildAssessmentPdfDocument({
  clubName = '',
  playerName = '',
  teamName = '',
  section = '',
  session = '',
  responseItems = [],
  summaryItems = [],
  emailSections = [],
  developmentReport = null,
  content: suppliedContent = null,
} = {}) {
  const content = suppliedContent || (developmentReport
    ? buildDevelopmentParentReportContent(developmentReport)
    : null)

  return validatePdfDocument({
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.assessment,
    context: content
      ? {
          clubName: content.context.clubName,
          playerName: content.context.playerName,
          teamName: content.context.teamName,
          section: content.context.section,
          session: content.context.reportDate,
          authorName: content.context.authorName,
          reportDate: content.context.reportDate,
          formName: content.context.formName,
          recipientLabel: content.context.recipientLabel,
          overallAssessment: content.overallAssessment.value,
        }
      : { clubName, playerName, teamName, section, session },
    responseItems: Array.isArray(content?.responseItems ?? responseItems)
      ? (content?.responseItems ?? responseItems).map((item) => ({
          label: item?.label,
          value: item?.value,
          type: item?.type,
          numericScore: item?.numericScore,
          maxScore: item?.maxScore,
          ratingLabel: item?.ratingLabel,
          order: item?.order,
        }))
      : responseItems,
    summaryItems: Array.isArray(content?.summaryItems ?? summaryItems)
      ? (content?.summaryItems ?? summaryItems).map((item) => ({
          label: item?.label,
          value: String(item?.value ?? '').length > 220
            ? `${String(item.value).slice(0, 217).trimEnd()}...`
            : item?.value,
        }))
      : summaryItems,
    emailSections: Array.isArray(content?.sections ?? emailSections)
      ? (content?.sections ?? emailSections).map((emailSection) => ({
          title: emailSection?.title,
          body: emailSection?.body,
          chartPoints: Array.isArray(emailSection?.chartPoints)
            ? emailSection.chartPoints.map((point) => ({ label: point?.label, value: point?.value }))
            : emailSection?.chartPoints,
        }))
      : emailSections,
  })
}

export function buildParentMessagePdfDocument({
  clubName = '',
  playerName = '',
  teamName = '',
  subject = '',
  body = '',
  assessmentFields = [],
} = {}) {
  return validatePdfDocument({
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.parentMessage,
    context: {
      clubName,
      playerName,
      teamName,
      section: 'Parent message',
      session: '',
    },
    subject,
    body,
    assessmentFields,
  })
}

export function buildProgressionChartDocument(points = []) {
  return validatePdfDocument({
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.progressionChart,
    points,
  })
}

export function buildFormationBoardDocument({
  clubName = '',
  teamName = '',
  reportDate = '',
  title = '',
  description = '',
  gameFormat = '',
  formation = '',
  orientation = 'portrait',
  placements = [],
  bench = [],
  unplaced = [],
  notes = '',
} = {}) {
  return validatePdfDocument({
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.formationBoard,
    context: { clubName, teamName, reportDate },
    title,
    description,
    gameFormat,
    formation,
    orientation,
    placements: placements.map((item) => ({
      displayName: item.displayName,
      playerId: item.playerId,
      shirtNumber: item.shirtNumber,
      x: item.x,
      y: item.y,
    })),
    bench: bench.map((item) => ({
      displayName: item.displayName,
      playerId: item.playerId,
      shirtNumber: item.shirtNumber,
    })),
    unplaced: unplaced.map((item) => ({
      displayName: item.displayName,
      playerId: item.playerId,
      shirtNumber: item.shirtNumber,
    })),
    notes,
  })
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getReportTitle(reportType) {
  return reportType === PDF_REPORT_TYPES.parentMessage
    ? 'Parent Message Report'
    : reportType === PDF_REPORT_TYPES.assessment
      ? 'Development Report'
      : reportType === PDF_REPORT_TYPES.formationBoard
        ? 'Formation Board'
        : 'Progression Chart'
}

function renderBrandMark(branding) {
  if (branding.clubLogoData) {
    return `<img class="club-logo" src="${escapeHtml(branding.clubLogoData)}" alt="${escapeHtml(`${branding.clubName} logo`)}" />`
  }

  return `<div class="club-initials" aria-label="${escapeHtml(`${branding.clubName} initials`)}">${escapeHtml(branding.clubInitials)}</div>`
}

function renderContext(document, branding) {
  const context = document.context
  const facts = [
    ['Team', context.teamName || branding.teamName || 'Not provided'],
    ['Section', context.section || 'Development'],
    ['Report date', context.reportDate || context.session || 'Not provided'],
    ...(context.formName ? [['Form', context.formName]] : []),
    ...(context.authorName ? [['Coach or author', context.authorName]] : []),
    ...(context.recipientLabel ? [['Prepared for', context.recipientLabel]] : []),
  ]

  return `
    <header
      class="report-header"
      style="--club-accent: ${branding.primaryColour}; --club-accent-soft: ${branding.secondaryColour}; --club-accent-text: ${branding.accentTextColour};"
    >
      <div class="club-identity">
        ${renderBrandMark(branding)}
        <div class="club-copy">
          <p class="club-name">${escapeHtml(branding.clubName)}</p>
          <p class="team-name">${escapeHtml(branding.teamName || 'Club report')}</p>
        </div>
      </div>
      <div class="report-identity">
        <p class="report-title">${escapeHtml(getReportTitle(document.reportType))}</p>
        <h1>${escapeHtml(context.playerName)}</h1>
        <p class="generated-date">Generated ${escapeHtml(branding.generatedDate || 'securely')}</p>
      </div>
    </header>
    <dl class="context-grid">
      ${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
    </dl>
  `
}

function renderRows(items, emptyMessage) {
  if (items.length === 0) {
    return `<p class="empty">${escapeHtml(emptyMessage)}</p>`
  }

  const rows = []
  let index = 0

  while (index < items.length) {
    const item = items[index]
    const longItem = String(item?.value ?? '').length > 600
    const nextItemIsLong = String(items[index + 1]?.value ?? '').length > 600
    const rowItems = longItem || nextItemIsLong ? [item] : items.slice(index, index + 2)
    rows.push(`<div class="response-row${longItem ? ' response-row-long' : ''}">${rowItems.map((rowItem) => `
      <section class="response-card${longItem ? ' response-card-long' : ''}">
        <h3>${escapeHtml(rowItem.label)}</h3>
        <p>${escapeHtml(rowItem.value || 'Not provided')}</p>
      </section>
    `).join('')}</div>`)
    index += rowItems.length
  }

  return `<div class="response-grid">${rows.join('')}</div>`
}

function isScoredResponseItem(item) {
  return (
    Number.isFinite(Number(item?.numericScore)) &&
    Number.isFinite(Number(item?.maxScore)) &&
    Number(item.maxScore) > 0
  ) || (
    isDefaultAssessmentScoreLabel(item?.label) &&
    isDefaultAssessmentScoreValue(item?.value)
  ) || /^\d+(?:\.\d+)?\s*\/\s*10(?:\s*-\s*.+)?$/i.test(String(item?.value ?? '').trim())
}

function renderScoringGuide(items) {
  const scoredItems = items.filter(isScoredResponseItem)

  if (scoredItems.length === 0) {
    return ''
  }
  const scoreMaxima = scoredItems
    .map((item) => Number(item.maxScore || 10))
    .filter((value, index, values) => Number.isFinite(value) && value > 0 && values.indexOf(value) === index)
  const usesApprovedTenPointScale = scoreMaxima.length === 1 && scoreMaxima[0] === 10
  const scaleDescription = usesApprovedTenPointScale
    ? 'Player feedback is scored out of 10. A 5 means the player is broadly at the expected level, 6 shows slightly above expected performance, and 10 means exceptional for this context rather than flawless.'
    : scoreMaxima.length === 1
      ? `This saved Development form uses a 1 to ${scoreMaxima[0]} scoring scale. Each selected score is shown with its saved maximum and rating label.`
      : 'This saved Development report contains more than one scoring scale. Each selected score is shown with its saved maximum and rating label.'

  return `<section class="panel scoring-guide">
    <h2>How scoring works</h2>
    <p class="section-body">${escapeHtml(scaleDescription)}</p>
    ${usesApprovedTenPointScale
      ? DEFAULT_ASSESSMENT_SCORE_GUIDE.map((item) => `<p><strong>${item.score} - ${escapeHtml(item.label)}:</strong> ${escapeHtml(item.description)}</p>`).join('')
      : ''}
  </section>`
}

function formatPdfResponseValue(item) {
  return isDefaultAssessmentScoreLabel(item?.label) && isDefaultAssessmentScoreValue(item?.value)
    ? formatDefaultAssessmentScoreForParent(item.value)
    : item?.value
}

function renderAssessmentDocument(document, branding) {
  const hasCurrentSummary =
    Boolean(document.context.overallAssessment && document.context.overallAssessment !== 'Not recorded') ||
    document.summaryItems.length > 0

  return `
    ${renderContext(document, branding)}
    <main>
      ${hasCurrentSummary ? `
        <section class="panel current-summary">
          <h2>Current assessment summary</h2>
          ${document.context.overallAssessment && document.context.overallAssessment !== 'Not recorded'
            ? `<div class="overall-assessment"><span>Overall assessment</span><strong>${escapeHtml(document.context.overallAssessment)}</strong></div>`
            : ''}
          ${document.summaryItems.length > 0
            ? renderRows(document.summaryItems, '')
            : ''}
        </section>
      ` : ''}
      <section class="panel">
        <h2>Development responses</h2>
        ${renderRows(document.responseItems.map((item) => ({
          ...item,
          value: formatPdfResponseValue(item),
        })), 'This report contains only the summary information deliberately selected by the coaching team. No completed Development response fields were selected for sharing.')}
      </section>
      ${document.emailSections.map((section) => `
        <section class="panel section-block">
          <h2>${escapeHtml(section.title)}</h2>
          <p class="section-body">${escapeHtml(section.body || 'No update provided.')}</p>
          ${section.chartPoints.length >= 2 ? buildProgressionChartMarkup(section.chartPoints) : ''}
        </section>
      `).join('')}
      ${renderScoringGuide(document.responseItems)}
    </main>
  `
}

function renderParentMessageDocument(document, branding) {
  return `
    ${renderContext(document, branding)}
    <main>
      <section class="panel section-block">
        <h2>${escapeHtml(document.subject)}</h2>
        <p class="section-body">${escapeHtml(document.body || 'No message body was recorded.')}</p>
      </section>
      <section class="panel">
        <h2>Development details</h2>
        ${renderRows(document.assessmentFields, 'No development fields were attached.')}
      </section>
    </main>
  `
}

function renderProgressionChartDocument(document) {
  return `<main class="chart-page">${buildProgressionChartMarkup(document.points)}</main>`
}

function renderFormationBoardDocument(document, branding) {
  const formationLabel = document.formation.split('-').slice(1).join('-') || document.formation
  const renderPlayerVisual = (player, compact = false) => `
    <span class="formation-player-visual${compact ? ' formation-player-visual-compact' : ''}">
      ${renderFormationPlayerSilhouetteSvg()}
      ${player.shirtNumber ? `<span class="formation-shirt-badge">${escapeHtml(player.shirtNumber)}</span>` : ''}
    </span>`
  const markerMarkup = document.placements.map((player) => `
    <div class="formation-marker" style="left:${player.x * 100}%;top:${player.y * 100}%;">
      ${renderPlayerVisual(player)}
      <span class="formation-name">${escapeHtml(player.displayName)}</span>
    </div>
  `).join('')
  const benchMarkup = document.bench.length > 0
    ? document.bench.map((player) => `<li>${renderPlayerVisual(player, true)}<span>${escapeHtml(player.displayName)}</span></li>`).join('')
    : '<li class="formation-empty">No Players on the bench</li>'
  const unplacedMarkup = document.unplaced.length > 0
    ? document.unplaced.map((player) => `<li>${renderPlayerVisual(player, true)}<span>${escapeHtml(player.displayName)}</span></li>`).join('')
    : '<li class="formation-empty">No unplaced Players</li>'

  return `
    <main class="formation-page" style="--club-accent:${branding.primaryColour};--club-accent-soft:${branding.secondaryColour};--club-accent-text:${branding.accentTextColour};">
      <header class="formation-header">
        <div class="formation-club">
          ${renderBrandMark(branding)}
          <div>
            <p class="formation-kicker">Formation Board</p>
            <p class="formation-club-name">${escapeHtml(branding.clubName)}</p>
            <p class="formation-team-name">${escapeHtml(document.context.teamName || branding.teamName)}</p>
          </div>
        </div>
        <div class="formation-heading">
          <h1>${escapeHtml(document.title)}</h1>
          <p>${escapeHtml(document.gameFormat)} | ${escapeHtml(formationLabel)} | Updated ${escapeHtml(document.context.reportDate || 'Unknown')}</p>
        </div>
      </header>
      <div class="formation-layout">
        <section class="formation-pitch-panel" aria-label="Formation pitch">
          <div class="formation-pitch formation-pitch-${escapeHtml(document.orientation)}">
            <div class="pitch-outline"></div>
            <div class="pitch-halfway"></div>
            <div class="pitch-centre-circle"></div>
            <div class="pitch-box pitch-box-top"></div>
            <div class="pitch-box pitch-box-bottom"></div>
            ${markerMarkup}
          </div>
        </section>
        <aside class="formation-sidebar">
          <section>
            <h2>Board details</h2>
            <dl>
              <div><dt>Game format</dt><dd>${escapeHtml(document.gameFormat)}</dd></div>
              <div><dt>Formation</dt><dd>${escapeHtml(formationLabel)}</dd></div>
              <div><dt>Pitch Players</dt><dd>${document.placements.length}</dd></div>
              <div><dt>Unplaced Players</dt><dd>${document.unplaced.length}</dd></div>
            </dl>
            ${document.description ? `<p class="formation-description">${escapeHtml(document.description)}</p>` : ''}
          </section>
          <section>
            <h2>Unplaced Players</h2>
            <ul class="formation-bench">${unplacedMarkup}</ul>
          </section>
          <section>
            <h2>Bench</h2>
            <ul class="formation-bench">${benchMarkup}</ul>
          </section>
          ${document.notes ? `<section><h2>Notes</h2><p class="formation-notes">${escapeHtml(document.notes)}</p></section>` : ''}
        </aside>
      </div>
      <footer class="formation-footer">Footballplayer.online | Team staff resource</footer>
    </main>
  `
}

export function renderPdfFooterTemplate(brandingValue, context = {}) {
  const branding = validatePdfBranding(brandingValue, { context })

  return `<div style="box-sizing:border-box;width:100%;padding:0 14mm 4mm;color:#667085;font-family:Arial,Helvetica,sans-serif;font-size:8px;line-height:1.35;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid ${branding.secondaryColour};padding-top:5px;">
      <span style="max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:#344054;">${escapeHtml(branding.clubName)}</span>
      <span>${escapeHtml(branding.confidentialityLabel)} | Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
    <div style="margin-top:2px;text-align:right;font-size:7px;color:#98a2b3;">${escapeHtml(branding.platformAttribution)}</div>
  </div>`
}

export function renderPdfDocumentHtml(value, { branding: brandingValue = null } = {}) {
  const document = validatePdfDocument(value)
  const branding = validatePdfBranding(brandingValue, { context: document.context })
  const content = document.reportType === PDF_REPORT_TYPES.assessment
    ? renderAssessmentDocument(document, branding)
    : document.reportType === PDF_REPORT_TYPES.parentMessage
      ? renderParentMessageDocument(document, branding)
      : document.reportType === PDF_REPORT_TYPES.formationBoard
        ? renderFormationBoardDocument(document, branding)
        : renderProgressionChartDocument(document)
  const pageRule = document.reportType === PDF_REPORT_TYPES.formationBoard
    ? '@page { size: A4 portrait; margin: 8mm; }'
    : '@page { size: A4; margin: 14mm 14mm 23mm; }'

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          ${pageRule}
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; background: #ffffff; color: #101828; font-family: Arial, Helvetica, sans-serif; }
          body { font-size: 12px; line-height: 1.45; }
          .report-header { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(220px, 0.85fr); align-items: center; gap: 20px; border-bottom: 3px solid var(--club-accent); padding: 0 0 14px; break-inside: avoid; }
          .club-identity { display: flex; min-width: 0; align-items: center; gap: 13px; }
          .club-logo, .club-initials { width: 64px; height: 64px; flex: 0 0 64px; border: 1px solid var(--club-accent-soft); border-radius: 12px; background: #ffffff; }
          .club-logo { display: block; object-fit: contain; padding: 5px; }
          .club-initials { display: flex; align-items: center; justify-content: center; background: var(--club-accent-soft); color: var(--club-accent-text); font-size: 20px; font-weight: 900; letter-spacing: .04em; }
          .club-copy { min-width: 0; }
          .club-name { margin: 0; color: #101828; font-size: 18px; font-weight: 900; line-height: 1.15; overflow-wrap: anywhere; }
          .team-name { margin: 5px 0 0; color: #475467; font-size: 11px; font-weight: 700; overflow-wrap: anywhere; }
          .report-identity { min-width: 0; text-align: right; }
          .report-title { margin: 0; color: var(--club-accent-text); font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
          h1 { margin: 7px 0 0; color: #101828; font-size: 21px; line-height: 1.15; overflow-wrap: anywhere; }
          .generated-date { margin: 6px 0 0; color: #667085; font-size: 9px; font-weight: 700; }
          .context-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin: 11px 0 0; break-inside: avoid; }
          .context-grid div { border: 1px solid #d7e5dc; border-radius: 8px; background: #f7faf8; padding: 7px 9px; }
          dt { color: #4f6552; font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
          dd { margin: 3px 0 0; color: #101828; font-weight: 700; }
          main { margin-top: 16px; }
          .panel { border: 1px solid #d7e5dc; border-radius: 12px; background: #fbfcf9; padding: 12px; margin-top: 12px; break-inside: auto; }
          .panel > h2 { margin: 0; color: #101828; font-size: 15px; line-height: 1.25; }
          .overall-assessment { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 10px; border: 1px solid #d7e5dc; border-radius: 9px; background: #ffffff; padding: 10px 12px; break-inside: avoid; }
          .overall-assessment span { color: #4f6552; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
          .overall-assessment strong { color: #101828; font-size: 14px; text-align: right; }
          .response-grid { display: block; margin-top: 10px; }
          .response-row { display: flex; align-items: stretch; gap: 8px; margin-top: 8px; break-inside: avoid; }
          .response-row:first-child { margin-top: 0; }
          .response-card { flex: 0 0 calc(50% - 4px); min-width: 0; border: 1px solid #e2e8f0; border-radius: 9px; background: #ffffff; padding: 9px 10px; break-inside: avoid; }
          .response-row-long { display: block; break-inside: auto; }
          .response-card-long { width: 100%; break-inside: auto; }
          .response-card h3 { margin: 0; color: #4f6552; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
          .response-card p, .section-body { margin: 6px 0 0; color: #334155; white-space: pre-wrap; overflow-wrap: anywhere; }
          .section-block { break-inside: avoid; }
          .scoring-guide { break-inside: avoid; }
          .scoring-guide p { margin: 5px 0 0; color: #334155; font-size: 10px; line-height: 1.35; }
          .empty { margin: 10px 0 0; color: #66756c; }
          .chart-page { width: 760px; min-height: 240px; margin: 0; padding: 20px; }
          .formation-page { width: 100%; min-height: 100vh; margin: 0; padding: 18px; background: #f7faf8; color: #101828; display: flex; flex-direction: column; }
          .formation-header { display: grid; grid-template-columns: minmax(300px,.8fr) minmax(0,1.2fr); align-items: center; gap: 22px; border-bottom: 4px solid var(--club-accent); padding-bottom: 13px; }
          .formation-club { display: flex; align-items: center; gap: 12px; }
          .formation-club .club-logo, .formation-club .club-initials { width: 58px; height: 58px; flex-basis: 58px; }
          .formation-kicker { margin: 0; color: var(--club-accent-text); font-size: 10px; font-weight: 900; letter-spacing: .11em; text-transform: uppercase; }
          .formation-club-name { margin: 4px 0 0; font-size: 17px; font-weight: 900; line-height: 1.1; }
          .formation-team-name { margin: 4px 0 0; color: #475467; font-size: 11px; font-weight: 800; }
          .formation-heading { min-width: 0; text-align: right; }
          .formation-heading h1 { margin: 0; font-size: 25px; line-height: 1.08; overflow-wrap: anywhere; }
          .formation-heading p { margin: 7px 0 0; color: #475467; font-size: 11px; font-weight: 800; }
          .formation-layout { display: grid; grid-template-columns: minmax(0, 1fr) 220px; flex: 1; min-height: 0; gap: 16px; margin-top: 15px; }
          .formation-pitch-panel { min-height: 0; border: 1px solid #176a3a; border-radius: 14px; background: #237a45; padding: 12px; overflow: hidden; }
          .formation-pitch { position: relative; width: 100%; height: 100%; min-height: 520px; border-radius: 10px; background: linear-gradient(90deg,#237a45 0 12.5%,#2b834c 12.5% 25%,#237a45 25% 37.5%,#2b834c 37.5% 50%,#237a45 50% 62.5%,#2b834c 62.5% 75%,#237a45 75% 87.5%,#2b834c 87.5%); }
          .pitch-outline { position: absolute; inset: 18px; border: 3px solid rgba(255,255,255,.92); }
          .pitch-halfway { position: absolute; left: 18px; right: 18px; top: 50%; border-top: 3px solid rgba(255,255,255,.92); }
          .pitch-centre-circle { position: absolute; left: 50%; top: 50%; width: 100px; height: 100px; transform: translate(-50%,-50%); border: 3px solid rgba(255,255,255,.92); border-radius: 50%; }
          .pitch-box { position: absolute; left: 50%; width: 42%; height: 18%; transform: translateX(-50%); border: 3px solid rgba(255,255,255,.92); }
          .pitch-box-top { top: 18px; border-top: 0; }
          .pitch-box-bottom { bottom: 18px; border-bottom: 0; }
          .formation-marker { position: absolute; z-index: 3; width: 106px; transform: translate(-50%,-50%); text-align: center; }
          .formation-player-visual { position: relative; display: flex; width: 44px; height: 44px; margin: 0 auto; align-items: center; justify-content: center; border: 3px solid #ffffff; border-radius: 50%; background: #f7faf8; color: #344054; box-shadow: 0 3px 7px rgba(16,24,40,.25); }
          .formation-player-visual svg { width: 72%; height: 72%; fill: currentColor; }
          .formation-shirt-badge { position: absolute; right: -7px; top: -4px; display: flex; min-width: 19px; height: 19px; padding: 0 4px; align-items: center; justify-content: center; border: 1px solid #ffffff; border-radius: 999px; background: #101828; color: #ffffff; font-size: 8px; font-weight: 900; line-height: 1; }
          .formation-player-visual-compact { width: 22px; height: 22px; flex: 0 0 22px; border-width: 1px; box-shadow: none; }
          .formation-player-visual-compact .formation-shirt-badge { right: -5px; top: -4px; min-width: 12px; height: 12px; padding: 0 2px; font-size: 5px; }
          .formation-name { display: block; max-width: 106px; margin: 4px auto 0; padding: 3px 6px; border-radius: 6px; background: rgba(255,255,255,.95); color: #101828; font-size: 9px; font-weight: 900; line-height: 1.15; overflow-wrap: anywhere; }
          .formation-sidebar { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
          .formation-sidebar section { border: 1px solid #d7e5dc; border-radius: 11px; background: #ffffff; padding: 11px; }
          .formation-sidebar h2 { margin: 0; color: var(--club-accent-text); font-size: 12px; }
          .formation-sidebar dl { margin: 8px 0 0; }
          .formation-sidebar dl div { display: flex; justify-content: space-between; gap: 8px; border-top: 1px solid #eef2ef; padding: 6px 0; }
          .formation-sidebar dl div:first-child { border-top: 0; }
          .formation-sidebar dt { font-size: 8px; }
          .formation-sidebar dd { margin: 0; font-size: 10px; text-align: right; }
          .formation-description, .formation-notes { margin: 8px 0 0; color: #344054; font-size: 9px; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; }
          .formation-bench { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 5px; margin: 8px 0 0; padding: 0; list-style: none; }
          .formation-bench li { display: flex; min-width: 0; align-items: center; gap: 5px; border: 1px solid #e2e8f0; border-radius: 7px; padding: 5px; font-size: 8px; font-weight: 800; }
          .formation-bench > li > span:last-child { min-width: 0; overflow-wrap: anywhere; }
          .formation-bench .formation-empty { grid-column: 1 / -1; color: #667085; }
          .formation-footer { margin-top: 8px; color: #667085; font-size: 8px; font-weight: 700; text-align: right; }
          @media print {
            .report-header, .context-grid, .formation-page, .formation-pitch { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        ${content}
      </body>
    </html>`
}
