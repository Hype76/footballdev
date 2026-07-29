export const DEVELOPMENT_PARENT_OUTPUT_CONTEXT = 'development_record'
export const DEVELOPMENT_RECIPIENT_OUTPUT_CONTEXT = 'development_record_recipient'
export const DEVELOPMENT_INTERNAL_TEST_OUTPUT_CONTEXT = 'development_record_internal_test'
export const DIRECT_PARENT_EMAIL_OUTPUT_CONTEXT = 'direct_parent_email'

const DEVELOPMENT_EMAIL_ONLY_OUTPUT_CONTEXTS = new Set([
  DEVELOPMENT_PARENT_OUTPUT_CONTEXT,
  DEVELOPMENT_RECIPIENT_OUTPUT_CONTEXT,
  DEVELOPMENT_INTERNAL_TEST_OUTPUT_CONTEXT,
])

const LEGACY_DEVELOPMENT_EMAIL_MODES = new Set([
  'email',
  'email_and_pdf',
])

export function normalizeDevelopmentPreviewMode(value) {
  return LEGACY_DEVELOPMENT_EMAIL_MODES.has(String(value ?? '').trim().toLowerCase())
    ? 'email'
    : 'scored'
}

export function resolveDevelopmentEmailOutputPolicy({
  attachPdf = false,
  evaluationId = '',
  includePdf = false,
  outputContext = '',
} = {}, {
  developmentPdfEnabled = false,
} = {}) {
  const normalizedOutputContext = String(outputContext ?? '').trim()
  const isLegacyDevelopmentRequest =
    !normalizedOutputContext && Boolean(String(evaluationId ?? '').trim())
  const isDevelopmentEmailOnly =
    DEVELOPMENT_EMAIL_ONLY_OUTPUT_CONTEXTS.has(normalizedOutputContext) ||
    isLegacyDevelopmentRequest
  const canAttachDevelopmentPdf =
    normalizedOutputContext === DEVELOPMENT_PARENT_OUTPUT_CONTEXT &&
    developmentPdfEnabled === true
  const requestedPdf = attachPdf === true || includePdf === true

  return {
    canAttachDevelopmentPdf,
    developmentPdfEnabled: developmentPdfEnabled === true,
    isDevelopmentEmailOnly,
    requiresDevelopmentParentResolution: normalizedOutputContext === DEVELOPMENT_PARENT_OUTPUT_CONTEXT,
    requestedPdf,
    shouldRejectUnavailableDevelopmentPdf:
      normalizedOutputContext === DEVELOPMENT_PARENT_OUTPUT_CONTEXT &&
      requestedPdf &&
      !canAttachDevelopmentPdf,
    shouldAttachPdf: attachPdf === true && (!isDevelopmentEmailOnly || canAttachDevelopmentPdf),
    shouldBuildChartAttachments: !isDevelopmentEmailOnly || (canAttachDevelopmentPdf && attachPdf === true),
  }
}

export function normalizeDevelopmentEmailBody(value) {
  return String(value ?? '').replaceAll(
    'The development details are included below and attached as a PDF for your records.',
    'The development details are included below for your records.',
  )
}
