import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const contactFunctionUrl = new URL('../netlify/functions/send-contact-request.js', import.meta.url)

test('system support contact emails are not gated as parent emails', async () => {
  const source = await readFile(contactFunctionUrl, 'utf8')

  assert.match(source, /sendSupportNotification/)
  assert.match(source, /public_contact_request/)
  assert.doesNotMatch(source, /_plan-gate/)
  assert.doesNotMatch(source, /assertPlanFeature/)
  assert.doesNotMatch(source, /hasPlanFeature/)
  assert.doesNotMatch(source, /parentEmail/)
})
