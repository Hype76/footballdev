import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const [matchDayPage, matchDayPush, migration, parentPush, scheduledProcessor] = await Promise.all([
  readFile(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/send-match-day-push.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260812103411_matchday_parent_notification_repair.sql', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/send-parent-mobile-push.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url), 'utf8'),
])

test('accepted availability email queues one exact focused Parent response notification', () => {
  assert.match(scheduledProcessor, /matchDayAvailability\?\.requestId/)
  assert.match(scheduledProcessor, /matchDayAvailability\?\.parentLinkId/)
  assert.match(scheduledProcessor, /type: 'matchday_availability'/)
  assert.match(parentPush, /from\('match_day_availability_requests'\)/)
  assert.match(parentPush, /parentLinkQuery: \(query\) => query\.eq\('id', request\.parent_link_id\)/)
  assert.match(parentPush, /availabilityRequestId: request\.id/)
  assert.match(parentPush, /invitationId: `match:\$\{request\.id\}`/)
  assert.match(parentPush, /route: 'invites'/)
  assert.match(parentPush, /categoryId: 'parent-response'/)
  assert.match(parentPush, /type: 'matchday_update'/)
})

test('saved cards and substitutions use server-authoritative Parent push scope', () => {
  assert.match(matchDayPage, /\['yellow_card', 'red_card', 'substitution'\]\.includes\(savedEvent\.eventType \|\| savedEvent\.event_type\)/)
  assert.match(matchDayPage, /eventId: savedEvent\.id/)
  assert.match(matchDayPush, /\['yellow_card', 'red_card', 'substitution'\]\.includes\(type\)[\s\S]*rpc\('authorize_match_day_push_v2'/)
  assert.match(migration, /normalized_type not in \('yellow_card', 'red_card'\)/i)
  assert.match(migration, /from public\.match_day_events[\s\S]*event_type = normalized_type[\s\S]*event_status, 'active'/i)
  assert.match(migration, /from public\.team_staff staff_scope/i)
  assert.match(migration, /grant execute on function public\.authorize_match_day_push_v2[\s\S]*to service_role/i)
  assert.doesNotMatch(migration, /grant execute on function public\.authorize_match_day_push_v2[\s\S]*to authenticated/i)
})
