import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { loadPlanInsights } from '../netlify/functions/lib/_plan-insights.js'
import { previewPlanChange } from '../src/lib/plan-change-preview.js'
import { MATCHDAY_DEFAULT_FLAGS } from '../src/lib/matchday-policy.js'

const policy = { revision: 1, flags: MATCHDAY_DEFAULT_FLAGS }
const preview = overrides => previewPlanChange({ currentPlanKey: 'club', targetPlanKey: 'matchday', teamCapacity: 1, usage: { teams: 3 }, matchdayPolicy: policy, ...overrides })

test('downgrade identifies lost features and capacity without changing settings', () => {
  const result = preview()
  assert.equal(result.excessTeams, 2)
  assert.ok(result.lostFeatures.some(feature => feature.key === 'assessments'))
  assert.ok(result.lostFeatures.some(feature => feature.key === 'clubAdministration'))
  assert.ok(!result.lostFeatures.some(feature => feature.key === 'matchDay'))
  assert.ok(!result.lostFeatures.some(feature => feature.key === 'dataRightsExport'))
  assert.equal(policy.flags.matchDay, true)
  assert.equal(preview({ targetPlanKey: 'club', teamCapacity: 20, usage: { teams: 21 } }).excessTeams, 1)
  assert.equal(preview({ currentPlanKey: 'matchday', targetPlanKey: 'team' }).lostFeatures.length, 0)
})

test('preview uses current admin switches and treats unknown inputs honestly', () => {
  const disabled = { ...policy, flags: { ...policy.flags, matchDay: false, pdfReports: false } }
  assert.ok(preview({ matchdayPolicy: disabled }).lostFeatures.some(feature => feature.key === 'matchDay'))
  assert.equal(preview({ matchdayPolicy: null }).available, false)
  assert.equal(preview({ currentPlanKey: 'unknown' }).available, false)
  assert.equal(preview({ usage: { teams: null } }).capacityVerified, false)
  assert.equal(preview({ usage: { teams: null } }).excessTeams, null)
  assert.throws(() => preview({ targetPlanKey: 'club', teamCapacity: 11 }))
})

function client(results = {}) {
  const scopes = []
  return {
    scopes,
    rpc: async () => results.policy ?? { data: policy },
    from(table) {
      const query = {
        select: () => query,
        eq: (key, value) => { scopes.push([table, key, value]); return query },
        is: () => Promise.resolve(results[table] ?? { count: 2 }),
        neq: () => Promise.resolve(results[table] ?? { count: 40 }),
        maybeSingle: async () => results[table] ?? { data: null },
      }
      return query
    },
  }
}

test('usage scopes every query to the authorised club and uses paid capacity', async () => {
  const db = client()
  const result = await loadPlanInsights(db, { id: 'club-a', plan_key: 'club', subscription_team_capacity: 30 })
  assert.equal(result.teams, 2)
  assert.equal(result.players, 40)
  assert.equal(result.teamCapacity, 30)
  assert.ok(db.scopes.every(([, key, value]) => key === 'club_id' && value === 'club-a'))
  const source = readFileSync(new URL('../netlify/functions/get-billing-summary.js', import.meta.url), 'utf8')
  assert.ok(source.indexOf('if (!canAccessBilling)') < source.indexOf('await loadPlanInsights'))
})

test('failed counts and missing policy never become zero or default entitlements', async () => {
  const db = client({ teams: { error: new Error('unavailable') }, policy: { error: new Error('unavailable') } })
  const result = await loadPlanInsights(db, { id: 'club-a', plan_key: 'matchday' })
  assert.equal(result.teams, null)
  assert.equal(result.players, 40)
  assert.equal(result.teamCapacity, 1)
  assert.equal(result.matchdayPolicy, null)
})
