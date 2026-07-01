import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CAPABILITIES,
  canUseFeature,
} from '../src/lib/paywall-access.js'

const migrationPath = 'supabase/migrations/20260622050850_paywall_server_enforcement.sql'
const pilotMigrationPath = 'supabase/migrations/20260629153000_add_internal_pilot_tier.sql'

function readSource(path) {
  return readFileSync(path, 'utf8')
}

function paidContext(planKey, overrides = {}) {
  return {
    planKey,
    planStatus: 'active',
    isPlanComped: false,
    clubId: 'club-1',
    teamId: 'team-1',
    role: 'coach',
    roleRank: 30,
    ...overrides,
  }
}

test('server capability checks follow approved tier edges', () => {
  assert.equal(canUseFeature(paidContext('individual'), CAPABILITIES.assessments), false)
  assert.equal(canUseFeature(paidContext('single_team'), CAPABILITIES.assessments), true)
  assert.equal(canUseFeature(paidContext('single_team'), CAPABILITIES.recurringEvents), false)
  assert.equal(canUseFeature(paidContext('small_club'), CAPABILITIES.recurringEvents), true)
  assert.equal(canUseFeature(paidContext('small_club', { role: 'admin', roleRank: 90 }), CAPABILITIES.approvalWorkflows), false)
  assert.equal(canUseFeature(paidContext('development_club', { role: 'admin', roleRank: 90 }), CAPABILITIES.approvalWorkflows), true)
  assert.equal(canUseFeature(paidContext('large_club'), CAPABILITIES.integrations), false)
  assert.equal(canUseFeature(paidContext('pilot', { planStatus: 'past_due' }), CAPABILITIES.agreedServiceTerms), true)
  assert.equal(canUseFeature(paidContext('pilot'), CAPABILITIES.integrations), false)
})

test('high-risk Netlify functions use authenticated plan profiles for user-token actions', () => {
  const parentEmail = readSource('netlify/functions/send-parent-email.js')
  const renderPdf = readSource('netlify/functions/render-pdf.js')
  const parentInvite = readSource('netlify/functions/send-parent-portal-invite.js')
  const staffInvite = readSource('netlify/functions/send-staff-invite.js')

  assert.match(parentEmail, /getAuthenticatedPlanProfile\(event,\s*\{/)
  assert.match(parentEmail, /assertPlanFeature\(planProfile,\s*'parentEmails'\)/)
  assert.match(parentEmail, /assertPlanFeature\(planProfile,\s*'pdfReports'\)/)
  assert.doesNotMatch(parentEmail, /getClubPlanProfile\(body\.clubId\)/)

  assert.match(renderPdf, /getAuthenticatedPlanProfile\(event,\s*\{/)
  assert.match(renderPdf, /assertPlanFeature\(planProfile,\s*'pdfReports'\)/)
  assert.doesNotMatch(renderPdf, /getClubPlanProfile\(body\.clubId\)/)

  assert.match(parentInvite, /assertPlanFeature\(planProfile,\s*'parentInvitations'\)/)
  assert.match(staffInvite, /assertPlanFeature\(planProfile,\s*invite\.team_id \? 'teamStaffRoles' : 'clubStaffRoles'\)/)
})

test('migration fails closed and maps approved server-side feature tiers', () => {
  const sql = readSource(migrationPath)

  assert.match(sql, /else false\s+end;/)
  assert.match(sql, /normalized_feature_key in \('approvalworkflows', 'approval_workflows', 'approvalworkflow', 'approval_workflow'\) then target_plan_key in \('development_club', 'large_club'\)/)
  assert.match(sql, /normalized_feature_key in \('parentemails', 'parent_emails', 'parentemail', 'parent_email'\) then target_plan_key in \('single_team', 'small_club', 'development_club', 'large_club'\)/)
  assert.match(sql, /normalized_feature_key in \('recurringevents', 'recurring_events', 'calendarexportfeed', 'calendar_export_feed'\) then target_plan_key in \('small_club', 'development_club', 'large_club'\)/)
  assert.match(sql, /normalized_feature_key in \('integrations', 'externalcalendarintegrations', 'external_calendar_integrations'\) then false/)
  assert.match(sql, /public\.can_use_plan_feature\(calendar_events\.club_id, 'recurringEvents'\)/)
  assert.match(sql, /public\.can_use_plan_feature\(parent_player_links\.club_id, 'parentInvitations'\)/)
  assert.match(sql, /public\.can_use_plan_feature\(public\.current_user_club_id\(\), 'basicLogoBranding'\)/)

  const pilotSql = readSource(pilotMigrationPath)
  assert.match(pilotSql, /then 'pilot'/)
  assert.match(pilotSql, /target_entitlement_plan_key := case[\s\S]*when target_plan_key = 'pilot' then 'large_club'/)
  assert.match(pilotSql, /target_plan_key <> 'pilot'[\s\S]*not target_is_plan_comped[\s\S]*public\.is_club_plan_access_active/)
  assert.match(pilotSql, /target_entitlement_plan_key in \('development_club', 'large_club'\)/)
  assert.match(pilotSql, /target_is_plan_comped and target_plan_key <> 'pilot'/)
})
