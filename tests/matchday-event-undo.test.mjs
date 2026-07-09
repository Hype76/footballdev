import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const staffPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const confirmModalUrl = new URL('../src/components/ui/ConfirmModal.jsx', import.meta.url)
const goalCorrectionMigrationUrl = new URL('../supabase/migrations/20260708064812_matchday_goal_correction_rpc.sql', import.meta.url)

test('latest Match Day goal exposes a styled undo confirmation with exact event details', async () => {
  const source = await readFile(staffPageUrl, 'utf8')
  const handlerStart = source.indexOf('const handleVoidGoal =')
  const handlerEnd = source.indexOf('const handleScoreSave =', handlerStart)
  const handlerSource = source.slice(handlerStart, handlerEnd)
  const timelineStart = source.indexOf('function MatchTimelinePanel')
  const timelineEnd = source.indexOf('function MatchDayReadinessPanel', timelineStart)
  const timelineSource = source.slice(timelineStart, timelineEnd)

  assert.match(timelineSource, /visibleTimelineEvents\.map\(\(event, eventIndex\) =>/)
  assert.match(timelineSource, /const isLatestEvent = eventIndex === 0/)
  assert.match(timelineSource, /\{isLatestEvent \? 'Correct' : 'Edit'\}/)
  assert.match(timelineSource, /\{isLatestEvent \? 'Undo last event' : 'Remove'\}/)
  assert.match(handlerSource, /title: isLatestEvent \? 'Undo last event' : 'Remove goal from score'/)
  assert.match(handlerSource, /Are you sure you want to undo this event\?/)
  assert.match(handlerSource, /itemsTitle: isLatestEvent \? 'This will remove' : 'Goal removal'/)
  assert.match(handlerSource, /`Event: \$\{getMatchEventTypeLabel\(goalEvent, match\)\}`/)
  assert.match(handlerSource, /`Player: \$\{playerLabel\}`/)
  assert.match(handlerSource, /`Minute: \$\{minuteLabel\}`/)
  assert.doesNotMatch(handlerSource, /window\.confirm|confirm\(|alert\(|prompt\(/)
})

test('undo stays goal-only and preserves audited score recalculation without deleting event history', async () => {
  const [source, migration] = await Promise.all([
    readFile(staffPageUrl, 'utf8'),
    readFile(goalCorrectionMigrationUrl, 'utf8'),
  ])
  const timelineStart = source.indexOf('function MatchTimelinePanel')
  const timelineEnd = source.indexOf('function MatchDayReadinessPanel', timelineStart)
  const timelineSource = source.slice(timelineStart, timelineEnd)
  const voidRpcStart = migration.indexOf('create or replace function public.void_match_day_goal')
  const voidRpcEnd = migration.indexOf('revoke all on function public.correct_match_day_goal', voidRpcStart)
  const voidRpc = migration.slice(voidRpcStart, voidRpcEnd)

  assert.match(timelineSource, /event\.eventType === 'goal' && event\.eventStatus !== 'voided'/)
  assert.doesNotMatch(timelineSource, /yellow_card['"]\s*\|\||red_card['"]\s*\|\||substitution['"]\s*\|\||water_break['"]\s*\|\|/)
  assert.match(voidRpc, /if event_row\.event_type <> 'goal' then/)
  assert.match(voidRpc, /next_home_score := next_home_score - 1/)
  assert.match(voidRpc, /next_away_score := next_away_score - 1/)
  assert.match(voidRpc, /if next_home_score < 0 or next_away_score < 0 then/)
  assert.match(voidRpc, /event_status = 'voided'/)
  assert.match(voidRpc, /correction_metadata = jsonb_build_object/)
  assert.match(voidRpc, /insert into public\.match_day_event_log/)
  assert.doesNotMatch(voidRpc, /delete from public\.match_day_events/)
})

test('latest-event ordering, substitution structure, minute guard, and mobile Game Mode remain intact', async () => {
  const source = await readFile(staffPageUrl, 'utf8')
  const orderingStart = source.indexOf('function getOrderedMatchTimelineEvents')
  const orderingEnd = source.indexOf('function MatchTimelinePanel', orderingStart)
  const orderingSource = source.slice(orderingStart, orderingEnd)
  const substitutionStart = source.indexOf("if (event.eventType === 'substitution')")
  const substitutionEnd = source.indexOf('const items = [', substitutionStart)
  const substitutionSource = source.slice(substitutionStart, substitutionEnd)
  const gameModeStart = source.indexOf('function MatchDayGameModePanel')
  const gameModeEnd = source.indexOf('function GoalCorrectionModal', gameModeStart)
  const gameModeSource = source.slice(gameModeStart, gameModeEnd)

  assert.ok(
    orderingSource.indexOf('getMatchEventSortTime(right) - getMatchEventSortTime(left)')
      < orderingSource.indexOf('getMatchEventSortMinute(right) - getMatchEventSortMinute(left)'),
  )
  assert.match(substitutionSource, /label: 'Player Off'/)
  assert.match(substitutionSource, /label: 'Player On'/)
  assert.match(source, /MATCH_DAY_EVENT_MINUTE_VALIDATION_MESSAGE/)
  assert.match(source, /Minute must be between 0 and 130\./)
  assert.match(gameModeSource, /<MatchTimelinePanel events=\{events\} match=\{match\} isReadOnly \/>/)
  assert.match(gameModeSource, /aria-label="Game Mode cockpit"/)
})

test('undo confirmation uses the responsive app modal and destructive styling', async () => {
  const source = await readFile(confirmModalUrl, 'utf8')

  assert.match(source, /role="dialog"/)
  assert.match(source, /aria-modal="true"/)
  assert.match(source, /max-h-\[calc\(100dvh-2rem\)\]/)
  assert.match(source, /overflow-y-auto/)
  assert.match(source, /flex flex-col gap-3 sm:flex-row sm:justify-end/)
  assert.match(source, /delete\|remove\|suspend\|revoke\|undo/i)
})
