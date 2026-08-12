import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const netlifyTomlUrl = new URL('../netlify.toml', import.meta.url)
const scheduledWrapperUrl = new URL('../netlify/functions/send-scheduled-emails.js', import.meta.url)
const scheduledProcessorUrl = new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url)
const trainingProcessorUrl = new URL('../netlify/functions/process-training-availability-requests.js', import.meta.url)
const retryProcessorUrl = new URL('../netlify/functions/retry-failed-emails.js', import.meta.url)
const planGateUrl = new URL('../netlify/functions/lib/_plan-gate.js', import.meta.url)
const supabaseHelperUrl = new URL('../netlify/functions/lib/_supabase.js', import.meta.url)

test('scheduled email functions are built through the bundled Netlify functions pipeline', async () => {
  const netlifyToml = await readFile(netlifyTomlUrl, 'utf8')

  assert.match(netlifyToml, /\[functions\][\s\S]*directory = "netlify\/functions"/)
  assert.match(netlifyToml, /\[functions\][\s\S]*node_bundler = "esbuild"/)
  assert.doesNotMatch(netlifyToml, /\[functions\."send-scheduled-emails"\]/)
})

test('scheduled email wrapper delegates to the shared processor without changing queue behavior', async () => {
  const [wrapper, processor] = await Promise.all([
    readFile(scheduledWrapperUrl, 'utf8'),
    readFile(scheduledProcessorUrl, 'utf8'),
  ])

  assert.match(wrapper, /import \{ processScheduledEmails \} from '\.\/process-scheduled-emails\.js'/)
  assert.match(wrapper, /await processScheduledEmails\(\)/)
  assert.match(wrapper, /export\s+default\s+async\s+function\s+handler/)
  assert.match(wrapper, /export const config = \{[\s\S]*schedule: '\* \* \* \* \*'/)
  assert.match(processor, /\.from\('scheduled_email_queue'\)/)
  assert.match(processor, /sendPreparedParentEmail/)
  assert.match(processor, /sendParentMobilePushById/)
})

test('scheduled email Supabase helper uses the correct package casing', async () => {
  const source = await readFile(supabaseHelperUrl, 'utf8')

  assert.match(source, /from '@supabase\/supabase-js'/)
  assert.doesNotMatch(source, /@Supabase\/supabase-js/)
})

test('only internal email workers opt into trusted system billing evaluation', async () => {
  const [scheduled, training, retry, planGate] = await Promise.all([
    readFile(scheduledProcessorUrl, 'utf8'),
    readFile(trainingProcessorUrl, 'utf8'),
    readFile(retryProcessorUrl, 'utf8'),
    readFile(planGateUrl, 'utf8'),
  ])

  assert.match(scheduled, /assertTrustedSystemPlanFeature\(planProfile, 'parentEmails'\)/)
  assert.match(training, /assertTrustedSystemPlanFeature\(\{[\s\S]*'parentEmails'\)/)
  assert.match(retry, /assertTrustedSystemPlanFeature\(planProfile, requiredFeature\)/)
  assert.match(planGate, /export function assertTrustedSystemPlanFeature/)
  assert.match(planGate, /trustedSystemContext: false/)
  assert.match(planGate, /trustedSystemContext: true/)
  assert.match(planGate, /assertBillingActionAllowed\(planProfile, actionCategory, \{ trustedSystemContext \}\)/)
})
