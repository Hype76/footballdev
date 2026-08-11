import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertEasLogin } from './mobile-eas-auth.mjs'
import { mobileApps } from './mobile-apps.mjs'
import { loadMobileLocalEnv } from './mobile-local-env.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [appRole, profile, platform] = process.argv.slice(2)

const allowedBuilds = new Set([
  'internal:android',
  'store-test:android',
  'store-test:ios',
  'internal-live:android',
  'store-live:ios',
])
const productionBuilds = new Set(['internal-live:android', 'store-live:android', 'store-live:ios'])
const authorisedParentProductionReferences = new Set([
  'FP-MOBILE-PARENT-IOS-BLACK-SCREEN-AND-PLAY-CLOSED-TEST-28',
  'FP-MOBILE-PARENT-LIVE-ACCOUNT-QA-CORRECTIVE-29',
  'FP-MOBILE-PARENT-COACH-FINAL-PUBLIC-RELEASE-MASTER-39',
])
const authorisedCoachProductionReferences = new Set([
  'FP-MOBILE-COACH-PRODUCTION-PROMOTION-MASTER-32',
  'FP-MOBILE-COACH-LIVE-QA-CORRECTIVE-35',
  'FP-MOBILE-COMMS-POLLS-PRIVACY-CORRECTIVE-36',
  'FP-MOBILE-PARENT-COACH-FINAL-PUBLIC-RELEASE-MASTER-39',
  'FP-MOBILE-COACH-DEVICE-CORRECTIVE-40',
  'FP-MOBILE-COACH-DEVICE-CORRECTIVE-41',
])
const app = mobileApps.find((candidate) => candidate.appRole === appRole)
const buildConfirmed = (process.env.MOBILE_NATIVE_BUILD_CONFIRMED || '').trim().toLowerCase() === 'true'
const promotionReference = (process.env.MOBILE_PRODUCTION_PROMOTION_REFERENCE || '').trim()
const easEnvironment = productionBuilds.has(`${profile}:${platform}`) ? 'production' : profile === 'development' ? 'development' : 'preview'
const masterStoreAndroid = `${profile}:${platform}` === 'store-live:android'
  && promotionReference === 'FP-MOBILE-PARENT-COACH-FINAL-PUBLIC-RELEASE-MASTER-39'

if (!app) {
  console.error('Unknown mobile app role. Expected coach or parent.')
  process.exit(1)
}

if (!allowedBuilds.has(`${profile}:${platform}`) && !masterStoreAndroid) {
  console.error('Unknown mobile build profile and platform combination.')
  process.exit(1)
}

const productionReferenceAuthorised = appRole === 'parent'
  ? authorisedParentProductionReferences.has(promotionReference)
  : authorisedCoachProductionReferences.has(promotionReference)

if (productionBuilds.has(`${profile}:${platform}`) && !productionReferenceAuthorised) {
  console.error('Production mobile build not authorised for this app and reference.')
  console.error('Reason: production_build_not_authorised')
  process.exit(1)
}

if (!buildConfirmed) {
  console.error('Mobile native build is blocked until EAS setup and the selected environment values are confirmed.')
  console.error('Complete the EAS project, guarded Supabase values, HTTPS API values, and EAS environment verification first.')
  console.error('Then rerun with MOBILE_NATIVE_BUILD_CONFIRMED=true.')
  process.exit(1)
}

assertEasLogin()

console.log(`Validating the resolved ${appRole} ${profile} EAS environment without printing values.`)
const resolvedEnvironmentCommand = `node ../scripts/mobile-resolved-environment-check.mjs ${appRole} ${profile}`
const resolvedEnvironmentArgument = process.platform === 'win32' ? `"${resolvedEnvironmentCommand}"` : resolvedEnvironmentCommand
execFileSync('npx', ['eas-cli', 'env:exec', easEnvironment, resolvedEnvironmentArgument, '--non-interactive'], {
  cwd: resolve(repoRoot, app.path),
  env: {
    ...process.env,
    ...loadMobileLocalEnv(repoRoot, app.path),
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Running mobile release gate before ${app.expectedName} ${profile} ${platform} build.`)
execFileSync('npm', ['run', 'mobile:release-check'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Release gate passed. Starting EAS build for ${app.expectedName} ${profile} ${platform}.`)
execFileSync('npx', ['eas-cli', 'build', '--profile', profile, '--platform', platform, '--non-interactive', '--no-wait'], {
  cwd: resolve(repoRoot, app.path),
  env: {
    ...process.env,
    ...loadMobileLocalEnv(repoRoot, app.path),
    MOBILE_EAS_REMOTE_BUILD: 'true',
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
