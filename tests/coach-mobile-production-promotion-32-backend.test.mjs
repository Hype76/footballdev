import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const [migration, installationApi, coachPush] = await Promise.all([
  readFile(
    new URL('../supabase/migrations/20260809183000_coach_mobile_push_installations.sql', import.meta.url),
    'utf8',
  ),
  readFile(new URL('../netlify/functions/coach-mobile-push-installation.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/send-coach-mobile-push.js', import.meta.url), 'utf8'),
])

test('production Coach installation schema is additive, private, and service-owned', () => {
  assert.match(migration, /create table public\.coach_mobile_push_installations/i)
  assert.match(migration, /create table public\.coach_mobile_notification_events/i)
  assert.match(migration, /installation_id uuid primary key/i)
  assert.match(migration, /app_role text not null default 'coach'/i)
  assert.match(migration, /check \(detail_level in \('off', 'minimal', 'detailed'\)\)/i)
  assert.match(migration, /force row level security/i)
  assert.match(migration, /revoke all on public\.coach_mobile_push_installations from public, anon, authenticated/i)
  assert.match(
    migration,
    /grant select, insert, update, delete on public\.coach_mobile_push_installations to service_role/i,
  )
  assert.doesNotMatch(migration, /mobile_test|allowlist|communicationsDisabled|schedulesDisabled/i)
  assert.doesNotMatch(migration, /grant .*coach_mobile_push_installations to authenticated/i)
})

test('production Coach installation API keeps tokens private and revalidates canonical staff context', () => {
  assert.match(installationApi, /export default async function handler\(request\)/)
  assert.match(installationApi, /path: '\/api\/mobile\/coach-push-installation'/)
  assert.doesNotMatch(installationApi, /httpMethod/)
  assert.match(installationApi, /supabaseAdmin\.auth\.getUser\(accessToken\)/)
  assert.match(installationApi, /loadActiveAuthorityProfile\(supabaseAdmin, authUser/)
  assert.match(installationApi, /role === 'parent_portal' \|\| role === 'super_admin' \|\| roleRank < 20/)
  assert.match(
    installationApi,
    /from\('team_staff'\)[\s\S]*\.eq\('team_id', team\.id\)[\s\S]*\.eq\('user_id', profile\.id\)/,
  )
  assert.match(installationApi, /profile\.role !== 'admin'/)
  assert.match(installationApi, /existing\.auth_user_id !== authUser\.id/)
  assert.match(installationApi, /\.eq\('installation_id', installationId\)[\s\S]*\.eq\('auth_user_id', authUserId\)/)
  assert.match(installationApi, /expo_push_token: null[\s\S]*status: 'unbound'/)
  const publicShape = installationApi.slice(
    installationApi.indexOf('function publicInstallation'),
    installationApi.indexOf('async function loadOwnedInstallation'),
  )
  assert.doesNotMatch(publicShape, /expo_push_token|auth_user_id|user_profile_id/)
})

test('Coach send path uses current server-owned audience and privacy-safe preference copy', () => {
  const actorAuthority = coachPush.slice(
    coachPush.indexOf('async function canNotifyCoaches'),
    coachPush.indexOf('function getTeamName'),
  )
  assert.match(actorAuthority, /from\('team_staff'\)[\s\S]*\.eq\('team_id', match\.team_id\)[\s\S]*\.eq\('user_id', profile\.id\)/)
  assert.match(actorAuthority, /profile\.role === 'admin' && profile\.roleRank >= 90/)
  assert.match(coachPush, /from\('coach_mobile_push_installations'\)/)
  assert.match(coachPush, /\.eq\('status', 'active'\)/)
  assert.match(coachPush, /\.eq\('enabled', true\)/)
  assert.match(coachPush, /loadActiveAuthorityProfile\([\s\S]*?supabaseAdmin,[\s\S]*?\{ id: device\.auth_user_id \}/)
  assert.match(coachPush, /from\('team_staff'\)[\s\S]*\.eq\('user_id', profile\.id\)/)
  assert.match(coachPush, /detailLevel === 'detailed'/)
  assert.match(coachPush, /from\('coach_mobile_notification_events'\)/)
  assert.match(coachPush, /A scorer volunteer is ready to review\./)
  assert.match(coachPush, /You have a new Coach update\./)
  assert.doesNotMatch(coachPush, /profile\.email.*volunteered/)
  assert.doesNotMatch(coachPush, /from\('mobile_push_devices'\)|from\('notification_events'\)/)
})
