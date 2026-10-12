import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { hash } from './security-verify-reviewed-backports.mjs'

export function decodeNetlifyReceipt(env) {
  const parts = [env.FOOTBALL_REVIEW_RECEIPT_GZIP_BASE64_1, env.FOOTBALL_REVIEW_RECEIPT_GZIP_BASE64_2]
  assert.ok(parts.every(value => typeof value === 'string' && value.length > 0 && value.length <= 5000), 'Protected Netlify review receipt parts are required')
  const encoded = parts.join('')
  assert.match(encoded, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Invalid compressed receipt encoding')
  const compressed = Buffer.from(encoded, 'base64')
  assert.equal(compressed.toString('base64'), encoded, 'Noncanonical compressed review receipt')
  const bytes = gunzipSync(compressed, { maxOutputLength: 65536 })
  assert.match(env.FOOTBALL_REVIEW_RECEIPT_SHA256 || '', /^[a-f0-9]{64}$/, 'Externally approved Netlify review receipt SHA256 is required')
  assert.equal(hash(bytes), env.FOOTBALL_REVIEW_RECEIPT_SHA256, 'Netlify review receipt differs from protected external approval')
  const receipt = JSON.parse(bytes)
  assert.ok(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'Invalid Netlify review receipt object')
  return bytes
}
export function runNetlifyBuild(root, env = process.env, run = execFileSync) {
  assert.equal(env.NETLIFY, 'true', 'Use this entry point only for Netlify builds')
  assert.ok(['production', 'deploy-preview'].includes(env.CONTEXT), 'Unapproved Netlify build context')
  const bytes = decodeNetlifyReceipt(env)
  const options = { cwd: root, encoding: 'utf8', env, shell: process.platform === 'win32' }
  assert.equal(run('git', ['rev-parse', 'HEAD'], options).trim(), env.COMMIT_REF, 'Netlify source commit identity mismatch')
  assert.equal(run('npm', ['--version'], options).trim(), '11.7.0', 'Netlify must use pinned npm11.7.0')
  // Netlify may use shallow history. Fetch only the immutable source baseline,
  // with no checkout, source mutation or branch change.
  run('git', ['fetch', '--no-tags', 'origin', '864a6ad3856a02b65ec33bfe8e952e6f98d13dbd'], { ...options, stdio: 'inherit' })
  const buildEnv = { ...env, FOOTBALL_REVIEW_RECEIPT_BASE64: bytes.toString('base64') }
  const buildOptions = { cwd: root, env: buildEnv, stdio: 'inherit', shell: process.platform === 'win32' }
  run('npm', ['run', 'security:provision', '--', '--install-mobile'], buildOptions)
  run(process.execPath, ['scripts/security-maintained-release-gate.mjs'], { ...buildOptions, shell: false })
  run('npm', ['run', 'build:live'], buildOptions)
  run('npm', ['run', 'verify:build-env'], buildOptions)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 2, 'No build or security bypass arguments permitted')
  runNetlifyBuild(process.cwd())
}
