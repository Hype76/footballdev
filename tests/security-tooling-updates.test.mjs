import assert from 'node:assert/strict'
import { test } from 'node:test'
import uri from 'fast-uri'
import serialize from 'serialize-javascript'
import { z } from 'zod'
import Ajv from 'ajv'

test('URI normalization does not activate an encoded or suffix-only script scheme', () => {
  for (const encoded of ['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)']) {
    assert.notEqual(uri.parse(encoded).scheme, 'javascript')
    assert.ok(!/^javascript:/i.test(uri.normalize(encoded)))
    assert.throws(() => uri.resolve('https://example.invalid/', encoded), /URI scheme is malformed/)
  }
  assert.equal(uri.equal('%68ttp://example.invalid/', 'http://example.invalid/'), false)
  assert.equal(uri.serialize({ path: 'javascript:alert(1)' }, { reference: 'suffix' }), 'javascript%3Aalert(1)')
})

test('AJV still resolves local references with the patched URI parser', () => {
  const validate = new Ajv().compile({
    $id: 'https://example.invalid/schema',
    definitions: { name: { type: 'string', minLength: 1 } },
    type: 'object', properties: { name: { $ref: '#/definitions/name' } }, required: ['name'],
  })
  assert.equal(validate({ name: 'Example' }), true)
  assert.equal(validate({ name: '' }), false)
})

test('serialized function source cannot terminate its containing script at a value boundary', () => {
  function fixture() { return 1 }
  fixture.toString = () => 'function fixture(){return 1}//' + '</script'
  const output = serialize({ nested: { fixture }, following: '>text' }, { space: 2 })
  assert.ok(!/<\/script(?=[\t\n\f\r />]|$)/i.test(output))
  assert.match(output, /function fixture/)
})

test('oversized constrained collections stop before accumulating per-element Zod errors', () => {
  let visits = 0
  const schema = z.array(z.string().superRefine(() => { visits++ })).max(2)
  const result = schema.safeParse(['one', 'two', 'three'])
  assert.equal(result.success, false)
  assert.equal(result.error.issues.length, 1)
  assert.equal(visits, 0, 'Oversized input must fail before per-element validation')
  assert.deepEqual(schema.parse(['one', 'two']), ['one', 'two'])
})
