import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const masterReference = 'FP-MOBILE-PARENT-COACH-FINAL-PUBLIC-RELEASE-MASTER-39'

test('Master 39 authorises exact production AAB and iOS builds for both app roles', async () => {
  const source = await readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8')
  assert.match(source, /masterStoreAndroid/)
  assert.match(source, /productionBuilds = new Set\(\['internal-live:android', 'internal-live:ios', 'store-live:android', 'store-live:ios'\]\)/)
  assert.equal(source.split(masterReference).length - 1, 3)
})

test('Master 39 submissions require the exact completed build and separate iOS groups from Android', async () => {
  const source = await readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8')
  assert.match(source, /MOBILE_SUBMISSION_BUILD_ID/)
  assert.match(source, /if \(platform === 'ios'\) submitArgs\.push\('--groups', 'Internal Testers'\)/)
  assert.match(source, new RegExp(masterReference))
})

test('public release AAB submissions target the Production track for both apps', async () => {
  const [coachEas, parentEas] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/eas.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../apps/parent-mobile/eas.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  for (const eas of [coachEas, parentEas]) {
    assert.equal(eas.build['store-live'].distribution, 'store')
    assert.equal(eas.submit['store-live'].android.track, 'production')
    assert.equal(eas.submit['store-live'].android.releaseStatus, 'completed')
    assert.equal(eas.submit['store-live'].android.changesNotSentForReview, false)
  }
  assert.equal(coachEas.submit['store-live'].ios.ascAppId, '6772059305')
})
