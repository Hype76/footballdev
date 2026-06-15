import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  shouldSendMatchdayAvailabilityRequests,
  shouldSendMatchdayPushNotification,
} from '../src/lib/matchday-communication-safety.js'
import { buildMatchDayParentVisibility } from '../src/lib/matchday-parent-visibility.js'

const migrationUrl = new URL('../supabase/migrations/20260613120000_parent_calendar_visibility_controls.sql', import.meta.url)
const grantHardeningMigrationUrl = new URL('../supabase/migrations/20260614031058_harden_parent_portal_rpc_execute_grants.sql', import.meta.url)

async function readMigration() {
  return readFile(migrationUrl, 'utf8')
}

async function readGrantHardeningMigration() {
  return readFile(grantHardeningMigrationUrl, 'utf8')
}

function getFunctionSection(source, functionName) {
  const start = source.indexOf(`create or replace function public.${functionName}`)
  assert.notEqual(start, -1, `${functionName} should exist`)

  const nextFunction = source.indexOf('\ncreate or replace function public.', start + 1)
  const end = nextFunction === -1 ? source.length : nextFunction

  return source.slice(start, end)
}

test('match day migration defaults fail closed for existing and new rows', async () => {
  const migration = await readMigration()

  assert.match(migration, /alter table public\.match_days[\s\S]*parent_visible boolean not null default false/)
  assert.match(migration, /alter table public\.match_days[\s\S]*parent_audience text not null default 'none'/)
})

test('new match days are private unless explicitly shared', () => {
  assert.deepEqual(buildMatchDayParentVisibility({}), {
    parentVisible: false,
    parentAudience: 'none',
  })
})

test('all team parents audience is ignored unless parent visibility is enabled', () => {
  assert.deepEqual(buildMatchDayParentVisibility({
    parentVisible: false,
    parentAudience: 'all_team_parents',
  }), {
    parentVisible: false,
    parentAudience: 'none',
  })
})

test('explicit shared match days keep the requested safe audience', () => {
  assert.deepEqual(buildMatchDayParentVisibility({
    parentVisible: true,
    parentAudience: 'all_team_parents',
  }), {
    parentVisible: true,
    parentAudience: 'all_team_parents',
  })
})

test('parent calendar RPC has a hard parent visible gate for match days', async () => {
  const migration = await readMigration()

  assert.match(migration, /and match_day\.parent_visible is true/)
  assert.match(migration, /and match_day\.parent_audience <> 'none'/)
})

test('parent match day RPC preserves phase clock return shape and live statuses', async () => {
  const migration = await readMigration()
  const rpc = getFunctionSection(migration, 'get_parent_portal_match_days')

  assert.match(rpc, /returns table \([\s\S]*phase_started_at timestamptz[\s\S]*has_interest boolean[\s\S]*is_scorer boolean[\s\S]*events jsonb[\s\S]*\)/)
  assert.match(rpc, /match_day\.phase_started_at/)
  assert.match(rpc, /match_day\.status in \('scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'scheduled'\)/)
})

test('parent match day RPC preserves parent link, scorer, and event gates', async () => {
  const migration = await readMigration()
  const rpc = getFunctionSection(migration, 'get_parent_portal_match_days')

  assert.match(rpc, /from public\.parent_player_links/)
  assert.match(rpc, /auth_user_id = auth\.uid\(\)/)
  assert.match(rpc, /status = 'active'/)
  assert.match(rpc, /from public\.match_day_scorer_interest/)
  assert.match(rpc, /from public\.match_day_scorer_assignments/)
  assert.match(rpc, /from public\.match_day_events event/)
  assert.match(rpc, /event\.match_day_id = match_day\.id/)
})

test('parent match day RPC supports each parent audience and fails closed by relationship', async () => {
  const migration = await readMigration()
  const rpc = getFunctionSection(migration, 'get_parent_portal_match_days')

  assert.match(rpc, /match_day\.parent_audience = 'involved_players'[\s\S]*from public\.match_day_availability_requests request[\s\S]*request\.match_day_id = match_day\.id[\s\S]*request\.club_id = link\.club_id[\s\S]*request\.player_id = link\.player_id[\s\S]*request\.status <> 'expired'/)
  assert.match(rpc, /match_day\.parent_audience = 'all_team_parents'[\s\S]*match_day\.team_id is not null[\s\S]*match_day\.team_id = link\.team_id/)
  assert.match(rpc, /match_day\.parent_audience = 'all_club_parents'[\s\S]*match_day\.club_id = link\.club_id/)
})

test('parent calendar migration does not duplicate Plan B availability objects', async () => {
  const migration = await readMigration()

  assert.doesNotMatch(migration, /create table if not exists public\.match_day_availability_requests/i)
  assert.doesNotMatch(migration, /create or replace function public\.confirm_match_day_availability/i)
})

test('parent calendar migration has limited execute grants and no broad anon grants', async () => {
  const migration = await readMigration()

  assert.match(migration, /security definer\s+set search_path = public/i)
  assert.match(migration, /revoke all on function public\.get_parent_portal_shared_calendar_events\(uuid\) from public;/i)
  assert.match(migration, /revoke all on function public\.get_parent_portal_match_days\(uuid\) from public;/i)
  assert.match(migration, /grant execute on function public\.get_parent_portal_shared_calendar_events\(uuid\) to authenticated;/i)
  assert.match(migration, /grant execute on function public\.get_parent_portal_match_days\(uuid\) to authenticated;/i)
  assert.doesNotMatch(migration, /grant execute on function public\.(get_parent_portal_shared_calendar_events|get_parent_portal_match_days)\(uuid\) to anon;/i)
})

test('grant hardening removes anon execute from parent portal RPCs only', async () => {
  const migration = await readGrantHardeningMigration()

  assert.match(migration, /revoke execute on function public\.get_parent_portal_match_days\(uuid\) from anon;/i)
  assert.match(migration, /revoke execute on function public\.get_parent_portal_shared_calendar_events\(uuid\) from anon;/i)
  assert.match(migration, /grant execute on function public\.get_parent_portal_match_days\(uuid\) to authenticated;/i)
  assert.match(migration, /grant execute on function public\.get_parent_portal_shared_calendar_events\(uuid\) to authenticated;/i)
  assert.match(migration, /grant execute on function public\.get_parent_portal_match_days\(uuid\) to service_role;/i)
  assert.match(migration, /grant execute on function public\.get_parent_portal_shared_calendar_events\(uuid\) to service_role;/i)
  assert.doesNotMatch(migration, /grant execute on function public\.(get_parent_portal_match_days|get_parent_portal_shared_calendar_events)\(uuid\) to anon;/i)
})

test('grant hardening leaves token confirmation RPC public for token flow', async () => {
  const migration = await readGrantHardeningMigration()

  assert.doesNotMatch(migration, /revoke\s+(?:all|execute)\s+on function public\.confirm_match_day_availability\(text,\s*text\) from anon;/i)
  assert.doesNotMatch(migration, /grant execute on function public\.confirm_match_day_availability\(text,\s*text\)/i)
})

test('grant hardening does not alter tables data policies or function bodies', async () => {
  const migration = await readGrantHardeningMigration()

  assert.doesNotMatch(migration, /\balter\s+table\b/i)
  assert.doesNotMatch(migration, /\bcreate\s+(?:or\s+replace\s+)?function\b/i)
  assert.doesNotMatch(migration, /\bdrop\s+function\b/i)
  assert.doesNotMatch(migration, /\bcreate\s+policy\b/i)
  assert.doesNotMatch(migration, /\bdrop\s+policy\b/i)
  assert.doesNotMatch(migration, /\binsert\s+into\b/i)
  assert.doesNotMatch(migration, /\bupdate\s+public\./i)
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i)
  assert.doesNotMatch(migration, /\btruncate\b/i)
})

test('grant hardening does not touch unrelated functions or grant broad anon access', async () => {
  const migration = await readGrantHardeningMigration()
  const functionNames = [...migration.matchAll(/function public\.([a-z0-9_]+)\(/gi)].map((match) => match[1])
  const uniqueFunctionNames = [...new Set(functionNames)]

  assert.deepEqual(uniqueFunctionNames.sort(), [
    'get_parent_portal_match_days',
    'get_parent_portal_shared_calendar_events',
  ])
  assert.doesNotMatch(migration, /\bto anon\b/i)
})

test('parent calendar migration avoids destructive SQL and dynamic SQL', async () => {
  const migration = await readMigration()

  assert.doesNotMatch(migration, /\bdrop\s+table\b/i)
  assert.doesNotMatch(migration, /\bdrop\s+function\b/i)
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i)
  assert.doesNotMatch(migration, /\btruncate\b/i)
  assert.doesNotMatch(migration, /\bexecute\s+format\(/i)
  assert.doesNotMatch(migration, /\bexecute\s+'/i)
})

test('calendar event parent sharing remains private by default', async () => {
  const migration = await readMigration()

  assert.match(migration, /alter table public\.calendar_events[\s\S]*parent_visible boolean not null default false/)
  assert.match(migration, /alter table public\.calendar_events[\s\S]*parent_audience text not null default 'none'/)
})

test('local and test runtimes do not send availability requests', () => {
  assert.equal(shouldSendMatchdayAvailabilityRequests({
    parentVisible: true,
    runtime: {
      env: {
        MODE: 'development',
        PROD: false,
        VITE_ENABLE_LIVE_MATCHDAY_COMMUNICATIONS: 'true',
      },
      location: {
        hostname: 'localhost',
      },
    },
  }), false)
})

test('local and test runtimes do not send match day push notifications', () => {
  assert.equal(shouldSendMatchdayPushNotification({
    parentVisible: true,
    runtime: {
      env: {
        MODE: 'test',
        PROD: false,
        VITE_ENABLE_LIVE_MATCHDAY_COMMUNICATIONS: 'true',
      },
      location: {
        hostname: '127.0.0.1',
      },
    },
  }), false)
})

test('shared match day push sender is guarded before the live function call', async () => {
  const source = await readFile(new URL('../src/lib/push-notifications.js', import.meta.url), 'utf8')

  assert.match(source, /isLiveMatchdayCommunicationAllowed/)
  assert.match(source, /return null[\s\S]*const token = await getAccessToken\(\)[\s\S]*send-match-day-push/)
})

test('live match day communications require explicit production opt in', () => {
  const runtime = {
    env: {
      MODE: 'production',
      PROD: true,
      VITE_ENABLE_LIVE_MATCHDAY_COMMUNICATIONS: 'true',
    },
    location: {
      hostname: 'footballplayer.online',
    },
  }

  assert.equal(shouldSendMatchdayAvailabilityRequests({ parentVisible: true, runtime }), true)
  assert.equal(shouldSendMatchdayPushNotification({ parentVisible: true, runtime }), true)
})
