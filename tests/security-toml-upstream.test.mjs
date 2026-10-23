import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const toml = require('toml')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))

test('root and Netlify bundler use the same official patched TOML package', () => {
  const bundlerRequire = createRequire(require.resolve('@netlify/zip-it-and-ship-it'))
  assert.equal(packageJson.devDependencies.toml, '5.0.1')
  assert.equal(packageJson.overrides.toml, '5.0.1')
  assert.equal(lock.packages['node_modules/toml'].version, '5.0.1')
  assert.equal(require.resolve('toml'), bundlerRequire.resolve('toml'))
  assert.equal(Object.keys(lock.packages).filter(key => /(?:^|\/)node_modules\/toml$/.test(key)).length, 1)
})

test('real Netlify configuration and Cargo package metadata retain their parsed values', () => {
  const config = toml.parse(readFileSync('netlify.toml', 'utf8'))
  assert.equal(config.functions.directory, 'netlify/functions')
  assert.equal(config.build.publish, 'dist')
  const cargo = toml.parse('[package]\nname = "fixture-function"\nversion = "1.0.0"\nedition = "2021"\n[dependencies]\nserde = "1"\n')
  assert.equal(cargo.package.name, 'fixture-function')
  assert.equal(cargo.dependencies.serde, '1')
  const values = toml.parse('enabled = true\ncount = 42\nvalues = [1, 2, 3]\n')
  assert.deepEqual({ ...values }, { enabled: true, count: 42, values: [1, 2, 3] })
  assert.equal(Object.getPrototypeOf(values), null)
  assert.throws(() => toml.parse('value = 1\nvalue = 2\n'))
  assert.throws(() => toml.parse('value = 9007199254740992\n'), /integer|safe|range/i)
})

test('prototype-shaped keys remain isolated parsed data', () => {
  const data = toml.parse('__proto__.polluted = true\nconstructor.prototype.injected = true\n')
  assert.equal(data.__proto__.polluted, true)
  assert.equal(data.constructor.prototype.injected, true)
  assert.equal(Object.getPrototypeOf(data), null)
  assert.equal(Object.prototype.polluted, undefined)
  assert.equal(Object.prototype.injected, undefined)
})

function boundedParse(source) {
  return JSON.parse(execFileSync(process.execPath, ['-e', source], { timeout: 10000, encoding: 'utf8', maxBuffer: 1024 * 1024 }))
}

test('many distinct array-of-table headers finish within a bounded child process', () => {
  const result = boundedParse(`const t=require('toml');const data=t.parse(Array.from({length:20000},(_,i)=>'[[entry'+i+']]\\nvalue=1').join('\\n'));console.log(JSON.stringify({count:Object.keys(data).length,last:data.entry19999[0].value}))`)
  assert.deepEqual(result, { count: 20000, last: 1 })
})

test('deep dotted paths finish within a bounded child process without stack exhaustion', () => {
  const result = boundedParse(`const t=require('toml');const data=t.parse(Array(20001).fill('a').join('.')+'=1');let leaf=data;for(let i=0;i<20001;i++)leaf=leaf.a;console.log(JSON.stringify({leaf}))`)
  assert.deepEqual(result, { leaf: 1 })
})

test('a million-digit integer is rejected within a bounded child process', () => {
  const result = boundedParse(`const t=require('toml');let rejected=false;try{t.parse('value='+ '1'.repeat(1000000))}catch(e){if(!/integer.*range/i.test(e.message))throw e;rejected=true}console.log(JSON.stringify({rejected}))`)
  assert.deepEqual(result, { rejected: true })
})
