import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertEasLogin } from './mobile-eas-auth.mjs'
import { mobileApps } from './mobile-apps.mjs'
import { loadMobileLocalEnv } from './mobile-local-env.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [appRole, updatePlatform = 'all'] = process.argv.slice(2)
const app = mobileApps.find((candidate) => candidate.appRole === appRole)
const supportedUpdatePlatforms = new Set(['all', 'ios', 'android'])
const updateConfirmed = String(process.env.MOBILE_OTA_UPDATE_CONFIRMED || '').trim().toLowerCase() === 'true'
const updateMessage = String(process.env.MOBILE_OTA_UPDATE_MESSAGE || '').trim()
const productionProfile = 'store-live'

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

const gitStatus = execFileSync('git', ['status', '--porcelain'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()

if (gitStatus) {
  console.error('Production mobile update is blocked because the release worktree is not clean.')
  process.exit(1)
}

execFileSync('git', ['fetch', 'origin', '--prune'], {
  cwd: repoRoot,
  stdio: 'inherit',
})

const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()
const originMainCommit = execFileSync('git', ['rev-parse', 'origin/main'], {
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
const resolvedEnvironmentCommand = `node ../scripts/mobile-resolved-environment-check.mjs ${appRole} ${productionProfile}`
const resolvedEnvironmentArgument = process.platform === 'win32' ? `"${resolvedEnvironmentCommand}"` : resolvedEnvironmentCommand
execFileSync('npx', ['eas-cli', 'env:exec', 'production', resolvedEnvironmentArgument, '--non-interactive'], {
  cwd: resolve(repoRoot, app.path),
  env: updateEnvironment,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Running the mobile release gate before updating ${app.expectedName}.`)
execFileSync('npm', ['run', 'mobile:release-check'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Publishing the guarded ${app.expectedName} ${updatePlatform} production update from ${headCommit}.`)
const updateMessageArgument = process.platform === 'win32' ? `"${updateMessage}"` : updateMessage
execFileSync('npx', [
  'eas-cli',
  'update',
  '--channel',
  'production',
  '--environment',
  'production',
  '--message',
  updateMessageArgument,
  '--platform',
  updatePlatform,
  '--clear-cache',
  '--non-interactive',
  '--json',
], {
  cwd: resolve(repoRoot, app.path),
  env: updateEnvironment,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
