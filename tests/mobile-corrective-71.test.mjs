import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('corrective 71 freezes guarded Coach and Parent production candidates', async () => {
  const [buildGuard, submitGuard, coachConfig, coachPackage, parentConfig, parentPackage] = await Promise.all([
    read('../apps/scripts/mobile-build-guard.mjs'),
    read('../apps/scripts/mobile-submit-guard.mjs'),
    read('../apps/coach-mobile/app.config.js'),
    read('../apps/coach-mobile/package.json'),
    read('../apps/parent-mobile/app.config.js'),
    read('../apps/parent-mobile/package.json'),
  ])

  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-CORRECTIVE-71/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-CORRECTIVE-71/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-CORRECTIVE-71'/)
  assert.match(coachConfig, /version: '1\.0\.21'/)
  assert.equal(JSON.parse(coachPackage).version, '1.0.21')
  assert.match(parentConfig, /version: '1\.0\.18'/)
  assert.equal(JSON.parse(parentPackage).version, '1.0.18')
  assert.match(submitGuard, /submitArgs\.push\('--groups', 'Internal Testers'\)/)
})
