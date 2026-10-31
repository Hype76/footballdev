import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { hash, inventory, evaluateAudit } from '../scripts/security-verify-reviewed-backports.mjs'
import { prepareWrites } from '../scripts/security-apply-reviewed-backports.mjs'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const record = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'security/reviewed-source-remediations.json')))
const payload = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'security/patches/reviewed-source-manifest.json')))
const require = createRequire(path.resolve('package.json'))
const installed = path.resolve('node_modules/exceljs/node_modules/glob')
const target = record.targets.find(item => item.name === 'glob')
const library = payload.libraries.find(item => item.name === 'glob')
const normalize = files => files.map(file => file.replaceAll('\\', '/')).sort()

// Compile only isolated test modules. Bare dependencies use the actual installed
// fixed tooling; no installed package is written or substituted in require.cache.
function isolatedGlob(sources) {
  const cache = new Map()
  const packageRequire = createRequire(path.join(installed, 'package.json'))
  const load = relative => {
    if (cache.has(relative)) return cache.get(relative).exports
    const module = { exports: {} }
    cache.set(relative, module)
    const localRequire = name => name.startsWith('./') ? load(name.slice(2)) : packageRequire(name)
    const source = sources.get(relative) ?? fs.readFileSync(path.join(installed, relative), 'utf8')
    new Function('require', 'module', 'exports', source)(localRequire, module, module.exports)
    return module.exports
  }
  return load('glob.js')
}

const patched = new Map(library.files.map(file => [file.path, Buffer.from(file.contentBase64, 'base64').toString('utf8')]))
const allJs = ['src/!alert.js', 'src/[bracket].js', 'src/index.js', 'src/index.test.js', 'src/keep.js', 'src/nested/player.js', 'src/équipe.js'].sort()
const cases = [
  ['literal', 'src/index.js', {}, ['src/index.js']],
  ['globstar', 'src/**/*.js', { nodir: true }, allJs],
  ['brace expansion', 'src/{index,keep}.js', {}, ['src/index.js', 'src/keep.js']],
  ['extglob', 'src/@(index|keep).js', {}, ['src/index.js', 'src/keep.js']],
  ['negative extglob', 'src/!(index|keep).js', { nodir: true }, ['src/!alert.js', 'src/[bracket].js', 'src/index.test.js', 'src/équipe.js']],
  ['explicit dot', 'src/.*.js', {}, ['src/.hidden.js']],
  ['dot option', 'src/**/*.js', { dot: true, nodir: true }, [...allJs, 'src/.hidden.js', 'src/.hidden-dir/coach.js', 'src/nested/.secret.js'].sort()],
  ['dot extglob retains outer prefilter', 'src/@(.hidden|index).js', {}, ['src/index.js']],
  ['ignore', 'src/**/*.js', { nodir: true, ignore: ['**/*.test.js', '**/nested/**'] }, allJs.filter(file => !file.endsWith('.test.js') && !file.includes('/nested/'))],
  ['nodir', 'src/*', { nodir: true }, [...allJs.filter(file => !file.includes('/nested/')), 'src/notes.txt'].sort()],
  ['include directories', 'src/*', {}, [...allJs.filter(file => !file.includes('/nested/')), 'src/notes.txt', 'src/nested', 'src/other'].sort()],
  ['case insensitive', 'src/INDEX.JS', { nocase: true }, ['src/index.js']],
  ['unicode', 'src/éq*.js', {}, ['src/équipe.js']],
]

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'football-glob-contract-'))
  for (const file of [...allJs, 'src/notes.txt', 'src/.hidden.js', 'src/.hidden-dir/coach.js', 'src/nested/.secret.js', 'src/other/player.ts']) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    fs.writeFileSync(path.join(directory, file), 'synthetic fixture\n')
  }
  return directory
}

function removeFixture(directory) {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
  assert.ok(path.basename(directory).startsWith('football-glob-'))
  fs.rmSync(directory, { recursive: true, force: true })
}

test('the retained glob7 tree and payload bytes match the reviewed preimage and postimage', () => {
  assert.equal(require('minimatch/package.json').version, '11.0.3')
  assert.equal(require(path.join(installed, 'package.json')).version, '7.2.3')
  assert.ok([target.originalTreeSha256, target.patchedTreeSha256].includes(hash(Buffer.from(JSON.stringify(inventory(installed))))))
  for (const file of library.files) {
    assert.equal(hash(Buffer.from(file.contentBase64, 'base64')), file.patchedSha256)
    assert.equal(Buffer.byteLength(patched.get(file.path)), file.patchedBytes)
  }
  const segment = new (require('minimatch').Minimatch)('*.js').set[0][0]
  assert.equal(segment.pattern, '*.js')
  assert.equal(segment instanceof RegExp, false)
  assert.equal(segment[Symbol.match], undefined)
  assert.equal(segment.test('index.js'), true)
  assert.equal(segment.test('notes.txt'), false)
})

test('unmodified glob7 fails and changing only the pattern field still gives incorrect matches', () => {
  const directory = fixture()
  try {
    // Reconstruct the exact published preimage from the two reviewed changes.
    const original = new Map([...patched].map(([file, source]) => [file, source.replace('var rawGlob = pn.pattern', 'var rawGlob = pn._glob').replace('m = !pn.test(e)', 'm = !e.match(pn)').replace('m = pn.test(e)', 'm = e.match(pn)')]))
    for (const file of library.files) assert.equal(hash(Buffer.from(original.get(file.path))), file.originalSha256)
    assert.throws(() => isolatedGlob(original).sync('src/*.js', { cwd: directory, nodir: true }), /charAt/)
    const partial = new Map([...original].map(([file, source]) => [file, source.replace('var rawGlob = pn._glob', 'var rawGlob = pn.pattern')]))
    assert.notDeepEqual(normalize(isolatedGlob(partial).sync('src/*.js', { cwd: directory, nodir: true })), allJs.filter(file => !file.includes('/nested/')))
  } finally { removeFixture(directory) }
})

test('the exact compatibility payload preserves sync and callback matching across the fixture matrix', async () => {
  const glob = isolatedGlob(patched), directory = fixture()
  try {
    assert.equal(typeof glob, 'function')
    for (const [label, pattern, options, expected] of cases) {
      assert.deepEqual(normalize(glob.sync(pattern, { cwd: directory, ...options })), [...expected].sort(), 'sync: ' + label)
      const files = await new Promise((resolve, reject) => glob(pattern, { cwd: directory, ...options }, (error, value) => error ? reject(error) : resolve(value)))
      assert.deepEqual(normalize(files), [...expected].sort(), 'callback: ' + label)
    }
    const instance = new glob.Glob('src/*.js', { cwd: directory, nodir: true })
    const files = await new Promise((resolve, reject) => instance.on('error', reject).on('end', resolve))
    assert.deepEqual(normalize(files), allJs.filter(file => !file.includes('/nested/')))
  } finally { removeFixture(directory) }
})

test('all eight compatibility copies are prepared atomically and no partial, substituted or unsafe payload is accepted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'football-glob-writes-'))
  try {
    const copies = record.targets.filter(item => item.name === 'glob').map((item, index) => {
      const dir = path.join(directory, String(index))
      fs.cpSync(installed, dir, { recursive: true })
      // Restore only the exact original bytes inside isolated test copies.
      for (const file of library.files) {
        const source = patched.get(file.path).replace('var rawGlob = pn.pattern', 'var rawGlob = pn._glob').replace('m = !pn.test(e)', 'm = !e.match(pn)').replace('m = pn.test(e)', 'm = e.match(pn)')
        assert.equal(hash(Buffer.from(source)), file.originalSha256)
        fs.writeFileSync(path.join(dir, file.path), source)
      }
      const treeSha256 = hash(Buffer.from(JSON.stringify(inventory(dir))))
      assert.equal(treeSha256, item.originalTreeSha256)
      return { target: item, dir, treeSha256 }
    })
    assert.equal(copies.length, 8)
    const writes = prepareWrites(record, payload, copies)
    assert.equal(writes.length, 16)
    for (const mutate of [
      value => value.libraries.find(item => item.name === 'glob').files.pop(),
      value => { value.libraries.find(item => item.name === 'glob').files[0].contentBase64 = Buffer.from('substituted').toString('base64') },
      value => { value.libraries.find(item => item.name === 'glob').files[0].path = '../glob.js' },
    ]) {
      const altered = structuredClone(payload); mutate(altered)
      assert.throws(() => prepareWrites(record, altered, copies))
    }
    assert.throws(() => prepareWrites(record, payload, copies.map(copy => ({ ...copy, target: { ...copy.target, patchedTreeSha256: '0'.repeat(64) } }))), /Prospective postimage/)
    for (const copy of copies) assert.equal(hash(Buffer.from(JSON.stringify(inventory(copy.dir)))), copy.target.originalTreeSha256)
    for (const item of writes) fs.writeFileSync(item.destination, item.content)
    for (const copy of copies) assert.equal(hash(Buffer.from(JSON.stringify(inventory(copy.dir)))), copy.target.patchedTreeSha256)
    const installedCopies = copies.map(copy => ({ ...copy, treeSha256: copy.target.patchedTreeSha256 }))
    assert.deepEqual(prepareWrites(record, payload, installedCopies), [])
  } finally { removeFixture(directory) }
})

test('glob compatibility grants no acceptance for minimatch, glob or any new advisory', () => {
  for (const name of ['glob', 'minimatch']) {
    const audit = { auditReportVersion: 2, vulnerabilities: { [name]: { name, severity: 'moderate', via: [{ name, severity: 'moderate', url: 'https://github.com/advisories/' + (name === 'glob' ? 'GHSA-3g3m-2fjr-6pw4' : 'GHSA-g3hv-75wg-m249') }], nodes: ['node_modules/' + name] } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 } } }
    const result = evaluateAudit(audit, { packages: { ['node_modules/' + name]: { version: name === 'glob' ? '7.2.3' : '11.0.3' } } }, '.', record)
    assert.ok(result.failures.some(value => value.includes('Unaccepted advisory')))
    assert.deepEqual(result.acceptedSourceRemediations, [])
  }
})
