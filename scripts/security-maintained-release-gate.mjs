import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { artifactPath, hash, loadRecord, verifySource, verifyCopies, verifyReview, verifyInstallation, verifyUpstream } from './security-verify-reviewed-backports.mjs'

export const maintainedTestFiles = [
  'tests/security-reviewed-backports.test.mjs', 'tests/security-reviewed-provisioning.test.mjs',
  'tests/security-backport-runtime.test.mjs', 'tests/security-maintained-source.test.mjs',
  'tests/security-tooling-updates.test.mjs',
  'tests/security-toml-upstream.test.mjs',
  'tests/security-forge-official.test.mjs',
]
export function runRequiredCommands(root, run = spawnSync) {
  for (const [command, args] of [
    ['npm', ['run', 'security:supply-chain']],
    [process.execPath, ['--test', ...maintainedTestFiles]],
  ]) {
    const result = run(command, args, { cwd: root, stdio: 'inherit', shell: command === 'npm' && process.platform === 'win32' })
    assert.ok(!result.error && !result.signal && result.status === 0, 'Required maintained source check failed: ' + args.join(' '))
  }
}
export async function verifyMaintainedRelease(root) {
  const { record, payload } = loadRecord(root), source = verifySource(root, record)
  const copies = verifyCopies(root, record), review = verifyReview(root, record, source)
  verifyInstallation(root, record, source, copies, review)
  const upstream = await verifyUpstream(record, payload)
  const after = verifySource(root, loadRecord(root).record)
  assert.equal(after.head, source.head, 'Source HEAD changed during live verification')
  verifyReview(root, record, after)
  verifyCopies(root, record)
  const result = { verifiedAt: new Date().toISOString(), head: source.head, recordSha256: hash(fs.readFileSync(path.join(root, 'security/reviewed-source-remediations.json'))), maintenancePolicySha256: record.adoptionProposalSha256, copies: copies.map(({ relative, treeSha256 }) => ({ path: relative, treeSha256 })), upstream }
  fs.writeFileSync(artifactPath(root, 'maintained-release-verification.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 2, 'No check-skipping or scope arguments permitted')
  runRequiredCommands(process.cwd())
  await verifyMaintainedRelease(process.cwd())
  console.log('Maintained source release gate passed: current advisories, published packages, three exact source-fixed braces copies and two unmodified official Forge copies verified. No calendar approval renewal.')
}
