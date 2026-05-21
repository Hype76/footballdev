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

console.log('Football Player Mobile Submit Preflight')
console.log('Status: local checklist only')
console.log('This command does not call EAS, Apple, Google, Netlify, Supabase, or any live service.')
console.log('')
console.log('Local readiness snapshot:')
console.log(`- Working tree: ${readGitStatus() ? 'has uncommitted changes' : 'clean'}`)
console.log(`- Private evidence folder: ${existsSync(evidenceDir) ? 'present' : 'not created yet'}`)
console.log('- Required local gate before submission: npm run mobile:release-check')
console.log('')
console.log('Apps covered:')

mobileApps.forEach((app) => {
  console.log(`- ${app.expectedName}`)
  console.log(`  Bundle ID: ${app.bundleIdentifier}`)
  console.log(`  Android package: ${app.packageName}`)
})

console.log('')
console.log('Final external evidence required before setting MOBILE_SUBMISSION_CONFIRMED=true:')
console.log('- EAS project values verified for Coach and Parents.')
console.log('- Android internal builds installed on real devices.')
console.log('- iOS TestFlight builds installed on real iPhones.')
console.log('- Push notifications verified on Android and iOS.')
console.log('- Reviewer credentials entered only in App Store Connect and Google Play Console.')
console.log('- Store screenshots captured from real native builds with test data only.')
console.log('- Store record links and screenshot folder paths recorded only under apps/mobile-release-evidence/.')
console.log('- Both apps still use EXPO_PUBLIC_SUPABASE_ENV=test.')
console.log('- Both apps still use EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false.')
console.log('')
console.log('Submit commands stay blocked until MOBILE_SUBMISSION_CONFIRMED=true is set for the final command.')
