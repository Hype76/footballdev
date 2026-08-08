import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  assertBillingActionAllowed,
  BILLING_ACCESS_STATES,
  BILLING_ACTION_CATEGORIES,
  resolveBillingAccess,
} from '../src/lib/billing-access.js'
import { getUkCalendarDate, ukCalendarDateToInstant, validateBillingArrangement } from '../src/lib/billing-date.js'
import { resolveBillingConfigurationUpdate } from '../src/lib/billing-configuration.js'
import { getBillingReminderType } from '../src/lib/billing-reminders.js'

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

test('Immediate and Complimentary arrangements ignore blank, undefined, malformed, and stale dates', () => {
  for (const arrangement of ['immediate', 'complimentary']) {
    for (const startDate of ['', undefined, 'not-a-date', '2027-04-30']) {
      assert.deepEqual(validateBillingArrangement({ arrangement, startDate, planKey: 'small_club' }), {
        arrangement,
        billingStartAt: null,
      })
    }
  }
})

test('Deferred arrangements require a valid explicit UK date and reject malformed or impossible values', () => {
  const options = { arrangement: 'deferred', now: new Date('2026-08-08T12:00:00Z'), planKey: 'small_club' }
  for (const startDate of ['', undefined, '08/09/2026', '2026-02-30', '2026-13-01']) {
    assert.throws(() => validateBillingArrangement({ ...options, startDate }), /valid UK billing start date/)
  }
})

test('UK date conversion remains correct at spring and autumn daylight saving boundaries', () => {
  assert.equal(ukCalendarDateToInstant('2026-03-29'), '2026-03-29T00:00:00.000Z')
  assert.equal(ukCalendarDateToInstant('2026-03-30'), '2026-03-29T23:00:00.000Z')
  assert.equal(ukCalendarDateToInstant('2026-10-25'), '2026-10-24T23:00:00.000Z')
  assert.equal(ukCalendarDateToInstant('2026-10-26'), '2026-10-26T00:00:00.000Z')
})

test('server update resolution clears stale dates and requires a new date when switching to Deferred', () => {
  const currentClub = {
    billing_arrangement: 'immediate',
    billing_start_at: '2027-04-29T23:00:00.000Z',
    is_plan_comped: false,
  }

  for (const billingArrangement of ['immediate', 'complimentary']) {
    for (const billingStartDate of ['', undefined, 'not-a-date', '2027-04-30']) {
      assert.deepEqual(resolveBillingConfigurationUpdate({
        request: { billingArrangement, billingStartDate },
        currentClub,
        planKey: 'small_club',
      }), {
        arrangement: billingArrangement,
        billingStartAt: null,
      })
    }
  }

  assert.throws(() => resolveBillingConfigurationUpdate({
    request: { billingArrangement: 'deferred' },
    currentClub,
    now: new Date('2026-08-08T12:00:00Z'),
    planKey: 'small_club',
  }), /valid UK billing start date/)
  assert.deepEqual(resolveBillingConfigurationUpdate({
    request: { billingArrangement: 'deferred', billingStartDate: '2026-08-09' },
    currentClub,
    now: new Date('2026-08-08T12:00:00Z'),
    planKey: 'small_club',
  }), {
    arrangement: 'deferred',
    billingStartAt: '2026-08-08T23:00:00.000Z',
  })
})

test('Team and Club edit transitions preserve arrangement, access, reminder, and null-date contracts', () => {
  const currentDate = '2026-08-20T23:00:00.000Z'
  const selectedDate = '2026-08-15'
  const expectedDeferredInstant = '2026-08-14T23:00:00.000Z'
  const now = new Date('2026-08-08T12:00:00Z')

  for (const planKey of ['single_team', 'small_club']) {
    for (const currentArrangement of ['immediate', 'deferred', 'complimentary']) {
      for (const nextArrangement of ['immediate', 'deferred', 'complimentary']) {
        const currentClub = {
          billing_arrangement: currentArrangement,
          billing_start_at: currentArrangement === 'deferred' ? currentDate : null,
          is_plan_comped: currentArrangement === 'complimentary',
        }
        const request = {
          billingArrangement: nextArrangement,
          billingStartDate: nextArrangement === 'deferred' ? selectedDate : '',
        }
        const result = resolveBillingConfigurationUpdate({ currentClub, now, planKey, request })
        const billingAccess = resolveBillingAccess({
          billingArrangement: result.arrangement,
          billingStartAt: result.billingStartAt,
          planKey,
          planStatus: 'active',
          role: planKey === 'single_team' ? 'head_manager' : 'admin',
          roleRank: planKey === 'single_team' ? 70 : 90,
          workspaceId: `${planKey}-${currentArrangement}-${nextArrangement}`,
        }, { now })

        assert.equal(result.arrangement, nextArrangement, `${planKey}: ${currentArrangement} -> ${nextArrangement}`)
        assert.equal(
          result.billingStartAt,
          nextArrangement === 'deferred' ? expectedDeferredInstant : null,
          `${planKey}: ${currentArrangement} -> ${nextArrangement} date`,
        )
        assert.equal(billingAccess.accessState, BILLING_ACCESS_STATES.full)
        assert.equal(
          getBillingReminderType(result.billingStartAt, now),
          nextArrangement === 'deferred' ? '7_day' : '',
          `${planKey}: ${currentArrangement} -> ${nextArrangement} reminder`,
        )
      }
    }
  }
})

test('Platform Admin edits arrangement and date as one validated billing configuration', async () => {
  const [sectionSource, pageSource, actionsSource] = await Promise.all([
    readFile(new URL('../src/components/platform/PlatformAccountManagementSection.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/PlatformAdminPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/domain/platform-admin-actions.js', import.meta.url), 'utf8'),
  ])

  assert.match(sectionSource, /function BillingConfigurationControl/)
  assert.match(sectionSource, /onClubPlanChange\(club, 'billingConfiguration', \{[\s\S]*billingArrangement: arrangementDraft,[\s\S]*billingStartDate: arrangementDraft === 'deferred' \? startDateDraft : null/)
  assert.doesNotMatch(sectionSource, /onClubPlanChange\(club, 'billingArrangement'/)
  assert.doesNotMatch(sectionSource, /onClubPlanChange\(club, 'billingStartDate'/)
  assert.match(sectionSource, /role="alert"/)
  assert.match(sectionSource, /validateBillingArrangement\(\{[\s\S]*arrangement: arrangementDraft,[\s\S]*startDate: startDateDraft/)
  assert.match(pageSource, /fieldName === 'billingConfiguration'[\s\S]*billingArrangement: value\.billingArrangement,[\s\S]*billingStartDate: value\.billingStartDate/)
  assert.match(actionsSource, /billingStartDate: billingArrangement === 'deferred' \? billingStartDate : null/)
})
