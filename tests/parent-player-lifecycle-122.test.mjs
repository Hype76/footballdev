import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const addPlayerPageUrl = new URL('../src/pages/AddPlayerPage.jsx', import.meta.url)
const onboardingUrl = new URL('../src/components/onboarding/OnboardingProvider.jsx', import.meta.url)
const playerDetailsUrl = new URL('../src/components/players/PlayerDetailsSection.jsx', import.meta.url)
const playerLifecycleUrl = new URL('../src/lib/domain/player-event-lifecycle.js', import.meta.url)
const playerProfileUrl = new URL('../src/pages/PlayerProfile.jsx', import.meta.url)
const coreUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260828123000_parent_trial_access_and_safe_player_archive.sql', import.meta.url)

test('every player creation and Trial promotion exposes explicit Parent access and future-event choices', async () => {
  const [addPlayerPage, onboarding, profile, lifecycle] = await Promise.all([
    readFile(addPlayerPageUrl, 'utf8'),
    readFile(onboardingUrl, 'utf8'),
    readFile(playerProfileUrl, 'utf8'),
    readFile(playerLifecycleUrl, 'utf8'),
  ])

  for (const source of [addPlayerPage, onboarding, profile]) {
    assert.match(source, /Send Parent app invite/)
    assert.match(source, /Add to all future team events/)
    assert.match(source, /Send event invitations now/)
  }

  assert.match(lifecycle, /previewEventPlayerChanges/)
  assert.match(lifecycle, /preview\.currentPlayerIds\.includes\(playerId\)/)
  assert.match(lifecycle, /EVENT_PLAYER_COMMUNICATION_MODES\.notifyAdded/)
  assert.match(lifecycle, /EVENT_PLAYER_COMMUNICATION_MODES\.none/)
  assert.match(lifecycle, /requestToken:\s*createRequestToken\(\)/)
})

test('profile reset and archive actions use the secure server boundaries', async () => {
  const [details, profile, core, migration] = await Promise.all([
    readFile(playerDetailsUrl, 'utf8'),
    readFile(playerProfileUrl, 'utf8'),
    readFile(coreUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])

  assert.match(details, /Send password reset/)
  assert.match(profile, /sendParentPasswordReset\(resetTarget\.id\)/)
  assert.match(profile, /The current password stays unchanged unless the Parent opens the link/)
  assert.match(core, /supabase\.rpc\('archive_player_with_future_events'/)
  assert.doesNotMatch(core.slice(
    core.indexOf('export async function archivePlayer'),
    core.indexOf('export async function previewPlayerTeamRemoval'),
  ), /\.from\('players'\)[\s\S]*\.update\(/)
  assert.match(migration, /affectedOccurrenceCount/)
  assert.match(migration, /playerRecordPreserved', true/)
  assert.match(migration, /historyPreserved', true/)
  assert.match(migration, /pastEventsPreserved', true/)
  assert.match(migration, /update public\.player_team_memberships/)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.players/i)
})

test('Trial Parent access is accepted only for active Trial or Squad records', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /lower\(btrim\(coalesce\(player\.section, ''\)\)\) in \('trial', 'squad'\)/)
  assert.match(migration, /lower\(btrim\(coalesce\(player\.status, 'active'\)\)\) <> 'archived'/)
  assert.match(migration, /player\.archived_at is null/)
  assert.match(migration, /set search_path = ''/)
  assert.match(migration, /revoke all on function public\.accept_parent_player_link\(uuid\) from public, anon/)
})

test('promote and move-to-Trial retain one saved player identity and history route', async () => {
  const [core, profile] = await Promise.all([
    readFile(coreUrl, 'utf8'),
    readFile(playerProfileUrl, 'utf8'),
  ])
  const moveStart = core.indexOf('export async function movePlayerToTrial')
  const moveEnd = core.indexOf('export async function deletePlayerRecord', moveStart)
  const moveSource = core.slice(moveStart, moveEnd)

  assert.doesNotMatch(moveSource, /promoted_at:\s*null/)
  assert.doesNotMatch(moveSource, /promoted_by:\s*null/)
  assert.match(profile, /navigate\(buildPlayerProfilePath\(promotedPlayer\), \{ replace: true \}\)/)
  assert.match(profile, /navigate\(buildPlayerProfilePath\(movedPlayer\), \{ replace: true \}\)/)
})
