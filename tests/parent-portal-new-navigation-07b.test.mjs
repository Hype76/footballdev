import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  PARENT_PORTAL_ACTIVITY_CATEGORY_KEYS,
  PARENT_PORTAL_ACTIVITY_REGISTRY,
  PARENT_PORTAL_ACTIVITY_SCOPES,
  normalizeParentPortalActivityState,
  toParentPortalActivityMap,
  toParentPortalNewStateMap,
} from '../src/lib/parent-portal-activity.js'

const shellUrl = new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url)
const portalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const pollsPageUrl = new URL('../src/pages/ParentPollsPage.jsx', import.meta.url)
const chatPageUrl = new URL('../src/pages/ParentChatPage.jsx', import.meta.url)
const chatWorkspaceUrl = new URL('../src/components/chat/ParentChatWorkspace.jsx', import.meta.url)
const hookUrl = new URL('../src/hooks/use-parent-portal-navigation-state.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260727170000_parent_portal_navigation_view_state.sql', import.meta.url)

test('activity registry inventories only current dynamic Parent navigation categories', () => {
  assert.deepEqual(PARENT_PORTAL_ACTIVITY_CATEGORY_KEYS, [
    'calendar',
    'invites',
    'matches',
    'results',
    'resources',
    'chat',
    'polls',
  ])
  assert.equal(PARENT_PORTAL_ACTIVITY_REGISTRY.some((category) => category.key === 'settings'), false)
  assert.equal(PARENT_PORTAL_ACTIVITY_REGISTRY.some((category) => category.key === 'overview'), false)
  assert.equal(
    PARENT_PORTAL_ACTIVITY_REGISTRY.find((category) => category.key === 'chat')?.scope,
    PARENT_PORTAL_ACTIVITY_SCOPES.parentGlobal,
  )
  assert.equal(
    PARENT_PORTAL_ACTIVITY_REGISTRY
      .filter((category) => category.key !== 'chat')
      .every((category) => category.scope === PARENT_PORTAL_ACTIVITY_SCOPES.child),
    true,
  )
  PARENT_PORTAL_ACTIVITY_REGISTRY.forEach((category) => {
    assert.ok(category.route)
    assert.ok(category.source)
    assert.ok(category.eligibility)
    assert.ok(category.markViewedAfter.includes('loads successfully'))
  })
})

test('activity state normalises database rows and derives text-only New state', () => {
  const resources = normalizeParentPortalActivityState({
    category_key: 'resources',
    scope_type: 'child',
    parent_link_id: 'link-a',
    player_id: 'player-a',
    latest_activity_at: '2026-07-27T16:00:00.000Z',
    last_viewed_at: '2026-07-27T15:00:00.000Z',
    is_new: true,
  })
  const map = toParentPortalActivityMap([
    resources,
    { category_key: 'settings', is_new: true },
  ])
  const newState = toParentPortalNewStateMap(map)

  assert.equal(map.resources.isNew, true)
  assert.equal(map.settings, undefined)
  assert.equal(newState.resources, true)
  assert.equal(newState.polls, false)
})

test('Parent navigation renders accessible New text without numeric count props', async () => {
  const shell = await readFile(shellUrl, 'utf8')

  assert.match(shell, /newStateByCategory/)
  assert.match(shell, />\s*New\s*</)
  assert.match(shell, /has new activity/)
  assert.match(shell, /aria-label=\{isNew \? `\$\{section\.label\}, New activity`/)
  assert.match(shell, /variant === 'mobile'/)
  assert.match(shell, /min-w-12/)
  assert.doesNotMatch(shell, /\bcounts\s*=/)
  assert.doesNotMatch(shell, /\{count\}/)
})

test('category pages capture authority state before loading and clear only after successful data', async () => {
  const [portalPage, pollsPage, chatPage, chatWorkspace] = await Promise.all([
    readFile(portalPageUrl, 'utf8'),
    readFile(pollsPageUrl, 'utf8'),
    readFile(chatPageUrl, 'utf8'),
    readFile(chatWorkspaceUrl, 'utf8'),
  ])

  assert.match(
    portalPage,
    /activitySnapshot = await captureActivityState\(\)[\s\S]*await Promise\.all\(\[/,
  )
  assert.match(portalPage, /setSuccessfulCategoryLoad[\s\S]*markCategoryViewed/)
  assert.match(portalPage, /successfulCategoryLoad\.linkId !== selectedLink\.id/)
  assert.match(pollsPage, /activitySnapshot = await captureActivityState\(\)[\s\S]*getParentPortalPolls/)
  assert.match(pollsPage, /successfulPollLoad\.linkId !== selectedLink\.id/)
  assert.match(chatWorkspace, /activitySnapshot = await onBeforeCategoryLoad/)
  assert.match(chatWorkspace, /getParentChatRooms\(\)[\s\S]*onCategoryLoadSuccess/)
  assert.match(chatPage, /categoryKey: 'chat'/)
  assert.match(chatPage, /onBeforeCategoryLoad=\{captureActivityState\}/)
})

test('synchronisation hook uses server state, periodic refresh and conservative write handling', async () => {
  const hook = await readFile(hookUrl, 'utf8')

  assert.match(hook, /getParentPortalActivityState/)
  assert.match(hook, /markParentPortalCategoryViewed/)
  assert.match(hook, /DEFAULT_SYNC_INTERVAL_MS = 15000/)
  assert.match(hook, /window\.setInterval/)
  assert.match(hook, /visibilitychange/)
  assert.match(hook, /window\.addEventListener\('focus'/)
  assert.match(hook, /if \(!requestedParentLinkId \|\| !observedState\?\.isNew \|\| !observedState\.latestActivityAt\)/)
  assert.doesNotMatch(hook, /localStorage|sessionStorage/)
})

test('migration provides child isolation, explicit global scope, baseline and cursor-bounded writes', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.parent_portal_view_states/)
  assert.match(migration, /scope_type in \('child', 'parent_global'\)/)
  assert.match(migration, /category_key <> 'chat'/)
  assert.match(migration, /category_key = 'chat'/)
  assert.match(migration, /parent_link\.auth_user_id = auth\.uid\(\)/)
  assert.match(migration, /parent_link\.status = 'active'/)
  assert.match(migration, /coalesce\(player\.status, 'active'\) <> 'archived'/)
  assert.match(migration, /player\.archived_at is null/)
  assert.match(migration, /least\(\s*observed_activity_at_value,\s*authoritative_latest_activity_at/)
  assert.match(migration, /greatest\(view_state\.last_viewed_at, bounded_viewed_at\)/)
  assert.match(migration, /revoke all privileges on table public\.parent_portal_view_states from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.get_parent_portal_activity_state\(uuid\) to authenticated/)
  assert.match(migration, /grant execute on function public\.mark_parent_portal_category_viewed\(uuid, text, timestamptz\) to authenticated/)
})
