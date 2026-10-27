import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test from 'node:test'
import { hash, inventory, evaluateAudit } from '../scripts/security-verify-reviewed-backports.mjs'
import { prepareWrites } from '../scripts/security-apply-reviewed-backports.mjs'

const baseline = '1987002eab5feb025daa787fbf26d9a434b743e5'
const record = JSON.parse(fs.readFileSync('security/reviewed-source-remediations.json'))
const payload = JSON.parse(fs.readFileSync('security/patches/reviewed-source-manifest.json'))
const oldBytes = file => execFileSync('git', ['show', `${baseline}:${file}`])
const read = file => JSON.parse(fs.readFileSync(file))
const require = createRequire(import.meta.url)

for (const app of ['parent', 'coach']) {
  const scope = `apps/${app}-mobile`
  test(`${app}: Forge is the only dependency identity change and native inputs stay compatible`, () => {
    const lock = read(`${scope}/package-lock.json`), before = JSON.parse(oldBytes(`${scope}/package-lock.json`))
    const old = before.packages['node_modules/node-forge'], current = lock.packages['node_modules/node-forge']
    assert.equal(old.version, '1.4.0'); assert.equal(current.version, '1.4.2')
    before.packages['node_modules/node-forge'] = current
    assert.deepEqual(lock, before, 'Another dependency or native module changed')
    const pkg = read(`${scope}/package.json`), oldPkg = JSON.parse(oldBytes(`${scope}/package.json`))
    assert.equal(pkg.overrides['node-forge'], '1.4.2')
    delete pkg.overrides['node-forge']
    assert.deepEqual(pkg, oldPkg, 'Direct dependencies, scripts or another override changed')
    for (const file of [`${scope}/app.config.js`, `${scope}/eas.json`, 'apps/mobile-core/appConfig.cjs']) {
      assert.equal(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), oldBytes(file).toString().replaceAll('\r\n', '\n'), 'Native/runtime configuration changed')
    }
    const target = record.targets.find(item => item.scope === scope && item.name === 'node-forge')
    const dir = `${scope}/node_modules/node-forge`, treeSha256 = hash(Buffer.from(JSON.stringify(inventory(dir))))
    assert.equal(target.remediation, 'official-release')
    assert.equal(treeSha256, target.originalTreeSha256)
    assert.equal(treeSha256, target.patchedTreeSha256)
    assert.deepEqual(prepareWrites(record, payload, [{ target, dir, treeSha256 }]), [])
    assert.ok(!inventory(dir).some(item => /(?:\.node$|expo-module\.config\.json$|react-native\.config\.js$|\.podspec$|build\.gradle$)/.test(item.path)), 'Forge unexpectedly contains native module inputs')
    const forge = require('../' + dir)
    const pem = '-----BEGIN TEST-----\nYWJj\n-----END TEST-----\n'
    assert.equal(forge.pem.decode(Buffer.from(pem))[0].body, 'abc', 'Official1.4.2 PEM Buffer regression')
  })
}

test('Parent remains on the installed1.0.22 app-version runtime policy', () => {
  const config = require('../apps/parent-mobile/app.config.js')
  assert.equal(config.expo.version, '1.0.22')
  assert.deepEqual(config.expo.runtimeVersion, { policy: 'appVersion' })
})

test('Forge advisories can never use the retired source exception or payload', () => {
  assert.equal(record.eligibleAdvisories['node-forge'], undefined)
  assert.deepEqual(record.patches.map(item => item.file), ['patches/braces-3.0.3.patch'])
  assert.deepEqual(payload.libraries.map(item => item.name), ['braces'])
  for (const id of ['GHSA-86w9-cpqp-85rv', 'GHSA-2g46-22mc-6gwp', 'GHSA-6qrw-m8cv-hcxf']) {
    const audit = { auditReportVersion: 2, vulnerabilities: { 'node-forge': { severity: 'high', via: [{ url: `https://github.com/advisories/${id}`, severity: 'high' }], nodes: ['node_modules/node-forge'] } }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } } }
    const result = evaluateAudit(audit, read('apps/parent-mobile/package-lock.json'), 'apps/parent-mobile', record)
    assert.ok(result.failures.length)
    assert.deepEqual(result.acceptedSourceRemediations, [])
  }
})
