import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { hash, verifyMaintainedAuthority, verifyReviewBytes, verifyUpstream } from '../scripts/security-verify-reviewed-backports.mjs'
import { runRequiredCommands, maintainedTestFiles } from '../scripts/security-maintained-release-gate.mjs'
import { decodeNetlifyReceipt, runNetlifyBuild } from '../scripts/security-netlify-build.mjs'

const record = JSON.parse(fs.readFileSync('security/reviewed-source-remediations.json'))
const payload = JSON.parse(fs.readFileSync('security/patches/reviewed-source-manifest.json'))
const clone = value => JSON.parse(JSON.stringify(value))
function responses() {
  const map = new Map()
  for (const snapshot of payload.advisories) map.set('https://api.github.com/advisories/' + snapshot.ghsaId, {
    ghsa_id: snapshot.ghsaId, cve_id: snapshot.cveId, severity: snapshot.severity,
    summary: snapshot.summary, description: snapshot.description, vulnerabilities: snapshot.vulnerabilities,
    references: snapshot.references, withdrawn_at: snapshot.withdrawnAt, updated_at: '2026-10-12T06:00:00Z',
  })
  for (const source of Object.values(record.sourceRevisions)) map.set(`https://api.github.com/repos/${source.repository}/pulls/${source.number}`, {
    head: { sha: source.headSha }, base: { sha: source.baseSha }, state: source.state, merged: source.merged,
  })
  for (const target of record.targets) map.set('https://registry.npmjs.org/' + target.name + '/latest', { name: target.name, version: target.version, dist: { integrity: target.registryIntegrity } })
  return map
}
test('standing maintenance authority rejects legacy expiry, changed schema, mode and owner', () => {
  assert.doesNotThrow(() => verifyMaintainedAuthority(record))
  for (const mutate of [
    value => { value.schemaVersion = 1 }, value => { value.remediationMode = 'temporary' },
    value => { value.expiresAt = '2099-12-31T23:59:59Z' }, value => { value.maintenance.owner = '' },
  ]) {
    const value = clone(record); mutate(value)
    assert.throws(() => verifyMaintainedAuthority(value))
  }
})
test('a correctly pinned temporary receipt cannot grant maintained-mode authority', () => {
  const bytes = fs.readFileSync('security/reviewed-source-remediations.json')
  const receiptRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maintained-receipt-'))
  fs.mkdirSync(path.join(receiptRoot, 'security'))
  fs.writeFileSync(path.join(receiptRoot, 'security/reviewed-source-remediations.json'), bytes)
  execFileSync('git', ['init', '--quiet', receiptRoot])
  execFileSync('git', ['-C', receiptRoot, 'add', '.'])
  execFileSync('git', ['-C', receiptRoot, '-c', 'user.name=Receipt test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Receipt fixture'])
  const source = { head: '1'.repeat(40) }
  const receipt = {
    status: 'ACCEPTED_LOCAL_IMPLEMENTATION', reviewer: 'test-only', reviewedAt: new Date().toISOString(),
    head: source.head, recordSha256: hash(bytes), proposalSha256: record.adoptionProposalSha256,
    dependencyRemediationSha256: record.dependencyRemediationSha256, releasePreparationSha256: record.releasePreparationSha256,
    payloadSha256: record.payloadSha256, implementationHashes: record.implementationHashes, nativeInputs: record.nativeInputs,
    expiresAt: '2099-12-31T23:59:59Z',
  }
  const encoded = Buffer.from(JSON.stringify(receipt))
  assert.throws(() => verifyReviewBytes(receiptRoot, record, source, encoded, hash(encoded)), /does not approve maintained source fixes/)
  receipt.remediationMode = record.remediationMode
  receipt.maintenancePolicySha256 = record.adoptionProposalSha256
  const transferred = Buffer.from(JSON.stringify(receipt))
  assert.throws(() => verifyReviewBytes(receiptRoot, record, source, transferred, hash(transferred)), /Temporary review cannot authorise/)
  delete receipt.expiresAt
  const valid = Buffer.from(JSON.stringify(receipt))
  assert.doesNotThrow(() => verifyReviewBytes(receiptRoot, record, source, valid, hash(valid)))
  for (const mutate of [
    value => { value.remediationMode = 'temporary' },
    value => { value.maintenancePolicySha256 = '0'.repeat(64) },
  ]) {
    const changed = clone(receipt); mutate(changed)
    const encodedChanged = Buffer.from(JSON.stringify(changed))
    assert.throws(() => verifyReviewBytes(receiptRoot, record, source, encodedChanged, hash(encodedChanged)))
  }
  fs.rmSync(receiptRoot, { recursive: true, force: true })
})
test('every upstream verification makes fresh advisory, revision and published-package requests', async () => {
  const map = responses(), seen = []
  const request = async (url, options) => { assert.ok(options.signal); seen.push(url); return { ok: true, json: async () => clone(map.get(url)) } }
  for (let i = 0; i < 2; i++) {
    const result = await verifyUpstream(record, payload, request)
    assert.equal(result.receipts.length, 7)
    assert.equal(result.receipts.filter(item => item.type === 'registry').length, 2)
  }
  assert.equal(seen.length, 14)
  for (const url of map.keys()) assert.equal(seen.filter(item => item === url).length, 2)
})
test('changed advisory, upstream patch, published version or registry integrity blocks release', async () => {
  const urls = [...responses().keys()]
  for (const [url, mutate] of [
    [urls[0], value => { value.severity = 'critical' }],
    [urls[0], value => { value.description += '\nChanged security meaning' }],
    [urls[0], value => { value.summary += ' changed' }],
    [urls[0], value => { value.withdrawn_at = null }],
    [urls[2], value => { value.head.sha = '0'.repeat(40) }],
    [urls[2], value => { value.merged = !value.merged }],
    [urls[2], value => { value.state = value.state === 'open' ? 'closed' : 'open' }],
    [urls[5], value => { value.version = '3.0.4' }],
    [urls[6], value => { value.dist.integrity = 'substituted' }],
    [urls[6], value => { value.name = 'other-package' }],
  ]) {
    const map = responses(); mutate(map.get(url))
    await assert.rejects(() => verifyUpstream(record, payload, async key => ({ ok: true, json: async () => map.get(key) })))
  }
})
test('unavailable, malformed or failed official lookup never grants standing acceptance', async () => {
  for (const request of [
    async () => { throw new Error('network unavailable') },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON') } }),
    async () => ({ ok: true, json: async () => ({}) }),
  ]) await assert.rejects(() => verifyUpstream(record, payload, request))
})
test('failed supply-chain or runtime command stops the maintained release gate', () => {
  for (const failure of [0, 1]) {
    const calls = []
    assert.throws(() => runRequiredCommands(process.cwd(), (command, args) => {
      calls.push([command, args]); return { status: calls.length - 1 === failure ? 1 : 0 }
    }), /Required maintained source check failed/)
    assert.equal(calls.length, failure + 1)
    assert.deepEqual(calls[0][1], ['run', 'security:supply-chain'])
    if (failure === 1) assert.deepEqual(calls[1][1], ['--test', ...maintainedTestFiles])
  }
})
function transport(bytes) {
  const encoded = gzipSync(bytes).toString('base64'), middle = Math.ceil(encoded.length / 2)
  return { FOOTBALL_REVIEW_RECEIPT_GZIP_BASE64_1: encoded.slice(0, middle), FOOTBALL_REVIEW_RECEIPT_GZIP_BASE64_2: encoded.slice(middle), FOOTBALL_REVIEW_RECEIPT_SHA256: hash(bytes) }
}
test('Netlify transport requires protected approval and bounded complete receipt bytes', () => {
  const bytes = Buffer.from('{"transportOnly":true}\n'), env = transport(bytes)
  assert.deepEqual(decodeNetlifyReceipt(env), bytes)
  for (const changed of [
    { ...env, FOOTBALL_REVIEW_RECEIPT_SHA256: '0'.repeat(64) },
    { ...env, FOOTBALL_REVIEW_RECEIPT_GZIP_BASE64_2: '' },
    { ...env, FOOTBALL_REVIEW_RECEIPT_GZIP_BASE64_1: '?' },
    transport(Buffer.from('[]')),
    transport(Buffer.from(JSON.stringify({ oversized: 'x'.repeat(65536) }))),
  ]) assert.throws(() => decodeNetlifyReceipt(changed))
})
test('Netlify cannot build or deploy after provisioning or maintained verification fails', () => {
  const env = { NETLIFY: 'true', CONTEXT: 'production', COMMIT_REF: '1'.repeat(40), ...transport(Buffer.from('{"transportOnly":true}')) }
  for (const failure of ['security:provision', 'scripts/security-maintained-release-gate.mjs']) {
    const calls = []
    assert.throws(() => runNetlifyBuild(process.cwd(), env, (command, args) => {
      calls.push(args)
      if (args.includes(failure)) throw new Error('synthetic failed security command')
      if (command === 'git' && args[0] === 'rev-parse') return env.COMMIT_REF
      if (command === 'npm' && args[0] === '--version') return '11.7.0'
      return ''
    }), /synthetic failed/)
    assert.equal(calls.some(args => args.includes('build:live')), false)
  }
  for (const changed of [{ ...env, NETLIFY: 'false' }, { ...env, CONTEXT: 'branch-deploy' }]) {
    assert.throws(() => runNetlifyBuild(process.cwd(), changed, () => { throw new Error('must not execute') }))
  }
})
test('mobile and Netlify release entry points require the maintained gate', () => {
  const mobile = fs.readFileSync('apps/scripts/mobile-release-check.mjs', 'utf8')
  assert.match(mobile, /scripts\/security-maintained-release-gate\.mjs/)
  assert.ok(mobile.indexOf('security-maintained-release-gate.mjs') > mobile.indexOf("['git', ['diff', '--check']]"))
  for (const file of ['mobile-update-guard.mjs', 'mobile-build-guard.mjs', 'mobile-submit-guard.mjs']) {
    assert.match(fs.readFileSync('apps/scripts/' + file, 'utf8'), /execFileSync\('npm', \['run', 'mobile:release-check'\]/)
  }
  const config = fs.readFileSync('netlify.toml', 'utf8')
  assert.equal((config.match(/command = "npx --yes --package=npm@11\.7\.0 -- node scripts\/security-netlify-build\.mjs"/g) || []).length, 3)
  assert.match(config, /NPM_VERSION = "11\.7\.0"/)
})
