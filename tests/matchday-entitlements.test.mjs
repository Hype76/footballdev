import assert from 'node:assert/strict'
import test from 'node:test'
import { MATCHDAY_DEFAULT_FLAGS, validateMatchdayFlags } from '../src/lib/matchday-policy.js'
import { getFeatureAccess } from '../src/lib/paywall-access.js'
import { getPlanLimit, getPublicPlanOptions } from '../src/lib/plans.js'
import { resolveBillingAccess } from '../src/lib/billing-access.js'

const coach = { id: 'coach', role: 'manager', roleRank: 50, clubId: 'club', teamId: 'team', planKey: 'matchday', matchdayPolicy: { flags: MATCHDAY_DEFAULT_FLAGS } }

test('Matchday provides a working match workflow without development or club capabilities', () => {
  for (const feature of ['players', 'teamCalendar', 'fixtures', 'matchDay', 'parentInvitations', 'parentEmails', 'pdfReports']) {
    assert.equal(getFeatureAccess(coach, feature).allowed, true, feature)
  }
  for (const feature of ['assessments', 'basicDevelopmentRecords', 'trainingEvents', 'trialPlayers', 'resourceLibrary', 'staffChat', 'customColoursBranding', 'clubAdministration']) {
    assert.equal(getFeatureAccess(coach, feature).allowed, false, feature)
  }
})

test('admin switches cannot bypass roles, missing context or disabled dependencies', () => {
  const flags = { ...MATCHDAY_DEFAULT_FLAGS, assessments: true }
  assert.equal(getFeatureAccess({ ...coach, role: 'parent_portal', roleRank: 0, matchdayPolicy: { flags } }, 'assessments').allowed, false)
  assert.equal(getFeatureAccess({ ...coach, teamId: '', matchdayPolicy: { flags } }, 'assessments').allowed, false)
  assert.equal(getFeatureAccess({ ...coach, matchdayPolicy: { flags: {} } }, 'matchDay').allowed, false)
  assert.equal(getFeatureAccess({ ...coach, matchdayPolicy: { flags: {} } }, 'dataRightsExport').allowed, true)
  assert.throws(() => validateMatchdayFlags({ ...flags, platformAdminAccess: true }))
  assert.throws(() => validateMatchdayFlags({ ...flags, matchDay: 'true' }))
  assert.throws(() => validateMatchdayFlags({ ...flags, fixtures: false }))
})

test('Team and Club scope remain independent from commercial capacity overrides', () => {
  assert.equal(getPlanLimit({ planKey: 'matchday', teamLimitOverride: 100 }, 'teams'), 1)
  assert.equal(getPlanLimit({ planKey: 'team', planStatus: 'active', teamLimitOverride: 100 }, 'teams'), 1)
  assert.equal(getPlanLimit({ planKey: 'club', planStatus: 'active', subscriptionTeamCapacity: 30 }, 'teams'), 30)
  assert.equal(getPlanLimit({ planKey: 'club', planStatus: 'active', subscriptionTeamCapacity: 31 }, 'teams'), 10)
  assert.equal(getFeatureAccess({ ...coach, planKey: 'team', role: 'admin', roleRank: 90 }, 'clubAdministration').allowed, false)
  assert.equal(getFeatureAccess({ ...coach, planKey: 'club', role: 'admin', roleRank: 90 }, 'clubAdministration').allowed, true)
  assert.deepEqual(getPublicPlanOptions().map(plan => plan.key), ['matchday', 'team', 'club'])
})

test('free Matchday allows operations without a paid subscription and preserves archive restriction', () => {
  const billing = resolveBillingAccess({ ...coach, workspaceId: 'club', planStatus: 'unpaid' })
  assert.equal(billing.operationalMutationsAllowed, true)
  assert.equal(resolveBillingAccess({ ...coach, workspaceId: 'club', archivedAt: '2026-09-01T00:00:00Z' }).operationalMutationsAllowed, false)
})
