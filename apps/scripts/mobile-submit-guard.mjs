import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertEasLogin } from './mobile-eas-auth.mjs'
import { mobileApps } from './mobile-apps.mjs'
import { loadMobileLocalEnv } from './mobile-local-env.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [appRole, platform, profile = 'store-test'] = process.argv.slice(2)

const allowedPlatforms = new Set(['android', 'ios'])
const allowedProfiles = new Set(['store-test', 'store-live'])
const authorisedParentProductionReferences = new Set([
  'FP-MOBILE-PARENT-IOS-BLACK-SCREEN-AND-PLAY-CLOSED-TEST-28',
  'FP-MOBILE-LIVE-QA-CROSSPRODUCT-CORRECTIVE-MASTER-34',
])
const app = mobileApps.find((candidate) => candidate.appRole === appRole)
const submissionConfirmed = (process.env.MOBILE_SUBMISSION_CONFIRMED || '').trim().toLowerCase() === 'true'
const iosInternalTestersConfirmed = (process.env.MOBILE_IOS_INTERNAL_TESTERS_CONFIRMED || '').trim().toLowerCase() === 'true'
const promotionReference = (process.env.MOBILE_PRODUCTION_PROMOTION_REFERENCE || '').trim()
const submissionBuildId = (process.env.MOBILE_SUBMISSION_BUILD_ID || '').trim()

if (!app) {
  console.error('Unknown mobile app role. Expected coach or parent.')
  process.exit(1)
}

if (!allowedPlatforms.has(platform)) {
  console.error('Unknown submit platform. Expected android or ios.')
  process.exit(1)
}

if (!allowedProfiles.has(profile)) {
  console.error('Unknown submit profile. Expected store-test or store-live.')
  process.exit(1)
}

const authorisedProductionSubmission = (
  promotionReference === 'FP-MOBILE-PARENT-COACH-FINAL-PUBLIC-RELEASE-MASTER-39'
  || promotionReference === 'FP-MOBILE-SIMON-FEEDBACK-55'
  || promotionReference === 'FP-MOBILE-USABILITY-OFFLINE-57'
  || promotionReference === 'FP-MOBILE-CHAT-NOTIFY-PERF-58'
  || (platform === 'ios' && appRole === 'parent' && authorisedParentProductionReferences.has(promotionReference))
  || (appRole === 'coach' && promotionReference === 'FP-MOBILE-COACH-FORMATION-AUTOUPDATE-49')
  || (appRole === 'coach' && promotionReference === 'FP-MOBILE-COACH-FORMATION-STEPPER-50')
  || (appRole === 'coach' && promotionReference === 'FP-MOBILE-COACH-FORMATION-DRAG-51')
  || (appRole === 'coach' && promotionReference === 'FP-MOBILE-COACH-RESOURCES-MATCH-LINK-CORRECTIVE-53')
  || (appRole === 'coach' && promotionReference === 'FP-MOBILE-COACH-FORM-SELECTION-CORRECTIVE-54')
  || (platform === 'ios' && appRole === 'coach' && [
    'FP-MOBILE-COACH-PRODUCTION-PROMOTION-MASTER-32',
    'FP-MOBILE-COACH-LIVE-QA-CORRECTIVE-35',
    'FP-MOBILE-COACH-DEVICE-CORRECTIVE-40',
    'FP-MOBILE-COACH-DEVICE-CORRECTIVE-41',
  ].includes(promotionReference))
)

if (profile === 'store-live' && !authorisedProductionSubmission) {
  console.error(platform === 'ios'
    ? 'Production iOS submission not authorised for this app and reference.'
    : 'Production Android submission not authorised for this app and reference.')
  console.error('Reason: production_build_not_authorised')
  process.exit(1)
}

if (profile === 'store-live' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionBuildId)) {
  console.error('Production store submission requires the exact completed EAS build ID in MOBILE_SUBMISSION_BUILD_ID.')
  console.error('Reason: production_submission_build_id_required')
  process.exit(1)
}

if (!submissionConfirmed) {
  console.error('Mobile store submission is blocked until final external QA is confirmed.')
  console.error('Complete store records, reviewer credentials, screenshots, reviewer notes, physical device QA, notification QA, and private release evidence first.')
  console.error('Then rerun with MOBILE_SUBMISSION_CONFIRMED=true.')
  process.exit(1)
}

if (platform === 'ios' && !iosInternalTestersConfirmed) {
  console.error('iOS submission is blocked until Steve and Simon are confirmed as active Internal Testers for both Coach and Parents.')
  console.error('Confirm both users have App Store Connect access to both apps and belong to each app Internal Testers group.')
  console.error('Then rerun with MOBILE_IOS_INTERNAL_TESTERS_CONFIRMED=true.')
  console.error('Reason: ios_internal_testers_not_confirmed')
  process.exit(1)
}

assertEasLogin()

const easEnvironment = profile === 'store-live' ? 'production' : 'preview'
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

console.log(`Running mobile release gate before ${app.expectedName} ${profile} ${platform} submit.`)
execFileSync('npm', ['run', 'mobile:release-check'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Release gate passed. Starting EAS submit for ${app.expectedName} ${profile} ${platform}.`)
const submitArgs = ['eas-cli', 'submit', '--profile', profile, '--platform', platform]
if (platform === 'ios') submitArgs.push('--groups', 'Internal Testers')
if (profile === 'store-live') {
  submitArgs.push('--id', submissionBuildId)
  submitArgs.push('--non-interactive', '--no-wait')
}
execFileSync('npx', submitArgs, {
  cwd: resolve(repoRoot, app.path),
  env: {
    ...process.env,
    ...loadMobileLocalEnv(repoRoot, app.path),
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
