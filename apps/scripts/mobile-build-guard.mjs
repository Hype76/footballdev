import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mobileApps } from './mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [appRole, profile, platform] = process.argv.slice(2)

const allowedBuilds = new Set(['internal:android', 'store-test:android', 'store-test:ios'])
const app = mobileApps.find((candidate) => candidate.appRole === appRole)

if (!app) {
  console.error('Unknown mobile app role. Expected coach or parent.')
  process.exit(1)
}

if (!allowedBuilds.has(`${profile}:${platform}`)) {
  console.error('Unknown mobile build. Expected internal android, store-test android, or store-test ios.')
  process.exit(1)
}

console.log(`Running mobile release gate before ${app.expectedName} ${profile} ${platform} build.`)
execFileSync('npm', ['run', 'mobile:release-check'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Release gate passed. Starting EAS build for ${app.expectedName} ${profile} ${platform}.`)
execFileSync('npx', ['eas-cli', 'build', '--profile', profile, '--platform', platform], {
  cwd: resolve(repoRoot, app.path),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
