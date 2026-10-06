import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const root = process.cwd()
let moduleVersion = 0

async function loadSaver(platform) {
  const mocks = {
    'expo-file-system/legacy': `
      const ops = globalThis.__pdfOps;
      export const documentDirectory = 'file:///app/documents/';
      export const EncodingType = { Base64: 'base64' };
      export const StorageAccessFramework = {
        requestDirectoryPermissionsAsync: async () => ({ granted: ops.granted, directoryUri: 'content://downloads' }),
        createFileAsync: async (...args) => { ops.created = args; return 'content://downloads/report.pdf'; },
      };
      export const writeAsStringAsync = async (...args) => { ops.written = args; if (ops.writeError) throw new Error('Write failed'); };
      export const readAsStringAsync = async () => ops.corrupt ? '' : ops.written?.[1] || '';
      export const deleteAsync = async (...args) => { ops.deleted = args; };
      export const getInfoAsync = async () => ({ exists: ops.exists !== false, size: ops.size ?? 4 });
    `,
    'expo-sharing': `const ops = globalThis.__pdfOps; export const isAvailableAsync = async () => ops.sharingAvailable !== false; export const shareAsync = async (...args) => { ops.shared = args; if (ops.shareError) throw new Error('Share failed'); };`,
    'react-native': `export const Platform = { OS: '${platform}' };`,
    '../../src/lib/matchday-report-export.js': `export const buildCompletedReportPdf = () => new Uint8Array([37, 80, 68, 70]); export const getCompletedReportFilename = () => 'report.pdf';`,
  }
  const result = await build({
    entryPoints: [path.join(root, 'apps/parent-mobile/parentMatchReport.js')],
    bundle: true,
    write: false,
    format: 'esm',
    plugins: [{ name: 'pdf-save-mocks', setup(builder) {
      for (const [name, contents] of Object.entries(mocks)) {
        builder.onResolve({ filter: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ path: name, namespace: 'mock' }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path], loader: 'js' }))
      }
    } }],
  })
  moduleVersion += 1
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${moduleVersion}`)
}

test('Android saves the completed PDF into a chosen folder', async () => {
  globalThis.__pdfOps = { granted: true }
  const { saveParentMobileMatchReportPdf } = await loadSaver('android')
  const result = await saveParentMobileMatchReportPdf({ status: 'full_time' })
  assert.deepEqual(result, { filename: 'report.pdf', saved: true })
  assert.deepEqual(globalThis.__pdfOps.created, ['content://downloads', 'report', 'application/pdf'])
  assert.equal(globalThis.__pdfOps.written[0], 'content://downloads/report.pdf')
  assert.equal(globalThis.__pdfOps.shared, undefined)
})

test('Android does not claim a save when the folder picker is cancelled', async () => {
  globalThis.__pdfOps = { granted: false }
  const { saveParentMobileMatchReportPdf } = await loadSaver('android')
  assert.deepEqual(await saveParentMobileMatchReportPdf({ status: 'full_time' }), { filename: 'report.pdf', saved: false })
  assert.equal(globalThis.__pdfOps.written, undefined)
})

test('Android removes a PDF that fails verification', async () => {
  globalThis.__pdfOps = { granted: true, corrupt: true }
  const { saveParentMobileMatchReportPdf } = await loadSaver('android')
  await assert.rejects(saveParentMobileMatchReportPdf({ status: 'full_time' }), /could not be saved/)
  assert.equal(globalThis.__pdfOps.deleted[0], 'content://downloads/report.pdf')
})

test('iPhone prepares a persistent PDF and offers Save to Files without claiming completion', async () => {
  globalThis.__pdfOps = { granted: true }
  const { saveParentMobileMatchReportPdf } = await loadSaver('ios')
  assert.deepEqual(await saveParentMobileMatchReportPdf({ status: 'full_time' }), { filename: 'report.pdf', saved: false })
  assert.equal(globalThis.__pdfOps.written[0], 'file:///app/documents/report.pdf')
  assert.equal(globalThis.__pdfOps.shared[0], 'file:///app/documents/report.pdf')
  assert.deepEqual(globalThis.__pdfOps.shared[1], { dialogTitle: 'Save match report to Files', mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })
})

for (const scenario of [{ corrupt: true }, { size: 0 }, { size: 8 }, { exists: false }]) {
  test(`iPhone does not share an invalid PDF (${JSON.stringify(scenario)})`, async () => {
    globalThis.__pdfOps = scenario
    const { saveParentMobileMatchReportPdf } = await loadSaver('ios')
    await assert.rejects(saveParentMobileMatchReportPdf({ status: 'full_time' }), /could not be prepared/)
    assert.equal(globalThis.__pdfOps.shared, undefined)
    assert.deepEqual(globalThis.__pdfOps.deleted, ['file:///app/documents/report.pdf', { idempotent: true }])
  })
}

test('iPhone removes a partially written PDF when writing fails', async () => {
  globalThis.__pdfOps = { writeError: true }
  const { saveParentMobileMatchReportPdf } = await loadSaver('ios')
  await assert.rejects(saveParentMobileMatchReportPdf({ status: 'full_time' }), /Write failed/)
  assert.equal(globalThis.__pdfOps.shared, undefined)
  assert.equal(globalThis.__pdfOps.deleted[0], 'file:///app/documents/report.pdf')
})

test('iPhone preserves the verified PDF and reports a failed share', async () => {
  globalThis.__pdfOps = { shareError: true }
  const { saveParentMobileMatchReportPdf } = await loadSaver('ios')
  await assert.rejects(saveParentMobileMatchReportPdf({ status: 'full_time' }), /Share failed/)
  assert.equal(globalThis.__pdfOps.deleted, undefined)
})

test('iPhone checks sharing availability before preparing a file', async () => {
  globalThis.__pdfOps = { sharingAvailable: false }
  const { saveParentMobileMatchReportPdf } = await loadSaver('ios')
  await assert.rejects(saveParentMobileMatchReportPdf({ status: 'full_time' }), /cannot save or share/)
  assert.equal(globalThis.__pdfOps.written, undefined)
})

test('Reports are unavailable before full time', async () => {
  globalThis.__pdfOps = {}
  const { saveParentMobileMatchReportPdf } = await loadSaver('ios')
  await assert.rejects(saveParentMobileMatchReportPdf({ status: 'in_progress' }), /after full time/)
  assert.equal(globalThis.__pdfOps.written, undefined)
})

test('A context switch before preparation cancels without showing a save picker', async () => {
  globalThis.__pdfOps = { granted: true }
  const { saveParentMobileMatchReportPdf } = await loadSaver('android')
  assert.deepEqual(await saveParentMobileMatchReportPdf({ status: 'full_time' }, { isCurrent: () => false }), { filename: 'report.pdf', saved: false })
  assert.equal(globalThis.__pdfOps.created, undefined)
  assert.equal(globalThis.__pdfOps.written, undefined)
})

test('Switching context while the Android folder picker is open prevents a write', async () => {
  globalThis.__pdfOps = { granted: true }
  const { saveParentMobileMatchReportPdf } = await loadSaver('android')
  let checks = 0
  assert.deepEqual(await saveParentMobileMatchReportPdf({ status: 'full_time' }, { isCurrent: () => ++checks < 3 }), { filename: 'report.pdf', saved: false })
  assert.equal(globalThis.__pdfOps.created, undefined)
})

test('A verified Android save can be repeated after cancellation or write failure', async () => {
  globalThis.__pdfOps = { granted: false }
  const { saveParentMobileMatchReportPdf } = await loadSaver('android')
  await saveParentMobileMatchReportPdf({ status: 'full_time' })
  globalThis.__pdfOps.granted = true
  globalThis.__pdfOps.writeError = true
  await assert.rejects(saveParentMobileMatchReportPdf({ status: 'full_time' }), /Write failed/)
  globalThis.__pdfOps.writeError = false
  assert.equal((await saveParentMobileMatchReportPdf({ status: 'full_time' })).saved, true)
})
