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

const phase = {
  title: 'Phase 2: Expo EAS Setup',
  status: 'external',
  rule: 'Keep both apps on test Supabase until live release approval is explicit.',
}

const easInitCommands = {
  coach: 'npm run mobile:eas:init:coach',
  parent: 'npm run mobile:eas:init:parent',
}

const easEnvCommands = {
  coach: 'npm run mobile:eas:env:coach',
  parent: 'npm run mobile:eas:env:parent',
}

console.log(`${phase.title}`)
console.log(`Status: ${phase.status}`)
console.log(phase.rule)
console.log('')
console.log('Local readiness snapshot:')
console.log(`- Working tree: ${readGitStatus() ? 'has uncommitted changes' : 'clean'}`)
console.log(`- Private evidence folder: ${existsSync(evidenceDir) ? 'present' : 'not created yet'}`)
console.log('- Required local gate before external actions: npm run mobile:release-check')
console.log('- No Netlify deploy is required for mobile EAS or store setup.')
console.log('')
console.log('Before external setup:')
console.log('- Run npm run mobile:release-check from the repo root.')
console.log('- Create or update the private evidence file with npm run mobile:evidence:init.')
console.log('- Confirm you are logged in to the correct Expo account.')
console.log('- Make sure the working tree is clean before creating EAS projects or native builds.')
console.log('- Do not commit EAS project IDs, Supabase keys, API URLs, Apple keys, Google service account files, provisioning profiles, passwords, or reviewer credentials.')
console.log('')
console.log('Create EAS projects:')

mobileApps.forEach((app) => {
  console.log(`- ${app.expectedName}`)
  console.log(`  ${easInitCommands[app.appRole]}`)
  console.log('  Store EXPO_PUBLIC_EAS_PROJECT_ID in Expo EAS only.')
  console.log(`  Verify environment values with ${easEnvCommands[app.appRole]}`)
})

console.log('')
console.log('Set these EAS values for each app and each reviewer build profile:')
console.log('- EXPO_PUBLIC_SUPABASE_ENV=test')
console.log('- EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false')
console.log('- EXPO_PUBLIC_SUPABASE_URL set to the test Supabase project')
console.log('- EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY set to the test Supabase project')
console.log('- EXPO_PUBLIC_API_BASE_URL set to the HTTPS test API host')
console.log('- EXPO_PUBLIC_EAS_PROJECT_ID set in EAS only')
console.log('')
console.log('After setup:')
console.log('- Run npm run mobile:release-check again.')
console.log('- Record external evidence outside git with apps/MOBILE_EXTERNAL_RELEASE_EVIDENCE.md.')
console.log('- Do not start native builds until both EAS projects and test environment values are confirmed.')
