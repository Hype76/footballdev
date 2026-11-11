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

function applyApprovedXmlParserDelta(pkg, lock) {
  pkg.dependencies['fast-xml-parser'] = '5.12.0'
  lock.packages[''].dependencies['fast-xml-parser'] = '5.12.0'
  const packages = [
    ['@nodable/entities', '3.1.0', 'LsS/DjHr+uDM647Gru/cA8+J3a3HfhttwCKLyuoyN7yXTFCxKBtSgMQBvrW9yNPa2/zDRUNuGPaH5QUFoa4arQ=='],
    ['fast-xml-builder', '1.3.1', 'pIM/1n3ntFXKYrUZwW7QCK0gAW7XY+wzj1YMIV3tLDvPj/V+zTGJK5e3/4WJfwj0qWw2ElNXiTixda/R+3YSug=='],
    ['fast-xml-parser', '5.12.0', '/pXxRBtwxY9w8z7YbgsvIPPcPvFDsTbIkWwTQJhzNJPokj+TbN6ftmcv4j/pEQDvOCNnKGDzuk5Bo2oogIOiFg=='],
    ['is-unsafe', '2.0.3', 'ZBllczCCO267vgdFb6Tq3pv+LhHaCiGMdr+ZsuL+OopruAg7S+3ZDs1vD0RPC0uSrkjzbraxaGjtX1YBxjPeFQ=='],
    ['strnum', '2.5.1', 'UM4nTLWzQiDBseVxUGxN0wJzIk0UU89Qi7pKXz9qISo+lhviJikTuikBsK/oFRlpvYHvSdz0TVoLyQ+sEpYwxA=='],
  ]
  for (const [name, version, integrity] of packages) {
    Object.assign(lock.packages[`node_modules/${name}`], {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`,
      integrity: `sha512-${integrity}`,
    })
  }
  Object.assign(lock.packages['node_modules/fast-xml-parser'].dependencies, {
    '@nodable/entities': '^3.1.0',
    'fast-xml-builder': '^1.3.1',
    'is-unsafe': '^2.0.3',
    strnum: '^2.5.1',
  })
}

function applyApprovedCoachFileTools(pkg, lock) {
  const packages = [
    ['expo-document-picker', '14.0.8', '3tyQKpPqWWFlI8p9RiMX1+T1Zge5mEKeBuXWp1h8PEItFMUDSiOJbQ112sfdC6Hxt8wSxreV9bCRl/NgBdt+fA=='],
    ['expo-image-loader', '6.0.0', 'nKs/xnOGw6ACb4g26xceBD57FKLFkSwEUTDXEDF3Gtcu3MqF3ZIYd3YM+sSb1/z9AKV1dYT7rMSGVNgsveXLIQ=='],
    ['expo-image-picker', '17.0.11', '/apkoyukDvsCHHb9fzP+F34A1uQqSzUtYH/2P/xJACNEwq+mwEXjXvVU8bzlJq6ih0Qo1+tpVivIa7B9kYSwOQ=='],
    ['expo-sharing', '14.0.8', 'A1pPr2iBrxypFDCWVAESk532HK+db7MFXbvO2sCV9ienaFXAk7lIBm6bkqgE6vzRd9O3RGdEGzYx80cYlc089Q=='],
  ]
  for (const [name, version, integrity] of packages) {
    if (name !== 'expo-image-loader') {
      pkg.dependencies[name] = version
      lock.packages[''].dependencies[name] = version
    }
    const lockPath = `node_modules/${name}`
    assert.equal(lock.packages[lockPath], undefined)
    lock.packages[lockPath] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
      integrity: `sha512-${integrity}`,
      license: 'MIT',
      ...(name === 'expo-image-picker' ? { dependencies: { 'expo-image-loader': '~6.0.0' } } : {}),
      peerDependencies: { expo: '*' },
    }
  }
}

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
    if (scope === '.') applyApprovedXmlParserDelta(before, previousLock)
    if (scope === 'apps/coach-mobile') {
      applyApprovedCoachNativeDelta(before, previousLock)
      applyApprovedCoachFileTools(before, previousLock)
    }
    if (scope !== '.') applyLiveMatchDelta(before)
    const current = JSON.parse(fs.readFileSync(`${prefix}package.json`))
    const { overrides: oldOverrides, ...oldPackage } = before
    const { overrides, ...newPackage } = current
    assert.deepEqual(newPackage, oldPackage, `${scope} direct dependencies and scripts match the exact mobile feature additions`)
    assert.deepEqual(overrides, { ...oldOverrides, minimatch: '11.0.8', 'glob@>=9.0.0 <=14.0.1': '14.0.4', ...(scope === '.' ? { '@eslint/config-array': '0.23.5' } : { 'test-exclude': '8.0.0', 'node-forge': '1.4.3' }) })
    const oldLock = previousLock.packages
    const newLock = JSON.parse(fs.readFileSync(`${prefix}package-lock.json`)).packages
    for (const file of new Set([...Object.keys(oldLock), ...Object.keys(newLock)])) {
      if (!file) continue
      const old = oldLock[file], next = newLock[file]
      if (old?.version === next?.version && old?.integrity === next?.integrity) continue
      const name = file.split('node_modules/').at(-1)
      assert.ok(toolingPackages.has(name) || liveMatchPackages.has(name) || scope !== '.' && name === 'node-forge' || file === '../mobile-core/modules/live-match', `Unexpected package artifact change: ${scope}/${file}`)
      if (name === 'node-forge') {
        assert.equal(next.version, '1.4.3')
        assert.equal(next.integrity, 'sha512-P6wzfh6t70avmV8FrVEAd/36sOPJQ+hkaJVX1Laap9J/77m7M0eyozDvc8SwnDf4P7MP94gwbAAo0rg3YVXT+g==')
      }
      for (const entry of [old, next].filter(Boolean)) {
        assert.notEqual(entry.hasInstallScript, true, `${name} cannot add native installation scripts`)
        assert.equal(entry.os, undefined)
        assert.equal(entry.cpu, undefined)
      }
    }
  }
})

test('the current glob and minimatch update changes only reviewed tooling packages', () => {
  const candidate = '9ab4fe99cc751990976afc7a5041c5c6f6901147'
  const changedPackages = new Set(['node_modules/glob', 'node_modules/minimatch', 'node_modules/@isaacs/nonrecursive-glob-match'])
  for (const scope of ['.', 'apps/coach-mobile', 'apps/parent-mobile']) {
    const prefix = scope === '.' ? '' : `${scope}/`
    const oldPackage = JSON.parse(execFileSync('git', ['show', `${candidate}:${prefix}package.json`], { encoding: 'utf8' }))
    const newPackage = JSON.parse(fs.readFileSync(`${prefix}package.json`))
    const oldLock = JSON.parse(execFileSync('git', ['show', `${candidate}:${prefix}package-lock.json`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))
    if (scope === '.') applyApprovedXmlParserDelta(oldPackage, oldLock)
    if (scope === 'apps/coach-mobile') applyApprovedCoachFileTools(oldPackage, oldLock)
    oldPackage.overrides.minimatch = '11.0.8'
    oldPackage.overrides['glob@>=9.0.0 <=14.0.1'] = '14.0.4'
    assert.deepEqual(newPackage, oldPackage)
    const newLock = JSON.parse(fs.readFileSync(`${prefix}package-lock.json`))
    assert.deepEqual(Object.keys(newLock.packages).sort(), Object.keys(oldLock.packages).sort(), `${scope}: dependency set changed`)
    for (const [name, entry] of Object.entries(newLock.packages)) {
      if (!changedPackages.has(name)) assert.deepEqual(entry, oldLock.packages[name], `${scope}: unrelated dependency changed at ${name}`)
      if (name.endsWith('/glob')) assert.ok(['7.2.3', '14.0.4'].includes(entry.version), `${scope}: affected glob version at ${name}`)
    }
    assert.equal(newLock.packages['node_modules/glob'].version, '14.0.4')
    assert.equal(newLock.packages['node_modules/minimatch'].version, '11.0.8')
    assert.equal(newLock.packages['node_modules/@isaacs/nonrecursive-glob-match'].version, '1.1.0')
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
          assert.equal(pkg.version, '14.0.4', 'Modern glob entrypoints must use the official fixed release')
          assert.deepEqual(normalize(glob.globSync('src/**/*.js', options)), expectedFiles)
          assert.deepEqual(normalize(await glob.glob('src/**/*.js', options)), expectedFiles)
          const controller = new AbortController()
          controller.abort(new Error('Fixture walk cancelled'))
          await assert.rejects(glob.glob('src/**/*.js', { ...options, signal: controller.signal }), /cancelled/)
        }
      }
      const minimatch = require('minimatch')
      assert.equal(require('minimatch/package.json').version, '11.0.8')
      assert.equal(minimatch.minimatch('src/index.js', 'src/**/*.js'), true)
      assert.equal(new minimatch.Minimatch('src/**/*.js').match('src/nested/player.js'), true)
      assert.equal(new minimatch.Minimatch('src/**/*.js').match('src/notes.txt'), false)
      for (const options of [{}, { windowsPathsNoEscape: true }, { magicalBraces: true }, { windowsPathsNoEscape: true, magicalBraces: true }]) {
        for (const literal of ['!secret.txt', '#notes.md']) {
          const pattern = minimatch.escape(literal, options)
          assert.equal(minimatch.minimatch(literal, pattern, options), true)
          assert.equal(minimatch.minimatch('other.txt', pattern, options), false)
        }
      }
      assert.throws(() => new minimatch.Minimatch('@('.repeat(300) + 'a' + ')'.repeat(300)), /too many extglobs/)
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

test('large compiled patterns do not exhaust a constrained heap', () => {
  const source = `
    const { minimatch } = require('minimatch')
    for (let index = 0; index < 30; index++) {
      if (minimatch('a/b', '{a,b}/'.repeat(13) + '*' + index)) throw new Error('Unexpected match')
    }
  `
  execFileSync(process.execPath, ['--max-old-space-size=64', '-e', source], { cwd: root, timeout: 120000 })
})

test('the installed ESLint flat-configuration dependency supports its public ESM import', async () => {
  const { ConfigArray } = await import('@eslint/config-array')
  const config = new ConfigArray([{ files: ['**/*.js'] }], { basePath: root })
  await config.normalize()
  assert.equal(config.isFileIgnored(path.join(root, 'src', 'index.js')), false)
})
