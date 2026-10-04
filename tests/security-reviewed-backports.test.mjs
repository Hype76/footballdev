import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { evaluateAudit, verifyCopies, loadRecord, verifyReview, hash, inventory, artifactPath } from '../scripts/security-verify-reviewed-backports.mjs'
import { prepareWrites } from '../scripts/security-apply-reviewed-backports.mjs'

const root = process.cwd()
const policy = JSON.parse(fs.readFileSync(path.join(root, 'security/reviewed-source-remediations.json')))
const clone = value => JSON.parse(JSON.stringify(value))
const scope = 'apps/parent-mobile'
const lock = { packages: { 'node_modules/braces': { version: '3.0.3' }, 'node_modules/micromatch': { version: '4.0.8' } } }
const advisory = { url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm', severity: 'high' }
const fixture = () => ({ auditReportVersion: 2, vulnerabilities: {
  braces: { severity: 'high', via: [advisory], nodes: ['node_modules/braces'] },
  micromatch: { severity: 'high', via: ['braces'], nodes: ['node_modules/micromatch'] },
}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } } })

test('registry findings remain visible when exact source remediation covers every propagated finding', () => {
  const audit = fixture(), original = JSON.stringify(audit)
  const result = evaluateAudit(audit, lock, scope, policy)
  assert.deepEqual(result.failures, [])
  assert.equal(result.acceptedSourceRemediations.length, 2)
  assert.equal(result.registryCounts.high, 2)
  assert.equal(JSON.stringify(audit), original)
})
test('new, mixed, untraceable, cyclic and uncovered advisory paths fail closed', () => {
  for (const mutate of [
    a => a.vulnerabilities.braces.via.push({ ...advisory, url: 'https://github.com/advisories/GHSA-new-unknown' }),
    a => a.vulnerabilities.braces.via.push('missing-package'),
    a => a.vulnerabilities.braces.via.push('micromatch'),
    a => { a.vulnerabilities.braces.via = ['micromatch'] },
    a => { a.vulnerabilities.braces.via = [] },
    a => { a.vulnerabilities.braces.nodes.push('node_modules/extra/node_modules/braces') },
    a => { a.vulnerabilities.braces.via[0].severity = 'critical' },
    a => { a.vulnerabilities.micromatch.nodes = [] },
  ]) {
    const audit = fixture(); mutate(audit)
    if (audit.vulnerabilities.braces.via[0]?.severity === 'critical') {
      // The propagated finding remains high in this malformed fixture.
      assert.ok(evaluateAudit(audit, lock, scope, policy).failures.length > 0)
    } else {
      const result = evaluateAudit(audit, lock, scope, policy)
      assert.ok(result.failures.length > 0)
      assert.deepEqual(result.acceptedSourceRemediations, [])
    }
  }
  const changed = clone(lock); changed.packages['node_modules/braces'].version = '3.0.2'
  assert.ok(evaluateAudit(fixture(), changed, scope, policy).failures.length > 0)
})
test('missing, invalid, API-error and inconsistent audit data cannot be accepted', () => {
  for (const audit of [null, {}, { error: { code: 'ENET' } }, { vulnerabilities: [], metadata: { vulnerabilities: {} } }]) {
    assert.throws(() => evaluateAudit(audit, lock, scope, policy))
  }
  const audit = fixture(); audit.metadata.vulnerabilities.high = 0
  assert.throws(() => evaluateAudit(audit, lock, scope, policy), /counts disagree/)
  for (const value of [-1, 0.5, '2', null]) {
    const altered = fixture(); altered.metadata.vulnerabilities.high = value
    assert.throws(() => evaluateAudit(altered, lock, scope, policy), /count/)
  }
})
test('all owned physical copies, complete package contents and lock identities are verified', () => {
  // This is an integration check against freshly installed, actually patched dependencies.
  const record = loadRecord(root).record
  assert.equal(verifyCopies(root, record).length, 5)
})
test('an additional nested vulnerable package and an unpatched copy stop verification', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'football-backport-check-'))
  try {
    for (const target of policy.targets) {
      const relative = (target.scope === '.' ? '' : target.scope + '/') + target.packagePath
      fs.cpSync(path.join(root, relative), path.join(directory, relative), { recursive: true })
    }
    for (const item of policy.scopeLocks) {
      const relative = (item.scope === 'root' ? '' : item.scope + '/') + 'package-lock.json'
      fs.copyFileSync(path.join(root, relative), path.join(directory, relative))
    }
    assert.equal(verifyCopies(directory, policy).length, 5)
    const extra = path.join(directory, 'node_modules/braces/node_modules/braces')
    fs.mkdirSync(extra, { recursive: true })
    fs.writeFileSync(path.join(extra, 'package.json'), JSON.stringify({ name: 'braces', version: '3.0.3' }))
    assert.throws(() => verifyCopies(directory, policy), /copy set/)
    fs.rmSync(path.join(directory, 'node_modules/braces/node_modules'), { recursive: true })
    const source = path.join(directory, 'apps/parent-mobile/node_modules/braces/lib/compile.js')
    fs.appendFileSync(source, '\n// drift\n')
    assert.throws(() => verifyCopies(directory, policy), /tree drift/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
test('a self-issued review, wrong receipt hash or stale HEAD never authorises acceptance', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'football-review-check-'))
  try {
    fs.mkdirSync(path.join(directory, '.security-artifacts'))
    const receipt = Buffer.from(JSON.stringify({ status: 'ACCEPTED_LOCAL_IMPLEMENTATION', reviewer: 'test-only', reviewedAt: new Date().toISOString(), head: 'wrong-head' }))
    fs.writeFileSync(path.join(directory, '.security-artifacts/implementation-review.json'), receipt)
    assert.throws(() => verifyReview(directory, policy, { head: 'expected-head' }, ''), /Trusted independent-review/)
    assert.throws(() => verifyReview(directory, policy, { head: 'expected-head' }, '0'.repeat(64)), /externally approved identity/)
    assert.throws(() => verifyReview(directory, policy, { head: 'expected-head' }, hash(receipt)), /exact HEAD/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
test('incomplete payload or wrong prospective complete tree causes zero writes', () => {
  const { record, payload } = loadRecord(root), copies = verifyCopies(root, record)
  const before = copies.map(copy => hash(Buffer.from(JSON.stringify(inventory(copy.dir)))))
  const incomplete = clone(payload); incomplete.libraries[0].files.pop()
  assert.throws(() => prepareWrites(record, incomplete, copies), /Incomplete payload/)
  const wrongTree = copies.map(copy => ({ ...copy, target: { ...copy.target, patchedTreeSha256: '0'.repeat(64) }, treeSha256: '0'.repeat(64) }))
  assert.throws(() => prepareWrites(record, payload, wrongTree), /Prospective postimage tree mismatch/)
  assert.deepEqual(copies.map(copy => hash(Buffer.from(JSON.stringify(inventory(copy.dir))))), before)
})
test('artifact junctions cannot redirect receipts or audit reports outside the checkout', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'football-artifact-check-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'football-outside-check-'))
  try {
    fs.symlinkSync(outside, path.join(directory, '.security-artifacts'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => artifactPath(directory, 'backport-installation.json'), /Linked path forbidden/)
    assert.deepEqual(fs.readdirSync(outside), [])
  } finally {
    fs.unlinkSync(path.join(directory, '.security-artifacts'))
    fs.rmSync(directory, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})
test('an exact pinned review receipt cannot bless dirty tracked source', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'football-dirty-check-'))
  const git = args => execFileSync('git', ['-c', `safe.directory=${directory.replaceAll('\\', '/')}`, '-C', directory, ...args], { encoding: 'utf8' }).trim()
  try {
    git(['init', '--quiet'])
    fs.writeFileSync(path.join(directory, 'source.txt'), 'reviewed\n')
    git(['add', 'source.txt'])
    git(['-c', 'user.name=Local test', '-c', 'user.email=local-test@example.invalid', 'commit', '--quiet', '-m', 'Test fixture'])
    const head = git(['rev-parse', 'HEAD'])
    fs.mkdirSync(path.join(directory, 'security'))
    const recordBytes = Buffer.from(JSON.stringify(policy))
    fs.writeFileSync(path.join(directory, 'security/reviewed-source-remediations.json'), recordBytes)
    const receipt = Buffer.from(JSON.stringify({ status: 'ACCEPTED_LOCAL_IMPLEMENTATION', reviewer: 'test-only', reviewedAt: new Date().toISOString(), head, recordSha256: hash(recordBytes), proposalSha256: policy.adoptionProposalSha256, payloadSha256: policy.payloadSha256, implementationHashes: policy.implementationHashes, nativeInputs: policy.nativeInputs, expiresAt: policy.expiresAt }))
    fs.writeFileSync(artifactPath(directory, 'implementation-review.json'), receipt)
    fs.writeFileSync(path.join(directory, 'source.txt'), 'drift\n')
    assert.throws(() => verifyReview(directory, policy, { head }, hash(receipt)), /tracked working changes/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
