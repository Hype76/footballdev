import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

const root = process.cwd()
const expectedFiles = ['src/index.js', 'src/nested/player.js']
const normalize = files => files.map(file => file.replaceAll('\\', '/')).sort()
const baseline = 'a891ce5fea782b6f17052a1cee4c65c271717447'
const toolingPackages = new Set(['glob', 'minimatch', 'path-scurry', 'test-exclude', '@eslint/config-array', '@eslint/object-schema', '@isaacs/nonrecursive-glob-match', '@isaacs/cliui', 'balanced-match', 'brace-expansion', 'concat-map', 'foreground-child', 'jackspeak', 'package-json-from-dist'])
const liveMatchPackages = new Set(['expo-task-manager', 'football-player-live-match', 'react-native-widget-extension', 'unimodules-app-loader', '@expo/config-plugins', '@expo/config-types', '@expo/plist', '@expo/require-utils', 'semver', 'xcode', 'argparse', 'sprintf-js'])

function applyLiveMatchDelta(pkg) {
  if (pkg.name === 'parent-mobile') {
    pkg.version = '1.1.2'
    pkg.scripts.android = 'expo run:android'
    pkg.scripts.ios = 'expo run:ios'
  }
  pkg.scripts.postinstall = 'node ../scripts/mobile-apply-reviewed-glob-compat.mjs'
  pkg.dependencies['expo-task-manager'] = '~14.0.9'
  pkg.dependencies['football-player-live-match'] = 'file:../mobile-core/modules/live-match'
  pkg.dependencies['react-native-widget-extension'] = '^0.3.0'
}

function applyApprovedCoachNativeDelta(pkg, lock) {
  const nested = 'node_modules/expo/node_modules/expo-file-system'
  const direct = 'node_modules/expo-file-system'
  const entry = lock.packages[nested]
  assert.equal(entry?.version, '19.0.24')
  assert.equal(entry?.resolved, 'https://registry.npmjs.org/expo-file-system/-/expo-file-system-19.0.24.tgz')
  assert.equal(entry?.integrity, 'sha512-hZs0Ng+coNjx7YJ8MPwfJpoU1SRul6OZ9LZycFzozUeoR+denbyr944YrMP9NVn+Zf1tdC7p0K0zgah3ZySOYg==')
  assert.equal(lock.packages[direct], undefined)
  pkg.version = '1.1.2'
  assert.equal(pkg.scripts.android, 'expo start --android')
  assert.equal(pkg.scripts.ios, 'expo start --ios')
  pkg.scripts.android = 'expo start -a'
  pkg.scripts.ios = 'expo start -i'
  pkg.dependencies['expo-file-system'] = '19.0.24'
  lock.version = '1.1.2'
  lock.packages[''].version = '1.1.2'
  lock.packages[''].dependencies['expo-file-system'] = '19.0.24'
  lock.packages[direct] = entry
  delete lock.packages[nested]
}

test('official tooling updates preserve unrelated dependencies and the exact approved Coach native change', () => {
  for (const scope of ['.', 'apps/coach-mobile', 'apps/parent-mobile']) {
    const prefix = scope === '.' ? '' : `${scope}/`
    const previous = file => JSON.parse(execFileSync('git', ['show', `${baseline}:${prefix}${file}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))
    const before = previous('package.json')
    const previousLock = previous('package-lock.json')
    if (scope === 'apps/coach-mobile') applyApprovedCoachNativeDelta(before, previousLock)
    if (scope !== '.') applyLiveMatchDelta(before)
    const current = JSON.parse(fs.readFileSync(`${prefix}package.json`))
    const { overrides: oldOverrides, ...oldPackage } = before
    const { overrides, ...newPackage } = current
    assert.deepEqual(newPackage, oldPackage, `${scope} direct dependencies and scripts match the exact mobile feature additions`)
    assert.deepEqual(overrides, { ...oldOverrides, minimatch: '11.0.4', 'glob@>=9.0.0 <=14.0.1': '14.0.3', ...(scope === '.' ? { '@eslint/config-array': '0.23.5' } : { 'test-exclude': '8.0.0' }) })
    const oldLock = previousLock.packages
    const newLock = JSON.parse(fs.readFileSync(`${prefix}package-lock.json`)).packages
    for (const file of new Set([...Object.keys(oldLock), ...Object.keys(newLock)])) {
      if (!file) continue
      const old = oldLock[file], next = newLock[file]
      if (old?.version === next?.version && old?.integrity === next?.integrity) continue
      const name = file.split('node_modules/').at(-1)
      assert.ok(toolingPackages.has(name) || liveMatchPackages.has(name) || file === '../mobile-core/modules/live-match', `Unexpected package artifact change: ${scope}/${file}`)
      for (const entry of [old, next].filter(Boolean)) {
        assert.notEqual(entry.hasInstallScript, true, `${name} cannot add native installation scripts`)
        assert.equal(entry.os, undefined)
        assert.equal(entry.cpu, undefined)
      }
    }
  }
})

test('minimatch 11.0.4 changes only the official package identity and supported Node range', () => {
  const candidate = 'f05d42536d0893912c7c972f8363f304c6ba9384'
  for (const scope of ['.', 'apps/coach-mobile', 'apps/parent-mobile']) {
    const prefix = scope === '.' ? '' : `${scope}/`
    const oldPackage = JSON.parse(execFileSync('git', ['show', `${candidate}:${prefix}package.json`], { encoding: 'utf8' }))
    const newPackage = JSON.parse(fs.readFileSync(`${prefix}package.json`))
    const oldLock = JSON.parse(execFileSync('git', ['show', `${candidate}:${prefix}package-lock.json`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))
    if (scope === 'apps/coach-mobile') applyApprovedCoachNativeDelta(oldPackage, oldLock)
    if (scope !== '.') applyLiveMatchDelta(oldPackage)
    oldPackage.overrides.minimatch = '11.0.4'
    if (scope !== '.') {
      oldPackage.overrides['glob@>=9.0.0 <=14.0.1'] = '14.0.3'
      oldPackage.overrides['test-exclude'] = '8.0.0'
    }
    assert.deepEqual(newPackage, oldPackage)
    const newLock = JSON.parse(fs.readFileSync(`${prefix}package-lock.json`))
    const oldEntry = oldLock.packages['node_modules/minimatch']
    Object.assign(oldEntry, { version: '11.0.4', resolved: 'https://registry.npmjs.org/minimatch/-/minimatch-11.0.4.tgz', integrity: 'sha512-/UJ1dEoVQTjPNDh6SGlUo+ueLMmoHTas4q+8yaAR/5t6nLAIiBDJtoYUh20IYleix7ehiQkgczb84PE3uzHkxg==' })
    oldEntry.engines.node = '20 || >=22'
    assert.deepEqual(newLock.packages['node_modules/minimatch'], oldEntry, `${scope}: official minimatch identity changed`)
    assert.deepEqual(newLock.packages[''].dependencies, newPackage.dependencies, `${scope}: locked direct dependencies changed`)
    for (const [name, entry] of Object.entries(newLock.packages)) {
      if (name.endsWith('/glob')) assert.ok(['7.2.3', '14.0.3'].includes(entry.version), `${scope}: affected glob version at ${name}`)
    }
  }
})

for (const scope of ['.', 'apps/coach-mobile', 'apps/parent-mobile']) {
  test(`${scope} retains real legacy and modern glob consumers with official security updates`, async () => {
    const require = createRequire(path.resolve(root, scope, 'package.json'))
    const lock = JSON.parse(fs.readFileSync(path.resolve(root, scope, 'package-lock.json')))
    const modules = Object.entries(lock.packages).filter(([name]) => /(?:^|\/)node_modules\/glob$/.test(name))
    assert.ok(modules.length > 0)
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'football-tooling-compat-'))
    try {
      fs.mkdirSync(path.join(fixture, 'src', 'nested'), { recursive: true })
      fs.writeFileSync(path.join(fixture, 'src', 'index.js'), 'export const ready = true\n')
      fs.writeFileSync(path.join(fixture, 'src', 'nested', 'player.js'), 'export const player = true\n')
      fs.writeFileSync(path.join(fixture, 'src', 'index.test.js'), 'test fixture\n')
      const options = { cwd: fixture, nodir: true, ignore: ['**/*.test.js'] }
      for (const [relative, pkg] of modules) {
        const glob = require(path.resolve(root, scope, relative))
        if (pkg.version === '7.2.3') {
          assert.equal(typeof glob, 'function', 'Legacy callback consumers keep glob 7')
          assert.deepEqual(normalize(glob.sync('src/**/*.js', options)), expectedFiles)
          const files = await new Promise((resolve, reject) => glob('src/**/*.js', options, (error, result) => error ? reject(error) : resolve(result)))
          assert.deepEqual(normalize(files), expectedFiles)
        } else {
          assert.equal(pkg.version, '14.0.3', 'Modern glob entrypoints must use the official fixed release')
          assert.deepEqual(normalize(glob.globSync('src/**/*.js', options)), expectedFiles)
          assert.deepEqual(normalize(await glob.glob('src/**/*.js', options)), expectedFiles)
          const controller = new AbortController()
          controller.abort(new Error('Fixture walk cancelled'))
          await assert.rejects(glob.glob('src/**/*.js', { ...options, signal: controller.signal }), /cancelled/)
        }
      }
      const minimatch = require('minimatch')
      assert.equal(require('minimatch/package.json').version, '11.0.4')
      assert.equal(minimatch.minimatch('src/index.js', 'src/**/*.js'), true)
      assert.equal(new minimatch.Minimatch('src/**/*.js').match('src/nested/player.js'), true)
      assert.equal(new minimatch.Minimatch('src/**/*.js').match('src/notes.txt'), false)
      if (scope !== '.') {
        assert.equal(require('test-exclude/package.json').version, '8.0.0')
        const TestExclude = require('test-exclude')
        const exclude = new TestExclude({ cwd: fixture, include: ['src/**/*.js'], exclude: ['**/*.test.js'], extension: ['.js'] })
        assert.equal(exclude.shouldInstrument(path.join(fixture, 'src', 'index.js')), true)
        assert.equal(exclude.shouldInstrument(path.join(fixture, 'src', 'index.test.js')), false)
        assert.deepEqual(normalize(exclude.globSync()), expectedFiles)
        assert.deepEqual(normalize(await exclude.glob()), expectedFiles)
      }
    } finally {
      assert.ok(path.resolve(fixture).startsWith(path.resolve(os.tmpdir()) + path.sep))
      assert.ok(path.basename(fixture).startsWith('football-tooling-compat-'))
      fs.rmSync(fixture, { recursive: true, force: true })
    }
  })
}

test('the installed ESLint flat-configuration dependency supports its public ESM import', async () => {
  const { ConfigArray } = await import('@eslint/config-array')
  const config = new ConfigArray([{ files: ['**/*.js'] }], { basePath: root })
  await config.normalize()
  assert.equal(config.isFileIgnored(path.join(root, 'src', 'index.js')), false)
})
