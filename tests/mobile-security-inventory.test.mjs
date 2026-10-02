import assert from 'node:assert/strict'
import test from 'node:test'
import { packageName, sourcePaths } from '../apps/scripts/mobile-security-inventory.mjs'

test('inventory identifies packages across nested and scoped dependency paths', () => {
  assert.equal(packageName('E:/app/node_modules/expo/node_modules/undici/lib/index.js'), 'undici')
  assert.equal(packageName('E:/app/node_modules/@expo/code-signing-certificates/build/main.js'), '@expo/code-signing-certificates')
  assert.equal(packageName('E:/app/src/node-forge-reference.js'), null)
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
