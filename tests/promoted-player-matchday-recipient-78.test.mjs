import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260823135328_promoted_player_matchday_recipient_fix_78.sql', import.meta.url)
const sendFunctionUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)

test('event invitation recipients include promoted Squad players with active membership', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /membership\.status = 'active'/i)
  assert.match(migration, /membership\.ended_at is null/i)
  assert.match(migration, /coalesce\(player\.status, 'active'\) <> 'archived'/i)
  assert.doesNotMatch(migration, /coalesce\(player\.status, 'active'\) = 'active'/i)
  assert.match(migration, /player\.archived_at is null/i)
})

test('Match Day invitation preparation loads promoted nonarchived Players', async () => {
  const source = await readFile(sendFunctionUrl, 'utf8')

  assert.match(source, /\.from\('player_team_memberships'\)[\s\S]*?\.eq\('status', 'active'\)[\s\S]*?\.is\('ended_at', null\)/)
  assert.match(source, /\.from\('players'\)[\s\S]*?\.neq\('status', 'archived'\)[\s\S]*?\.is\('archived_at', null\)/)
  assert.doesNotMatch(source, /\.from\('players'\)[\s\S]{0,500}?\.eq\('status', 'active'\)[\s\S]{0,500}?\.in\('id', authorisedPlayerIds\)/)
})
