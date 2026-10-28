import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash, constants, generateKeyPairSync, privateEncrypt, sign } from 'node:crypto'
import { hash, inventory, loadRecord, verifyReviewBytes } from '../scripts/security-verify-reviewed-backports.mjs'

const root = process.cwd()
const record = JSON.parse(fs.readFileSync('security/reviewed-source-remediations.json'))
const payload = JSON.parse(fs.readFileSync('security/patches/reviewed-source-manifest.json'))
const require = createRequire(import.meta.url)
const temporary = fs.mkdtempSync(path.join(root, 'node_modules', '.security-runtime-'))
const copies = []
try {
  for (const target of record.targets) {
    const relative = (target.scope === '.' ? '' : target.scope + '/') + target.packagePath
    const source = path.join(root, relative)
    const sourceHash = hash(Buffer.from(JSON.stringify(inventory(source))))
    assert.ok([target.originalTreeSha256, target.patchedTreeSha256].includes(sourceHash), 'Unexpected installed package tree: ' + relative)
    const directory = path.join(temporary, String(copies.length), target.name)
    fs.cpSync(source, directory, { recursive: true })
    const original = require(directory)
    if (target.mode === 'official-maintained') {
      assert.equal(target.name, 'node-forge')
      assert.equal(target.version, '1.4.2')
      assert.equal(target.originalTreeSha256, target.patchedTreeSha256)
      assert.deepEqual(target.files, [])
      copies.push({ target, relative, original, patched: original, originalAvailable: false })
    } else if (sourceHash === target.originalTreeSha256) {
      // Separate test-only copies demonstrate pre-fix behaviour. Installation
      // and acceptance still require the independent receipt and normal gate.
      const patchedDirectory = directory + '-patched'
      fs.cpSync(source, patchedDirectory, { recursive: true })
      for (const file of payload.libraries.find(item => item.name === target.name).files) {
        const content = Buffer.from(file.contentBase64, 'base64')
        assert.equal(hash(content), file.patchedSha256)
        assert.equal(hash(fs.readFileSync(path.join(patchedDirectory, file.path))), file.originalSha256)
        fs.writeFileSync(path.join(patchedDirectory, file.path), content)
      }
      assert.equal(hash(Buffer.from(JSON.stringify(inventory(patchedDirectory)))), target.patchedTreeSha256)
      copies.push({ target, relative, original, patched: require(patchedDirectory), originalAvailable: true, originalDirectory: directory, patchedDirectory })
    } else copies.push({ target, relative, original, patched: original, originalAvailable: false, originalDirectory: directory, patchedDirectory: directory })
  }
} catch (error) {
  fs.rmSync(temporary, { recursive: true, force: true })
  throw error
}
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }))

function loadDeepmergeEntry(directory, entry) {
  if (entry !== 'index.js') return require(path.join(directory, entry))
  // The source entry requires a build-time dependency that is not shipped.
  // Use the exact implementation bundled into this same verified package.
  const bundled = fs.readFileSync(path.join(directory, 'dist/cjs.js'), 'utf8')
  const mergeable = new Function(bundled.slice(0, bundled.indexOf('function emptyTarget(')) + '\nreturn isMergeableObject')()
  const module = { exports: {} }
  new Function('require', 'module', fs.readFileSync(path.join(directory, entry), 'utf8'))(name => {
    assert.equal(name, 'is-mergeable-object')
    return mergeable
  }, module)
  return module.exports
}
for (const copy of copies.filter(item => item.target.name === 'deepmerge')) {
  for (const entry of ['dist/cjs.js', 'dist/umd.js', 'index.js']) {
    const merge = loadDeepmergeEntry(copy.patchedDirectory, entry)
    test(copy.relative + '/' + entry + ': blocks both source and target prototype poisoning', () => {
      const payload = () => JSON.parse('{"__proto__":{"securityPoison":true},"safe":{"value":1}}')
      for (const target of [null, Object.create(null), payload(), { safe: {} }]) {
        const result = merge(target, payload())
        assert.equal(Object.getPrototypeOf(result), Object.prototype)
        assert.equal(Object.hasOwn(result, '__proto__'), false)
        assert.equal(result.securityPoison, undefined)
        assert.deepEqual(result.safe, { value: 1 })
      }
      const nullSource = Object.assign(Object.create(null), payload())
      for (const source of [nullSource, { nested: payload() }, { values: [payload()] }]) {
        const result = merge({}, source)
        for (const value of [result, result.nested, result.values?.[0]].filter(Boolean)) {
          assert.equal(Object.getPrototypeOf(value), Object.prototype)
          assert.equal(value.securityPoison, undefined)
          assert.equal(Object.hasOwn(value, '__proto__'), false)
        }
      }
      // Target copying must reject the key even if the source is empty.
      assert.equal(merge(payload(), {}).securityPoison, undefined)
      assert.equal({}.securityPoison, undefined)
      if (copy.originalAvailable) {
        const original = loadDeepmergeEntry(copy.originalDirectory, entry)
        assert.equal(original(null, payload()).securityPoison, true)
        assert.equal(original(Object.create(null), payload()).securityPoison, true)
        assert.equal(original(payload(), {}).securityPoison, true)
      }
    })
    test(copy.relative + '/' + entry + ': preserves arrays, symbols, cloning and custom merge semantics', () => {
      const symbol = Symbol('enumerable'), hidden = Symbol('hidden')
      const source = { values: [{ b: 2 }], [symbol]: { value: 3 }, constructor: { prototype: { safe: 1 } } }
      Object.defineProperty(source, hidden, { value: 'hidden' })
      const target = { values: [{ a: 1 }], [symbol]: { old: 2 } }
      const merged = merge(target, source)
      assert.deepEqual(merged.values, [{ a: 1 }, { b: 2 }])
      assert.deepEqual(merged[symbol], { old: 2, value: 3 })
      assert.equal(Object.hasOwn(merged, hidden), false)
      assert.notEqual(merged.values[1], source.values[0])
      assert.equal(merge({}, source, { clone: false }).values, source.values)
      assert.deepEqual(merge(target, source, { arrayMerge: (_left, right) => right }).values, source.values)
      const customKeys = []
      const custom = merge({ values: [1], nested: { a: 1 } }, { values: [2], nested: { b: 2 } }, {
        customMerge: key => { customKeys.push(key); return key === 'nested' ? (left, right) => ({ ...left, ...right, custom: true }) : undefined },
      })
      assert.deepEqual(custom.nested, { a: 1, b: 2, custom: true })
      assert.deepEqual(custom.values, [1, 2])
      assert.ok(customKeys.includes('nested'))
      assert.deepEqual(merge.all([{ one: 1 }, { two: 2 }]), { one: 1, two: 2 })
      assert.throws(() => merge.all({}), /array/)
      assert.deepEqual(merge({ prototype: { legitimate: 1 } }, { prototype: { second: 2 } }), { prototype: { legitimate: 1, second: 2 } })
      const date = new Date(0), regex = /safe/
      assert.equal(merge({}, { date, regex }).date, date)
      assert.equal(merge({}, { date, regex }).regex, regex)
      assert.deepEqual(merge({ nested: { old: 1 } }, { nested: { next: 2 } }, { isMergeableObject: value => Boolean(value) && !Array.isArray(value) && typeof value === 'object' }), { nested: { old: 1, next: 2 } })
    })
  }
}

const pattern = (open, close, depth) => open.repeat(depth) + 'a' + close.repeat(depth)
const ast = depth => {
  let child = { type: 'text', value: 'a' }
  for (let i = 0; i < depth; i++) child = { type: 'paren', nodes: [child] }
  return { type: 'root', nodes: [child] }
}
for (const copy of copies.filter(item => item.target.name === 'braces')) {
  test(copy.relative + ': string and AST depth guards preserve the 100/101 boundary', () => {
    const braces = copy.patched
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      for (const method of ['parse', 'compile', 'expand', 'stringify']) {
        assert.doesNotThrow(() => braces[method](pattern(open, close, 100)))
        for (const depth of [101, 1000, 4998]) assert.throws(() => braces[method](pattern(open, close, depth)), /exceeds max depth/)
      }
    }
    for (const method of ['compile', 'expand', 'stringify']) {
      assert.doesNotThrow(() => braces[method](ast(100)))
      for (const depth of [101, 10000]) assert.throws(() => braces[method](ast(depth)), /exceeds max depth/)
      const cyclic = { type: 'root', nodes: [] }; cyclic.nodes.push(cyclic)
      assert.throws(() => braces[method](cyclic), /exceeds max depth/)
    }
    const parent = { type: 'paren', nodes: [{ type: 'text', value: 'a' }] }; parent.parent = parent
    assert.throws(() => braces.expand(parent), /parent chain contains a cycle/)
    if (copy.originalAvailable) assert.doesNotThrow(() => copy.original.parse(pattern('{', '}', 101)))
  })
  test(copy.relative + ': configured limits, mixed and malformed inputs cannot bypass guards', () => {
    const braces = copy.patched
    for (const method of ['parse', 'compile', 'expand', 'stringify']) {
      for (const maxDepth of [Infinity, NaN, 1000]) assert.throws(() => braces[method](pattern('{', '}', 101), { maxDepth }), /exceeds max depth/)
      assert.doesNotThrow(() => braces[method]('{a}', { maxDepth: 1.5 }))
      assert.throws(() => braces[method]('{{a}}', { maxDepth: 1.5 }), /exceeds max depth/)
      assert.throws(() => braces[method]('({'.repeat(51) + 'a' + '})'.repeat(51)), /exceeds max depth/)
      assert.throws(() => braces[method]('{'.repeat(101) + 'a'), /exceeds max depth/)
    }
    assert.throws(() => braces.parse('x'.repeat(10001)), /exceeds max characters/)
    assert.doesNotThrow(() => braces.parse('\\{'.repeat(101)))
  })
  test(copy.relative + ': ordinary ranges, invalid escaping and glob consumers remain compatible', () => {
    const braces = copy.patched
    assert.deepEqual(braces.expand('{a,b}/{1..3}'), ['a/1', 'a/2', 'a/3', 'b/1', 'b/2', 'b/3'])
    for (const input of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}}', '{}{a}', '{1..8}']) {
      assert.equal(braces.stringify(braces.parse(input), { escapeInvalid: true }), input)
    }
    const micromatch = require(path.join(root, copy.target.scope, 'node_modules/micromatch'))
    assert.deepEqual(micromatch(['src/a.js', 'src/b.ts', 'test/a.js'], 'src/*.{js,ts}'), ['src/a.js', 'src/b.ts'])
    if (copy.originalAvailable) {
      for (const input of ['a', '{a,b}', '{1..8}', '{a,{b,c}}', '(a|b)', '\\{a,b\\}', '{a', 'a}', '{{x}y}', '{a,,b}']) {
        for (const method of ['compile', 'expand', 'stringify']) {
          for (const escapeInvalid of [false, true]) {
            assert.deepEqual(braces[method](input, { escapeInvalid }), copy.original[method](input, { escapeInvalid }), method + '/' + input)
          }
        }
      }
    }
  })
}

const message = Buffer.from('Football Player synthetic security regression')
for (const copy of copies.filter(item => item.target.name === 'node-forge')) {
  test(copy.relative + ': official release preserves PEM Buffer input', () => {
    const pem = '-----BEGIN TEST-----\r\n' + Buffer.from('synthetic PEM body').toString('base64') + '\r\n-----END TEST-----\r\n'
    assert.deepEqual(copy.patched.pem.decode(Buffer.from(pem)), copy.patched.pem.decode(pem))
  })
  test(copy.relative + ': valid RSA signatures and optional NULL parameters remain accepted', () => {
    for (const publicExponent of [3, 65537]) {
      const pair = generateKeyPairSync('rsa', { modulusLength: 1024, publicExponent })
      const forge = copy.patched
      const publicKey = forge.pki.publicKeyFromPem(pair.publicKey.export({ type: 'spki', format: 'pem' }).toString())
      for (const algorithm of ['sha1', 'sha256', 'sha384', 'sha512']) {
        const digest = createHash(algorithm).update(message).digest()
        assert.equal(publicKey.verify(digest.toString('binary'), sign(algorithm, message, pair.privateKey).toString('binary')), true)
        for (const parameters of ['absent', 'empty']) {
          const signature = signatureFor(forge, pair.privateKey, algorithm, digest, parameters)
          assert.equal(publicKey.verify(digest.toString('binary'), signature), true)
        }
      }
    }
  })
  test(copy.relative + ': extra DigestInfo elements and non-empty NULL are rejected', () => {
    for (const publicExponent of [3, 65537]) {
      const pair = generateKeyPairSync('rsa', { modulusLength: 1024, publicExponent })
      const forge = copy.patched
      const pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
      const publicKey = forge.pki.publicKeyFromPem(pem)
      const digest = createHash('sha256').update(message).digest()
      for (const malformed of ['nested-extra', 'outer-extra', 'nonempty-null', 'nonminimal-length', 'nonminimal-oid']) {
        // Private-key-generated malformed encodings test validation, not a
        // claim of signature forgery without possession of that private key.
        const signature = signatureFor(forge, pair.privateKey, 'sha256', digest, malformed)
        assert.throws(() => publicKey.verify(digest.toString('binary'), signature), /valid RSASSA-PKCS1-v1_5 DigestInfo/)
        if (copy.originalAvailable && malformed !== 'outer-extra') {
          assert.equal(copy.original.pki.publicKeyFromPem(pem).verify(digest.toString('binary'), signature), true)
        }
      }
    }
  })
}
function signatureFor(forge, privateKey, algorithm, digest, mode) {
  const a = forge.asn1, u = a.Class.UNIVERSAL, t = a.Type
  const parameters = [a.create(u, t.OID, false, a.oidToDer(forge.pki.oids[algorithm]).getBytes())]
  if (mode !== 'absent') parameters.push(a.create(u, t.NULL, false, mode === 'nonempty-null' ? 'unchecked' : ''))
  if (mode === 'nested-extra') parameters.push(a.create(u, t.OCTETSTRING, false, 'unchecked'))
  const outer = [a.create(u, t.SEQUENCE, true, parameters), a.create(u, t.OCTETSTRING, false, digest.toString('binary'))]
  if (mode === 'outer-extra') outer.push(a.create(u, t.OCTETSTRING, false, 'unchecked'))
  if (mode === 'nonminimal-oid') parameters[0].value = '\x80' + parameters[0].value
  let der = Buffer.from(a.toDer(a.create(u, t.SEQUENCE, true, outer)).getBytes(), 'binary')
  if (mode === 'nonminimal-length') der = Buffer.concat([der.subarray(0, 1), Buffer.from([0x81, der[1]]), der.subarray(2)])
  const padding = Buffer.alloc(128 - der.length - 3, 0xff)
  return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, Buffer.concat([Buffer.from([0, 1]), padding, Buffer.from([0]), der])).toString('binary')
}
test('replacement proposal and review record drift cannot reuse independent acceptance', () => {
  const fixture = path.join(temporary, 'qualification-drift')
  fs.mkdirSync(path.join(fixture, 'security'), { recursive: true })
  const bytes = Buffer.from(JSON.stringify(record))
  const recordPath = path.join(fixture, 'security/reviewed-source-remediations.json')
  fs.writeFileSync(recordPath, bytes)
  fs.writeFileSync(path.join(fixture, 'security/maintained-source-policy.json'), '{"substituted":true}')
  assert.throws(() => loadRecord(fixture), /policy evidence drift/)
  const source = { head: '1'.repeat(40) }
  const receipt = Buffer.from(JSON.stringify({ status: 'ACCEPTED_LOCAL_IMPLEMENTATION', reviewer: 'test-only', reviewedAt: new Date().toISOString(), head: source.head, recordSha256: hash(bytes) }))
  fs.appendFileSync(recordPath, '\n')
  assert.throws(() => verifyReviewBytes(fixture, record, source, receipt, hash(receipt)), /Review record drift/)
})
