import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mobileApps } from './mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [appRole, platform] = process.argv.slice(2)

const allowedPlatforms = new Set(['android', 'ios'])
const app = mobileApps.find((candidate) => candidate.appRole === appRole)

if (!app) {
  console.error('Unknown mobile app role. Expected coach or parent.')
  process.exit(1)
}

if (!allowedPlatforms.has(platform)) {
  console.error('Unknown submit platform. Expected android or ios.')
  process.exit(1)
}

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
