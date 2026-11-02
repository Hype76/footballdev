import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migration = await readFile(new URL('../supabase/migrations/20261102083200_event_cancellation_reasons.sql', import.meta.url), 'utf8')
const web = await readFile(new URL('../src/lib/domain/match-day.js', import.meta.url), 'utf8')
const mobile = await readFile(new URL('../apps/mobile-core/src/coachMatchDayData.js', import.meta.url), 'utf8')

test('cancellation reason is optional and is passed through both coach clients', () => {
  assert.match(migration, /cancellation_reason text not null default ''/)
  assert.match(migration, /cancellation_reason = left\(trim\(coalesce\(p_reason, ''\)\), 1000\)/)
  assert.match(web, /payload\.cancellation_reason = payload\.status === 'cancelled'/)
  assert.match(mobile, /p_reason: normalize\(cancellationReason\)/)
})

test('cancelled fixtures use the active authenticated parent relationship and audience gates', () => {
  assert.match(migration, /link\.auth_user_id = \(select auth\.uid\(\)\) and link\.status = 'active'/)
  assert.match(migration, /fixture\.status = 'cancelled' and fixture\.deleted_at is null/)
  assert.match(migration, /fixture\.parent_visible is true and fixture\.parent_audience <> 'none'/)
  assert.match(migration, /fixture\.team_id = link\.team_id/)
  assert.match(migration, /invite\.player_id = link\.player_id/)
  assert.match(migration, /revoke all on function public\.get_parent_cancelled_match_days\(uuid\) from public, anon/)
})
