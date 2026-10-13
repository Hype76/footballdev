import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { resolveDevelopmentEmailOutputPolicy, normalizeDevelopmentEmailBody } from '../src/lib/development-email-output-policy.js'

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only-service-key'
const { assertPlanFeature } = await import('../netlify/functions/lib/_plan-gate.js')
const { sealDeferredDevelopmentPdf, developmentReportHash, verifyDeferredDevelopmentPdf } = await import('../netlify/functions/lib/_development-pdf-background.js')
const source = await readFile(new URL('../netlify/functions/send-parent-email.js', import.meta.url), 'utf8')
const declarations = parse(source, { sourceType: 'module' }).program.body.map(node => node.declaration || node)
const helpers = ['cleanHeaderPart', 'normaliseEmail', 'normaliseRecipients', 'isValidEmail', 'getSenderCopyEmails', 'normalizeEmailHtml', 'buildEmailPayload', 'buildDevelopmentChartImages', 'addDevelopmentChartContentIds', 'prepareParentEmail'].map(name => {
  const node = declarations.find(item => item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, `Actual preparation helper ${name} exists`)
  return source.slice(node.start, node.end)
}).join('\n')

test('actual Coach email preparation returns the sealed deferred request while PDF rendering is unavailable', async () => {
  let renders = 0
  const report = { responseItems: [{ fieldId: 'technical', type: 'score_1_10', label: 'Technical', displayValue: '3 / 10' }], emailSections: [], recipients: [{ linkId: 'parent' }] }
  const profile = { id: 'actor', email: 'coach@example.test', clubId: 'club', role: 'coach', roleRank: 30, planKey: 'club', planStatus: 'active', accountStatus: 'active', clubStatus: 'active' }
  const context = { evaluation: { id: 'evaluation', development_parent_report: report }, player: { id: 'player' }, club: { id: 'club', name: 'FP TEST Club' }, team: { id: 'team', name: 'FP TEST Team' }, recipient: { linkId: 'parent', email: 'parent@example.test' }, outputKey: 'output', outputQueueId: 'queue' }
  const dependencies = {
    process, assertPlanFeature, resolveDevelopmentEmailOutputPolicy, normalizeDevelopmentEmailBody,
    isDevelopmentPdfServerEnabled: () => true,
    assertDevelopmentSubmissionOperation: async () => ({ operation_id: 'operation' }),
    supabaseAdmin: {}, DEMO_EMAIL: 'demo@example.test',
    loadDevelopmentParentEmailContext: async () => context,
    getDevelopmentParentReport: () => report,
    enrichDevelopmentParentReportWithScores: value => value,
    buildDevelopmentParentReportContent: () => ({ sections: [] }),
    buildDevelopmentPdfFilename: () => 'FP-TEST-13-10-2026.pdf',
    buildDevelopmentParentEmailHtml: () => '<p>Authorised selected report attached</p>',
    buildAssessmentPdfDocument: () => ({ id: 'document' }),
    authorizeAssessmentPdfReport: async ({ document }) => ({ document, branding: { clubName: 'FP TEST Club' } }),
    buildPdfAttachment: () => { renders++; return new Promise(() => {}) },
    buildProgressionChartAttachments: () => { renders++; return new Promise(() => {}) },
    createFromAddress: name => `${name} <fixture@example.test>`, sealDeferredDevelopmentPdf, developmentReportHash,
  }
  const prepare = new Function(...Object.keys(dependencies), `${helpers}; return prepareParentEmail`)(...Object.values(dependencies))
  let timeoutId
  try {
    const result = await Promise.race([prepare({ deferPdf: true, requestUser: profile, body: { outputContext: 'development_record', evaluationId: 'evaluation', userId: 'actor', attachPdf: true, senderEmail: profile.email, subject: 'FP TEST Review' } }), new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('Foreground request waited for PDF rendering')), 1000) })])
    assert.equal(renders, 0)
    assert.deepEqual(result.attachments, [])
    assert.equal(result.emailPayload.attachments, undefined)
    assert.equal(verifyDeferredDevelopmentPdf(result.storedPayload).filename, 'FP-TEST-13-10-2026.pdf')
    assert.equal(result.storedPayload.pendingDevelopmentPdf.snapshotHash, developmentReportHash(report))
  } finally { clearTimeout(timeoutId) }
})
