import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { prepareStoreToolchain } from '../apps/scripts/mobile-eas-toolchain.mjs'

test('both store profiles pin Node and run the shared hook without changing clean install', () => {
  for (const role of ['parent', 'coach']) {
    const base = `apps/${role}-mobile/`
    const eas = JSON.parse(fs.readFileSync(base + 'eas.json'))
    const pkg = JSON.parse(fs.readFileSync(base + 'package.json'))
    assert.equal(eas.build['store-live'].node, '22.17.0')
    assert.equal(eas.build['store-live'].npm, undefined)
    assert.equal(pkg.scripts['eas-build-pre-install'], 'node ../scripts/mobile-eas-toolchain.mjs')
  }
})

test('store hook upgrades default npm before verifying the installed version', () => {
  const calls = []
  let installed = false
  prepareStoreToolchain({ profile: 'store-live', nodeVersion: '22.17.0', run: args => {
    calls.push(args)
    if (args[0] === 'install') { installed = true; return '' }
    return installed ? '11.7.0\n' : '10.9.3\n'
  } })
  assert.deepEqual(calls, [['--version'], ['install', '--global', 'npm@11.7.0', '--no-audit', '--no-fund'], ['--version']])
})

test('store hook fails closed on wrong Node, installation failure or unchanged npm', () => {
  assert.throws(() => prepareStoreToolchain({ profile: 'store-live', nodeVersion: '20.19.4', run: () => assert.fail('must not install') }), /Node22/)
  assert.throws(() => prepareStoreToolchain({ profile: 'store-live', nodeVersion: '22.17.0', run: args => { if (args[0] === 'install') throw new Error('install failed'); return '10.9.3' } }), /install failed/)
  assert.throws(() => prepareStoreToolchain({ profile: 'store-live', nodeVersion: '22.17.0', run: () => '10.9.3' }), /npm11/)
})

test('approved npm needs no install; other profiles retain their current behaviour', () => {
  const calls = []
  prepareStoreToolchain({ profile: 'store-live', nodeVersion: '22.17.0', run: args => { calls.push(args); return '11.7.0' } })
  assert.deepEqual(calls, [['--version'], ['--version']])
  prepareStoreToolchain({ profile: 'internal', run: () => assert.fail('unrelated profile') })
})
