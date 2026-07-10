import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  PLAN_KEYS,
  getPlanDefaultLimit,
  getPlanLimit,
  normalizeTeamLimitOverride,
} from '../src/lib/plans.js'

const migrationUrl = migrationSourceUrl('20260623172005_add_club_team_limit_overrides.sql', 'active')
const manageTeamFunctionUrl = new URL('../netlify/functions/manage-team.js', import.meta.url)
const updatePlatformClubBillingUrl = new URL('../netlify/functions/update-platform-club-billing.js', import.meta.url)
const platformAccountManagementUrl = new URL('../src/components/platform/PlatformAccountManagementSection.jsx', import.meta.url)
const platformAdminPageUrl = new URL('../src/pages/PlatformAdminPage.jsx', import.meta.url)
const teamManagementPageUrl = new URL('../src/pages/TeamManagementPage.jsx', import.meta.url)

test('team allowance override controls the effective team limit without changing plan defaults', () => {
  const largeClub = {
    planKey: PLAN_KEYS.largeClub,
    planStatus: 'active',
  }

  assert.equal(getPlanDefaultLimit(largeClub, 'teams'), 10)
  assert.equal(getPlanLimit(largeClub, 'teams'), 10)
  assert.equal(getPlanLimit({ ...largeClub, teamLimitOverride: 25 }, 'teams'), 25)
  assert.equal(getPlanLimit({ ...largeClub, teamAllowanceOverride: '30' }, 'teams'), 30)
  assert.equal(getPlanLimit({ ...largeClub, teamLimitOverride: '' }, 'teams'), 10)
  assert.equal(getPlanLimit({ planKey: PLAN_KEYS.smallClub, planStatus: 'active', teamLimitOverride: 8 }, 'teams'), 8)

  const pilot = {
    planKey: PLAN_KEYS.pilot,
    planStatus: 'active',
  }

  assert.equal(getPlanDefaultLimit(pilot, 'teams'), 10)
  assert.equal(getPlanLimit(pilot, 'teams'), 10)
  assert.equal(getPlanLimit({ ...pilot, teamLimitOverride: 18 }, 'teams'), 18)
})

test('team allowance override validation rejects unsafe values and keeps blank as plan default', () => {
  assert.equal(normalizeTeamLimitOverride(''), null)
  assert.equal(normalizeTeamLimitOverride(null), null)
  assert.equal(normalizeTeamLimitOverride(' 12 '), 12)
  assert.throws(() => normalizeTeamLimitOverride('0'), /Team allowance must be a whole number/)
  assert.throws(() => normalizeTeamLimitOverride('-1'), /Team allowance must be a whole number/)
  assert.throws(() => normalizeTeamLimitOverride('12.5'), /Team allowance must be a whole number/)
  assert.throws(() => normalizeTeamLimitOverride('501'), /Team allowance must be a whole number/)
})

test('migration stores team allowance overrides in a Platform Admin controlled table', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.club_team_limit_overrides/)
  assert.match(migration, /team_limit_override integer not null/)
  assert.match(migration, /check \(team_limit_override between 1 and 500\)/)
  assert.match(migration, /alter table public\.club_team_limit_overrides enable row level security/)
  assert.match(migration, /club_team_limit_overrides_select_super_admin/)
  assert.match(migration, /club_team_limit_overrides_insert_super_admin/)
  assert.match(migration, /club_team_limit_overrides_update_super_admin/)
  assert.match(migration, /club_team_limit_overrides_delete_super_admin/)
  assert.match(migration, /public\.current_user_role\(\) = 'super_admin'/)
  assert.doesNotMatch(migration, /alter table public\.clubs[\s\S]*team_limit_override/)
})

test('database team insert policy uses custom allowance before plan default', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create or replace function public\.can_insert_team_for_plan/)
  assert.match(migration, /left join public\.club_team_limit_overrides o on o\.club_id = c\.id/)
  assert.match(migration, /target_team_limit_override/)
  assert.match(migration, /team_limit := coalesce\(/)
  assert.match(migration, /when 'large_club' then 10/)
  assert.match(migration, /return current_team_count < team_limit/)
})

test('manage-team server function enforces the effective allowance', async () => {
  const source = await readFile(manageTeamFunctionUrl, 'utf8')

  assert.match(source, /from\('club_team_limit_overrides'\)/)
  assert.match(source, /getTeamLimitOverride\(profile\.clubId\)/)
  assert.match(source, /teamLimitOverride/)
  assert.match(source, /getPlanLimit\(planProfile, 'teams'\)/)
  assert.match(source, /createLimitUpgradeMessage\(planProfile, 'teams', 'Teams'\)/)
})

test('Platform Admin can save a custom team allowance without changing billing fields', async () => {
  const billingFunction = await readFile(updatePlatformClubBillingUrl, 'utf8')
  const platformPage = await readFile(platformAdminPageUrl, 'utf8')
  const platformSection = await readFile(platformAccountManagementUrl, 'utf8')

  assert.match(platformSection, /getAdminAssignablePlanOptions/)
  assert.match(platformSection, /Team allowance/)
  assert.match(platformSection, /Leave blank to use the plan default\./)
  assert.match(platformSection, /Effective allowance/)
  assert.match(platformSection, /Current teams/)
  assert.match(platformPage, /fieldName === 'teamLimitOverride'/)
  assert.match(platformPage, /teamLimitOverride: value/)
  assert.match(billingFunction, /hasRequestedTeamLimitOverride/)
  assert.match(billingFunction, /saveTeamLimitOverride/)
  assert.match(billingFunction, /from\('club_team_limit_overrides'\)/)
  assert.match(billingFunction, /Club team allowance updated\./)
  assert.match(billingFunction, /shouldUpdateBilling && Boolean\(currentClub\.is_plan_comped\) !== nextIsPlanComped/)
})

test('Platform Admin plan controls expose Pilot as an admin-only free plan', async () => {
  const billingFunction = await readFile(updatePlatformClubBillingUrl, 'utf8')
  const platformPage = await readFile(platformAdminPageUrl, 'utf8')
  const platformSection = await readFile(platformAccountManagementUrl, 'utf8')
  const manageClubsSection = await readFile(new URL('../src/components/platform/ManageClubsSection.jsx', import.meta.url), 'utf8')

  assert.match(manageClubsSection, /getAdminAssignablePlanOptions/)
  assert.match(manageClubsSection, /value="paid" disabled=\{form\.planKey === PLAN_KEYS\.pilot\}/)
  assert.match(platformSection, /getAdminAssignablePlanOptions/)
  assert.match(platformSection, /isPilotPlan \|\| Boolean\(club\.isPlanComped\)/)
  assert.match(platformSection, /Pilot access is always free\./)
  assert.match(platformPage, /fieldName === 'planKey' && value === PLAN_KEYS\.pilot[\s\S]*billingMode: 'unpaid'/)
  assert.match(platformPage, /fieldName === 'planKey' && value === PLAN_KEYS\.pilot[\s\S]*isPlanComped: true[\s\S]*planStatus: 'active'/)
  assert.match(billingFunction, /const nextPlanStatus = nextPlanKey === 'pilot' \? 'active' : requestedPlanStatus/)
  assert.match(billingFunction, /const nextIsPlanComped = nextPlanKey === 'pilot'/)
})

test('Club Admin create-team flow does not block on stale client-only team limit', async () => {
  const source = await readFile(teamManagementPageUrl, 'utf8')

  assert.match(source, /const serverEnforcesTeamLimit = user\?\.role === 'admin' \|\| user\?\.role === 'super_admin'/)
  assert.match(source, /const canCreateMoreTeams = serverEnforcesTeamLimit \|\| isWithinPlanLimit\(user, 'teams', teams\.length\)/)
  assert.match(source, /if \(!serverEnforcesTeamLimit && !isWithinPlanLimit\(user, 'teams', teams\.length\)\)/)
})
