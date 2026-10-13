import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createClient } from '@supabase/supabase-js'
import { assertDevelopmentPdfScopeUnchanged } from '../netlify/functions/lib/_parent-development-history.js'
import { buildDevelopmentCompletionItems } from '../src/lib/development-submission-flow.js'

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only-service-key'
const { completeDeferredDevelopmentPdf, developmentReportHash, isCurrentDevelopmentPdfArtifact, sealDeferredDevelopmentPdf, verifyDeferredDevelopmentPdf, storeDevelopmentPdfArtifact } = await import('../netlify/functions/lib/_development-pdf-background.js')
const { getQueuedActorPlanProfile } = await import('../netlify/functions/lib/_plan-gate.js')

const secret = 'fixture-only-signing-key'
const snapshot = { finalizedAt: '2026-10-13T12:00:00Z', recipients: [{ linkId: 'parent' }], responseItems: [{ label: 'Technical', rawValue: 3 }] }
const profile = { id: 'actor', email: 'coach@example.test', clubId: 'club', role: 'coach', roleRank: 30, planKey: 'club', planStatus: 'active', accountStatus: 'active', clubStatus: 'active' }
function fixture() {
  const payload = { actorId: 'actor', actorRole: 'system', clubId: 'club', teamId: 'team', playerId: 'player', evaluationId: 'report', recipientLinkId: 'parent', outputKey: 'output', submissionOperationId: 'operation', resendPayload: { to: ['parent@example.test'], subject: 'Review', html: '<p>Selected response</p>' } }
  payload.pendingDevelopmentPdf = sealDeferredDevelopmentPdf(payload, { report: { document: { id: 'authorised-document' }, branding: { clubName: 'FP TEST Club' } }, snapshotHash: developmentReportHash(snapshot), filename: 'FP-TEST-13-10-2026.pdf' }, secret)
  return { emailPayload: payload.resendPayload, storedPayload: payload, senderCopyEmails: ['coach@example.test'] }
}
function harness(overrides = {}) {
  const calls = []
  let currentSnapshot = snapshot
  const client = { from() { return { select() { return this }, eq() { return this }, async maybeSingle() { return { data: { report_snapshot: currentSnapshot } } } } } }
  const options = { secret, loadProfile: async () => { calls.push('authority'); return profile }, reauthorize: async (_, prepared) => { calls.push('recipient'); return prepared }, authorizePdf: async ({ profile: currentProfile, document }) => { calls.push('pdf-authority'); assert.equal(currentProfile.role, 'coach'); return { document, branding: { clubName: 'FP TEST Club', clubLogoData: 'current-logo' } } }, render: async () => { calls.push('render'); return Buffer.from('%PDF-1.4\n' + 'x'.repeat(120)) }, store: async (_, value) => { calls.push('store'); assert.equal(value.snapshotHash, developmentReportHash(snapshot)) }, ...overrides }
  return { calls, client, options, changeSnapshot(value) { currentSnapshot = value } }
}

test('deferred PDF is sealed without generating or delivering it, and rejects altered authority or content', () => {
  const prepared = fixture()
  assert.equal(prepared.emailPayload.attachments, undefined)
  assert.equal(verifyDeferredDevelopmentPdf(prepared.storedPayload, secret).filename, 'FP-TEST-13-10-2026.pdf')
  for (const mutate of [p => { p.actorId = 'other' }, p => { p.clubId = 'other' }, p => { p.recipientLinkId = 'other' }, p => { p.resendPayload.to = ['other@example.test'] }, p => { p.resendPayload.html = '<p>Injected</p>' }, p => { p.pendingDevelopmentPdf.report.document = { id: 'injected' } }, p => { p.pendingDevelopmentPdf.filename = 'injected.pdf' }, p => { p.pendingDevelopmentPdf.signature = 'invalid' }]) {
    const payload = structuredClone(prepared.storedPayload)
    mutate(payload)
    assert.throws(() => verifyDeferredDevelopmentPdf(payload, secret), /not valid/)
  }
})

test('worker checks current authority and recipient before and after rendering and attaches the required PDF', async () => {
  const h = harness()
  const result = await completeDeferredDevelopmentPdf(fixture(), h.client, h.options)
  assert.deepEqual(h.calls, ['authority', 'recipient', 'pdf-authority', 'render', 'authority', 'recipient', 'store'])
  assert.equal(result.planProfile.role, 'coach', 'Stored system role cannot replace current staff authority')
  assert.equal(result.emailPayload.attachments[0].contentType, 'application/pdf')
  assert.match(Buffer.from(result.emailPayload.attachments[0].content, 'base64').toString(), /^%PDF/)
  assert.equal(result.storedPayload.pendingDevelopmentPdf, undefined)
  assert.ok(result.storedPayload.deliveryTelemetry.pdfStartedAt <= result.storedPayload.deliveryTelemetry.pdfFinishedAt)
})

test('revoked staff or changed report cannot start PDF generation', async () => {
  const revoked = harness({ loadProfile: async () => { throw new Error('Access revoked') } })
  await assert.rejects(completeDeferredDevelopmentPdf(fixture(), revoked.client, revoked.options), /revoked/)
  assert.deepEqual(revoked.calls, [])
  const changed = harness()
  changed.changeSnapshot({ ...snapshot, finalizedAt: 'later' })
  await assert.rejects(completeDeferredDevelopmentPdf(fixture(), changed.client, changed.options), /changed/)
  assert.equal(changed.calls.includes('render'), false)
})

test('recipient revocation during PDF construction prevents storage and delivery', async () => {
  let reads = 0
  const h = harness({ reauthorize: async (_, prepared) => { if (++reads === 2) throw new Error('Recipient revoked'); return prepared } })
  await assert.rejects(completeDeferredDevelopmentPdf(fixture(), h.client, h.options), /revoked/)
  assert.equal(h.calls.includes('store'), false)
})

test('saved snapshot changes during construction prevent storing the older PDF', async () => {
  const h = harness()
  h.options.render = async () => { h.changeSnapshot({ ...snapshot, recipients: [] }); return Buffer.from('%PDF-test') }
  await assert.rejects(completeDeferredDevelopmentPdf(fixture(), h.client, h.options), /changed/)
  assert.equal(h.calls.includes('store'), false)
})

test('renderer or storage failure remains a failed job instead of sending an email without its requested PDF', async () => {
  for (const failure of ['render', 'store']) {
    const h = harness({ [failure]: async () => { throw new Error(`${failure} failed`) } })
    await assert.rejects(completeDeferredDevelopmentPdf(fixture(), h.client, h.options), /failed/)
  }
})

test('private artifact validation rejects other report paths, stale versions and changed content', () => {
  const hash = developmentReportHash(snapshot)
  const artifact = { version: 1, snapshotHash: hash, bytes: 130, key: `club/report/1-${hash}.pdf` }
  assert.equal(isCurrentDevelopmentPdfArtifact(artifact, snapshot, 'club', 'report'), true)
  for (const changed of [{ ...artifact, key: 'other/report/file.pdf' }, { ...artifact, bytes: 6000000 }, { ...artifact, version: 0 }]) assert.equal(isCurrentDevelopmentPdfArtifact(changed, snapshot, 'club', 'report'), false)
  assert.equal(isCurrentDevelopmentPdfArtifact(artifact, { ...snapshot, finalizedAt: 'later' }, 'club', 'report'), false)
})

test('queued output is reported as preparing and queued, never as already attached or sent', () => {
  assert.deepEqual(buildDevelopmentCompletionItems({ emailOutcome: 'queued', isPdfAttachmentApproved: true, previewMode: 'email' }).slice(0, 3), ['Development record: Saved', 'PDF: Preparing in background', 'Parent email: Queued for sending'])
})

test('private artifact migration creates a private bounded PDF bucket and preserves saved reports', async () => {
  const db = new PGlite()
  try {
    await db.exec('create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table public.development_parent_reports(evaluation_id text primary key,report_snapshot jsonb); insert into public.development_parent_reports values (\'existing\',\'{"selected":true}\');')
    await db.exec(await readFile(new URL('../supabase/migrations/20261013111506_development_pdf_private_artifacts.sql', import.meta.url), 'utf8'))
    assert.deepEqual((await db.query('select public,file_size_limit,allowed_mime_types from storage.buckets')).rows, [{ public: false, file_size_limit: 5242880, allowed_mime_types: ['application/pdf'] }])
    assert.deepEqual((await db.query('select report_snapshot,pdf_artifact from public.development_parent_reports')).rows, [{ report_snapshot: { selected: true }, pdf_artifact: {} }])
  } finally { await db.close() }
})

test('queued actor lookup denies banned, deleted or unconfirmed accounts before loading a profile', async () => {
  for (const change of [{ banned_until: '2099-01-01' }, { deleted_at: '2026-10-13' }, { email_confirmed_at: null }]) {
    const client = { auth: { admin: { getUserById: async () => ({ data: { user: { id: 'actor', email_confirmed_at: '2026-10-01', ...change } } }) } }, from() { throw new Error('Must not load revoked profile') } }
    await assert.rejects(getQueuedActorPlanProfile(client, { actorId: 'actor', clubId: 'club' }), /authorised staff access/)
  }
})

test('untampered queue seals and report hashes survive real Postgres JSONB storage', async () => {
  const db = new PGlite()
  try {
    const payload = fixture().storedPayload
    const [{ saved, saved_snapshot }] = (await db.query('select $1::jsonb as saved, $2::jsonb as saved_snapshot', [JSON.stringify(payload), JSON.stringify(snapshot)])).rows
    assert.equal(verifyDeferredDevelopmentPdf(saved, secret).filename, payload.pendingDevelopmentPdf.filename)
    assert.equal(developmentReportHash(saved_snapshot), developmentReportHash(snapshot))
    saved.pendingDevelopmentPdf.report.document.id = 'injected'
    assert.throws(() => verifyDeferredDevelopmentPdf(saved, secret), /not valid/)
  } finally { await db.close() }
})

test('real Supabase client sends a JSON snapshot comparison and requires a matching stored row', async () => {
  let matched = true
  const client = createClient('https://example.supabase.co', 'fixture-key', { auth: { persistSession: false }, global: { fetch: async (url, options) => {
    if (String(url).includes('/storage/')) return new Response(JSON.stringify({ Key: 'stored' }), { headers: { 'Content-Type': 'application/json' } })
    const parsed = new URL(url)
    assert.equal(options.method, 'PATCH')
    assert.deepEqual(JSON.parse(parsed.searchParams.get('report_snapshot').slice(3)), snapshot)
    assert.equal(parsed.searchParams.get('select'), 'evaluation_id')
    return new Response(JSON.stringify(matched ? [{ evaluation_id: 'report' }] : []), { headers: { 'Content-Type': 'application/json' } })
  } } })
  const input = { clubId: 'club', evaluationId: 'report', snapshot, snapshotHash: developmentReportHash(snapshot), filename: 'FP-TEST.pdf', buffer: Buffer.from('%PDF-1.4\n' + 'x'.repeat(120)) }
  assert.equal((await storeDevelopmentPdfArtifact(client, input)).bytes, input.buffer.length)
  matched = false
  await assert.rejects(storeDevelopmentPdfArtifact(client, input), /changed/)
})

test('refreshed Parent scope denies a link retargeted to another child, team or club', () => {
  const original = { parentLink: { id: 'parent', club_id: 'club', team_id: 'team', player_id: 'player' }, player: { id: 'player', club_id: 'club', team_id: 'team' } }
  assert.doesNotThrow(() => assertDevelopmentPdfScopeUnchanged(original, structuredClone(original)))
  for (const [target, field] of [['parentLink', 'player_id'], ['parentLink', 'club_id'], ['parentLink', 'team_id'], ['player', 'id'], ['player', 'team_id']]) {
    const current = structuredClone(original)
    current[target][field] = 'other'
    assert.throws(() => assertDevelopmentPdfScopeUnchanged(original, current), /selected player changed/)
  }
})
