import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { hash } from '../scripts/security-verify-reviewed-backports.mjs'
import { decodeReceipt, assertInstallScope } from '../scripts/security-provision-reviewed-backports.mjs'

test('receipt transport rejects missing external approval, malformed base64 and substituted contents', () => {
  const bytes = Buffer.from('{"transportOnly":true}\n')
  const encoded = bytes.toString('base64'), pin = hash(bytes)
  assert.deepEqual(decodeReceipt(encoded, pin), bytes)
  for (const [value, identity] of [[encoded, undefined], [encoded + '\n', pin], ['?', pin], [encoded, '0'.repeat(64)], [Buffer.from('[]').toString('base64'), hash(Buffer.from('[]'))]]) {
    assert.throws(() => decodeReceipt(value, identity))
  }
})
test('executable links must resolve within node_modules including the exact parent boundary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'football-bin-owner-'))
  const app = path.join(root, 'apps', 'parent-mobile'), modules = path.join(app, 'node_modules')
  const bin = path.join(modules, '.bin'), pkg = path.join(modules, 'owned-package'), link = path.join(bin, 'tool')
  fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(pkg)
  fs.symlinkSync(pkg, link, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    assert.doesNotThrow(() => assertInstallScope(root, 'apps/parent-mobile'))
    fs.unlinkSync(link)
    fs.symlinkSync(app, link, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => assertInstallScope(root, 'apps/parent-mobile'), /External executable link/)
  } finally {
    fs.unlinkSync(link); fs.rmdirSync(bin); fs.rmdirSync(pkg); fs.rmdirSync(modules)
    fs.rmdirSync(app); fs.rmdirSync(path.join(root, 'apps')); fs.rmdirSync(root)
  }
})
test('wrong external receipt stops the real provisioner before artifact writes or npm execution', () => {
  const root = process.cwd(), artifacts = path.join(root, '.security-artifacts')
  const snapshot = () => fs.readdirSync(artifacts).filter(name => name.endsWith('.json')).sort().map(name => [name, hash(fs.readFileSync(path.join(artifacts, name)))])
  const before = snapshot(), probe = fs.mkdtempSync(path.join(os.tmpdir(), 'football-npm-probe-'))
  const cli = path.join(probe, 'npm-cli.js'), marker = path.join(probe, 'executed')
  fs.writeFileSync(cli, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'npm reached'); console.log('11.7.0')`)
  try {
    const result = spawnSync(process.execPath, ['scripts/security-provision-reviewed-backports.mjs', '--install-mobile'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, FOOTBALL_REVIEW_RECEIPT_BASE64: Buffer.from('{"substituted":true}').toString('base64'), FOOTBALL_REVIEW_RECEIPT_SHA256: '0'.repeat(64), npm_execpath: cli },
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Receipt does not match externally approved SHA256/)
    assert.deepEqual(snapshot(), before)
    assert.equal(fs.existsSync(marker), false)
  } finally { fs.unlinkSync(cli); if (fs.existsSync(marker)) fs.unlinkSync(marker); fs.rmdirSync(probe) }
})
test('clean install refuses linked app or dependency paths before npm can run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'football-provision-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'football-provision-outside-'))
  fs.mkdirSync(path.join(root, 'apps', 'parent-mobile'), { recursive: true })
  const target = path.join(root, 'apps', 'parent-mobile', 'node_modules')
  fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    assert.throws(() => assertInstallScope(root, 'apps/parent-mobile'), /Linked/)
    assert.throws(() => assertInstallScope(root, '../outside'), /Unapproved/)
    assert.equal(fs.readdirSync(outside).length, 0)
    fs.rmdirSync(outside)
    assert.throws(() => assertInstallScope(root, 'apps/parent-mobile'), /ENOENT|Linked/)
    assert.equal(fs.existsSync(outside), false)
  } finally {
    fs.unlinkSync(target)
    fs.rmdirSync(path.join(root, 'apps', 'parent-mobile'))
    fs.rmdirSync(path.join(root, 'apps'))
    fs.rmdirSync(root)
    if (fs.existsSync(outside)) fs.rmdirSync(outside)
  }
})
