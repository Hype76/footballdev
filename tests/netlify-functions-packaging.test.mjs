import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const functionsDir = join(process.cwd(), 'netlify', 'functions')
const topLevelFunctions = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => basename(entry.name, '.js'))
  .sort()

test('Report Issue feedback endpoints remain deployable top-level Netlify functions', () => {
  assert.ok(topLevelFunctions.includes('submit-tester-feedback'))
  assert.ok(topLevelFunctions.includes('_t-tester-feedback'))
  assert.ok(topLevelFunctions.includes('platform-feedback-reports'))
  assert.ok(topLevelFunctions.includes('platform-feedback-report-update'))
  assert.ok(topLevelFunctions.includes('platform-feedback-attachment-url'))
})

test('shared Netlify helpers do not consume deployable function slots', () => {
  assert.equal(topLevelFunctions.includes('_supabase'), false)
  assert.equal(topLevelFunctions.includes('_stripe-billing'), false)
  assert.equal(topLevelFunctions.includes('_email-provider'), false)
  assert.equal(topLevelFunctions.includes('_plan-gate'), false)
  assert.ok(topLevelFunctions.includes('manage-club-logo'))
  assert.ok(topLevelFunctions.includes('security-audit-monitor'))
  assert.equal(topLevelFunctions.length, 54)
})
