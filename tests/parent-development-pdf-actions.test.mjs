import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { createPdfVisitTracker } from '../apps/mobile-core/src/pdfVisit.js'

const signedUrl = 'https://example.supabase.co/storage/v1/object/sign/development-pdfs-private/club/report/file.pdf?token=fixture'
const calls = []
let platform = 'ios'
let openResponse = { ok: true, result: { url: signedUrl } }
let existing = false
let delayedResponse
let delayedDownload
globalThis.pdfActionFixture = {
  platform: () => platform,
  calls,
  async fetch() { calls.push(['authorize']); return delayedResponse ? await delayedResponse : openResponse },
  async info(uri) { return { exists: existing || uri.endsWith('.download'), size: 150 } },
}
const mocks = {
  'expo-file-system/legacy': `const f=globalThis.pdfActionFixture;export const cacheDirectory='file:///fixture/';export const getInfoAsync=uri=>f.info(uri);export const getContentUriAsync=async uri=>'content://fixture/file.pdf';export const deleteAsync=async()=>{};export const moveAsync=async()=>{};export const downloadAsync=async(url,destination,options)=>{f.calls.push(['download',url,options]);await f.waitDownload();return {status:200,uri:destination,headers:{'content-type':'application/pdf'}}}`,
  'expo-intent-launcher': `export const startActivityAsync=async(action,options)=>globalThis.pdfActionFixture.calls.push(['view',action,options])`,
  'expo-sharing': `export const isAvailableAsync=async()=>true;export const shareAsync=async(uri,options)=>globalThis.pdfActionFixture.calls.push(['share',uri,options])`,
  'react-native': `export const Platform={get OS(){return globalThis.pdfActionFixture.platform()}};export const Linking={openURL:async url=>globalThis.pdfActionFixture.calls.push(['browser',url])}`,
  '../mobile-core/src/http': `export const joinApiPath=(base,path)=>base+'/'+path;export const fetchJsonWithTimeout=(...args)=>globalThis.pdfActionFixture.fetch(...args)`,
  '../mobile-core/src/supabase': `export const getAccessToken=async()=>'fixture-token';export const supabase={supabaseUrl:'https://example.supabase.co',auth:{refreshSession:async()=>({data:{session:{access_token:'fixture-refreshed'}}})}}`,
}
const bundled = await build({ entryPoints: ['apps/parent-mobile/parentDevelopment.js'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'installed-native-fixtures', setup(builder) {
  builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined)
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }))
} }] })
const { clearParentDevelopmentPdfPreparation, prepareParentMobileDevelopmentPdf, shareParentMobileDevelopmentPdf, buildParentDevelopmentPdfCacheFilename } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const input = { apiBaseUrl: 'https://footballplayer.online', parentLinkId: 'parent', report: { id: 'report', canDownloadPdf: true, recordDate: '2026-10-13', form: { name: 'FP TEST Review' } } }
globalThis.pdfActionFixture.waitDownload = () => delayedDownload || Promise.resolve()
function reset(os) { clearParentDevelopmentPdfPreparation(); platform = os; existing = false; calls.length = 0; delayedResponse = null; delayedDownload = null; openResponse = { ok: true, result: { url: signedUrl, expiresIn: 60 } } }

test('iPhone Open PDF uses the authorised browser viewer and Share PDF uses the phone share sheet', async () => {
  reset('ios')
  await shareParentMobileDevelopmentPdf({ ...input, action: 'open' })
  assert.deepEqual(calls.map(item => item[0]), ['authorize', 'browser'])
  assert.equal(calls[1][1], signedUrl)
  reset('ios')
  await shareParentMobileDevelopmentPdf({ ...input, action: 'share' })
  assert.deepEqual(calls.map(item => item[0]), ['authorize', 'download', 'share'])
  assert.deepEqual(calls[1][2].headers, {}, 'The account token never goes to storage')
  assert.match(buildParentDevelopmentPdfCacheFilename(input.report), /13-10-2026.*v2\.pdf$/)
})

test('Android Open PDF uses the existing PDF reader and Share PDF stays separate', async () => {
  reset('android')
  await shareParentMobileDevelopmentPdf({ ...input, action: 'open' })
  assert.deepEqual(calls.map(item => item[0]), ['authorize', 'download', 'view'])
  assert.deepEqual(calls[1][2].headers, {}, 'Never send the account token to storage')
  assert.equal(calls[2][1], 'android.intent.action.VIEW')
  assert.deepEqual(calls[2][2], { data: 'content://fixture/file.pdf', flags: 1, type: 'application/pdf' })
  reset('android'); existing = true
  await shareParentMobileDevelopmentPdf({ ...input, action: 'share' })
  assert.deepEqual(calls.map(item => item[0]), ['authorize', 'share'])
})

test('background preparation does not launch a viewer and prepared Open and Share reuse one authorised artifact', async () => {
  reset('ios')
  await prepareParentMobileDevelopmentPdf(input)
  assert.deepEqual(calls.map(item => item[0]), ['authorize', 'download'])
  existing = true
  await shareParentMobileDevelopmentPdf({ ...input, action: 'open' })
  await shareParentMobileDevelopmentPdf({ ...input, action: 'share' })
  assert.deepEqual(calls.map(item => item[0]), ['authorize', 'download', 'browser', 'share'])
  assert.match(calls[1][1], /development-pdfs-private/)
  assert.deepEqual(calls[1][2].headers, {})
})

test('iPhone Open does not wait for an unfinished background share download, and Share joins that download', async () => {
  reset('ios')
  let finish
  delayedDownload = new Promise(resolve => { finish = resolve })
  const preparing = prepareParentMobileDevelopmentPdf(input)
  await new Promise(resolve => setImmediate(resolve))
  await shareParentMobileDevelopmentPdf({ ...input, action: 'open' })
  const sharing = shareParentMobileDevelopmentPdf({ ...input, action: 'share' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls.map(item => item[0]), ['authorize', 'download', 'browser'])
  finish()
  await Promise.all([preparing, sharing])
  assert.deepEqual(calls.map(item => item[0]), ['authorize', 'download', 'browser', 'share'])
})

test('expired viewer capabilities and account changes require fresh authority even when the PDF is on the phone', async () => {
  reset('ios')
  await prepareParentMobileDevelopmentPdf(input)
  existing = true
  const realNow = Date.now
  const future = realNow() + 45_000
  Date.now = () => future
  try {
    openResponse = { ok: false, result: { message: 'Access revoked' } }
    await assert.rejects(shareParentMobileDevelopmentPdf({ ...input, action: 'share' }), /Access revoked/)
  } finally { Date.now = realNow }
  assert.equal(calls.filter(item => item[0] === 'share').length, 0)
  reset('ios')
  await prepareParentMobileDevelopmentPdf({ ...input, authorityScope: 'account-a:parent' })
  openResponse = { ok: false, result: { message: 'Wrong account' } }
  await assert.rejects(shareParentMobileDevelopmentPdf({ ...input, authorityScope: 'account-b:parent', action: 'open' }), /Wrong account/)
  assert.equal(calls.filter(item => item[0] === 'browser').length, 0)
  reset('ios')
  await prepareParentMobileDevelopmentPdf(input)
  openResponse = { ok: false, result: { message: 'Report changed' } }
  await assert.rejects(shareParentMobileDevelopmentPdf({ ...input, report: { ...input.report, overallScore: 8 }, action: 'open' }), /Report changed/)
  assert.equal(calls.filter(item => item[0] === 'browser').length, 0, 'A changed report cannot reuse a prior viewer capability')
})

test('Open PDF rejects permission failures and foreign viewer links', async () => {
  for (const response of [{ ok: false, result: { message: 'Access revoked' } }, { ok: true, result: { url: signedUrl.replace('example.supabase.co', 'other.example.test') } }, { ok: true, result: { url: 'javascript:alert(1)' } }]) {
    reset('ios'); openResponse = response
    await assert.rejects(shareParentMobileDevelopmentPdf({ ...input, action: 'open' }))
    assert.deepEqual(calls.map(item => item[0]), ['authorize'])
  }
})

test('returning to the same account, screen or report does not revive an old pending PDF action', async () => {
  for (const [a, b] of [['parent:development', 'parent:home'], ['parent-a:development', 'parent-b:development'], ['report-a', 'report-b']]) {
    reset('ios')
    const visit = createPdfVisitTracker(); visit.update(a)
    const isCurrent = visit.capture()
    let resolve
    delayedResponse = new Promise(done => { resolve = done })
    const pending = shareParentMobileDevelopmentPdf({ ...input, action: 'open', isCurrent })
    await new Promise(done => setImmediate(done))
    visit.update(b); visit.update(a)
    resolve(openResponse)
    assert.equal(await pending, false)
    assert.deepEqual(calls.map(item => item[0]), ['authorize'])
    assert.equal(visit.capture()(), true)
  }
})

test('actual Messages View Development PDF shortcut requests the viewer instead of sharing', async () => {
  const source = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  let declaration
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'handleOpenParentItem') declaration = node
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value)
  }
  visit(ast)
  assert.ok(declaration)
  let requested
  const dispatch = new Function('handleDevelopmentPdf', `${source.slice(declaration.start, declaration.end)}; return handleOpenParentItem`)(async (report, action) => { requested = { report, action } })
  await dispatch('development', input.report)
  assert.deepEqual(requested, { report: input.report, action: 'open' })
})
