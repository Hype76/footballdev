import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { isDeepStrictEqual } from 'node:util'

const root = process.cwd()
const expectedFiles = ['src/index.js', 'src/nested/player.js']
const normalize = files => files.map(file => file.replaceAll('\\', '/')).sort()
const previousIosRelease = 'a9de799a2fef0b5ac4915a3c1c3417f877354421'
const approvedSecuritySource = '5546191650cd90ac71b7db28bb8ad38d1be1ef3f'

function readGitJson(revision, file) {
  return JSON.parse(execFileSync('git', ['show', revision + ':' + file], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }))
}

test('iOS 1.1.1 keeps its native dependencies and adopts only the reviewed JavaScript packages', () => {
  for (const scope of ['.', 'apps/coach-mobile', 'apps/parent-mobile']) {
    const prefix = scope === '.' ? '' : scope + '/'
    const packagePath = prefix + 'package.json'
    const lockPath = prefix + 'package-lock.json'
    const expectedPackage = readGitJson(previousIosRelease, packagePath)
    const approvedPackage = readGitJson(approvedSecuritySource, packagePath)
    const overrideNames = ['minimatch', 'glob@>=9.0.0 <=14.0.1']
    if (scope !== '.') overrideNames.push('node-forge')
    for (const name of overrideNames) expectedPackage.overrides[name] = approvedPackage.overrides[name]

    const expectedLock = readGitJson(previousIosRelease, lockPath)
    const approvedLock = readGitJson(approvedSecuritySource, lockPath)
    const changedPackages = ['@isaacs/nonrecursive-glob-match', 'glob', 'minimatch']
    if (scope === '.') {
      expectedPackage.dependencies['fast-xml-parser'] = approvedPackage.dependencies['fast-xml-parser']
      expectedLock.packages[''].dependencies['fast-xml-parser'] = approvedPackage.dependencies['fast-xml-parser']
      changedPackages.push('@nodable/entities', 'fast-xml-builder', 'fast-xml-parser', 'is-unsafe', 'strnum')
    } else {
      changedPackages.push('brace-expansion', 'node-forge')
    }

    for (const name of changedPackages) {
      const key = 'node_modules/' + name
      const entry = name === 'brace-expansion' ? {
        ...expectedLock.packages[key],
        version: '5.0.13',
        resolved: 'https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.13.tgz',
        integrity: 'sha512-Vh3dmFbc4wZeox7M9I/0L9GfFd83Su4+yCck/OF9Gi/P/dAHn0RT7X4K9R7gMNMhDck3DvhR6QXsnQdjjgwNvQ==',
      } : approvedLock.packages[key]
      assert.ok(entry, name + ' must have an exact approved lock entry')
      assert.notEqual(entry.hasInstallScript, true)
      assert.equal(entry.os, undefined)
      assert.equal(entry.cpu, undefined)
      expectedLock.packages[key] = entry
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(packagePath, 'utf8')), expectedPackage, scope + ' manifest changed beyond the approved JavaScript scope')
    assert.ok(isDeepStrictEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), expectedLock), scope + ' lock changed beyond the approved JavaScript scope')
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
          assert.equal(pkg.version, '14.0.6', 'Modern glob entrypoints must use the official fixed release')
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
