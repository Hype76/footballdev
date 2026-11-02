import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const reference = 'FP-COACH-OFFLINE-15MB-20261102'
const env = { ...process.env, MOBILE_PRODUCTION_PROMOTION_REFERENCE: reference, MOBILE_NATIVE_BUILD_CONFIRMED: 'false', MOBILE_QA_UPLOAD_CONFIRMED: 'false', MOBILE_SUBMISSION_CONFIRMED: 'false', MOBILE_SUBMISSION_BUILD_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const run = (...args) => spawnSync(process.execPath, args, { env, encoding: 'utf8' })

for (const platform of ['android', 'ios']) {
  test(`Coach ${platform} test build and upload retain the evidence gates`, () => {
    const build = run('apps/scripts/mobile-build-guard.mjs', 'coach', 'store-live', platform)
    assert.notEqual(build.status, 0)
    assert.match(build.stderr, /MOBILE_NATIVE_BUILD_CONFIRMED=true/)
    const submit = run('apps/scripts/mobile-submit-guard.mjs', 'coach', platform, 'store-qa')
    assert.notEqual(submit.status, 0)
    assert.match(submit.stderr, /MOBILE_QA_UPLOAD_CONFIRMED=true/)
  })
  test(`test reference grants no public or Parent ${platform} submission`, () => {
    for (const [role, profile] of [['coach', 'store-live'], ['parent', 'store-qa']]) {
      const submit = run('apps/scripts/mobile-submit-guard.mjs', role, platform, profile)
      assert.notEqual(submit.status, 0)
      assert.match(submit.stderr, /production_build_not_authorised/)
    }
  })
}
