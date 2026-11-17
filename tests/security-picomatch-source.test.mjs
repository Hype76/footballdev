import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const record = JSON.parse(fs.readFileSync('security/reviewed-source-remediations.json'))
const payload = JSON.parse(fs.readFileSync('security/patches/reviewed-source-manifest.json'))
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'football-picomatch-source-'))
const hash = value => createHash('sha256').update(value).digest('hex')
const variants = new Map()

for (const target of record.targets.filter(item => item.name === 'picomatch')) {
  if (variants.has(target.version)) continue
  const source = path.resolve(target.scope, target.packagePath)
  const original = path.join(temporary, target.version, 'original')
  const patched = path.join(temporary, target.version, 'patched')
  fs.cpSync(source, original, { recursive: true })
  fs.cpSync(source, patched, { recursive: true })
  const library = payload.libraries.find(item => item.name === 'picomatch' && item.version === target.version)
  for (const file of library.files) {
    const before = Buffer.from(file.originalContentBase64, 'base64')
    const after = Buffer.from(file.contentBase64, 'base64')
    assert.equal(hash(before), file.originalSha256)
    assert.equal(hash(after), file.patchedSha256)
    fs.writeFileSync(path.join(original, file.path), before)
    fs.writeFileSync(path.join(patched, file.path), after)
  }
  variants.set(target.version, { original, patched })
}

test.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

for (const [version, directories] of variants) {
  test(version + ' reproduces original wildcard, bracket, brace and ambiguous-alternative failures in bounded processes', () => {
    const attacks = [
      { pattern: '+(*a)', input: 'a'.repeat(42) + '!' },
      { pattern: '+([[]*a)', input: '[a'.repeat(26) + '!' },
      { pattern: '+({a,aa})b', input: 'a'.repeat(42) + '!' },
      { pattern: '+(ab|abab)c', input: 'ab'.repeat(42) + '!' },
    ]
    for (const attack of attacks) {
      const result = spawnSync(process.execPath, ['-e', `
        const match = require(process.argv[1])
        match.isMatch(process.argv[3], process.argv[2])
      `, directories.original, attack.pattern, attack.input], { encoding: 'utf8', timeout: 1500 })
      assert.equal(result.error?.code, 'ETIMEDOUT', attack.pattern)
    }
  })

  test(version + ' prevents repeated wildcard and nested-group backtracking', () => {
    const patterns = [
      '+(*)b', '+(*a)', '*(*)b', '*(*a)', '+(a*)b', '+(a*b*)',
      '+(@(*a))', '+(a*(a))', '+(@(*(a)))', '+(@(a|aa))', '+(a?(a))',
      '+([[]*a)', '+([[]a*)b', '+([[]*)b', '+([[]*a|x)',
      '+({a,aa})b', '*({a,aa})b', '+([[:alpha:]]*a)b',
      '+(a|a?)b', '+([a]|aa)b', '+(a|a[a])b', '+([a]|[a][a])b',
      '+(ab|abab)c',
      '+("a"|a)b', '+("ab"|ab)c',
      '+([a[]|aa)b', '+([a[]|a[a])b',
      '+([a]+)b', '+(a+)b',
    ]
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict')
      const match = require(process.argv[1])
      const patterns = JSON.parse(process.argv[2])
      for (const pattern of patterns) {
        for (const repeated of ['a', '[a', ']a', 'ab']) {
          assert.equal(match.isMatch(repeated.repeat(256) + '!', pattern), false, pattern)
        }
      }
      assert.equal(match.isMatch('[a'.repeat(256) + '!', '+([*]a)', { nobracket: true }), false)
      assert.equal(match.isMatch('a'.repeat(256) + '!', '+(a|A)b', { nocase: true }), false)
      assert.equal(match.isMatch('a'.repeat(256) + '!', '+(a|A)b', { flags: 'i' }), false)
      assert.equal(match.isMatch('a'.repeat(256) + '!', '+([a]+)b', { regex: true }), false)
    `, directories.patched, JSON.stringify(patterns)], { encoding: 'utf8', timeout: 2000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
  })

  test(version + ' preserves ordinary glob and supported non-risky extglob results', () => {
    const before = require(directories.original)
    const after = require(directories.patched)
    const patterns = [
      '*.js', '**/*.js', 'src/**/!(*.test).js', '**/*.{js,jsx,ts,tsx}',
      '**/node_modules/**', '!**/*.test.js', '@(src|tests)/*.js',
      '+(abc)', '*(foo|bar)', '?(foo)', '!(foo)', '+([ab])', '+(a?)',
      '+(a\\*b)', '+("a*b")', '+([*])', '+(*(a))', '+(*(a)*(b))',
      '+([[])', '+([a-z])', '+([[:alpha:]])', '+([^a])', '+(\\{a,b\\})',
      '*(foo|bar|baz)', '+(ab|cd)', '*(a|bb)', '*(Foo|bAR)',
    ]
    const names = [
      '', 'a', 'aaa', 'ab', 'abc', 'abcabc', 'foo', 'foobar', 'barfoo',
      '*', '**', 'a*b', 'a*ba*b', 'a.js', 'a.test.js', 'src/index.js',
      '[', '[[', ']', '[a]', 'a[]', 'a{b}', '{a,b}', '{a,b}{a,b}',
      'abcd', 'ababcd', 'bazfoobar', 'bbabb', 'FOObar',
      'src/nested/a.js', 'src/nested/a.test.js', 'tests/spec.ts',
      'node_modules/glob/index.js', 'a/b/c.tsx', '.hidden.js', 'a'.repeat(64),
    ]
    for (const pattern of patterns) {
      for (const name of names) {
        for (const options of [{}, { dot: true }, { nocase: true }, { noext: true }]) {
          assert.equal(after.isMatch(name, pattern, options), before.isMatch(name, pattern, options), JSON.stringify({ pattern, name, options }))
        }
      }
    }
  })
}

test('all eleven exact picomatch copies are included in source verification', () => {
  const actual = record.targets.filter(item => item.name === 'picomatch')
  assert.equal(actual.length, 11)
  assert.deepEqual([...new Set(actual.map(item => item.version))].sort(), ['2.3.2', '4.0.4'])
  for (const target of actual) {
    assert.equal(target.mode, 'reviewed-source')
    assert.deepEqual(target.files.map(file => file.path), ['lib/parse.js'])
  }
})
