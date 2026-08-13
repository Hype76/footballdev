import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const [migration, installationApi, parentPush, matchDayPush, matchDayCopy, developmentApi] = await Promise.all([
  readFile(new URL('../supabase/migrations/20260809090000_parent_mobile_push_installations.sql', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/parent-mobile-push-installation.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/send-parent-mobile-push.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/send-match-day-push.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/lib/_match-day-notification-copy.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/parent-development-history.js', import.meta.url), 'utf8'),
])

test('production Parent installation schema is additive, private, and service-owned', () => {
  assert.match(migration, /create table public\.parent_mobile_push_installations/i)
  assert.match(migration, /create table public\.parent_mobile_notification_events/i)
  assert.match(migration, /installation_id uuid primary key/i)
  assert.match(migration, /detail_level text not null default 'minimal'/i)
  assert.match(migration, /check \(detail_level in \('minimal', 'detailed'\)\)/i)
  assert.match(migration, /force row level security/i)
  assert.match(migration, /revoke all on public\.parent_mobile_push_installations from public, anon, authenticated/i)
  assert.match(migration, /grant select, insert, update, delete on public\.parent_mobile_push_installations to service_role/i)
  assert.doesNotMatch(migration, /mobile_test|allowlist|communicationsDisabled|schedulesDisabled/i)
  assert.doesNotMatch(migration, /grant .*parent_mobile_push_installations to authenticated/i)
})

test('production Parent installation API keeps tokens private and enforces current link ownership', () => {
  assert.match(installationApi, /supabaseAdmin\.auth\.getUser\(accessToken\)/)
  assert.match(installationApi, /\.from\('parent_player_links'\)[\s\S]*\.eq\('auth_user_id', authUserId\)[\s\S]*\.eq\('status', 'active'\)/)
  assert.match(installationApi, /existing\.auth_user_id !== authUserId/)
  assert.match(installationApi, /\.eq\('installation_id', installationId\)[\s\S]*\.eq\('auth_user_id', authUserId\)/)
  assert.match(installationApi, /expo_push_token: null[\s\S]*status: 'unbound'/)
  const publicShape = installationApi.slice(
    installationApi.indexOf('function publicInstallation'),
    installationApi.indexOf('async function loadOwnedInstallation'),
  )
  assert.doesNotMatch(publicShape, /expo_push_token|auth_user_id|parent_link_id/)
})

test('native Parent send paths use server-owned audience and privacy-safe preference copy', () => {
  for (const source of [parentPush, matchDayPush]) {
    assert.match(source, /from\('parent_mobile_push_installations'\)/)
    assert.match(source, /\.eq\('status', 'active'\)/)
    assert.match(source, /\.eq\('enabled', true\)/)
    assert.match(source, /device\.detail_level === 'detailed'/)
    assert.match(source, /from\('parent_mobile_notification_events'\)/)
  }
  assert.match(parentPush, /Your club has shared a new announcement\./)
  assert.match(parentPush, /You have a new update in Football Player Parents\./)
  assert.match(parentPush, /A Parent poll is ready to view\./)
  assert.match(matchDayPush, /buildParentMatchDayNotificationCopy/)
  assert.match(matchDayPush, /\.neq\('detail_level', 'off'\)/)
  assert.match(matchDayPush, /route: 'matchday'/)
  assert.match(matchDayCopy, /minimalBody/)
  assert.match(matchDayCopy, /detailedBody/)
  assert.match(matchDayCopy, /Score correction/)
  assert.doesNotMatch(matchDayPush, /Your team has a new Matchday update\./)
})

test('production Development handler reuses the same authority for mobile GET downloads', () => {
  assert.match(developmentApi, /\['GET', 'POST'\]\.includes\(request\.method\)/)
  assert.match(developmentApi, /action: 'download_pdf'/)
  assert.match(developmentApi, /parentLinkId: url\.searchParams\.get\('parentLinkId'\)/)
  assert.match(developmentApi, /reportId: url\.searchParams\.get\('reportId'\)/)
  assert.match(developmentApi, /\.eq\('auth_user_id', authUserId\)/)
})
