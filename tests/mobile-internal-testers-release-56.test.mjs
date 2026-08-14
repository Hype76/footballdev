import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('every iOS submission targets Internal Testers and requires Steve and Simon confirmation', async () => {
  const source = await readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8')

  assert.match(source, /MOBILE_IOS_INTERNAL_TESTERS_CONFIRMED/)
  assert.match(source, /Steve and Simon are confirmed as active Internal Testers for both Coach and Parents/)
  assert.match(source, /if \(platform === 'ios'\) submitArgs\.push\('--groups', 'Internal Testers'\)/)
})

test('mobile submit preflight requires both internal testers on both apps', async () => {
  const source = await readFile(new URL('../apps/scripts/mobile-submit-preflight.mjs', import.meta.url), 'utf8')

  assert.match(source, /Steve and Simon are active App Store Connect users with access to both Coach and Parents/)
  assert.match(source, /Steve and Simon belong to the Internal Testers group for both apps/)
  assert.match(source, /MOBILE_IOS_INTERNAL_TESTERS_CONFIRMED=true/)
})

test('private evidence template records both internal testers against both apps', async () => {
  const source = await readFile(new URL('../apps/MOBILE_EXTERNAL_RELEASE_EVIDENCE.md', import.meta.url), 'utf8')

  assert.match(source, /Simon has App Store Connect access to Coach and Parents/)
  assert.match(source, /Simon belongs to both apps' Internal Testers groups/)
  assert.match(source, /Latest Parents build visible to Steve and Simon/)
})
