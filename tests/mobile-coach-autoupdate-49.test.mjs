import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Coach 1.0.7 checks the production update channel on launch', () => {
  const config = read('apps/mobile-core/appConfig.cjs')
  const app = read('apps/coach-mobile/app.config.js')
  const eas = read('apps/coach-mobile/eas.json')
  const packageJson = read('apps/coach-mobile/package.json')

  assert.match(app, /version: '1\.0\.7'/)
  assert.match(packageJson, /"expo-updates": "~29\.0\.18"/)
  assert.match(config, /https:\/\/u\.expo\.dev\/\$\{resolvedEasProjectId\}/)
  assert.match(config, /checkAutomatically: 'ON_LOAD'/)
  assert.match(eas, /"store-live": \{\s*"channel": "production"/)
})

test('Coach session refresh follows app foreground state and store guards stay explicit', () => {
  const auth = read('apps/mobile-core/src/auth.js')
  const buildGuard = read('apps/scripts/mobile-build-guard.mjs')
  const submitGuard = read('apps/scripts/mobile-submit-guard.mjs')

  assert.match(auth, /supabase\.auth\.startAutoRefresh\(\)/)
  assert.match(auth, /supabase\.auth\.stopAutoRefresh\(\)/)
  assert.match(auth, /AppState\.addEventListener\('change', updateAutoRefresh\)/)
  assert.match(
    buildGuard,
    /const authorisedCoachProductionReferences = new Set\(\[[\s\S]*FP-MOBILE-COACH-FORMATION-AUTOUPDATE-49[\s\S]*?\]\)/,
  )
  assert.match(submitGuard, /FP-MOBILE-COACH-FORMATION-AUTOUPDATE-49/)
  assert.match(buildGuard, /FP-MOBILE-COACH-FORMATION-STEPPER-50/)
  assert.match(submitGuard, /FP-MOBILE-COACH-FORMATION-STEPPER-50/)
  assert.match(buildGuard, /FP-MOBILE-COACH-FORMATION-DRAG-51/)
  assert.match(submitGuard, /FP-MOBILE-COACH-FORMATION-DRAG-51/)
  assert.match(buildGuard, /FP-MOBILE-COACH-RESOURCES-MATCH-LINK-CORRECTIVE-53/)
  assert.match(submitGuard, /FP-MOBILE-COACH-RESOURCES-MATCH-LINK-CORRECTIVE-53/)
})
