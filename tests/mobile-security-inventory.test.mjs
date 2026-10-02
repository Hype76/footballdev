import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { inventory, packageName, sha256, sourcePaths } from '../apps/scripts/mobile-security-inventory.mjs'

test('inventory identifies packages across nested and scoped dependency paths', () => {
  assert.equal(packageName('E:/app/node_modules/expo/node_modules/undici/lib/index.js'), 'undici')
  assert.equal(packageName('E:/app/node_modules/@expo/code-signing-certificates/build/main.js'), '@expo/code-signing-certificates')
  assert.equal(packageName('E:/app/src/node-forge-reference.js'), null)
})

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'mobile-inventory-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const artifacts = ['ios', 'android', 'web'].map((platform) => {
    const bundle = `_expo/static/js/${platform}/index.${platform === 'web' ? 'js' : 'hbc'}`
    mkdirSync(resolve(root, `_expo/static/js/${platform}`), {recursive: true})
    writeFileSync(resolve(root, bundle), `bundle ${platform}`)
    writeFileSync(resolve(root, bundle + '.map'), JSON.stringify({version: 3, file: 'index.' + (platform === 'web' ? 'js' : 'hbc'), sources: [`/app/node_modules/example/${platform}.js`]}))
    return {platform, bundle, sourceMap: bundle + '.map', bundleSha256: sha256(readFileSync(resolve(root, bundle))), sourceMapSha256: sha256(readFileSync(resolve(root, bundle + '.map')))}
  })
  const metadata = {fileMetadata: Object.fromEntries(artifacts.filter((a) => a.platform !== 'web').map((a) => [a.platform, {bundle: a.bundle}]))}
  writeFileSync(resolve(root, 'metadata.json'), JSON.stringify(metadata))
  const manifest = {schemaVersion: 1, sourceCommit: 'a'.repeat(40), runtimeVersion: '1.0.22', appVersion: '1.0.22', runtimePolicy: 'appVersion', resolvedRuntimeVersions: {ios: '1.0.22', android: '1.0.22'}, metadataSha256: sha256(readFileSync(resolve(root, 'metadata.json'))), artifacts}
  const expected = {manifestPath: resolve(root, 'manifest.json'), sourceCommit: 'a'.repeat(40), runtimeVersion: '1.0.22', appVersion: '1.0.22', runtimePolicy: 'appVersion', platforms: ['ios', 'android', 'web']}
  const save = () => {writeFileSync(expected.manifestPath, JSON.stringify(manifest)); expected.manifestSha256 = sha256(readFileSync(expected.manifestPath))}
  save()
  return {root, manifest, expected, save}
}

test('complete paired export hashes are required and reported', (t) => {
  const {root, expected} = fixture(t), result = inventory(root, expected)
  assert.deepEqual(result.map((a) => a.platform), ['ios', 'android', 'web'])
  assert.ok(result.every((a) => a.bundleSha256 && a.sourceMapSha256 && a.sourceCommit === expected.sourceCommit && a.manifestSha256 === expected.manifestSha256))
})

test('missing bundle and missing map both fail closed', (t) => {
  for (const suffix of ['', '.map']) {
    const {root, expected, manifest} = fixture(t)
    unlinkSync(resolve(root, manifest.artifacts[0].bundle + suffix))
    assert.throws(() => inventory(root, expected), /Missing paired|incomplete/)
  }
})

test('tampered bundle or source map rejects the recorded pair', (t) => {
  for (const suffix of ['', '.map']) {
    const {root, expected, manifest} = fixture(t)
    writeFileSync(resolve(root, manifest.artifacts[0].bundle + suffix), 'tampered')
    assert.throws(() => inventory(root, expected), /hash mismatch/)
  }
})

test('wrong expected commit, runtime, appVersion, policy or platform set is rejected', (t) => {
  const {root, expected} = fixture(t)
  for (const change of [{sourceCommit: 'b'.repeat(40)}, {runtimeVersion: '1.0.23'}, {appVersion: '1.0.23'}, {runtimePolicy: 'explicit'}, {platforms: ['ios', 'android']}]) {
    assert.throws(() => inventory(root, {...expected, ...change}), /mismatch|incomplete/)
  }
})

test('incomplete, duplicated and extra export sets cannot claim completeness', (t) => {
  const {root, expected, manifest, save} = fixture(t)
  manifest.artifacts.pop(); save()
  assert.throws(() => inventory(root, expected), /incomplete/)
  manifest.artifacts.push(manifest.artifacts[0]); save()
  assert.throws(() => inventory(root, expected), /duplicated/)
})

test('map identity and cross-platform pair mismatches reject', (t) => {
  const {root, expected, manifest, save} = fixture(t)
  const mapPath = resolve(root, manifest.artifacts[0].sourceMap)
  const map = JSON.parse(readFileSync(mapPath)); map.file = 'wrong.hbc'
  writeFileSync(mapPath, JSON.stringify(map)); manifest.artifacts[0].sourceMapSha256 = sha256(readFileSync(mapPath)); save()
  assert.throws(() => inventory(root, expected), /bundle identity/)
  manifest.artifacts[0].platform = 'android'; manifest.artifacts[1].platform = 'ios'; save()
  assert.throws(() => inventory(root, expected), /platform|pair/)
})

test('manifest/metadata tampering and absent trusted expectations reject', (t) => {
  const {root, expected, manifest} = fixture(t)
  assert.throws(() => inventory(root), /Trusted manifest/)
  writeFileSync(expected.manifestPath, JSON.stringify({...manifest, sourceCommit: 'b'.repeat(40)}))
  assert.throws(() => inventory(root, expected), /manifest hash/)
  writeFileSync(expected.manifestPath, JSON.stringify(manifest))
  writeFileSync(resolve(root, 'metadata.json'), '{}')
  assert.throws(() => inventory(root, expected), /metadata hash/)
})

test('explicit reviewed runtime may differ from appVersion without inventing compatibility', (t) => {
  const {root, expected, manifest, save} = fixture(t)
  manifest.runtimeVersion = '1.0.23'; manifest.runtimePolicy = 'explicit'; manifest.resolvedRuntimeVersions = {ios: '1.0.23', android: '1.0.23'}; save()
  const result = inventory(root, {...expected, runtimeVersion: '1.0.23', runtimePolicy: 'explicit'})
  assert.equal(result[0].runtimeVersion, '1.0.23'); assert.equal(result[0].appVersion, '1.0.22')
})

test('indexed source maps include every section and resolve source roots', () => {
  const sources = sourcePaths({ sections: [
    { map: { sourceRoot: 'E:\\app', sources: ['node_modules/node-forge/lib/rsa.js'] } },
    { map: { sources: ['/app/node_modules/expo/build/Expo.js'] } },
  ] })
  assert.deepEqual(sources.map(packageName), ['node-forge', 'expo'])
})

test('missing source-map inventories fail rather than implying no exposure', () => {
  assert.throws(() => sourcePaths({ version: 3, sources: [] }), /no module inventory/)
  assert.throws(() => sourcePaths({ version: 3 }), /no module inventory/)
  assert.throws(() => sourcePaths({ version: 3, sections: [] }), /no module inventory/)
})
