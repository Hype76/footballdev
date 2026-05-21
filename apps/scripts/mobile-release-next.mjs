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
  title: 'Phase 3: Apple And Google Store Records',
  status: 'external',
  rule: 'Keep both apps on test Supabase until live release approval is explicit.',
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
console.log('EAS setup is complete:')
console.log('- Football Player Coach EAS project exists.')
console.log('- Football Player Parents EAS project exists.')
console.log('- Both apps have development, preview, and production EAS values set.')
console.log('- EAS values keep EXPO_PUBLIC_SUPABASE_ENV=test and EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false.')
console.log('')
console.log('Native build status:')
console.log('- Android internal builds are complete for both apps.')
console.log('- Android store-test AAB builds are complete for both apps.')
console.log('- iOS store-test builds are complete for both apps.')
console.log('')
console.log('Before store record setup:')
console.log('- Run npm run mobile:release-check from the repo root.')
console.log('- Run npm run mobile:store:preflight before creating or editing store records.')
console.log('- Use apps/MOBILE_STORE_RECORD_CHECKLIST.md for all four store records.')
console.log('- Use apps/MOBILE_REVIEWER_HANDOFF.md for review notes.')
console.log('- Enter reviewer credentials only in App Store Connect and Google Play Console.')
console.log('- Do not commit Apple keys, Google service account files, provisioning profiles, passwords, reviewer credentials, or private store notes.')
console.log('')
console.log('Store records to create:')

mobileApps.forEach((app) => {
  console.log(`- ${app.expectedName}`)
  console.log(`  Apple App Store Connect: ${app.bundleIdentifier}`)
  console.log(`  Google Play Console: ${app.packageName}`)
})

console.log('')
console.log('Before native builds:')
console.log('- Re-run npm run mobile:eas:env:coach and npm run mobile:eas:env:parent if any EAS values change.')
console.log('- Run npm run mobile:build:preflight.')
console.log('- Native builds are ready for real-device QA.')
console.log('')
console.log('No Netlify deploy is required for mobile EAS, store setup, or native builds.')
