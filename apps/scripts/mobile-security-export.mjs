import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inventory, sha256 } from './mobile-security-inventory.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [role, outputArgument, expectedCommit, expectedRuntime] = process.argv.slice(2)
if (!['coach', 'parent'].includes(role) || !outputArgument || !/^[a-f0-9]{40}$/.test(expectedCommit || '') || !expectedRuntime) throw new Error('Usage: node apps/scripts/mobile-security-export.mjs <coach|parent> <new-output-directory> <expected-commit> <expected-runtime>')
const output = resolve(outputArgument), project = resolve(repoRoot, 'apps', role + '-mobile')
if (existsSync(output)) throw new Error('Use a new output directory to reject stale export artifacts')
const git = (args) => execFileSync('git', ['-c', `safe.directory=${repoRoot.replaceAll('\\', '/')}`, ...args], {cwd: repoRoot, encoding: 'utf8'}).trim()
function checkSource() {
  assert.equal(git(['rev-parse', 'HEAD']), expectedCommit, 'Source commit changed')
  assert.equal(git(['status', '--porcelain']), '', 'Export requires a clean source worktree')
  const paths = git(['ls-files', '-z']).split('\0').filter(Boolean).sort()
  return sha256(Buffer.from(paths.map((path) => `${path}\0${sha256(readFileSync(resolve(repoRoot, path)))}`).join('\n')))
}
const sourceInputsSha256 = checkSource()
assert.equal(process.env.EXPO_PUBLIC_BUILD_PROFILE, 'store-live', 'Production profile required')
execFileSync(process.execPath, [resolve(repoRoot, 'apps/scripts/mobile-resolved-environment-check.mjs'), role, 'store-live'], {stdio: 'inherit'})
const require = createRequire(resolve(project, 'package.json'))
const { getConfig } = require('expo/config')
const { resolveRuntimeVersionAsync } = require('expo-updates/utils/build/resolveRuntimeVersionAsync.js')
const config = getConfig(project, {isPublicConfig: true}).exp
// EAS update checks private config: public Expo config removes signing fields.
const privateConfig = getConfig(project, {isPublicConfig: false}).exp
assert.equal(config.runtimeVersion?.policy, 'appVersion', 'This producer preserves the tracked appVersion policy')
assert.equal(config.version, expectedRuntime, 'Requested runtime does not match tracked config')
assert.equal(require('./package.json').version, expectedRuntime, 'Requested runtime does not match tracked package')
const resolvedRuntimeVersions = {}
for (const platform of ['ios', 'android']) {
  resolvedRuntimeVersions[platform] = (await resolveRuntimeVersionAsync(project, platform, {}, {workflowOverride: 'managed'})).runtimeVersion
  assert.equal(resolvedRuntimeVersions[platform], expectedRuntime, 'SDK runtime resolution mismatch')
}
const command = { executable: process.execPath, args: [resolve(project, 'node_modules/expo/bin/cli'), 'export', '--platform', 'all', '--source-maps', '--max-workers', '2', '--output-dir', output, '--clear'] }
execFileSync(command.executable, command.args, {cwd: project, env: {...process.env, CI: '1', EXPO_NO_TELEMETRY: '1'}, stdio: 'inherit'})
assert.equal(checkSource(), sourceInputsSha256, 'Tracked source inputs changed during export')
const metadataBytes = readFileSync(resolve(output, 'metadata.json')), metadata = JSON.parse(metadataBytes)
const walk = (path) => readdirSync(path).flatMap((name) => { const item = resolve(path, name); return statSync(item).isDirectory() ? walk(item) : [item] })
const webBundles = walk(resolve(output, '_expo/static/js/web')).filter((path) => path.endsWith('.js'))
assert.equal(webBundles.length, 1, 'Expected one web release bundle')
const artifacts = ['ios', 'android', 'web'].map((platform) => {
  const bundle = platform === 'web' ? relative(output, webBundles[0]).replaceAll('\\', '/') : metadata.fileMetadata[platform].bundle
  const sourceMap = `${bundle}.map`
  return {platform, bundle, sourceMap, bundleSha256: sha256(readFileSync(resolve(output, bundle))), sourceMapSha256: sha256(readFileSync(resolve(output, sourceMap)))}
})
const manifest = {schemaVersion: 1, role, sourceCommit: expectedCommit, sourceInputsSha256, sourceBeforeAndAfterVerified: true, appVersion: config.version, runtimeVersion: expectedRuntime, runtimePolicy: 'appVersion', resolvedRuntimeVersions, metadataSha256: sha256(metadataBytes), command, environmentScope: 'Validated store-live boundary; locked production env:exec invocation recorded in external publisher-operation-binding.json', codeSigningCertificatePresent: Boolean(privateConfig.updates?.codeSigningCertificate), codeSigningMetadataPresent: Boolean(privateConfig.updates?.codeSigningMetadata), artifacts}
const manifestPath = resolve(output, 'security-export-manifest.json'), manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(manifestPath, manifestBytes)
const manifestSha256 = sha256(manifestBytes)
const result = {scope: 'Exact source/runtime/platform/hash-bound production-environment exported JavaScript inventory only', manifestSha256, sourceCommit: expectedCommit, artifacts: inventory(output, {manifestPath, manifestSha256, sourceCommit: expectedCommit, runtimeVersion: expectedRuntime, appVersion: config.version, runtimePolicy: 'appVersion', platforms: ['ios', 'android', 'web']})}
writeFileSync(resolve(output, 'security-inventory.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({role, sourceCommit: expectedCommit, runtimeVersion: expectedRuntime, manifestSha256, artifacts: result.artifacts.map(({platform, bundleSha256, sourceMapSha256, moduleCount, roots}) => ({platform, bundleSha256, sourceMapSha256, moduleCount, roots}))}, null, 2))
