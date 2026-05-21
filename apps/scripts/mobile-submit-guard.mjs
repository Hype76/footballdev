import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertEasLogin } from './mobile-eas-auth.mjs'
import { mobileApps } from './mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [appRole, platform] = process.argv.slice(2)

const allowedPlatforms = new Set(['android', 'ios'])
const app = mobileApps.find((candidate) => candidate.appRole === appRole)
const submissionConfirmed = (process.env.MOBILE_SUBMISSION_CONFIRMED || '').trim().toLowerCase() === 'true'

if (!app) {
  console.error('Unknown mobile app role. Expected coach or parent.')
  process.exit(1)
}

if (!allowedPlatforms.has(platform)) {
  console.error('Unknown submit platform. Expected android or ios.')
  process.exit(1)
}

if (!submissionConfirmed) {
  console.error('Mobile store submission is blocked until final external QA is confirmed.')
  console.error('Complete store records, reviewer credentials, screenshots, reviewer notes, physical device QA, notification QA, and private release evidence first.')
  console.error('Then rerun with MOBILE_SUBMISSION_CONFIRMED=true.')
  process.exit(1)
}

assertEasLogin()

console.log(`Running mobile release gate before ${app.expectedName} ${platform} submit.`)
execFileSync('npm', ['run', 'mobile:release-check'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Release gate passed. Starting EAS submit for ${app.expectedName} ${platform}.`)
execFileSync('npx', ['eas-cli', 'submit', '--profile', 'store-test', '--platform', platform], {
  cwd: resolve(repoRoot, app.path),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
