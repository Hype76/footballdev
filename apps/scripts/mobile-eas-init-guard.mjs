import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertEasLogin } from './mobile-eas-auth.mjs'
import { mobileApps } from './mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [appRole] = process.argv.slice(2)
const app = mobileApps.find((candidate) => candidate.appRole === appRole)

if (!app) {
  console.error('Unknown mobile app role. Expected coach or parent.')
  process.exit(1)
}

assertEasLogin()

console.log(`Running mobile release gate before ${app.expectedName} EAS project setup.`)
execFileSync('npm', ['run', 'mobile:release-check'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Release gate passed. Starting EAS project setup for ${app.expectedName}.`)
console.log('If EAS offers to write the project ID into app.config.js, remove that change and store EXPO_PUBLIC_EAS_PROJECT_ID in EAS only.')
execFileSync('npx', ['eas-cli', 'project:init', '--force'], {
  cwd: resolve(repoRoot, app.path),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

const changedAppConfig = execFileSync('git', ['status', '--short', '--', app.appConfig], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()

if (changedAppConfig) {
  console.error(`${app.expectedName} app config changed during EAS project setup.`)
  console.error('Do not commit EAS project IDs into app.config.js. Revert that app config change and store EXPO_PUBLIC_EAS_PROJECT_ID in EAS only.')
  process.exit(1)
}

console.log(`${app.expectedName} EAS project setup finished without tracked app config changes.`)
