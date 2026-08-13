import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COACH_BACKEND_DELTA_MATRIX,
  COACH_INTENTIONAL_WEB_ONLY,
  COACH_LINEAGE,
  COACH_MASTER_REFERENCE,
  COACH_PARITY_MATRIX,
  COACH_REQUIRED_PARITY_AREAS,
  COACH_ROLE_MATRIX,
} from '../apps/coach-mobile/src/coachParityAudit.js'

test('Phase 31A records exact Coach, Parent, web, branch, and worktree lineage', () => {
  assert.equal(COACH_MASTER_REFERENCE, 'FP-MOBILE-COACH-FULL-PARITY-MASTER-31')
  assert.match(COACH_LINEAGE.initialCoachAssuranceCommit, /^[0-9a-f]{40}$/)
  assert.match(COACH_LINEAGE.initialCoachRuntimeSource, /^[0-9a-f]{40}$/)
  assert.match(COACH_LINEAGE.parentCorrectiveSource, /^[0-9a-f]{40}$/)
  assert.match(COACH_LINEAGE.staffWebSource, /^[0-9a-f]{40}$/)
  assert.equal(COACH_LINEAGE.branch, 'codex/fp-mobile-coach-full-parity-master-31')
  assert.equal(COACH_LINEAGE.worktree, 'E:/Project Manager/FP-MOBILE-COACH-FULL-PARITY-MASTER-31')
})

test('Phase 31A parity matrix covers every required operational area', () => {
  const coveredAreas = new Set(COACH_PARITY_MATRIX.map((item) => item.area))

  for (const area of COACH_REQUIRED_PARITY_AREAS) {
    assert.equal(coveredAreas.has(area), true, `Missing parity area: ${area}`)
  }

  assert.ok(COACH_PARITY_MATRIX.length >= 40)
})

test('every parity row identifies roles, current mobile state, authority, and disposition', () => {
  const permittedStatuses = new Set(['missing', 'partial', 'implemented', 'web-only'])

  for (const row of COACH_PARITY_MATRIX) {
    assert.ok(row.area)
    assert.ok(row.webCapability)
    assert.ok(Array.isArray(row.roles) && row.roles.length > 0)
    assert.ok(row.currentCoachEquivalent)
    assert.ok(row.authoritySource)
    assert.equal(permittedStatuses.has(row.mobileImplementationStatus), true)

    if (row.mobileImplementationStatus === 'web-only') {
      assert.ok(row.intentionalWebOnlyReason)
    } else {
      assert.equal(row.intentionalWebOnlyReason, '')
    }
  }
})

test('intentional web-only exclusions are concrete governance, financial, or poor-phone-fit decisions', () => {
  const excludedCapabilities = COACH_INTENTIONAL_WEB_ONLY.map((item) => item.webCapability).join(' | ')

  assert.match(excludedCapabilities, /Activity Log/)
  assert.match(excludedCapabilities, /Data Transfer/)
  assert.match(excludedCapabilities, /email template/)
  assert.match(excludedCapabilities, /Plan checkout/)
  assert.match(excludedCapabilities, /Platform Analytics/)
  assert.equal(COACH_INTENTIONAL_WEB_ONLY.every((item) => item.intentionalWebOnlyReason.length >= 40), true)
})

test('canonical role matrix separates operational staff, dual-role access, Parent, Player, and Platform Admin', () => {
  const roles = new Map(COACH_ROLE_MATRIX.map((role) => [role.key, role]))

  assert.equal(roles.get('assistant_coach').rank, 20)
  assert.equal(roles.get('coach').rank, 30)
  assert.equal(roles.get('manager').rank, 50)
  assert.equal(roles.get('head_manager').rank, 70)
  assert.equal(roles.get('admin').rank, 90)
  assert.equal(roles.get('super_admin').eligible, false)
  assert.equal(roles.get('parent_portal').eligible, false)
  assert.equal(roles.get('adult_player').eligible, false)
  assert.match(roles.get('super_admin').notes, /separately proven staff workspace/)
  assert.match(roles.get('parent_portal').notes, /independent staff workspace/)
})

test('backend audit classifies A, B, C, and D without duplicating canonical business models', () => {
  const categories = new Set(COACH_BACKEND_DELTA_MATRIX.map((item) => item.category))
  const parallelModels = COACH_BACKEND_DELTA_MATRIX.find((item) => item.key === 'parallel_business_models')

  assert.deepEqual([...categories].sort(), ['A', 'B', 'C', 'D'])
  assert.match(parallelModels.action, /Do not create/)
  assert.equal(
    COACH_BACKEND_DELTA_MATRIX
      .filter((item) => item.category === 'B')
      .every((item) => item.action.includes('Production promotion is not authorised') || !item.action.includes('production')),
    true,
  )
})

test('high-risk Match Day actions remain online required', () => {
  const highRiskTerms = /timer|goal|\bcards?\b|substitution|shootout|squad|scorer|formation/i
  const highRiskRows = COACH_PARITY_MATRIX.filter((item) => item.area === 'Match Day' && highRiskTerms.test(item.webCapability))

  assert.ok(highRiskRows.length >= 6)
  assert.equal(highRiskRows.every((item) => item.offlineBehaviour === 'online required' || item.offlineBehaviour.includes('read cache')), true)
})
