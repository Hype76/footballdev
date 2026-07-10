import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getRecoveryModuleForPath,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'
import { canViewEndSeasonStats } from '../src/lib/auth-permissions.js'

const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const endSeasonPageUrl = new URL('../src/pages/EndSeasonStatsPage.jsx', import.meta.url)
const seasonStatsDomainUrl = new URL('../src/lib/domain/season-stats.js', import.meta.url)
const seasonStatsMigrationUrl = new URL('../supabase/migrations/20260519213000_end_season_stats.sql', import.meta.url)
const hardeningMigrationUrl = migrationSourceUrl('20260617193000_harden_end_season_stats_visibility.sql', 'archivedNotAppliedProduction')
const teamSeasonStatsMigrationUrl = migrationSourceUrl('20260630102239_20260630100000_v1_team_season_reports_and_event_requests.sql', 'active')

function managerUser(overrides = {}) {
  return {
    activeTeamId: 'team-1',
    clubId: 'club-1',
    planKey: 'club',
    planStatus: 'active',
    role: 'head_manager',
    roleRank: 70,
    ...overrides,
  }
}

function getFunctionSection(source, functionName) {
  const start = source.indexOf(`function ${functionName}()`)
  assert.notEqual(start, -1, `${functionName} should exist`)
  const nextFunction = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction)
}

test('batch 4 season report route is surfaced while billing and activity log stay hidden', () => {
  const user = managerUser()

  assert.equal(getRecoveryModuleForPath('/end-season-stats'), 'reports')
  assert.equal(isRecoveryPathVisible('/end-season-stats', { user }), true)
  assert.equal(isRecoveryPathVisible('/billing', { user }), false)
  assert.equal(isRecoveryPathVisible('/activity-log', { user }), false)
  assert.equal(isRecoveryPathVisible('/platform-feedback', { user }), false)
})

test('season report route still requires manager access before recovery visibility', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const section = getFunctionSection(source, 'RequireEndSeasonStatsAccess')

  assert.match(section, /canViewEndSeasonStats\(user\)/)
  assert.match(section, /isRecoveryModuleVisible\('reports', \{ user \}\)/)
  assert.match(section, /return <FeatureUnavailableState capability=\{CAPABILITIES\.basicClubAnalytics\} user=\{user\} \/>/)
  assert.match(section, /return <RecoveryPhaseBlockedState \/>/)
})

test('season report access allows assigned team staff but blocks unscoped staff before RPC', async () => {
  const source = await readFile(seasonStatsDomainUrl, 'utf8')

  assert.equal(canViewEndSeasonStats(managerUser({ role: 'coach', roleRank: 30 })), true)
  assert.equal(canViewEndSeasonStats(managerUser({ activeTeamId: '', role: 'coach', roleRank: 30 })), false)
  assert.equal(canViewEndSeasonStats(managerUser({ activeTeamId: '', role: 'admin', roleRank: 100 })), true)

  assert.match(source, /function assertSeasonStatsAccess\(user\)/)
  assert.match(source, /!user\?\.clubId/)
  assert.match(source, /user\.role === 'parent_portal'/)
  assert.match(source, /user\.role === 'super_admin'/)
  assert.match(source, /Number\(user\.roleRank \?\? 0\) < 20/)
  assert.match(source, /!normalizeText\(user\.activeTeamId\)/)
  assert.match(source, /const isClubAdmin = user\?\.role === 'admin'/)
  assert.match(source, /safeTeamId = isClubAdmin \? normalizeText\(teamId\) \|\| null : normalizeText\(user\.activeTeamId\)/)
  assert.match(source, /assertSeasonStatsAccess\(user\)[\s\S]*supabase\.rpc\('get_end_season_stats'/)
})

test('season stats RPC is club scoped manager scoped and team filter safe', async () => {
  const migration = await readFile(seasonStatsMigrationUrl, 'utf8')
  const hardeningMigration = await readFile(hardeningMigrationUrl, 'utf8')
  const teamSeasonMigration = await readFile(teamSeasonStatsMigrationUrl, 'utf8')

  assert.match(migration, /public\.current_user_club_id\(\) as club_id/i)
  assert.match(migration, /public\.current_user_role_rank\(\) as role_rank/i)
  assert.match(migration, /where auth\.uid\(\) is not null/i)
  assert.match(migration, /scope\.role_rank >= 50/i)
  assert.match(migration, /scope\.club_id = player\.club_id/i)
  assert.match(migration, /scope\.club_id = match_day\.club_id/i)
  assert.match(migration, /coalesce\(player\.status, 'active'\) <> 'archived'/i)
  assert.match(migration, /player\.section = 'Squad'/i)
  assert.match(migration, /team_id_value is null\s+or player\.team_id = team_id_value/i)
  assert.match(hardeningMigration, /revoke all on function public\.get_end_season_stats\(uuid\) from public;/i)
  assert.match(hardeningMigration, /revoke execute on function public\.get_end_season_stats\(uuid\) from anon;/i)
  assert.match(hardeningMigration, /grant execute on function public\.get_end_season_stats\(uuid\) to authenticated;/i)
  assert.match(teamSeasonMigration, /scope\.role = 'admin'/i)
  assert.match(teamSeasonMigration, /scope\.role_rank >= 20/i)
  assert.match(teamSeasonMigration, /from public\.team_staff staff/i)
  assert.match(teamSeasonMigration, /staff\.team_id = team_id_value/i)
  assert.match(teamSeasonMigration, /scope\.can_read is true/i)
})

test('season report page is read-only and keeps awards as local snapshots', async () => {
  const source = await readFile(endSeasonPageUrl, 'utf8')

  assert.match(source, /const canUseClubWideSeasonView = isClubAdmin\(user\)/)
  assert.match(source, /getAvailableTeamsForUser\(user\)/)
  assert.match(source, /getEndSeasonStats\(\{ user, teamId: selectedTeamId \}\)/)
  assert.match(source, /canUseClubWideSeasonView \? \(/)
  assert.match(source, /const generateAwards = \(\) => \{\s*setAwardsGeneratedAt\(new Date\(\)\.toISOString\(\)\)\s*\}/)
  assert.match(source, /All active squad players are listed/)
  assert.doesNotMatch(source, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|sendParentEmail|sendPreparedParentEmail|sendEmail/i)
})
