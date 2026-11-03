import test from 'node:test'
import assert from 'node:assert/strict'
import { settleCoachFixtureAudit } from '../apps/mobile-core/src/coachFixtureAuditCore.js'

test('resolved Supabase activity record error warns without treating a created fixture as failed', async () => {
  const warning = await settleCoachFixtureAudit(Promise.resolve(), Promise.resolve({ error: new Error('temporarily unavailable') }))
  assert.match(warning, /Fixture created, but its activity record/)
  assert.equal(await settleCoachFixtureAudit(Promise.resolve(), Promise.resolve({ error: null })), '')
})
