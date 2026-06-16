import { sanitizeAssessmentEmailSections, sanitizeAssessmentOutputText } from './assessment-output-sanitizer.js'
import { buildProgressionChartMarkup } from './progression-chart-markup.js'
import {
  DEFAULT_ASSESSMENT_SCORE_GUIDE,
  formatDefaultAssessmentScoreForParent,
  isDefaultAssessmentScoreLabel,
  isDefaultAssessmentScoreValue,
} from './assessment-scoring.js'

function escapeHtml(value) {
  return sanitizeAssessmentOutputText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatValue(value) {
  const normalizedValue = sanitizeAssessmentOutputText(value).trim()
  return normalizedValue || 'Not provided'
}

function isScoredResponseItem(item) {
  return isDefaultAssessmentScoreLabel(item?.label) && isDefaultAssessmentScoreValue(item?.value)
}

function formatParentResponseValue(item) {
  return isScoredResponseItem(item) ? formatDefaultAssessmentScoreForParent(item.value) : formatValue(item?.value)
}

function isExportableResponseValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0
  }

  const trimmedValue = String(value ?? '').trim()
  return trimmedValue !== '' && trimmedValue !== '0'
}

function buildResponseItems(responseItems = []) {
  const exportableResponseItems = responseItems.filter((item) => isExportableResponseValue(item?.value))

  if (!exportableResponseItems.length) {
    return '<p style="margin: 14px 0 0; color: #66756c; font-size: 13px;">No development fields were selected.</p>'
  }

  return exportableResponseItems
    .map(
      (item) => `
        <div style="break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; background: #ffffff;">
          <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">${escapeHtml(item.label)}</p>
          <p style="margin: 6px 0 0; color: #334155; font-size: 12px; line-height: 1.45; white-space: pre-wrap;">${escapeHtml(formatParentResponseValue(item))}</p>
        </div>
      `,
    )
    .join('')
}

function buildScoringKey(responseItems = []) {
  const hasScoredResponses = responseItems.some((item) => isScoredResponseItem(item))

  if (!hasScoredResponses) {
    return ''
  }

  return `
      <div style="margin-top: 12px; break-inside: avoid; border: 1px solid #e7ece3; border-radius: 14px; background: #fbfcf9; padding: 12px;">
        <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;">How scoring works</p>
        <p style="margin: 8px 0 8px; color: #334155; font-size: 12px; line-height: 1.45;">Player feedback is scored out of 10. A 5 means the player is broadly at the expected level, 6 shows slightly above expected performance, and 10 means exceptional for this context rather than flawless.</p>
        ${DEFAULT_ASSESSMENT_SCORE_GUIDE.map((item) => `
          <p style="margin: 4px 0 0; color: #334155; font-size: 11px; line-height: 1.35;"><strong>${item.score} - ${escapeHtml(item.label)}:</strong> ${escapeHtml(item.description)}</p>
        `).join('')}
      </div>
  `
}

function buildEmailSections(emailSections = []) {
  const sections = sanitizeAssessmentEmailSections(emailSections)

  if (!sections.length) {
    return ''
  }

  return `
      <div style="margin-top: 16px; border: 1px solid #e7ece3; border-radius: 14px; background: #fbfcf9; padding: 12px;">
        <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;">Coach update</p>
        <div style="display: grid; gap: 8px; margin-top: 10px;">
          ${sections.map((section) => `
            <div style="break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; background: #ffffff;">
              <p style="margin: 0; color: #101828; font-size: 13px; font-weight: 800;">${escapeHtml(section.title)}</p>
              <p style="margin: 6px 0 0; color: #334155; font-size: 12px; line-height: 1.45; white-space: pre-wrap;">${escapeHtml(formatValue(section.body))}</p>
              ${section.chartPoints ? buildProgressionChartMarkup(section.chartPoints) : ''}
            </div>
          `).join('')}
        </div>
      </div>
  `
}

export function buildAssessmentPdfHtml({
  clubName = '',
  playerName = '',
  teamName = '',
  section = '',
  session = '',
  logoUrl = '',
  responseItems = [],
  emailSections = [],
} = {}) {
  return `
    <section style="box-sizing: border-box; width: 760px; padding: 22px; background: #ffffff; color: #101828; font-family: Arial, sans-serif;">
      <div style="display: flex; justify-content: space-between; gap: 18px; border-bottom: 1px solid #e7ece3; padding-bottom: 14px;">
        <div style="min-width: 0;">
          <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;">Development PDF</p>
          ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(clubName)}" style="display: block; max-width: 120px; max-height: 56px; margin-top: 10px; object-fit: contain;" />` : ''}
          <h1 style="margin: 10px 0 0; color: #101828; font-size: 20px; line-height: 1.15;">${escapeHtml(clubName || 'Club')}</h1>
        </div>
        <div style="align-self: flex-start; border-radius: 12px; background: #eef3ea; color: #4f6552; padding: 9px 12px; font-size: 12px; font-weight: 700; white-space: nowrap;">${escapeHtml(section || 'Development')}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px;">
        <div>
          <p style="margin: 0; color: #66756c; font-size: 12px; font-weight: 700;">Player</p>
          <h2 style="margin: 6px 0 0; color: #101828; font-size: 24px; line-height: 1.1;">${escapeHtml(playerName || 'Player')}</h2>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div style="border: 1px solid #e7ece3; border-radius: 10px; background: #fbfcf9; padding: 9px;">
            <p style="margin: 0; color: #5a6b5b; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">Team</p>
            <p style="margin: 5px 0 0; color: #334155; font-size: 12px; font-weight: 700;">${escapeHtml(teamName || 'Not provided')}</p>
          </div>
          <div style="border: 1px solid #e7ece3; border-radius: 10px; background: #fbfcf9; padding: 9px;">
            <p style="margin: 0; color: #5a6b5b; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">Session</p>
            <p style="margin: 5px 0 0; color: #334155; font-size: 12px; font-weight: 700;">${escapeHtml(session || 'Not provided')}</p>
          </div>
        </div>
      </div>

      <div style="margin-top: 16px; border: 1px solid #e7ece3; border-radius: 14px; background: #fbfcf9; padding: 12px;">
        <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;">Development Responses</p>
        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px;">
          ${buildResponseItems(responseItems)}
        </div>
      </div>
      ${buildScoringKey(responseItems)}
      ${buildEmailSections(emailSections)}
    </section>
  `
}
