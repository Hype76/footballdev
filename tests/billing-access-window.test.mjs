import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  assertBillingActionAllowed,
  BILLING_ACCESS_STATES,
  BILLING_ACTION_CATEGORIES,
  BILLING_ACTOR_CATEGORIES,
  isBillingActionAllowed,
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

test('null, undefined, malformed, and unknown billing contexts fail closed during authentication hydration', () => {
  for (const context of [null, undefined, '', 'single_team', 1, true, [], { planKey: 'unknown-plan' }]) {
    const decision = resolveBillingAccess(context)
    assert.equal(decision.accessState, BILLING_ACCESS_STATES.paymentRequired)
    assert.equal(decision.operationalMutationsAllowed, false)
    assert.equal(decision.payerAuthorized, false)
    assert.equal(decision.reason, 'unknown_commercial_scope')
    assert.equal(decision.reviewRequired, true)
  }

  assert.equal(isBillingActionAllowed(null, BILLING_ACTION_CATEGORIES.staffMutation), false)
  assert.equal(isBillingActionAllowed(null, BILLING_ACTION_CATEGORIES.platformAdmin), false)
  assert.equal(isBillingActionAllowed('single_team', BILLING_ACTION_CATEGORIES.staffMutation), false)
  assert.equal(isBillingActionAllowed({ role: 'super_admin' }, BILLING_ACTION_CATEGORIES.platformAdmin), true)
})

test('valid commercial and role contexts retain their established billing decisions', () => {
  const validContexts = [
    { label: 'Individual', context: { id: 'individual-1', planKey: 'individual', role: 'head_manager', roleRank: 70 } },
    { label: 'Single Team', context: { id: 'team-1', planKey: 'single_team', planStatus: 'active', role: 'head_manager', roleRank: 70 } },
    { label: 'Club', context: { id: 'club-1', planKey: 'small_club', planStatus: 'active', role: 'admin', roleRank: 90 } },
    { label: 'Platform Admin', context: { id: 'platform-1', planKey: 'small_club', planStatus: 'active', role: 'super_admin', roleRank: 100 } },
    { label: 'Parent', context: { id: 'parent-1', planKey: 'small_club', planStatus: 'active', role: 'parent', roleRank: 0 } },
    { label: 'Coach', context: { id: 'coach-1', planKey: 'small_club', planStatus: 'active', role: 'coach', roleRank: 30 } },
    { label: 'Team Admin', context: { id: 'team-admin-1', planKey: 'single_team', planStatus: 'active', role: 'head_manager', roleRank: 70 } },
    { label: 'Club Admin', context: { id: 'club-admin-1', planKey: 'small_club', planStatus: 'active', role: 'admin', roleRank: 90 } },
  ]

  for (const { context, label } of validContexts) {
    const decision = resolveBillingAccess(context)
    assert.equal(decision.accessState, BILLING_ACCESS_STATES.full, label)
    assert.equal(decision.operationalMutationsAllowed, true, label)
  }
})

test('Platform Admin bypass is actor-first across customer plans, payment states, and archive state', () => {
  const platformAdmin = { id: 'platform-1', role: 'super_admin', roleRank: 100 }
  const customerStates = [
    { label: 'Team payment required', planKey: 'single_team', planStatus: 'past_due', billingArrangement: 'immediate' },
    { label: 'Club payment required', planKey: 'small_club', planStatus: 'past_due', billingArrangement: 'immediate' },
    { label: 'Complimentary', planKey: 'development_club', planStatus: 'past_due', billingArrangement: 'complimentary', isPlanComped: true },
    { label: 'Deferred future', planKey: 'large_club', planStatus: 'past_due', billingArrangement: 'deferred', billingStartAt: '2030-01-01T00:00:00Z' },
    { label: 'Active subscription', planKey: 'small_club', planStatus: 'active', billingArrangement: 'immediate' },
    { label: 'Archived customer', planKey: 'small_club', planStatus: 'past_due', billingArrangement: 'immediate', archivedAt: '2026-08-01T00:00:00Z' },
  ]

  for (const state of customerStates) {
    const decision = resolveBillingAccess({ ...state, ...platformAdmin, workspaceId: 'selected-customer' })
    assert.equal(decision.actorCategory, BILLING_ACTOR_CATEGORIES.platformAdmin, state.label)
    assert.equal(decision.accessState, BILLING_ACCESS_STATES.full, state.label)
    assert.equal(decision.operationalMutationsAllowed, true, state.label)
    assert.equal(decision.paymentRequired, false, state.label)
    assert.equal(decision.payerAuthorized, false, state.label)
    assert.equal(decision.reason, 'platform_admin_customer_billing_bypass', state.label)
    assert.equal(decision.workspaceId, 'selected-customer', state.label)
  }

  assert.equal(isBillingActionAllowed({ ...platformAdmin }, BILLING_ACTION_CATEGORIES.platformAdmin), true)
  assert.equal(isBillingActionAllowed({ ...platformAdmin }, BILLING_ACTION_CATEGORIES.staffMutation), true)
})

test('Parent and player bypass is actor-first for Team-scope and Club-scope customer billing', () => {
  for (const role of ['parent', 'parent_portal', 'player', 'adult_player']) {
    for (const planKey of ['single_team', 'small_club']) {
      const decision = resolveBillingAccess({
        id: `${role}-${planKey}`,
        role,
        roleRank: 0,
        planKey,
        planStatus: 'past_due',
        billingArrangement: 'immediate',
      })
      assert.equal(decision.actorCategory, BILLING_ACTOR_CATEGORIES.parentOrPlayer, `${role}: ${planKey}`)
      assert.equal(decision.accessState, BILLING_ACCESS_STATES.full, `${role}: ${planKey}`)
      assert.equal(decision.operationalMutationsAllowed, true, `${role}: ${planKey}`)
      assert.equal(decision.paymentRequired, false, `${role}: ${planKey}`)
      assert.equal(decision.payerAuthorized, false, `${role}: ${planKey}`)
      assert.equal(decision.nextPaymentAction, 'none', `${role}: ${planKey}`)
      assert.equal(isBillingActionAllowed({ role, planKey }, BILLING_ACTION_CATEGORIES.billing), false, `${role}: ${planKey} billing`)
    }
  }
})

test('ordinary staff restrictions and exact commercial payer ownership are unchanged', () => {
  const cases = [
    { label: 'Team Admin owns Team billing', context: { ...teamAdmin, billingArrangement: 'immediate' }, payerAuthorized: true },
    { label: 'Club Admin owns Club billing', context: { ...clubAdmin, billingArrangement: 'immediate' }, payerAuthorized: true },
    { label: 'Coach is restricted', context: { ...clubAdmin, role: 'coach', roleRank: 30, billingArrangement: 'immediate' }, payerAuthorized: false },
    { label: 'Team Admin cannot control Club billing', context: { ...clubAdmin, role: 'head_manager', roleRank: 70, billingArrangement: 'immediate' }, payerAuthorized: false },
  ]

  for (const entry of cases) {
    const decision = resolveBillingAccess(entry.context)
    assert.equal(decision.actorCategory, BILLING_ACTOR_CATEGORIES.customerStaff, entry.label)
    assert.equal(decision.accessState, BILLING_ACCESS_STATES.paymentRequired, entry.label)
    assert.equal(decision.operationalMutationsAllowed, false, entry.label)
    assert.equal(decision.payerAuthorized, entry.payerAuthorized, entry.label)
    assert.equal(isBillingActionAllowed(entry.context, BILLING_ACTION_CATEGORIES.staffMutation), false, entry.label)
  }
})

test('unknown roles and missing actors fail closed even when customer billing is active', () => {
  const activeWorkspace = { planKey: 'small_club', planStatus: 'active', billingArrangement: 'immediate' }
  const unknown = resolveBillingAccess({ ...activeWorkspace, role: 'unknown_role', roleRank: 100 })
  const missing = resolveBillingAccess(activeWorkspace, { actorRequired: true })

  for (const decision of [unknown, missing]) {
    assert.equal(decision.actorCategory, BILLING_ACTOR_CATEGORIES.unknown)
    assert.equal(decision.accessState, BILLING_ACCESS_STATES.paymentRequired)
    assert.equal(decision.operationalMutationsAllowed, false)
    assert.equal(decision.payerAuthorized, false)
    assert.equal(decision.reason, 'unknown_actor')
  }

  assert.equal(isBillingActionAllowed({ ...activeWorkspace, role: 'unknown_role' }, BILLING_ACTION_CATEGORIES.read), false)
  assert.equal(isBillingActionAllowed(activeWorkspace, BILLING_ACTION_CATEGORIES.parentOperation), false)
})

test('actorless billing bookkeeping still calculates customer state without granting an action', () => {
  const context = { planKey: 'small_club', planStatus: 'past_due', billingArrangement: 'immediate' }
  const decision = resolveBillingAccess(context)

  assert.equal(decision.actorCategory, BILLING_ACTOR_CATEGORIES.system)
  assert.equal(decision.accessState, BILLING_ACCESS_STATES.paymentRequired)
  assert.equal(isBillingActionAllowed(context, BILLING_ACTION_CATEGORIES.staffMutation), false)
})

test('scheduled workers require explicit trust and still enforce the workspace billing state', () => {
  const activeCompedWorker = {
    planKey: 'pilot',
    planStatus: 'active',
    isPlanComped: true,
    role: 'system',
    roleRank: 100,
    workspaceId: 'demo-club',
  }
  const unpaidWorker = {
    ...activeCompedWorker,
    planKey: 'small_club',
    planStatus: 'past_due',
    isPlanComped: false,
    billingArrangement: 'immediate',
  }

  assert.equal(resolveBillingAccess(activeCompedWorker).actorCategory, BILLING_ACTOR_CATEGORIES.system)
  assert.equal(isBillingActionAllowed(activeCompedWorker, BILLING_ACTION_CATEGORIES.staffMutation), false)
  assert.equal(isBillingActionAllowed(activeCompedWorker, BILLING_ACTION_CATEGORIES.staffMutation, { trustedSystemContext: true }), true)
  assert.doesNotThrow(() => assertBillingActionAllowed(activeCompedWorker, BILLING_ACTION_CATEGORIES.staffMutation, { trustedSystemContext: true }))
  assert.equal(isBillingActionAllowed(unpaidWorker, BILLING_ACTION_CATEGORIES.staffMutation, { trustedSystemContext: true }), false)
  assert.throws(
    () => assertBillingActionAllowed(unpaidWorker, BILLING_ACTION_CATEGORIES.staffMutation, { trustedSystemContext: true }),
    { code: 'payment_required', statusCode: 402 },
  )
  assert.equal(isBillingActionAllowed({ ...activeCompedWorker, role: 'unknown_role' }, BILLING_ACTION_CATEGORIES.staffMutation, { trustedSystemContext: true }), false)
})

test('actor by billing-state matrix preserves banner, read, export, mutation, and billing authority', () => {
  const actors = [
    { label: 'Platform Admin', kind: 'platform', context: { role: 'super_admin', roleRank: 100, planKey: 'small_club' } },
    { label: 'Club Admin', kind: 'owner', context: { role: 'admin', roleRank: 90, planKey: 'small_club' } },
    { label: 'Team Admin', kind: 'owner', context: { role: 'head_manager', roleRank: 70, planKey: 'single_team' } },
    { label: 'Coach', kind: 'coach', context: { role: 'coach', roleRank: 30, planKey: 'single_team' } },
    { label: 'Parent', kind: 'parent', context: { role: 'parent_portal', roleRank: 0, planKey: 'small_club' } },
  ]
  const states = [
    { label: 'immediate payment required', values: { planStatus: 'past_due', billingArrangement: 'immediate' }, customerAccess: BILLING_ACCESS_STATES.paymentRequired, customerMutation: false, banner: true },
    { label: 'deferred future', values: { planStatus: 'past_due', billingArrangement: 'deferred', billingStartAt: '2030-01-01T00:00:00Z' }, customerAccess: BILLING_ACCESS_STATES.full, customerMutation: true, banner: false },
    { label: 'deferred due', values: { planStatus: 'past_due', billingArrangement: 'deferred', billingStartAt: '2020-01-01T00:00:00Z' }, customerAccess: BILLING_ACCESS_STATES.paymentRequired, customerMutation: false, banner: true },
    { label: 'complimentary', values: { planStatus: 'past_due', billingArrangement: 'complimentary', isPlanComped: true }, customerAccess: BILLING_ACCESS_STATES.full, customerMutation: true, banner: false },
    { label: 'active subscription', values: { planStatus: 'active', billingArrangement: 'immediate' }, customerAccess: BILLING_ACCESS_STATES.full, customerMutation: true, banner: false },
    { label: 'trialing subscription', values: { planStatus: 'trialing', billingArrangement: 'immediate' }, customerAccess: BILLING_ACCESS_STATES.full, customerMutation: true, banner: false },
    { label: 'archived', values: { planStatus: 'past_due', billingArrangement: 'immediate', archivedAt: '2026-08-01T00:00:00Z' }, customerAccess: BILLING_ACCESS_STATES.archived, customerMutation: false, banner: false },
  ]

  for (const actor of actors) {
    for (const state of states) {
      const label = `${actor.label}: ${state.label}`
      const context = { ...actor.context, ...state.values }
      const decision = resolveBillingAccess(context)
      const expectedAccess = actor.kind === 'platform'
        ? BILLING_ACCESS_STATES.full
        : actor.kind === 'parent' && state.label !== 'archived'
          ? BILLING_ACCESS_STATES.full
          : state.customerAccess
      const bannerVisible = [BILLING_ACCESS_STATES.paymentDueSoon, BILLING_ACCESS_STATES.paymentRequired].includes(decision.accessState)
      const expectedMutation = actor.kind === 'platform' || actor.kind === 'parent' ? true : state.customerMutation
      const expectedBilling = actor.kind === 'platform'
        ? true
        : actor.kind === 'parent' || actor.kind === 'coach' || state.label === 'archived'
          ? false
          : true

      assert.equal(decision.accessState, expectedAccess, `${label} access`)
      assert.equal(bannerVisible, actor.kind === 'platform' || actor.kind === 'parent' ? false : state.banner, `${label} banner`)
      assert.equal(isBillingActionAllowed(context, BILLING_ACTION_CATEGORIES.read), true, `${label} read`)
      assert.equal(isBillingActionAllowed(context, BILLING_ACTION_CATEGORIES.export), true, `${label} export`)
      assert.equal(isBillingActionAllowed(context, BILLING_ACTION_CATEGORIES.staffMutation), expectedMutation, `${label} mutation`)
      assert.equal(isBillingActionAllowed(context, BILLING_ACTION_CATEGORIES.billing), expectedBilling, `${label} billing`)
    }
  }
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
