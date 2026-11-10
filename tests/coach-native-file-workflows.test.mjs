import assert from 'node:assert/strict'
import { build } from 'esbuild'
import test from 'node:test'
import { validateResourceLibraryFile, writeResourceLibraryUpload } from '../src/lib/resource-library-upload.js'

function uploadClient({ insertError } = {}) {
  const calls = []
  const bucket = {
    upload: async (...args) => { calls.push(['upload', ...args]); return {} },
    remove: async (paths) => { calls.push(['remove', paths]); return {} },
  }
  const client = {
    storage: { from: (name) => { assert.equal(name, 'resource-library'); return bucket } },
    from: (name) => {
      assert.equal(name, 'resource_library_items')
      return { insert: (row) => {
        calls.push(['insert', row])
        return { select: () => ({ single: async () => ({ data: row, error: insertError }) }) }
      } }
    },
  }
  return { client, calls }
}

test('native PDF bytes use the existing private resource path, file checks and rollback', async () => {
  const file = { name: 'Match notes.pdf', type: 'application/pdf', size: 4 }
  const body = Uint8Array.of(37, 80, 68, 70).buffer
  const draft = { id: 'resource', clubId: 'club', teamId: 'team', title: 'Match notes', file, body, uploadedByProfileId: 'manager' }
  const { client, calls } = uploadClient()
  const { data } = await writeResourceLibraryUpload(client, draft)
  assert.deepEqual(calls[0], ['upload', 'club/team/resource/Match-notes.pdf', body, { contentType: 'application/pdf', upsert: false }])
  assert.equal(data.team_id, 'team')
  assert.equal(data.uploaded_by_profile_id, 'manager')
  assert.equal(data.original_filename, file.name)
  assert.equal(validateResourceLibraryFile({ name: 'Gallery.jpg', size: 4, type: 'image/jpeg' }).mimeType, 'image/jpeg')
  for (const invalid of [{ name: 'bad.svg' }, { type: 'image/jpeg' }, { size: 21 * 1024 * 1024 }]) {
    await assert.rejects(writeResourceLibraryUpload(client, { ...draft, file: { ...file, ...invalid } }))
  }
  assert.equal(calls.length, 2)
  const insertError = new Error('Insert denied')
  const failed = uploadClient({ insertError })
  await assert.rejects(writeResourceLibraryUpload(failed.client, draft), insertError)
  assert.deepEqual(failed.calls[2], ['remove', ['club/team/resource/Match-notes.pdf']])
})

let buildSequence = 0
async function loadPdfBridge(platform) {
  const mocks = {
    expo: 'export const requireOptionalNativeModule = () => globalThis.pdfOps.native ? {} : null',
    'expo-file-system/legacy': `
      const ops = globalThis.pdfOps
      export const cacheDirectory = 'file:///cache/'
      export const EncodingType = { Base64: 'base64' }
      export const StorageAccessFramework = {
        requestDirectoryPermissionsAsync: async () => ({ granted: ops.granted, directoryUri: 'content://downloads' }),
        createFileAsync: async (...args) => { ops.destination = args; return 'content://downloads/report.pdf' },
      }
      export const makeDirectoryAsync = async () => {}
      export const deleteAsync = async (uri) => { (ops.deleted ||= []).push(uri) }
      export const writeAsStringAsync = async (...args) => { ops.written = args }
      export const readAsStringAsync = async () => ops.corrupt ? '' : ops.written[1]
      export const getInfoAsync = async () => ({ exists: true, size: Buffer.from(ops.written[1], 'base64').length })
    `,
    'expo-sharing': `
      export const isAvailableAsync = async () => true
      export const shareAsync = async (...args) => { globalThis.pdfOps.shared = args }
    `,
    'react-native': `export const Platform = { OS: '${platform}' }`,
  }
  const result = await build({
    entryPoints: ['apps/coach-mobile/src/coachMatchReportPdf.js'],
    bundle: true,
    write: false,
    format: 'esm',
    plugins: [{ name: 'native-file-bridges', setup(builder) {
      builder.onResolve({ filter: /^(expo|expo-file-system\/legacy|expo-sharing|react-native)$/ }, ({ path }) => ({ path, namespace: 'mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path] }))
    } }],
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}#${++buildSequence}`)
}

const match = {
  id: 'fixture', status: 'full_time', teamId: 'team', clubId: 'club', matchDate: '2026-01-03',
  teamName: 'Home FC', clubName: 'Home FC', opponent: 'Away FC', homeScore: 2, awayScore: 1,
  finalReport: { staffNotes: 'Coach report note' },
}
const context = { teamId: 'team', clubId: 'club', roleRank: 30 }
const current = () => true

test('Coach on Android saves a real staff PDF, verifies the write and rejects a different team', async () => {
  globalThis.pdfOps = { native: true, granted: true }
  const { exportCoachMatchReportPdf, supportsCoachMatchReportPdf } = await loadPdfBridge('android')
  assert.equal(supportsCoachMatchReportPdf(), true)
  await assert.rejects(exportCoachMatchReportPdf(match, { context: { ...context, teamId: 'other' }, mode: 'save', isCurrent: current }), /active team/)
  assert.equal(await exportCoachMatchReportPdf(match, { context, mode: 'save', isCurrent: current }), 'saved')
  const [uri, encoded] = globalThis.pdfOps.written
  assert.equal(uri, 'content://downloads/report.pdf')
  const pdf = Buffer.from(encoded, 'base64').toString()
  assert.match(pdf, /^%PDF-/)
  assert.ok(pdf.includes('Generated securely by Footballplayer.online'))
  assert.match(pdf, /Coach report note/)
  globalThis.pdfOps.corrupt = true
  await assert.rejects(exportCoachMatchReportPdf(match, { context, mode: 'save', isCurrent: current }), /could not be saved/)
  assert.deepEqual(globalThis.pdfOps.deleted, [uri])
})

test('Coach on iPhone opens the share sheet without assuming a save and supports old binaries', async () => {
  globalThis.pdfOps = { native: true }
  const { exportCoachMatchReportPdf, supportsCoachMatchReportPdf } = await loadPdfBridge('ios')
  assert.equal(await exportCoachMatchReportPdf(match, { context, mode: 'share', isCurrent: current }), 'closed')
  const [uri, options] = globalThis.pdfOps.shared
  assert.match(uri, /^file:\/\/\/cache\/coach-match-report\/.+\.pdf$/)
  assert.equal(options.mimeType, 'application/pdf')
  globalThis.pdfOps.native = false
  assert.equal(supportsCoachMatchReportPdf(), false)
})
