import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { artifactPath, hash, loadRecord, verifySource, verifyReviewBytes, verifyCopies, verifyInstallation } from './security-verify-reviewed-backports.mjs'

const scopes = ['apps/parent-mobile', 'apps/coach-mobile']
export function decodeReceipt(encoded, trustedSha256) {
  assert.match(trustedSha256 || '', /^[a-f0-9]{64}$/, 'Externally approved receipt SHA256 is required')
  assert.ok(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 65536, 'Invalid encoded receipt size')
  assert.match(encoded, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Invalid receipt base64')
  const bytes = Buffer.from(encoded, 'base64')
  assert.equal(bytes.toString('base64'), encoded, 'Noncanonical receipt base64')
  assert.equal(hash(bytes), trustedSha256, 'Receipt does not match externally approved SHA256')
  const parsed = JSON.parse(bytes)
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Receipt must be a JSON object')
  return bytes
}
export function assertInstallScope(root, scope) {
  assert.ok(scopes.includes(scope), 'Unapproved install scope')
  const absolute = path.resolve(root, scope)
  for (const relative of ['apps', scope]) {
    const file = path.resolve(root, relative)
    assert.equal(fs.realpathSync(file), file, 'Linked install parent forbidden')
    assert.ok(fs.statSync(file).isDirectory(), 'Install parent must be a real directory')
  }
  const modules = path.join(absolute, 'node_modules')
  let moduleEntry
  try { moduleEntry = fs.lstatSync(modules) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!moduleEntry) {
    assert.ok(!fs.lstatSync(absolute).isSymbolicLink(), 'Linked app scope forbidden')
    return
  }
  assert.equal(fs.realpathSync(modules), modules, 'Linked node_modules forbidden before clean install')
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) {
        // npm creates Unix executable links in .bin. They must stay inside this owned tree.
        assert.ok(path.relative(modules, file).split(path.sep).includes('.bin'), 'Package links forbidden before clean install')
        const relative = path.relative(modules, fs.realpathSync(file))
        assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'External executable link forbidden')
      } else if (stat.isDirectory()) walk(file)
    }
  }
  walk(modules)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode] = process.argv.slice(2)
  assert.ok(process.argv.length === 3 && ['--install-mobile', '--no-install'].includes(mode), 'Choose exactly --install-mobile or --no-install')
  const root = process.cwd(), { record } = loadRecord(root), source = verifySource(root, record)
  const externalPin = process.env.FOOTBALL_REVIEW_RECEIPT_SHA256
  let bytes
  if (process.env.FOOTBALL_REVIEW_RECEIPT_BASE64) {
    bytes = decodeReceipt(process.env.FOOTBALL_REVIEW_RECEIPT_BASE64, externalPin)
  } else {
    const receipt = path.join(root, '.security-artifacts', 'implementation-review.json')
    assert.equal(fs.realpathSync(path.dirname(receipt)), path.dirname(receipt), 'Linked receipt directory forbidden')
    assert.equal(fs.realpathSync(receipt), receipt, 'Linked receipt file forbidden')
    bytes = fs.readFileSync(receipt)
  }
  // External approval and exact source identity are checked before any writes or npm action.
  const review = verifyReviewBytes(root, record, source, bytes, externalPin)
  for (const scope of scopes) assertInstallScope(root, scope)
  let npmCli
  if (mode === '--install-mobile') {
    npmCli = process.env.npm_execpath
    assert.ok(npmCli && path.basename(npmCli) === 'npm-cli.js', 'Run provisioning through pinned npm11.7.0')
    assert.equal(execFileSync(process.execPath, [npmCli, '--version'], { encoding: 'utf8' }).trim(), '11.7.0', 'Pinned npm11.7.0 required')
  } else verifyCopies(root, record, 'install')
  fs.writeFileSync(artifactPath(root, 'implementation-review.json'), bytes)
  if (npmCli) {
    for (const scope of scopes) execFileSync(process.execPath, [npmCli, 'ci', '--prefix', scope, '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' })
  }
  const verified = loadRecord(root)
  const after = verifySource(root, verified.record)
  assert.equal(after.head, source.head, 'Source HEAD changed during provisioning')
  verifyReviewBytes(root, verified.record, after, bytes, externalPin)
  verifyCopies(root, verified.record, 'install')
  execFileSync(process.execPath, ['scripts/security-apply-reviewed-backports.mjs'], { cwd: root, stdio: 'inherit' })
  verifyInstallation(root, verified.record, after, verifyCopies(root, verified.record), review)
  console.log('Exact externally reviewed backports provisioned across all three owned scopes. No publication action.')
}
