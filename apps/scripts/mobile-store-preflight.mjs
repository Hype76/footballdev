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

console.log('Football Player Mobile Store Record Preflight')
console.log('Status: local checklist only')
console.log('This command does not call Apple, Google, EAS, Netlify, Supabase, or any live service.')
console.log('')
console.log('Local readiness snapshot:')
console.log(`- Working tree: ${readGitStatus() ? 'has uncommitted changes' : 'clean'}`)
console.log(`- Private evidence folder: ${existsSync(evidenceDir) ? 'present' : 'not created yet'}`)
console.log('- Required local gate before store record setup: npm run mobile:release-check')
console.log('')
console.log('Store records to create:')

mobileApps.forEach((app) => {
  console.log(`- Apple App Store Connect: ${app.expectedName}, bundle ID ${app.bundleIdentifier}`)
  console.log(`- Google Play Console: ${app.expectedName}, package ${app.packageName}`)
})

console.log('')
console.log('Store record requirements:')
console.log('- Pricing: Free.')
console.log('- Category: Sports.')
console.log('- Login required: Yes.')
console.log('- In-app purchases: None.')
console.log('- Payments, checkout, subscription management, and billing controls in mobile app: No.')
console.log('- Reviewer credentials entered only in Apple and Google consoles.')
console.log('- Privacy answers copied from apps/MOBILE_PRIVACY_QUESTIONNAIRE.md.')
console.log('- Review notes copied from apps/MOBILE_REVIEWER_HANDOFF.md.')
console.log('- Screenshots captured later from real native builds using apps/MOBILE_SCREENSHOT_PLAN.md.')
console.log('- Native identity checked with apps/MOBILE_NATIVE_IDENTITY_CHECKLIST.md.')
console.log('- Store record links recorded only under apps/mobile-release-evidence/.')
console.log('')
console.log('Public URLs:')
console.log('- Support: https://footballplayer.online/')
console.log('- Privacy: https://footballplayer.online/gdpr')
console.log('- Terms: https://footballplayer.online/terms')
