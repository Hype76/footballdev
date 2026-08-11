import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { filterCoachMatchDays } from '../apps/mobile-core/src/coachMatchDayCore.js'

test('Match Day filtering rejects corrupt cache rows and accepts legacy cached field names', () => {
  const matches = [
    null,
    { deleted_at: '2026-08-11T10:00:00Z', id: 'deleted', match_date: '2026-08-11', status: 'live' },
    { id: 'legacy-live', match_date: '2026-08-11', kickoff_time: '19:00', presentation_priority: 1, status: 'live' },
  ]
  assert.deepEqual(filterCoachMatchDays(matches, 'current', new Date('2026-08-11T12:00:00Z')).map((match) => match.id), ['legacy-live'])
})

test('Coach Home messages use the existing Player Team relationship instead of a missing column', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  const messages = source.slice(source.indexOf('export async function getCoachMessages'), source.indexOf('export async function getCoachPolls'))
  assert.match(messages, /players!inner\(team_id\)/)
  assert.match(messages, /\.eq\('players\.team_id', user\.activeTeamId\)/)
  assert.doesNotMatch(messages, /\.eq\('team_id', user\.activeTeamId\)/)
})

test('Coach app uses measured bottom insets and the release gate enforces them', async () => {
  const [app, packageJson, prestore] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-prestore-check.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(app, /SafeAreaProvider/)
  assert.match(app, /from 'react-native-safe-area-context'/)
  assert.match(app, /useSafeAreaInsets\(\)/)
  assert.match(app, /edges=\{\['top', 'right', 'left'\]\}/)
  assert.match(app, /getCoachBottomNavigationPadding/)
  assert.match(app, /bottomInset=\{safeAreaInsets\.bottom\}/)
  assert.match(packageJson, /"react-native-safe-area-context": "~5\.6\.0"/)
  assert.match(prestore, /explicit bottom navigation inset/)
})

test('Match Day cached records and display labels fail closed instead of reaching the root boundary', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
  assert.match(source, /normalizeCachedMatches/)
  assert.match(source, /normalizeCoachMatchDay\(saved\.resources\.matchDayDetail\)/)
  assert.match(source, /function label\(value, fallback = ''\)/)
  assert.doesNotMatch(source, /match\.status\.replaceAll/)
  assert.doesNotMatch(source, /match\.conclusionRule\.replaceAll/)
})

test('Parent Chat restore reopens only the authenticated room-list function', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260811101500_parent_chat_authenticated_execute_restore_40.sql', import.meta.url), 'utf8')
  assert.match(migration, /to_regprocedure\('public\.get_parent_chat_rooms\(\)'\)/)
  assert.match(migration, /revoke execute on function public\.get_parent_chat_rooms\(\) from anon/i)
  assert.match(migration, /grant execute on function public\.get_parent_chat_rooms\(\) to authenticated, service_role/i)
  assert.doesNotMatch(migration, /create or replace function|drop function/i)
  assert.doesNotMatch(migration, /grant execute on function[^;]+ to public/i)
})

test('the corrective reference authorises only the existing guarded Coach production profiles', async () => {
  const [buildGuard, submitGuard] = await Promise.all([
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]+FP-MOBILE-COACH-DEVICE-CORRECTIVE-40/)
  assert.match(buildGuard, /'internal-live:android'/)
  assert.match(buildGuard, /'store-live:ios'/)
  assert.match(submitGuard, /platform === 'ios' && appRole === 'coach'[\s\S]+FP-MOBILE-COACH-DEVICE-CORRECTIVE-40/)
})
