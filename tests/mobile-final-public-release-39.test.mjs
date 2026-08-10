import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const masterReference = 'FP-MOBILE-PARENT-COACH-FINAL-PUBLIC-RELEASE-MASTER-39'

test('Master 39 authorises the Parent production AAB and iOS builds', async () => {
  const source = await readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8')
  assert.match(source, /masterStoreAndroid/)
  assert.match(source, /productionBuilds = new Set\(\['internal-live:android', 'store-live:android', 'store-live:ios'\]\)/)
  assert.match(source, new RegExp(masterReference))
})

test('Master 39 Parent submissions require the exact completed build and separate iOS groups from Android', async () => {
  const source = await readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8')
  assert.match(source, /MOBILE_SUBMISSION_BUILD_ID/)
  assert.match(source, /if \(platform === 'ios'\) submitArgs\.push\('--groups', 'Internal Testers'\)/)
  assert.match(source, new RegExp(masterReference))
})

test('Parent final AAB submission targets the existing closed Alpha track while Production access is gated', async () => {
  const eas = JSON.parse(await readFile(new URL('../apps/parent-mobile/eas.json', import.meta.url), 'utf8'))
  assert.equal(eas.build['store-live'].distribution, 'store')
  assert.equal(eas.submit['store-live'].android.track, 'alpha')
  assert.equal(eas.submit['store-live'].android.releaseStatus, 'completed')
  assert.equal(eas.submit['store-live'].ios.ascAppId, '6772061464')
})
