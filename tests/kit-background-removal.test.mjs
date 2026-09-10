import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { normalizeKitMask, prepareKitTensor, KIT_MASK_SIZE } from '../src/lib/kit-background-core.js'
import { assertBrowserCompatibleInlineCsp } from '../scripts/csp-inline-integrity.mjs'

test('bundled background model matches the reviewed upstream artifact', async () => {
  const model = await readFile('public/models/kit-background/u2netp.onnx')
  assert.equal(createHash('sha256').update(model).digest('hex'), '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8')
})

test('invalid or flat masks fail instead of replacing the original with a blank image', () => {
  const values = new Float32Array(KIT_MASK_SIZE * KIT_MASK_SIZE)
  assert.throws(() => normalizeKitMask(values), /could not identify/)
  values[0] = NaN
  assert.throws(() => normalizeKitMask(values), /could not identify/)
  assert.throws(() => prepareKitTensor(new Uint8Array(4)), /Invalid kit image size/)
  assert.ok(prepareKitTensor(new Uint8Array(KIT_MASK_SIZE * KIT_MASK_SIZE * 4)).every(Number.isFinite), 'Black images do not divide by zero')
})

test('WASM permission does not allow JavaScript eval or inline scripts', async () => {
  const html = await readFile('index.html', 'utf8')
  const netlifyConfig = await readFile('netlify.toml', 'utf8')
  assert.doesNotThrow(() => assertBrowserCompatibleInlineCsp({ html, netlifyConfig }))
  for (const token of ["'unsafe-eval'", "'unsafe-inline'"]) {
    assert.throws(() => assertBrowserCompatibleInlineCsp({ html, netlifyConfig: netlifyConfig.replace("'wasm-unsafe-eval'", "'wasm-unsafe-eval' " + token) }), /permissive source/)
  }
})
