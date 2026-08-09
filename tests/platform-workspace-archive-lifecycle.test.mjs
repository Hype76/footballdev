import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/20260807200526_platform_workspace_archive_lifecycle.sql', 'utf8')
const platformActions = readFileSync('src/lib/domain/platform-admin-actions.js', 'utf8')
const platformPage = readFileSync('src/pages/PlatformAdminPage.jsx', 'utf8')
const accountSection = readFileSync('src/components/platform/PlatformAccountManagementSection.jsx', 'utf8')
const teamActions = readFileSync('src/lib/domain/team-actions.js', 'utf8')
const router = readFileSync('src/app/router.jsx', 'utf8')
const planGate = readFileSync('netlify/functions/lib/_plan-gate.js', 'utf8')

test('archive lifecycle migration adds retained state and transactional audit actions', () => {
  assert.match(migration, /alter table public\.clubs[\s\S]*archived_at timestamptz[\s\S]*archived_by uuid[\s\S]*archived_previous_status text/)
  assert.match(migration, /alter table public\.teams[\s\S]*archived_at timestamptz[\s\S]*archived_by uuid[\s\S]*archived_previous_status text/)
  assert.match(migration, /function public\.set_platform_club_archive_state/)
  assert.match(migration, /function public\.set_platform_team_archive_state/)
  assert.match(migration, /'club_archived'/)
  assert.match(migration, /'club_restored'/)
  assert.match(migration, /'platform_team_archived'/)
  assert.match(migration, /'platform_team_restored'/)
  assert.match(migration, /perform public\.record_security_audit_event/)
})

test('database requires archive state before permanent deletion', () => {
  assert.match(migration, /create trigger clubs_require_archive_before_delete[\s\S]*before delete on public\.clubs/)
  assert.match(migration, /if old\.archived_at is null then[\s\S]*club_must_be_archived_before_delete/)
  assert.match(migration, /delete_platform_team_transaction[\s\S]*if target_team\.archived_at is null then[\s\S]*team_must_be_archived_before_delete/)
})

test('archived workspaces are removed from normal Team access and plan gates', () => {
  assert.match(migration, /team\.archived_at is null/)
  assert.match(migration, /coalesce\(team\.status, 'active'\) = 'active'/)
  assert.match(migration, /club\.archived_at is null/)
  assert.match(migration, /coalesce\(club\.status, 'active'\) = 'active'/)
  assert.match(teamActions, /\.from\('teams'\)[\s\S]*\.is\('archived_at', null\)/)
  assert.match(router, /function ClubArchivedState/)
  assert.match(router, /isClubArchived/)
  assert.match(planGate, /archived_at/)
  assert.match(planGate, /clubArchived/)
})

test('Platform Admin uses archive RPCs and keeps delete guards in both client layers', () => {
  assert.match(platformActions, /rpc\('set_platform_club_archive_state'/)
  assert.match(platformActions, /rpc\('set_platform_team_archive_state'/)
  assert.match(platformActions, /club_must_be_archived_before_delete/)
  assert.match(platformPage, /if \(!club\.archivedAt\)/)
  assert.match(platformPage, /if \(!team\.archivedAt\)/)
  assert.match(platformPage, /setPlatformClubArchived\(\{[\s\S]*archived: true/)
  assert.match(platformPage, /setPlatformTeamArchived\(\{[\s\S]*archived: true/)
})

test('active workspace controls archive while retained records offer restore and permanent delete', () => {
  assert.match(accountSection, /Active workspaces/)
  assert.match(accountSection, /Archive \(\{archiveCount \?\? 0\}\)/)
  assert.match(accountSection, /Archive Club/)
  assert.match(accountSection, /Archive Team/)
  assert.match(accountSection, /function ArchivedWorkspaceCard/)
  assert.match(accountSection, /Restore Club/)
  assert.match(accountSection, /Restore Team/)
  assert.match(accountSection, /Permanently delete/)
  assert.match(platformPage, /title="Permanently delete archived Club"/)
  assert.match(platformPage, /title="Permanently delete archived Team"/)
})
