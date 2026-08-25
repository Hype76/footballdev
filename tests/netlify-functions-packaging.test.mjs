import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const functionsDir = join(process.cwd(), 'netlify', 'functions')
const netlifyConfig = readFileSync(join(process.cwd(), 'netlify.toml'), 'utf8')
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
  assert.ok(topLevelFunctions.includes('send-event-player-invitation'))
})

test('shared Netlify helpers do not consume deployable function slots', () => {
  assert.equal(topLevelFunctions.includes('_supabase'), false)
  assert.equal(topLevelFunctions.includes('_stripe-billing'), false)
  assert.equal(topLevelFunctions.includes('_email-provider'), false)
  assert.equal(topLevelFunctions.includes('_plan-gate'), false)
  assert.ok(topLevelFunctions.includes('manage-club-logo'))
  assert.ok(topLevelFunctions.includes('security-audit-monitor'))
  assert.ok(topLevelFunctions.includes('parent-development-history'))
  assert.ok(topLevelFunctions.includes('parent-mobile-push-installation'))
  assert.ok(topLevelFunctions.includes('coach-mobile-push-installation'))
  assert.ok(topLevelFunctions.includes('resend-webhook'))
  assert.ok(topLevelFunctions.includes('configure-resend-webhook'))
  assert.ok(topLevelFunctions.includes('formation-board-export'))
  assert.ok(topLevelFunctions.includes('manage-workspace-team-transfer'))
  assert.ok(topLevelFunctions.includes('create-workspace-checkout-session'))
  assert.ok(topLevelFunctions.includes('process-billing-access-reminders'))
  assert.ok(topLevelFunctions.includes('process-chat-mobile-notifications'))
  assert.ok(topLevelFunctions.includes('calendar-change-notifications'))
  assert.equal(topLevelFunctions.length, 75)
})

test('Chromium packaging is limited to PDF function roots', () => {
  const globalFunctions = netlifyConfig.match(/\[functions\]\s+([\s\S]*?)(?=\[functions\.)/)?.[1] ?? ''

  assert.doesNotMatch(globalFunctions, /external_node_modules/)
  for (const functionName of [
    'formation-board-export',
    'parent-development-history',
    'render-pdf',
    'send-parent-email',
  ]) {
    assert.match(
      netlifyConfig,
      new RegExp(`\\[functions\\."${functionName}"\\]\\s+external_node_modules = \\["@sparticuz/chromium"\\]`),
    )
  }
})
