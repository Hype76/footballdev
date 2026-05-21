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

console.log(`Running mobile release gate before reading ${app.expectedName} EAS environment values.`)
execFileSync('npm', ['run', 'mobile:release-check'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log(`Release gate passed. Listing EAS project environment variables for ${app.expectedName}.`)
console.log('This command does not request sensitive values.')
console.log('Confirm these names exist and are set for the intended EAS environments:')
console.log('- EXPO_PUBLIC_SUPABASE_ENV')
console.log('- EXPO_PUBLIC_ALLOW_LIVE_SUPABASE')
console.log('- EXPO_PUBLIC_SUPABASE_URL')
console.log('- EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
console.log('- EXPO_PUBLIC_API_BASE_URL')
console.log('- EXPO_PUBLIC_EAS_PROJECT_ID')
console.log('')
console.log('Required profile values before native builds:')
console.log('- development: EXPO_PUBLIC_SUPABASE_ENV=test, EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false, API URL can be test or local dev.')
console.log('- internal: EXPO_PUBLIC_SUPABASE_ENV=test, EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false, API URL must be HTTPS test.')
console.log('- store-test: EXPO_PUBLIC_SUPABASE_ENV=test, EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false, API URL must be HTTPS test.')
console.log('Do not set MOBILE_NATIVE_BUILD_CONFIRMED=true until internal and store-test match those values.')

execFileSync('npx', ['eas-cli', 'env:list', '--scope', 'project', '--format', 'long'], {
  cwd: resolve(repoRoot, app.path),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
