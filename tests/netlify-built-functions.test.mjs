import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import JSZip from 'jszip'

const destination = path.resolve('.netlify/functions-internal')
const { functions } = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'))
const byName = new Map(functions.map((entry) => [entry.name, entry]))

test('every top-level function has exactly one fresh deployable archive', async () => {
  const sourceNames = (await readdir('netlify/functions'))
    .filter((name) => /\.(?:js|mjs|mts)$/.test(name)).map((name) => name.replace(/\.[^.]+$/, '')).sort()
  assert.deepEqual([...byName.keys()].sort(), sourceNames)
  assert.equal(functions.length, sourceNames.length)
  for (const entry of functions) {
    assert.equal(entry.runtime, 'js')
    assert.equal(entry.runtimeVersion, 'nodejs22.x')
    const archive = await JSZip.loadAsync(await readFile(entry.path))
    assert.ok(Object.values(archive.files).some((file) => !file.dir && /\.(?:js|mjs|cjs)$/.test(file.name)), `Executable JavaScript missing: ${entry.name}`)
    if (['website-help', 'create-billing-portal-session'].includes(entry.name)) {
      assert.ok(archive.file('___netlify-entry-point.mjs'), `Modern entry point missing: ${entry.name}`)
      assert.ok(Object.keys(archive.files).some((name) => name === `${entry.name}.mjs` || name.endsWith(`/${entry.name}.mjs`)), `Compiled handler missing: ${entry.name}`)
    }
    assert.ok(!Object.keys(archive.files).some((name) => /node_modules\/(?:node-forge|netlify-cli)\//.test(name)))
  }
})

test('website help rate limiting and route survive modern bundling', () => {
  const entry = byName.get('website-help')
  assert.equal(entry.trafficRules.action.type, 'rate_limit')
  assert.deepEqual(entry.trafficRules.action.config.rateLimitConfig, { windowLimit: 10, windowSize: 60, algorithm: 'sliding_window' })
  assert.deepEqual(entry.trafficRules.action.config.aggregate.keys, [{ type: 'ip' }, { type: 'domain' }])
  assert.ok(entry.routes.some((route) => route.pattern === '/api/website-help'))
})

test('scheduled function metadata survives bundling', () => {
  assert.equal(byName.get('process-platform-analytics').schedule, '*/15 * * * *')
  assert.equal(byName.get('cleanup-expired-retention').schedule, '@daily')
  assert.equal(byName.get('send-scheduled-emails').schedule, '* * * * *')
})

test('Chromium assets remain in PDF roots and their scheduled email wrapper', async () => {
  const pdfRoots = new Set(['formation-board-export', 'parent-development-history', 'render-pdf', 'send-parent-email', 'send-scheduled-emails'])
  for (const entry of functions) {
    const archive = await JSZip.loadAsync(await readFile(entry.path))
    const chromium = Object.keys(archive.files).filter((name) => name.includes('node_modules/@sparticuz/chromium/'))
    assert.equal(chromium.length > 0, pdfRoots.has(entry.name), entry.name)
    if (pdfRoots.has(entry.name)) {
      assert.ok(chromium.some((name) => name.endsWith('/bin/chromium.br')), entry.name)
    }
  }
})
