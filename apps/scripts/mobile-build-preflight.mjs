import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mobileApps } from './mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const evidenceDir = join(repoRoot, 'apps/mobile-release-evidence')

function readGitStatus() {
  return execSync('git status --short', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
}

console.log('Football Player Mobile Build Preflight')
console.log('Status: local checklist only')
console.log('This command does not call EAS, Netlify, Supabase, Apple, Google, or any live service.')
console.log('')
console.log('Local readiness snapshot:')
console.log(`- Working tree: ${readGitStatus() ? 'has uncommitted changes' : 'clean'}`)
console.log(`- Private evidence folder: ${existsSync(evidenceDir) ? 'present' : 'not created yet'}`)
console.log('- Required local gate before native builds: npm run mobile:release-check')
console.log('')
console.log('Apps covered:')

mobileApps.forEach((app) => {
  console.log(`- ${app.expectedName}`)
  console.log(`  Internal Android: npm run mobile:build:${app.appRole}:android:internal`)
  console.log(`  Store-test Android: npm run mobile:build:${app.appRole}:android:store-test`)
  console.log(`  Store-test iOS: npm run mobile:build:${app.appRole}:ios:store-test`)
})

console.log('')
console.log('External setup required before setting MOBILE_NATIVE_BUILD_CONFIRMED=true:')
console.log('- EAS project exists for Football Player Coach.')
console.log('- EAS project exists for Football Player Parents.')
console.log('- EXPO_PUBLIC_EAS_PROJECT_ID is stored in EAS only for each app.')
console.log('- EXPO_PUBLIC_SUPABASE_ENV=test for each reviewer build profile.')
console.log('- EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false for each reviewer build profile.')
console.log('- EXPO_PUBLIC_SUPABASE_URL points at the test Supabase project.')
console.log('- EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY belongs to the test Supabase project.')
console.log('- EXPO_PUBLIC_API_BASE_URL is the HTTPS test API host for internal and store-test profiles.')
console.log('- EAS env values were reviewed with npm run mobile:eas:env:coach and npm run mobile:eas:env:parent.')
console.log('')
console.log('Native build commands stay blocked until MOBILE_NATIVE_BUILD_CONFIRMED=true is set for the build command.')
