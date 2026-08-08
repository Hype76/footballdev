import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertBillingActionAllowed,
  BILLING_ACCESS_STATES,
  BILLING_ACTION_CATEGORIES,
  resolveBillingAccess,
} from '../src/lib/billing-access.js'
import { getUkCalendarDate, ukCalendarDateToInstant, validateBillingArrangement } from '../src/lib/billing-date.js'

const teamAdmin = { planKey: 'single_team', role: 'head_manager', roleRank: 70, workspaceId: 'club-1' }
const clubAdmin = { planKey: 'small_club', role: 'admin', roleRank: 90, workspaceId: 'club-1' }
const dueAt = '2026-08-08T23:00:00.000Z'

test('deferred access is full, due soon, then read and export only at the UK boundary', () => {
  assert.equal(resolveBillingAccess({ ...teamAdmin, billingArrangement: 'deferred', billingStartAt: dueAt }, { now: '2026-07-31T12:00:00Z' }).accessState, BILLING_ACCESS_STATES.full)
  assert.equal(resolveBillingAccess({ ...teamAdmin, billingArrangement: 'deferred', billingStartAt: dueAt }, { now: '2026-08-03T12:00:00Z' }).accessState, BILLING_ACCESS_STATES.paymentDueSoon)
  const expired = resolveBillingAccess({ ...teamAdmin, billingArrangement: 'deferred', billingStartAt: dueAt }, { now: dueAt })
  assert.equal(expired.accessState, BILLING_ACCESS_STATES.paymentRequired)
  assert.equal(expired.operationalMutationsAllowed, false)
  assert.equal(expired.exportAllowed, true)
  assert.doesNotThrow(() => assertBillingActionAllowed({ ...teamAdmin, billingArrangement: 'deferred', billingStartAt: dueAt }, BILLING_ACTION_CATEGORIES.export, { now: dueAt }))
  assert.throws(() => assertBillingActionAllowed({ ...teamAdmin, billingArrangement: 'deferred', billingStartAt: dueAt }, BILLING_ACTION_CATEGORIES.staffMutation, { now: dueAt }), { code: 'payment_required', statusCode: 402 })
})

test('valid subscriptions, complimentary access, Parents, and legacy rows remain usable', () => {
  assert.equal(resolveBillingAccess({ ...clubAdmin, planStatus: 'active', billingArrangement: 'immediate' }).operationalMutationsAllowed, true)
  assert.equal(resolveBillingAccess({ ...clubAdmin, planStatus: 'past_due', billingArrangement: 'complimentary' }).operationalMutationsAllowed, true)
  const legacy = resolveBillingAccess({ ...clubAdmin, planStatus: 'past_due' })
  assert.equal(legacy.operationalMutationsAllowed, true)
  assert.equal(legacy.reviewRequired, true)
  assert.doesNotThrow(() => assertBillingActionAllowed({ ...clubAdmin, role: 'parent', billingArrangement: 'immediate' }, BILLING_ACTION_CATEGORIES.staffMutation))
})

test('only the exact commercial owner role may take billing action', () => {
  assert.equal(resolveBillingAccess({ ...teamAdmin, billingArrangement: 'immediate' }).payerAuthorized, true)
  assert.equal(resolveBillingAccess({ ...teamAdmin, role: 'admin', roleRank: 90, billingArrangement: 'immediate' }).payerAuthorized, false)
  assert.equal(resolveBillingAccess({ ...clubAdmin, billingArrangement: 'immediate' }).payerAuthorized, true)
  assert.equal(resolveBillingAccess({ ...clubAdmin, role: 'head_manager', roleRank: 70, billingArrangement: 'immediate' }).payerAuthorized, false)
})

test('archived and unknown workspaces fail closed while Individual stays free', () => {
  assert.equal(resolveBillingAccess({ ...clubAdmin, archivedAt: '2026-08-01T00:00:00Z' }).accessState, BILLING_ACCESS_STATES.archived)
  assert.equal(resolveBillingAccess({ ...clubAdmin, planKey: 'unknown-plan' }).accessState, BILLING_ACCESS_STATES.paymentRequired)
  assert.equal(resolveBillingAccess({ planKey: 'individual', role: 'head_manager', roleRank: 70 }).operationalMutationsAllowed, true)
})

test('UK calendar dates convert correctly across daylight saving boundaries', () => {
  assert.equal(ukCalendarDateToInstant('2026-08-09'), '2026-08-08T23:00:00.000Z')
  assert.equal(ukCalendarDateToInstant('2026-12-09'), '2026-12-09T00:00:00.000Z')
  assert.equal(getUkCalendarDate('2026-08-08T23:00:00.000Z'), '2026-08-09')
  assert.deepEqual(validateBillingArrangement({ arrangement: 'deferred', startDate: '2026-08-09', now: new Date('2026-08-08T12:00:00Z'), planKey: 'small_club' }), {
    arrangement: 'deferred',
    billingStartAt: '2026-08-08T23:00:00.000Z',
  })
  assert.throws(() => validateBillingArrangement({ arrangement: 'deferred', startDate: '2026-08-07', now: new Date('2026-08-08T12:00:00Z'), planKey: 'small_club' }), /cannot be in the past/)
})
