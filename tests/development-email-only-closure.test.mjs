import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  DEVELOPMENT_PARENT_OUTPUT_CONTEXT,
  DIRECT_PARENT_EMAIL_OUTPUT_CONTEXT,
  normalizeDevelopmentEmailBody,
  normalizeDevelopmentPreviewMode,
  resolveDevelopmentEmailOutputPolicy,
} from '../src/lib/development-email-output-policy.js'
import { createPrivateEvaluationDraftPayload } from '../src/lib/evaluation-drafts.js'
import { EMAIL_TEMPLATE_AUDIENCES } from '../src/lib/email-templates.js'
import { PLAYER_CONTACT_TYPES } from '../src/lib/supabase.js'
import { buildParentEmailJobs } from '../src/hooks/evaluations/evaluationFormUtils.js'

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

function buildDevelopmentEmailJob() {
  return buildParentEmailJobs({
    allowServerRecipientResolution: true,
    contactAudiences: [EMAIL_TEMPLATE_AUDIENCES.parent],
    emailSections: [{ key: 'attendanceSummary', title: 'Attendance', body: 'Available.' }],
    emailTemplates: [{
      audience: EMAIL_TEMPLATE_AUDIENCES.parent,
      body: 'Dear {parentName}, the development details are below.',
      isEnabled: true,
      key: 'assessment',
      label: 'Assessment',
      subject: '{playerName} development update',
    }],
    evaluation: {
      id: '55555555-5555-4555-8555-555555555555',
      playerId: '44444444-4444-4444-8444-444444444444',
    },
    formData: {
      coachName: 'Coach One',
      parentName: 'Approved Internal',
      playerName: 'Fixture Player',
      section: 'Squad',
      session: '2026-07-26',
      team: 'Fixture Team',
    },
    inviteDate: '',
    normalizedPlayerName: 'Fixture Player',
    playerContactTypes: PLAYER_CONTACT_TYPES,
    selectedEmailTemplateKey: 'assessment',
    selectedParentContacts: [{
      email: 'approved.internal@example.test',
      linkId: '77777777-7777-4777-8777-777777777777',
      name: 'Approved Internal',
      type: PLAYER_CONTACT_TYPES.parent,
    }],
    selectedResponseItems: [{ label: 'Technical', value: 7 }],
    user: {
      clubId: '11111111-1111-4111-8111-111111111111',
      id: '22222222-2222-4222-8222-222222222222',
      email: 'coach@example.test',
    },
  })[0]
}

test('Development output choices are email selected parents or internal only with no PDF control', async () => {
  const createPage = await source('../src/pages/CreateEvaluationPage.jsx')
  const submitSection = await source('../src/components/evaluations/SubmitExportSection.jsx')
  const profileModals = await source('../src/components/players/PlayerProfileModals.jsx')

  assert.match(createPage, /isEmailEnabled \? 'Email selected parents' : 'Internal only'/)
  assert.match(submitSection, />Email selected parents</)
  assert.doesNotMatch(createPage, /Email and PDF|Attach development PDF|isPdfAttachmentApproved/)
  assert.doesNotMatch(submitSection, /Email and PDF|email and PDF|Attach development PDF|isPdfAttachmentApproved/)
  assert.doesNotMatch(profileModals, /Attach development PDF/)
  assert.match(profileModals, /emailConfirmTarget\?\.evaluation\?\.isDirectEmail/)
  assert.match(profileModals, /Output: Email selected parents/)
})

test('legacy email and PDF browser preferences normalize to email-only and PDF state is not persisted', () => {
  const payload = createPrivateEvaluationDraftPayload({
    isPdfAttachmentApproved: true,
    previewMode: 'email_and_pdf',
  })

  assert.equal(normalizeDevelopmentPreviewMode('email_and_pdf'), 'email')
  assert.equal(normalizeDevelopmentPreviewMode('email'), 'email')
  assert.equal(normalizeDevelopmentPreviewMode('scored'), 'scored')
  assert.equal(payload.previewMode, 'email')
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'isPdfAttachmentApproved'), false)
})

test('Development browser payload identifies the saved record and does not request or describe a PDF', () => {
  const job = buildDevelopmentEmailJob()

  assert.equal(job.payload.outputContext, DEVELOPMENT_PARENT_OUTPUT_CONTEXT)
  assert.deepEqual(job.payload.selectedParentLinkIds, ['77777777-7777-4777-8777-777777777777'])
  assert.equal(Object.prototype.hasOwnProperty.call(job.payload, 'attachPdf'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(job.payload, 'includePdf'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(job.payload, 'pdfDocument'), false)
})

test('server policy ignores stale Development PDF flags and suppresses all browser rendering attachments', () => {
  const attachPolicy = resolveDevelopmentEmailOutputPolicy({
    outputContext: DEVELOPMENT_PARENT_OUTPUT_CONTEXT,
    attachPdf: true,
  })
  const includePolicy = resolveDevelopmentEmailOutputPolicy({
    outputContext: DEVELOPMENT_PARENT_OUTPUT_CONTEXT,
    includePdf: true,
  })
  const cachedClientPolicy = resolveDevelopmentEmailOutputPolicy({
    evaluationId: '55555555-5555-4555-8555-555555555555',
    attachPdf: true,
  })
  const unrelatedPolicy = resolveDevelopmentEmailOutputPolicy({
    evaluationId: '55555555-5555-4555-8555-555555555555',
    outputContext: DIRECT_PARENT_EMAIL_OUTPUT_CONTEXT,
    attachPdf: true,
  })

  for (const policy of [attachPolicy, includePolicy, cachedClientPolicy]) {
    assert.equal(policy.isDevelopmentEmailOnly, true)
    assert.equal(policy.requestedPdf, true)
    assert.equal(policy.shouldAttachPdf, false)
    assert.equal(policy.shouldBuildChartAttachments, false)
  }

  assert.equal(unrelatedPolicy.isDevelopmentEmailOnly, false)
  assert.equal(unrelatedPolicy.shouldAttachPdf, true)
  assert.equal(unrelatedPolicy.shouldBuildChartAttachments, true)
})

test('server gates Chromium, chart and PDF work behind the email-only policy', async () => {
  const functionSource = await source('../netlify/functions/send-parent-email.js')

  assert.match(functionSource, /const shouldAttachPdf = outputPolicy\.shouldAttachPdf/)
  assert.match(functionSource, /const chartAttachments = outputPolicy\.shouldBuildChartAttachments/)
  assert.match(functionSource, /const authoritativePdfDocument = shouldAttachPdf/)
  assert.match(functionSource, /const pdfAttachments = shouldAttachPdf \? await buildPdfAttachment/)
  assert.match(functionSource, /developmentChartImages = outputPolicy\.shouldBuildChartAttachments && developmentContext/)
  assert.match(functionSource, /normalizeDevelopmentEmailBody\(body\.emailBody\)/)
})

test('legacy default Development email copy is normalized without changing unrelated text', () => {
  const legacy = 'The development details are included below and attached as a PDF for your records.'

  assert.equal(
    normalizeDevelopmentEmailBody(legacy),
    'The development details are included below for your records.',
  )
  assert.equal(normalizeDevelopmentEmailBody('Keep this custom message.'), 'Keep this custom message.')
})

test('saved Development resend is server-authoritative and direct email PDF support remains available', async () => {
  const profileUtils = await source('../src/hooks/players/playerProfileUtils.js')
  const profilePage = await source('../src/pages/PlayerProfile.jsx')
  const modalSource = await source('../src/components/players/PlayerProfileModals.jsx')

  const savedBuilder = profileUtils.slice(
    profileUtils.indexOf('export function buildPlayerProfileParentEmailPayload'),
    profileUtils.indexOf('export function buildPlayerDirectEmailPayload'),
  )
  const directBuilder = profileUtils.slice(profileUtils.indexOf('export function buildPlayerDirectEmailPayload'))

  assert.match(savedBuilder, /DEVELOPMENT_PARENT_OUTPUT_CONTEXT/)
  assert.match(savedBuilder, /selectedParentLinkIds/)
  assert.doesNotMatch(savedBuilder, /pdfDocument|buildAssessmentPdfDocument/)
  assert.match(profilePage, /Boolean\(evaluation\.isDirectEmail && isPdfAttachmentApproved\)/)
  assert.match(directBuilder, /pdfDocument: buildAssessmentPdfDocument/)
  assert.match(directBuilder, /outputContext: DIRECT_PARENT_EMAIL_OUTPUT_CONTEXT/)
  assert.match(modalSource, />Attach PDF</)
})

test('Match Day PDF export and generic server PDF implementation remain present', async () => {
  const matchDayExport = await source('../src/components/match-day/CompletedMatchReportExportActions.jsx')
  const functionSource = await source('../netlify/functions/send-parent-email.js')
  const pdfBuilder = await source('../src/lib/pdf-builder.js')

  assert.match(matchDayExport, /downloadCompletedReportPdf/)
  assert.match(matchDayExport, /Download PDF/)
  assert.match(functionSource, /async function buildPdfAttachment/)
  assert.match(functionSource, /assertPlanFeature\(planProfile, 'pdfReports'\)/)
  assert.match(pdfBuilder, /export function buildPdfBuffer/)
})
