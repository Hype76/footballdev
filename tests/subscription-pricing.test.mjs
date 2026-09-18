import assert from 'node:assert/strict'
import test from 'node:test'
import { quoteSubscription } from '../src/lib/subscription-pricing.js'

test('quotes free Matchday and Team pricing', () => {
  assert.deepEqual(quoteSubscription({ planKey: 'matchday', teamCapacity: 1, billingCycle: 'monthly' }), { monthlyPence: 0, annualPence: 0, chargePence: 0, annualSavingsPence: 0, includedTeams: 1, additionalTeamBlocks: 0, billingCycle: 'monthly' })
  assert.deepEqual(quoteSubscription({ planKey: 'team', teamCapacity: 1, billingCycle: 'annual' }), { monthlyPence: 799, annualPence: 7990, chargePence: 7990, annualSavingsPence: 1598, includedTeams: 1, additionalTeamBlocks: 0, billingCycle: 'annual' })
})

test('quotes Club base and additional capacity blocks', () => {
  assert.equal(quoteSubscription({ planKey: 'club', teamCapacity: 10, billingCycle: 'monthly' }).chargePence, 5999)
  const quote = quoteSubscription({ planKey: 'club', teamCapacity: 30, billingCycle: 'annual' })
  assert.deepEqual(quote, { monthlyPence: 15979, annualPence: 159790, chargePence: 159790, annualSavingsPence: 31958, includedTeams: 30, additionalTeamBlocks: 2, billingCycle: 'annual' })
})

test('rejects unsupported, fractional, rounded, and tampered inputs', () => {
  for (const input of [
    { planKey: 'club', teamCapacity: 11, billingCycle: 'monthly' },
    { planKey: 'club', teamCapacity: 10.5, billingCycle: 'monthly' },
    { planKey: 'club', teamCapacity: 0, billingCycle: 'monthly' },
    { planKey: 'team', teamCapacity: 10, billingCycle: 'monthly' },
    { planKey: 'matchday', teamCapacity: 1, billingCycle: 'weekly' },
    { planKey: 'enterprise', teamCapacity: 10, billingCycle: 'monthly' },
  ]) assert.throws(() => quoteSubscription(input), RangeError)
})
