import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const cleanupMigrationUrl = new URL('../supabase/migrations/20260616070626_harden_parent_portal_cleanup.sql', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const matchDayPushUrl = new URL('../netlify/functions/send-match-day-push.js', import.meta.url)
const parentMobilePushUrl = new URL('../netlify/functions/send-parent-mobile-push.js', import.meta.url)
const parentLoginUrl = new URL('../src/pages/ParentLoginPage.jsx', import.meta.url)
const publicParentPortalLoginUrl = new URL('../src/pages/PublicParentPortalLoginPage.jsx', import.meta.url)

const parentRpcSignatures = [
  'current_user_can_access_parent_link\\(uuid, uuid\\)',
  'current_user_can_access_parent_player\\(uuid\\)',
  'current_user_can_access_parent_team\\(uuid\\)',
  'accept_parent_player_link\\(uuid\\)',
  'revoke_family_player_link\\(uuid\\)',
  'get_parent_portal_email_messages\\(uuid\\)',
  'mark_parent_portal_message_read\\(uuid, uuid\\)',
  'get_parent_portal_polls\\(uuid\\)',
  'submit_parent_portal_poll_vote\\(uuid, uuid, text\\)',
  'get_parent_portal_match_day_players\\(uuid\\)',
  'express_match_day_scorer_interest\\(uuid, uuid, text\\)',
  'update_match_day_score_as_scorer\\(uuid, uuid, integer, integer, text\\)',
  'add_match_day_goal_as_scorer\\(uuid, uuid, text, text, text, text, text, integer, text\\)',
]

async function readCleanupMigration() {
  return readFile(cleanupMigrationUrl, 'utf8')
}

function getFunctionSection(source, functionName) {
  const start = source.indexOf(`create or replace function public.${functionName}`)
  assert.notEqual(start, -1, `${functionName} should exist`)
  const end = source.indexOf('\nrevoke all on function', start + 1)
  return source.slice(start, end === -1 ? source.length : end)
}

test('cleanup migration hardens parent-facing RPC execute grants', async () => {
  const migration = await readCleanupMigration()

  for (const signature of parentRpcSignatures) {
    const revokePublic = new RegExp(`revoke all on function public\\.${signature} from public;`, 'i')
    const revokeAnon = new RegExp(`revoke execute on function public\\.${signature} from anon;`, 'i')
    const grantAuthenticated = new RegExp(`grant execute on function public\\.${signature} to authenticated;`, 'i')
    const grantServiceRole = new RegExp(`grant execute on function public\\.${signature} to service_role;`, 'i')

    assert.match(migration, revokePublic, `${signature} should revoke public execute`)
    assert.match(migration, revokeAnon, `${signature} should revoke anon execute`)
    assert.match(migration, grantAuthenticated, `${signature} should keep authenticated execute`)
    assert.match(migration, grantServiceRole, `${signature} should keep service_role execute`)
  }

  assert.doesNotMatch(migration, /grant execute on function public\.[a-z0-9_]+\([^)]*\) to anon;/i)
  assert.doesNotMatch(migration, /confirm_match_day_availability/i)
})

test('cleanup migration only changes function grants and parent invite acceptance function', async () => {
  const migration = await readCleanupMigration()

  assert.doesNotMatch(migration, /\balter\s+table\b/i)
  assert.doesNotMatch(migration, /\bcreate\s+table\b/i)
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i)
  assert.doesNotMatch(migration, /\bcreate\s+policy\b/i)
  assert.doesNotMatch(migration, /\bdrop\s+policy\b/i)
  assert.doesNotMatch(migration, /\binsert\s+into\b/i)
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i)
  assert.doesNotMatch(migration, /\btruncate\b/i)
  assert.doesNotMatch(migration, /\bexecute\s+format\(/i)
  assert.doesNotMatch(migration, /\bexecute\s+'/i)
})

test('parent invite acceptance requires the signed-in email for locked invites', async () => {
  const migration = await readCleanupMigration()
  const acceptRpc = getFunctionSection(migration, 'accept_parent_player_link')

  assert.match(acceptRpc, /auth_email text := lower\(trim\(coalesce\(\(auth\.jwt\(\) ->> 'email'\), ''\)\)\);/i)
  assert.match(acceptRpc, /if auth_email = '' then[\s\S]*A verified parent email is required/i)
  assert.match(acceptRpc, /target_email := lower\(trim\(coalesce\(target_link\.email, ''\)\)\);/i)
  assert.match(acceptRpc, /if target_email <> '' and target_email <> auth_email then[\s\S]*different email address/i)
  assert.match(acceptRpc, /email = coalesce\(nullif\(link\.email, ''\), auth_email\)/i)
})

test('parent invite acceptance keeps expired revoked and active-link paths fail closed', async () => {
  const migration = await readCleanupMigration()
  const acceptRpc = getFunctionSection(migration, 'accept_parent_player_link')

  assert.match(acceptRpc, /link\.status <> 'revoked'/i)
  assert.match(acceptRpc, /target_link\.expires_at is not null and target_link\.expires_at <= timezone\('utc', now\(\)\)/i)
  assert.match(acceptRpc, /if target_link\.status = 'active' then[\s\S]*target_link\.auth_user_id is distinct from auth\.uid\(\)[\s\S]*already connected to another account/i)
  assert.match(acceptRpc, /existing\.auth_user_id = auth\.uid\(\)/i)
  assert.match(acceptRpc, /lower\(trim\(coalesce\(existing\.email, ''\)\)\) = auth_email/i)
})

test('mobile push senders skip absent native push tables safely', async () => {
  for (const sourceUrl of [matchDayPushUrl, parentMobilePushUrl]) {
    const source = await readFile(sourceUrl, 'utf8')

    assert.match(source, /function isMissingTableError\(error\)/)
    assert.match(source, /code === '42P01'/)
    assert.match(source, /message\.includes\('relation'\) && message\.includes\('does not exist'\)/)
    assert.match(source, /return \[\]/)
    assert.match(source, /skipping .*push/i)
    assert.match(source, /skipping .*event log/i)
  }
})

test('parent poll count remains behind the parent poll recovery path check', async () => {
  const source = await readFile(sidebarUrl, 'utf8')
  const parentBranchStart = source.indexOf('if (isParentPortalUser(user))')
  assert.notEqual(parentBranchStart, -1)
  const pollCallIndex = source.indexOf('getParentPortalPolls', parentBranchStart)
  const gateIndex = source.indexOf("!isRecoveryPathVisible('/parent-polls', { user })", parentBranchStart)

  assert.notEqual(pollCallIndex, -1)
  assert.notEqual(gateIndex, -1)
  assert.ok(gateIndex < pollCallIndex)
})

test('parent-facing copy does not promise current-phase report surfaces', async () => {
  const parentLogin = await readFile(parentLoginUrl, 'utf8')
  const publicLogin = await readFile(publicParentPortalLoginUrl, 'utf8')

  assert.doesNotMatch(parentLogin, /development reports/i)
  assert.doesNotMatch(publicLogin, /\breports\b/i)
  assert.match(parentLogin, /club-shared updates, match cards, and child information the club has chosen to share/i)
  assert.match(publicLogin, /linked child, match cards, and club-shared updates/i)
})
