import { execFileSync, spawnSync } from 'node:child_process'
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
const initResult = spawnSync('npx', ['eas-cli', 'project:init', '--force'], {
  cwd: resolve(repoRoot, app.path),
  encoding: 'utf8',
  shell: process.platform === 'win32',
})

if (initResult.stdout) {
  process.stdout.write(initResult.stdout)
}

if (initResult.stderr) {
  process.stderr.write(initResult.stderr)
}

const changedAppConfig = execFileSync('git', ['status', '--short', '--', app.appConfig], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()

if (changedAppConfig) {
  console.error(`${app.expectedName} app config changed during EAS project setup.`)
  console.error('Do not commit EAS project IDs into app.config.js. Revert that app config change and store EXPO_PUBLIC_EAS_PROJECT_ID in EAS only.')
  process.exit(1)
}

const initOutput = `${initResult.stdout || ''}\n${initResult.stderr || ''}`
const dynamicConfigProjectCreated = initOutput.includes('Cannot automatically write to dynamic config') &&
  initOutput.includes('Created @')

if (initResult.status !== 0 && !dynamicConfigProjectCreated) {
  console.error(`${app.expectedName} EAS project setup failed.`)
  process.exit(initResult.status || 1)
}

if (dynamicConfigProjectCreated) {
  console.log(`${app.expectedName} EAS project was created. Dynamic app config is expected to read EXPO_PUBLIC_EAS_PROJECT_ID from EAS environment values.`)
}

console.log(`${app.expectedName} EAS project setup finished without tracked app config changes.`)
