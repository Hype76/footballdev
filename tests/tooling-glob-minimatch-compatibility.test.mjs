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

test('official tooling updates preserve direct app dependencies and every unrelated package artifact', () => {
  for (const scope of ['.', 'apps/coach-mobile', 'apps/parent-mobile']) {
    const prefix = scope === '.' ? '' : `${scope}/`
    const previous = file => JSON.parse(execFileSync('git', ['show', `${baseline}:${prefix}${file}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))
    const before = previous('package.json')
    const current = JSON.parse(fs.readFileSync(`${prefix}package.json`))
    const { overrides: oldOverrides, ...oldPackage } = before
    const { overrides, ...newPackage } = current
    assert.deepEqual(newPackage, oldPackage, `${scope} direct dependencies, scripts, engines and versions remain unchanged`)
    assert.deepEqual(overrides, { ...oldOverrides, minimatch: '11.0.3', 'glob@>=9.0.0 <=14.0.1': '14.0.3', ...(scope === '.' ? { '@eslint/config-array': '0.23.5' } : { 'test-exclude': '8.0.0' }) })
    const oldLock = previous('package-lock.json').packages
    const newLock = JSON.parse(fs.readFileSync(`${prefix}package-lock.json`)).packages
    for (const file of new Set([...Object.keys(oldLock), ...Object.keys(newLock)])) {
      if (!file) continue
      const old = oldLock[file], next = newLock[file]
      if (old?.version === next?.version && old?.integrity === next?.integrity) continue
      const name = file.split('node_modules/').at(-1)
      assert.ok(toolingPackages.has(name), `Unexpected package artifact change: ${scope}/${file}`)
      for (const entry of [old, next].filter(Boolean)) {
        assert.notEqual(entry.hasInstallScript, true, `${name} cannot add native installation scripts`)
        assert.equal(entry.os, undefined)
        assert.equal(entry.cpu, undefined)
      }
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
      assert.equal(require('minimatch/package.json').version, '11.0.3')
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
