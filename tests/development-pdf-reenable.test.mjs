import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  DEVELOPMENT_PARENT_OUTPUT_CONTEXT,
  DEVELOPMENT_RECIPIENT_OUTPUT_CONTEXT,
  DIRECT_PARENT_EMAIL_OUTPUT_CONTEXT,
  resolveDevelopmentEmailOutputPolicy,
} from '../src/lib/development-email-output-policy.js'
import {
  isDevelopmentPdfClientEnabled,
  isDevelopmentPdfServerEnabled,
} from '../src/lib/development-pdf-feature.js'

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('Development PDF flags activate only from explicit client and server values', () => {
  assert.equal(isDevelopmentPdfClientEnabled({ VITE_ENABLE_DEVELOPMENT_PDF: 'true' }), true)
  assert.equal(isDevelopmentPdfClientEnabled({ VITE_ENABLE_DEVELOPMENT_PDF: 'TRUE' }), true)
  assert.equal(isDevelopmentPdfClientEnabled({ VITE_ENABLE_DEVELOPMENT_PDF: '1' }), false)
  assert.equal(isDevelopmentPdfClientEnabled({}), false)
  assert.equal(isDevelopmentPdfServerEnabled({ ENABLE_DEVELOPMENT_PDF: 'true' }), true)
  assert.equal(isDevelopmentPdfServerEnabled({ VITE_ENABLE_DEVELOPMENT_PDF: 'true' }), false)
  assert.equal(isDevelopmentPdfServerEnabled({}), false)
})

test('Development attachment and chart work remain server-dark until trusted activation', () => {
  const disabled = resolveDevelopmentEmailOutputPolicy({
    attachPdf: true,
    outputContext: DEVELOPMENT_PARENT_OUTPUT_CONTEXT,
  })
  const enabled = resolveDevelopmentEmailOutputPolicy({
    attachPdf: true,
    outputContext: DEVELOPMENT_PARENT_OUTPUT_CONTEXT,
  }, {
    developmentPdfEnabled: true,
  })
  const direct = resolveDevelopmentEmailOutputPolicy({
    attachPdf: true,
    outputContext: DIRECT_PARENT_EMAIL_OUTPUT_CONTEXT,
  })
  const unsupportedDevelopmentRecipient = resolveDevelopmentEmailOutputPolicy({
    attachPdf: true,
    outputContext: DEVELOPMENT_RECIPIENT_OUTPUT_CONTEXT,
  }, {
    developmentPdfEnabled: true,
  })

  assert.equal(disabled.requestedPdf, true)
  assert.equal(disabled.shouldRejectUnavailableDevelopmentPdf, true)
  assert.equal(disabled.shouldAttachPdf, false)
  assert.equal(disabled.shouldBuildChartAttachments, false)
  assert.equal(enabled.shouldRejectUnavailableDevelopmentPdf, false)
  assert.equal(enabled.shouldAttachPdf, true)
  assert.equal(enabled.shouldBuildChartAttachments, true)
  assert.equal(direct.shouldRejectUnavailableDevelopmentPdf, false)
  assert.equal(direct.shouldAttachPdf, true)
  assert.equal(direct.shouldBuildChartAttachments, true)
  assert.equal(unsupportedDevelopmentRecipient.shouldRejectUnavailableDevelopmentPdf, false)
  assert.equal(unsupportedDevelopmentRecipient.shouldAttachPdf, false)
  assert.equal(unsupportedDevelopmentRecipient.shouldBuildChartAttachments, false)
})

test('production activates both gates while previews remain dark', async () => {
  const netlifyConfig = await source('../netlify.toml')

  assert.match(
    netlifyConfig,
    /\[context\.production\.environment\][\s\S]*ENABLE_DEVELOPMENT_PDF = "true"[\s\S]*VITE_ENABLE_DEVELOPMENT_PDF = "true"/,
  )
  assert.match(
    netlifyConfig,
    /\[context\.branch-deploy\.environment\][\s\S]*ENABLE_DEVELOPMENT_PDF = "false"[\s\S]*VITE_ENABLE_DEVELOPMENT_PDF = "false"/,
  )
  assert.match(
    netlifyConfig,
    /\[context\.deploy-preview\.environment\][\s\S]*ENABLE_DEVELOPMENT_PDF = "false"[\s\S]*VITE_ENABLE_DEVELOPMENT_PDF = "false"/,
  )
})

test('Development PDF UI is deliberate, role gated, loading safe and draft persisted', async () => {
  const createPage = await source('../src/pages/CreateEvaluationPage.jsx')
  const submitSection = await source('../src/components/evaluations/SubmitExportSection.jsx')
  const drafts = await source('../src/lib/evaluation-drafts.js')

  assert.match(createPage, /isDevelopmentPdfClientEnabled\(import\.meta\.env\)/)
  assert.match(createPage, /canUseUiFeature\(user, CAPABILITIES\.pdfReports\)/)
  assert.match(createPage, /showDevelopmentPdfOption = hasDevelopmentPdfAccess && useLinkedParentRecipients/)
  assert.match(createPage, /const \[isPdfAttachmentApproved, setIsPdfAttachmentApproved\] = useState\(false\)/)
  assert.match(createPage, /if \(isPdfAttachmentApproved && !canUseDevelopmentPdf\)/)
  assert.match(createPage, /setIsPdfAttachmentApproved\(false\)/)
  assert.match(submitSection, /\{showDevelopmentPdfOption \? \(/)
  assert.match(submitSection, />Attach PDF report</)
  assert.match(submitSection, /disabled=\{isSubmitting \|\| !canUseDevelopmentPdf\}/)
  assert.match(submitSection, /Creates a PDF copy of this Development report and attaches it to the parent email\./)
  assert.match(createPage, /Add or select a parent contact before sending this report\./)
  assert.match(createPage, /developmentPdfServerAvailable !== true/)
  assert.match(drafts, /isPdfAttachmentApproved/)
  const attachmentChoiceHandler = createPage.slice(
    createPage.indexOf('onPdfAttachmentApprovedChange={(value) => {'),
    createPage.indexOf('onEmailSendModeChange={(value) => {'),
  )
  assert.match(attachmentChoiceHandler, /markDraftUnsaved/)
})

test('trusted Development requests fail safely instead of silently dropping an unavailable PDF', async () => {
  const functionSource = await source('../netlify/functions/send-parent-email.js')

  assert.match(functionSource, /if \(outputPolicy\.shouldRejectUnavailableDevelopmentPdf\)/)
  assert.match(functionSource, /code: 'DEVELOPMENT_PDF_UNAVAILABLE'/)
  assert.match(functionSource, /Email not sent because the requested PDF is not available\. Retry the PDF attachment\./)
})

test('Development attachment payload stays server-authoritative and records accurate outcomes', async () => {
  const createPage = await source('../src/pages/CreateEvaluationPage.jsx')
  const formUtils = await source('../src/hooks/evaluations/evaluationFormUtils.js')
  const emailFunction = await source('../netlify/functions/send-parent-email.js')

  assert.match(formUtils, /attachPdf:\s*attachPdf === true &&\s*contactType === playerContactTypes\.parent/)
  assert.doesNotMatch(formUtils, /pdfDocument: buildAssessmentPdfDocument/)
  assert.match(createPage, /attachPdf: isPdfAttachmentApproved/)
  assert.match(createPage, /hasAttachment: emailJob\.payload\?\.attachPdf === true/)
  assert.match(createPage, /hasAttachment: clientLoggedEmailJobs\.some/)
  assert.match(createPage, /requested PDF failed and the parent email was not sent/)
  assert.match(createPage, /persistedEvaluationForRetryRef/)
  assert.match(emailFunction, /isDevelopmentPdfServerEnabled\(process\.env\)/)
  assert.match(emailFunction, /assertPlanFeature\(planProfile, 'pdfReports'\)/)
  assert.match(emailFunction, /pdfAttachmentAvailable:[\s\S]*isDevelopmentPdfServerEnabled\(process\.env\)[\s\S]*canUsePlanFeature\(requestUser, 'pdfReports'\)/)
  assert.match(emailFunction, /buildAssessmentPdfDocument\(\{/)
  assert.match(emailFunction, /authorizeAssessmentPdfReport/)
  assert.match(emailFunction, /branding:\s*pdfReport\.branding/)
  assert.match(emailFunction, /PDF_ATTACHMENT_GENERATION_FAILED/)
  assert.match(emailFunction, /PDF_ATTACHMENT_DELIVERY_FAILED/)
})

test('retry and duplicate protections remain in both record and email paths', async () => {
  const createPage = await source('../src/pages/CreateEvaluationPage.jsx')
  const emailFunction = await source('../netlify/functions/send-parent-email.js')

  assert.match(createPage, /if \(submissionPromiseRef\.current\)/)
  assert.match(createPage, /shouldPreserveSavedRecordForRetry/)
  assert.match(createPage, /persistedEvaluationForRetryRef\.current/)
  assert.match(createPage, /const evaluationPayloadId = existingEvaluationId \|\| evaluationClientId/)
  assert.match(createPage, /const evaluation = buildEvaluationPayload\(evaluationPayloadId\)/)
  assert.match(emailFunction, /createPendingEmailLog/)
  assert.match(emailFunction, /createEmailDedupeKey/)
  assert.match(emailFunction, /duplicate: true/)
})
