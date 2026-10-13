import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { buildPdfBuffer } from '../../../src/lib/pdf-builder.js'
import { assertPlanFeature, getQueuedActorPlanProfile } from './_plan-gate.js'
import { reauthorizePreparedDevelopmentParentEmail } from './_development-parent-email-output.js'

export const DEVELOPMENT_PDF_BUCKET = 'development-pdfs-private'
export const DEVELOPMENT_PDF_CACHE_VERSION = 1
function canonicalJson(value) {
  const sort = item => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))))
}
export function isCurrentDevelopmentPdfArtifact(artifact, snapshot, clubId, evaluationId) {
  const hash = developmentReportHash(snapshot)
  return artifact?.version === DEVELOPMENT_PDF_CACHE_VERSION && artifact.snapshotHash === hash && artifact.bytes > 100 && artifact.bytes <= 5242880 && artifact.key === `${clubId}/${evaluationId}/${DEVELOPMENT_PDF_CACHE_VERSION}-${hash}.pdf`
}
export function developmentReportHash(snapshot) {
  return createHash('sha256').update(canonicalJson(snapshot)).digest('hex')
}
function signingSecret() {
  const secret = globalThis.Netlify?.env?.get?.('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Background PDF processing is not configured.')
  return secret
}
function signingInput(payload, pending) {
  return canonicalJson({ version: 1, actorId: payload.actorId, clubId: payload.clubId, teamId: payload.teamId, playerId: payload.playerId, evaluationId: payload.evaluationId, recipientLinkId: payload.recipientLinkId, outputKey: payload.outputKey, submissionOperationId: payload.submissionOperationId, email: payload.resendPayload, report: pending.report, filename: pending.filename, snapshotHash: pending.snapshotHash })
}
export function sealDeferredDevelopmentPdf(payload, pending, secret = signingSecret()) {
  return { ...pending, signature: createHmac('sha256', secret).update(signingInput(payload, pending)).digest('hex') }
}
export function verifyDeferredDevelopmentPdf(payload, secret = signingSecret()) {
  const pending = payload?.pendingDevelopmentPdf
  const actual = String(pending?.signature || '')
  const expected = sealDeferredDevelopmentPdf(payload, pending || {}, secret).signature
  if (!/^[a-f0-9]{64}$/.test(actual) || !timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) {
    throw Object.assign(new Error('The queued PDF request is not valid.'), { statusCode: 403, code: 'DEVELOPMENT_PDF_QUEUE_INVALID' })
  }
  return pending
}
export async function storeDevelopmentPdfArtifact(client, { evaluationId, clubId, snapshotHash, snapshot, filename, buffer }) {
  const key = `${clubId}/${evaluationId}/${DEVELOPMENT_PDF_CACHE_VERSION}-${snapshotHash}.pdf`
  const { error: uploadError } = await client.storage.from(DEVELOPMENT_PDF_BUCKET).upload(key, buffer, { contentType: 'application/pdf', upsert: true })
  if (uploadError) throw uploadError
  const artifact = { key, filename, snapshotHash, version: DEVELOPMENT_PDF_CACHE_VERSION, bytes: buffer.length }
  const { data, error } = await client.from('development_parent_reports').update({ pdf_artifact: artifact }).eq('evaluation_id', evaluationId).eq('club_id', clubId).eq('report_snapshot', JSON.stringify(snapshot)).select('evaluation_id').maybeSingle()
  if (error) throw error
  if (data?.evaluation_id !== evaluationId) throw Object.assign(new Error('The shared report changed while its PDF was saved.'), { statusCode: 409, code: 'DEVELOPMENT_PDF_SNAPSHOT_CHANGED' })
  return artifact
}
export async function completeDeferredDevelopmentPdf(prepared, client, {
  secret,
  loadProfile = getQueuedActorPlanProfile,
  reauthorize = reauthorizePreparedDevelopmentParentEmail,
  render = buildPdfBuffer,
  store = storeDevelopmentPdfArtifact,
} = {}) {
  const payload = prepared?.storedPayload
  if (!payload?.pendingDevelopmentPdf) return prepared
  const pending = verifyDeferredDevelopmentPdf(payload, secret)
  const planProfile = await loadProfile(client, payload)
  assertPlanFeature(planProfile, 'parentEmails')
  assertPlanFeature(planProfile, 'pdfReports')
  prepared = await reauthorize(client, { ...prepared, planProfile })
  const { data: row, error } = await client.from('development_parent_reports').select('report_snapshot').eq('evaluation_id', payload.evaluationId).eq('club_id', payload.clubId).maybeSingle()
  if (error || !row || developmentReportHash(row.report_snapshot) !== pending.snapshotHash || !row.report_snapshot.recipients?.some(item => item.linkId === payload.recipientLinkId)) {
    throw Object.assign(new Error('The shared report changed before its PDF was prepared.'), { statusCode: 409, code: 'DEVELOPMENT_PDF_SNAPSHOT_CHANGED' })
  }
  const diagnostics = {}
  const pdfStartedAt = new Date().toISOString()
  const buffer = await render(pending.report.document, { branding: pending.report.branding, diagnostics })
  const pdfFinishedAt = new Date().toISOString()
  // Recheck after rendering so revocation cannot be bypassed by a slow PDF job.
  const currentProfile = await loadProfile(client, payload)
  assertPlanFeature(currentProfile, 'parentEmails')
  assertPlanFeature(currentProfile, 'pdfReports')
  prepared = await reauthorize(client, { ...prepared, planProfile: currentProfile })
  const latest = await client.from('development_parent_reports').select('report_snapshot').eq('evaluation_id', payload.evaluationId).eq('club_id', payload.clubId).maybeSingle()
  if (latest.error || !latest.data || developmentReportHash(latest.data.report_snapshot) !== pending.snapshotHash) throw Object.assign(new Error('The shared report changed while its PDF was prepared.'), { statusCode: 409, code: 'DEVELOPMENT_PDF_SNAPSHOT_CHANGED' })
  await store(client, { evaluationId: payload.evaluationId, clubId: payload.clubId, snapshotHash: pending.snapshotHash, snapshot: latest.data.report_snapshot, filename: pending.filename, buffer })
  const attachments = [...(prepared.emailPayload.attachments || []), { filename: pending.filename, content: buffer.toString('base64'), contentType: 'application/pdf' }]
  const emailPayload = { ...prepared.emailPayload, attachments, ...(prepared.senderCopyEmails.length ? { cc: [currentProfile.email] } : {}) }
  const storedPayload = { ...prepared.storedPayload, resendPayload: emailPayload, pendingDevelopmentPdf: undefined, deliveryTelemetry: { ...prepared.storedPayload.deliveryTelemetry, pdfStartedAt, pdfFinishedAt } }
  return { ...prepared, attachments, emailPayload, storedPayload }
}
