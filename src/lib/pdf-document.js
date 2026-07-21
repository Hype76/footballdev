import { buildProgressionChartMarkup } from './progression-chart-markup.js'
import {
  DEFAULT_ASSESSMENT_SCORE_GUIDE,
  formatDefaultAssessmentScoreForParent,
  isDefaultAssessmentScoreLabel,
  isDefaultAssessmentScoreValue,
} from './assessment-scoring.js'

export const PDF_DOCUMENT_VERSION = 1

export const PDF_REPORT_TYPES = Object.freeze({
  assessment: 'assessment',
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
  assertAllowedKeys(value, ['clubName', 'playerName', 'teamName', 'section', 'session'], 'PDF context')

  return {
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
}

function normalizeResponseItems(value, label = 'Response items') {
  if (!Array.isArray(value)) {
    invalid(`${label} must be a list.`)
  }

  if (value.length > PDF_DOCUMENT_LIMITS.maxResponseItems) {
    invalid(`${label} contains too many rows.`, 'PDF_LIMIT_EXCEEDED')
  }

  return value.map((item) => {
    assertAllowedKeys(item, ['label', 'value'], 'Response item')

    return {
      label: normalizeText(item.label, {
        label: 'Response label',
        maxLength: PDF_DOCUMENT_LIMITS.maxLabelLength,
        required: true,
      }),
      value: normalizeText(item.value, {
        label: 'Response value',
        maxLength: PDF_DOCUMENT_LIMITS.maxTextLength,
      }),
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
  assertAllowedKeys(value, ['version', 'reportType', 'context', 'responseItems', 'emailSections'], 'PDF document')

  return {
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.assessment,
    context: normalizeContext(value.context),
    responseItems: normalizeResponseItems(value.responseItems ?? []),
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
  emailSections = [],
} = {}) {
  return validatePdfDocument({
    version: PDF_DOCUMENT_VERSION,
    reportType: PDF_REPORT_TYPES.assessment,
    context: { clubName, playerName, teamName, section, session },
    responseItems: Array.isArray(responseItems)
      ? responseItems.map((item) => ({ label: item?.label, value: item?.value }))
      : responseItems,
    emailSections: Array.isArray(emailSections)
      ? emailSections.map((emailSection) => ({
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderContext(context, eyebrow) {
  return `
    <header class="report-header">
      <div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(context.clubName)}</h1>
        <h2>${escapeHtml(context.playerName)}</h2>
      </div>
      <dl class="context-grid">
        <div><dt>Team</dt><dd>${escapeHtml(context.teamName || 'Not provided')}</dd></div>
        <div><dt>Section</dt><dd>${escapeHtml(context.section || 'Development')}</dd></div>
        <div><dt>Session</dt><dd>${escapeHtml(context.session || 'Not provided')}</dd></div>
      </dl>
    </header>
  `
}

function renderRows(items, emptyMessage) {
  if (items.length === 0) {
    return `<p class="empty">${escapeHtml(emptyMessage)}</p>`
  }

  return `<div class="response-grid">${items.map((item) => `
    <section class="response-card">
      <h3>${escapeHtml(item.label)}</h3>
      <p>${escapeHtml(item.value || 'Not provided')}</p>
    </section>
  `).join('')}</div>`
}

function isScoredResponseItem(item) {
  return isDefaultAssessmentScoreLabel(item?.label) && isDefaultAssessmentScoreValue(item?.value)
}

function renderScoringGuide(items) {
  if (!items.some(isScoredResponseItem)) {
    return ''
  }

  return `<section class="panel scoring-guide">
    <h2>How scoring works</h2>
    <p class="section-body">Player feedback is scored out of 10. A 5 means the player is broadly at the expected level, 6 shows slightly above expected performance, and 10 means exceptional for this context rather than flawless.</p>
    ${DEFAULT_ASSESSMENT_SCORE_GUIDE.map((item) => `<p><strong>${item.score} - ${escapeHtml(item.label)}:</strong> ${escapeHtml(item.description)}</p>`).join('')}
  </section>`
}

function renderAssessmentDocument(document) {
  return `
    ${renderContext(document.context, 'Development PDF')}
    <main>
      <section class="panel">
        <h2>Development responses</h2>
        ${renderRows(document.responseItems.map((item) => ({
          ...item,
          value: isScoredResponseItem(item) ? formatDefaultAssessmentScoreForParent(item.value) : item.value,
        })), 'No development fields were selected.')}
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

function renderParentMessageDocument(document) {
  return `
    ${renderContext(document.context, 'Parent message')}
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

export function renderPdfDocumentHtml(value) {
  const document = validatePdfDocument(value)
  const content = document.reportType === PDF_REPORT_TYPES.assessment
    ? renderAssessmentDocument(document)
    : document.reportType === PDF_REPORT_TYPES.parentMessage
      ? renderParentMessageDocument(document)
      : renderProgressionChartDocument(document)

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          @page { size: A4; margin: 14mm; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; background: #ffffff; color: #101828; font-family: Arial, Helvetica, sans-serif; }
          body { font-size: 12px; line-height: 1.45; }
          .report-header { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(220px, 0.7fr); gap: 18px; border-bottom: 2px solid #d7e5dc; padding: 0 0 16px; break-inside: avoid; }
          .eyebrow { margin: 0; color: #047857; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
          h1 { margin: 8px 0 0; font-size: 22px; line-height: 1.15; }
          .report-header h2 { margin: 8px 0 0; color: #334155; font-size: 18px; line-height: 1.2; }
          .context-grid { display: grid; grid-template-columns: 1fr; gap: 7px; margin: 0; }
          .context-grid div { border: 1px solid #d7e5dc; border-radius: 8px; background: #f7faf8; padding: 7px 9px; }
          dt { color: #4f6552; font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
          dd { margin: 3px 0 0; color: #101828; font-weight: 700; }
          main { margin-top: 16px; }
          .panel { border: 1px solid #d7e5dc; border-radius: 12px; background: #fbfcf9; padding: 12px; margin-top: 12px; break-inside: auto; }
          .panel > h2 { margin: 0; color: #101828; font-size: 15px; line-height: 1.25; }
          .response-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
          .response-card { border: 1px solid #e2e8f0; border-radius: 9px; background: #ffffff; padding: 9px 10px; break-inside: avoid; }
          .response-card h3 { margin: 0; color: #4f6552; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
          .response-card p, .section-body { margin: 6px 0 0; color: #334155; white-space: pre-wrap; overflow-wrap: anywhere; }
          .section-block { break-inside: avoid; }
          .scoring-guide { break-inside: avoid; }
          .scoring-guide p { margin: 5px 0 0; color: #334155; font-size: 10px; line-height: 1.35; }
          .empty { margin: 10px 0 0; color: #66756c; }
          .chart-page { width: 760px; min-height: 240px; margin: 0; padding: 20px; }
          footer { border-top: 1px solid #d7e5dc; margin-top: 18px; padding-top: 10px; color: #66756c; font-size: 9px; }
        </style>
      </head>
      <body>
        ${content}
        ${document.reportType === PDF_REPORT_TYPES.progressionChart ? '' : '<footer>Generated securely by Football Player | footballplayer.online</footer>'}
      </body>
    </html>`
}
