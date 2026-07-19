import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { migrationSourceUrl } from './helpers/migration-source.mjs'

const migrationUrl = migrationSourceUrl('20260719071505_p0_shared_authority_profile_containment.sql', 'active')

const sourceUrls = {
  core: new URL('../src/lib/domain/core.js', import.meta.url),
  onboarding: new URL('../src/lib/onboarding.js', import.meta.url),
  clubUsers: new URL('../src/lib/domain/club-user-actions.js', import.meta.url),
  platformUsers: new URL('../src/lib/domain/platform-admin-actions.js', import.meta.url),
  platformAccess: new URL('../netlify/functions/platform-admin-access.js', import.meta.url),
  platformStaff: new URL('../netlify/functions/manage-platform-admin-staff.js', import.meta.url),
  planGate: new URL('../netlify/functions/lib/_plan-gate.js', import.meta.url),
  authorityProfile: new URL('../netlify/functions/lib/_authority-profile.js', import.meta.url),
}

const serverAuthorityUrls = [
  '../netlify/functions/claim-stripe-checkout.js',
  '../netlify/functions/data-transfer.js',
  '../netlify/functions/delete-staff-voice-note.js',
  '../netlify/functions/get-billing-summary.js',
  '../netlify/functions/manage-stripe-coupons.js',
  '../netlify/functions/manage-tester-access-codes.js',
  '../netlify/functions/platform-create-club.js',
  '../netlify/functions/platform-delete-team.js',
  '../netlify/functions/platform-feedback-attachment-url.js',
  '../netlify/functions/platform-feedback-report-update.js',
  '../netlify/functions/platform-feedback-reports.js',
  '../netlify/functions/register-mobile-push-device.js',
  '../netlify/functions/select-match-day-volunteer.js',
  '../netlify/functions/send-coach-mobile-push.js',
  '../netlify/functions/send-match-day-availability-requests.js',
  '../netlify/functions/send-match-day-push.js',
  '../netlify/functions/send-parent-mobile-push.js',
  '../netlify/functions/submit-tester-feedback.js',
  '../netlify/functions/update-platform-club-billing.js',
]

async function readSources() {
  return Object.fromEntries(
    await Promise.all(Object.entries(sourceUrls).map(async ([key, url]) => [key, await readFile(url, 'utf8')])),
  )
}

test('migration revokes browser profile and membership writes and removes broad self-write policies', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /revoke insert, update on table public\.users from anon, authenticated/i)
  assert.match(migration, /revoke insert, update on table public\.user_club_memberships from anon, authenticated/i)
  assert.match(migration, /revoke insert, update, delete on table public\.platform_admins from anon, authenticated/i)
  assert.match(migration, /drop policy if exists users_insert_self on public\.users/i)
  assert.match(migration, /drop policy if exists users_update_self_or_manager on public\.users/i)
  assert.match(migration, /drop policy if exists user_club_memberships_insert_scoped on public\.user_club_memberships/i)
  assert.match(migration, /drop policy if exists user_club_memberships_update_scoped on public\.user_club_memberships/i)
  assert.doesNotMatch(migration, /grant\s+(?:all|insert|update)[^;]*public\.users\s+to\s+(?:anon|authenticated)/i)
})

test('protected profile and membership authority has a fail-closed trigger boundary', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const protectedUserFields = [
    'id',
    'email',
    'role',
    'club_id',
    'role_label',
    'role_rank',
    'force_password_change',
    'status',
    'suspended_at',
    'created_at',
  ]
  const protectedMembershipFields = [
    'id',
    'auth_user_id',
    'email',
    'role',
    'role_label',
    'role_rank',
    'club_id',
    'created_at',
  ]

  for (const field of protectedUserFields) {
    assert.match(migration, new RegExp(`old\\.${field} is distinct from new\\.${field}`, 'i'))
  }

  for (const field of protectedMembershipFields) {
    assert.match(migration, new RegExp(`old\\.${field} is distinct from new\\.${field}`, 'i'))
  }

  assert.match(migration, /before insert or update on public\.users/i)
  assert.match(migration, /before insert or update on public\.user_club_memberships/i)
  assert.match(migration, /errcode = '42501'/i)
})

test('authority helpers require active matching database authority and controlled execution', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  for (const functionName of [
    'current_user_has_active_authority',
    'current_user_role',
    'current_user_club_id',
    'current_user_role_rank',
    'user_belongs_to_current_club',
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${functionName}\\(`, 'i'))
    assert.match(migration, new RegExp(`revoke all on function public\\.${functionName}\\([^;]*from public, anon`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${functionName}\\([^;]*to authenticated`, 'i'))
  }

  assert.match(migration, /u\.status = 'active'/i)
  assert.match(migration, /pa\.status = 'active'/i)
  assert.match(migration, /m\.auth_user_id = u\.id[\s\S]*m\.club_id = u\.club_id[\s\S]*m\.role = u\.role[\s\S]*m\.role_rank = u\.role_rank/i)
  assert.match(migration, /coalesce\(c\.status, 'active'\) = 'active'/i)
})

test('all browser profile writes use narrow RPCs without direct insert, update or upsert', async () => {
  const sources = await readSources()
  const browserSources = [sources.core, sources.onboarding, sources.clubUsers, sources.platformUsers].join('\n')

  assert.doesNotMatch(browserSources, /\.from\(['"]users['"]\)[\s\S]{0,240}?\.(?:insert|update|upsert)\(/i)
  assert.doesNotMatch(browserSources, /\.from\(['"]user_club_memberships['"]\)[\s\S]{0,240}?\.(?:insert|update|upsert)\(/i)
  assert.match(sources.core, /rpc\('update_own_user_profile'/)
  assert.match(sources.core, /rpc\('update_own_theme_settings'/)
  assert.match(sources.core, /rpc\('sync_own_user_email'/)
  assert.match(sources.core, /rpc\('accept_own_club_user_invites'/)
  assert.match(sources.core, /rpc\('activate_own_club_membership'/)
  assert.match(sources.onboarding, /rpc\('update_own_onboarding_state'/)
  assert.match(sources.clubUsers, /rpc\('set_club_user_role'/)
  assert.match(sources.clubUsers, /rpc\('update_club_user_name'/)
  assert.match(sources.platformUsers, /rpc\('set_platform_user_status'/)
  assert.doesNotMatch(sources.core, /syncMembershipFromUserRow|buildLegacyStaffMembershipFromProfile/)
})

test('security-definer RPCs have fixed search paths and deliberate execute grants', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const rpcNames = [
    'update_own_user_profile',
    'update_own_theme_settings',
    'update_own_onboarding_state',
    'sync_own_user_email',
    'accept_own_club_user_invites',
    'activate_own_club_membership',
    'set_club_user_role',
    'update_club_user_name',
    'set_platform_user_status',
  ]

  for (const functionName of rpcNames) {
    const start = migration.search(new RegExp(`create or replace function public\\.${functionName}\\(`, 'i'))
    assert.notEqual(start, -1, `${functionName} must exist`)
    const nextFunction = migration.indexOf('create or replace function public.', start + 1)
    const definition = migration.slice(start, nextFunction === -1 ? migration.length : nextFunction)
    assert.match(definition, /security definer/i, `${functionName} must be security definer`)
    assert.match(definition, /set search_path = pg_catalog, public(?:, auth)?/i, `${functionName} must fix its search path`)
    assert.match(migration, new RegExp(`revoke all on function public\\.${functionName}\\([^;]*from public, anon`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${functionName}\\([^;]*to authenticated`, 'i'))
  }
})

test('server authority hydration fails closed on removed membership and revoked platform access', async () => {
  const sources = await readSources()

  assert.match(sources.planGate, /loadActiveAuthorityProfile\(supabaseAdmin, authUser/)
  assert.doesNotMatch(sources.planGate, /email\.eq\.|loadMembershipProfile/)
  assert.match(sources.authorityProfile, /\.eq\('auth_user_id', authUserId\)/)
  assert.match(sources.authorityProfile, /\.eq\('role', normalizeText\(profile\.role\)\)/)
  assert.match(sources.authorityProfile, /\.eq\('role_rank', Number\(profile\.role_rank \?\? 0\)\)/)
  assert.match(sources.authorityProfile, /\.from\('platform_admins'\)[\s\S]*\.eq\('id', authUserId\)[\s\S]*\.eq\('status', 'active'\)/)
  assert.match(sources.platformAccess, /access\?\.status === 'active'[\s\S]*userProfile\?\.role === 'super_admin'[\s\S]*userProfile\?\.status === 'active'/)
  assert.doesNotMatch(sources.platformAccess, /platform_admins['"]\)[\s\S]{0,240}?\.upsert\([\s\S]{0,240}?status:\s*'active'/)
  assert.match(sources.platformStaff, /profile\?\.role !== 'super_admin' \|\| profile\?\.status !== 'active' \|\| !platformAccess\?\.id/)
})

test('affected service-role functions revalidate active current authority before privileged work', async () => {
  for (const relativePath of serverAuthorityUrls) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(source, /loadActiveAuthorityProfile/, `${relativePath} must use current authority validation`)
  }
})

test('migration is metadata-only outside function bodies and contains no authority backfill', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const withoutBodies = migration.replace(/as \$\$[\s\S]*?\$\$;/gi, '')

  assert.doesNotMatch(withoutBodies, /\b(?:insert into|update|delete from)\s+public\.(?:users|user_club_memberships|platform_admins)\b/i)
  assert.doesNotMatch(migration, /alter table\s+public\.(?:users|user_club_memberships|platform_admins)\s+drop\s+column/i)
})
