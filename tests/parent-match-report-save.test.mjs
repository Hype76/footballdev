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
      export const writeAsStringAsync = async (...args) => { ops.written = args; };
      export const readAsStringAsync = async () => ops.corrupt ? '' : ops.written?.[1] || '';
      export const deleteAsync = async (...args) => { ops.deleted = args; };
      export const getInfoAsync = async () => ({ exists: true, size: 120 });
    `,
    'expo-sharing': `const ops = globalThis.__pdfOps; export const isAvailableAsync = async () => true; export const shareAsync = async (...args) => { ops.shared = args; };`,
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
})
