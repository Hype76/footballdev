import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertEasLogin } from './mobile-eas-auth.mjs'
import { publisherInvocation } from './mobile-eas-publisher.mjs'
import { mobileApps } from './mobile-apps.mjs'
import { loadMobileLocalEnv } from './mobile-local-env.mjs'
import { targetPaths } from './mobile-ota-provenance.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [appRole, updatePlatform = 'all', targetId = 'tracked'] = process.argv.slice(2)
const app = mobileApps.find((candidate) => candidate.appRole === appRole)
const supportedUpdatePlatforms = new Set(['all', 'ios', 'android'])
const updateConfirmed = String(process.env.MOBILE_OTA_UPDATE_CONFIRMED || '').trim().toLowerCase() === 'true'
const updateMessage = String(process.env.MOBILE_OTA_UPDATE_MESSAGE || '').trim()
const productionProfile = 'store-live'
const reviewedManifestSha256 = String(process.env.MOBILE_OTA_REVIEWED_MANIFEST_SHA256 || '').trim().toLowerCase()
if (!/^[a-f0-9]{64}$/.test(reviewedManifestSha256)) throw new Error('MOBILE_OTA_REVIEWED_MANIFEST_SHA256 must identify the reviewed complete export')
if (process.argv.slice(2).length > 3) throw new Error('Unsupported extra publication arguments')
targetPaths(repoRoot, appRole, targetId, '0'.repeat(40))

if (!app) {
  console.error('Unknown mobile app role. Expected coach or parent.')
  process.exit(1)
}

if (!supportedUpdatePlatforms.has(updatePlatform)) {
  console.error('Unknown mobile update platform. Expected all, ios, or android.')
  process.exit(1)
}

if (!updateConfirmed) {
  console.error('Production mobile update is blocked until MOBILE_OTA_UPDATE_CONFIRMED=true is set for the guarded command.')
  process.exit(1)
}

if (!updateMessage) {
  console.error('Production mobile update is blocked until MOBILE_OTA_UPDATE_MESSAGE contains a concise release message.')
  process.exit(1)
}

if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/.test(updateMessage)) {
  console.error('Production mobile update is blocked because MOBILE_OTA_UPDATE_MESSAGE contains unsupported characters or is too long.')
  process.exit(1)
}

const gitStatus = execFileSync('git', ['-c', `safe.directory=${repoRoot.replaceAll('\\', '/')}`, 'status', '--porcelain'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()

if (gitStatus) {
  console.error('Production mobile update is blocked because the release worktree is not clean.')
  process.exit(1)
}

execFileSync('git', ['-c', `safe.directory=${repoRoot.replaceAll('\\', '/')}`, 'fetch', 'origin', '--prune'], {
  cwd: repoRoot,
  stdio: 'inherit',
})

const headCommit = execFileSync('git', ['-c', `safe.directory=${repoRoot.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()
const originMainCommit = execFileSync('git', ['-c', `safe.directory=${repoRoot.replaceAll('\\', '/')}`, 'rev-parse', 'origin/main'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()

if (!headCommit || headCommit !== originMainCommit) {
  console.error('Production mobile update is blocked because HEAD does not exactly match origin/main.')
  process.exit(1)
}

assertEasLogin()

const updateEnvironment = {
  ...process.env,
  ...loadMobileLocalEnv(repoRoot, app.path),
  EXPO_PUBLIC_BUILD_PROFILE: productionProfile,
}

console.log(`Validating the resolved ${appRole} ${productionProfile} update environment without printing values.`)
const resolvedEnvironmentCommand = `node ../scripts/mobile-ota-worker.mjs verify ${appRole} ${targetId} ${headCommit} ${reviewedManifestSha256}`
const environmentPublisher = publisherInvocation(['env:exec', 'production', resolvedEnvironmentCommand, '--non-interactive'])
execFileSync(environmentPublisher.command, environmentPublisher.args, {
  cwd: resolve(repoRoot, app.path),
  env: updateEnvironment,
  stdio: 'inherit',
  shell: false,
})

console.log(`Running the mobile release gate before updating ${app.expectedName}.`)
execFileSync('npm', ['run', 'mobile:release-check'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Revalidating reviewed ${app.expectedName} ${targetId} bytes before the guarded update.`)
const publishCommand = `node ../scripts/mobile-ota-worker.mjs publish ${appRole} ${targetId} ${headCommit} ${reviewedManifestSha256} ${updatePlatform} "${updateMessage}"`
const updatePublisher = publisherInvocation(['env:exec', 'production', publishCommand, '--non-interactive'])
execFileSync(updatePublisher.command, updatePublisher.args, {
  cwd: resolve(repoRoot, app.path),
  env: updateEnvironment,
  stdio: 'inherit',
  shell: false,
})
