import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('single-process Chromium uses one dedicated browser process without a second target context', async () => {
  const renderer = await source('../src/lib/pdf-builder.js')

  assert.match(renderer, /page = await browser\.newPage\(\)/)
  assert.doesNotMatch(renderer, /browser\.createBrowserContext\(\)/)
  assert.match(renderer, /totalRenderTimeoutMs:\s*8_000/)
  assert.match(renderer, /cleanupState/)
  assert.match(renderer, /networkRequestCount/)
  assert.match(renderer, /pageCount/)
})

test('requested PDF email failures fail closed and never fall back to an attachment-free send', async () => {
  const emailFunction = await source('../netlify/functions/send-parent-email.js')

  assert.doesNotMatch(emailFunction, /retrying without attachment/i)
  assert.doesNotMatch(emailFunction, /removeAttachments/)
  assert.match(emailFunction, /PDF_ATTACHMENT_GENERATION_FAILED/)
  assert.match(emailFunction, /PDF_ATTACHMENT_DELIVERY_FAILED/)
  assert.match(emailFunction, /Email not sent because the requested PDF/)
  assert.match(emailFunction, /markEmailLogFailed/)
})

test('direct email PDF retries reuse a stable request key and server-side duplicate protection', async () => {
  const playerProfile = await source('../src/pages/PlayerProfile.jsx')
  const emailClient = await source('../src/lib/email-builder.js')
  const emailFunction = await source('../netlify/functions/send-parent-email.js')

  assert.match(playerProfile, /emailAttemptId/)
  assert.match(playerProfile, /idempotencyKey: `direct-parent-email:/)
  assert.match(emailClient, /idempotencyKey: data\.idempotencyKey/)
  assert.match(emailFunction, /preparedEmail\.storedPayload\.idempotencyKey/)
  assert.match(emailFunction, /createPendingEmailLog/)
  assert.match(emailFunction, /createDeterministicQueueId/)
})

test('manual downloads validate the PDF and prevent repeated mobile taps', async () => {
  const activity = await source('../src/components/players/PlayerStaffActivity.jsx')
  const download = await source('../src/lib/pdf.js')

  assert.match(activity, /downloadLockRef\.current/)
  assert.match(activity, /disabled=\{isDownloading\}/)
  assert.match(download, /content-type/)
  assert.match(download, /signature !== '%PDF-'/)
  assert.match(download, /PDF_MIN_BYTES/)
  assert.match(download, /PDF_MAX_BYTES/)
  assert.match(download, /link\.target = '_blank'/)
  assert.match(download, /link\.download = PDF_DOWNLOAD_FILENAME/)
})

test('shared PDF caller map stays structured and Development controls remain dark', async () => {
  const developmentPolicy = await source('../src/lib/development-email-output-policy.js')
  const directEmailCaller = await source('../src/hooks/players/playerProfileUtils.js')
  const developmentCreate = await source('../src/pages/CreateEvaluationPage.jsx')
  const developmentSubmit = await source('../src/components/evaluations/SubmitExportSection.jsx')
  const activity = await source('../src/components/players/PlayerStaffActivity.jsx')
  const emailFunction = await source('../netlify/functions/send-parent-email.js')
  const matchDay = await source('../src/lib/matchday-report-export.js')
  const endpoint = await source('../netlify/functions/render-pdf.js')

  assert.match(developmentPolicy, /isDevelopmentEmailOnly/)
  assert.match(developmentPolicy, /shouldAttachPdf: !isDevelopmentEmailOnly/)
  assert.match(directEmailCaller, /buildAssessmentPdfDocument/)
  assert.match(activity, /exportCommunicationPdf/)
  assert.match(emailFunction, /buildProgressionChartPngBuffer/)
  assert.match(emailFunction, /authorizeAssessmentPdfDocument/)
  assert.match(endpoint, /loadCommunicationPdfDocument/)
  assert.match(endpoint, /FIXED_FILENAME = 'football-player-report\.pdf'/)
  assert.match(matchDay, /%PDF-1\.4/)
  assert.doesNotMatch(developmentCreate, /Email and PDF|Attach development PDF/)
  assert.doesNotMatch(developmentSubmit, /Email and PDF|Attach development PDF/)
})

test('structured response cards paginate as explicit rows without Chromium grid fragmentation', async () => {
  const {
    buildParentMessagePdfDocument,
    renderPdfDocumentHtml,
  } = await import('../src/lib/pdf-document.js')
  const document = buildParentMessagePdfDocument({
    clubName: 'FP TEST',
    playerName: 'FP TEST Player',
    teamName: 'FP TEST Team',
    subject: 'Multi-page verification',
    body: 'Synthetic structured content',
    assessmentFields: Array.from({ length: 42 }, (_, index) => ({
      label: `Field ${index + 1}`,
      value: `Value ${index + 1}`,
    })),
  })
  const html = renderPdfDocumentHtml(document)

  assert.equal((html.match(/class="response-row"/g) || []).length, 21)
  assert.match(html, /\.response-row \{[^}]*display: flex;[^}]*break-inside: avoid;/)
  assert.doesNotMatch(html, /\.response-grid \{[^}]*display: grid;/)
})
