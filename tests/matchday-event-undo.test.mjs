import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getMatchDayUndoReasonOptions,
  isMatchDayEventUndoSupported,
  validateMatchDayEventUndoInput,
} from '../src/lib/matchday-event-undo.js'

const staffPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const parentPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260710050137_matchday_universal_event_undo_second_half_floor.sql', import.meta.url)

test('universal undo policy supports football events and blocks voided or lifecycle events', () => {
  for (const eventType of ['goal', 'yellow_card', 'red_card', 'substitution', 'water_break']) {
    assert.equal(isMatchDayEventUndoSupported({ eventType, eventStatus: 'active' }), true)
    assert.equal(isMatchDayEventUndoSupported({ eventType, eventStatus: 'corrected' }), true)
    assert.equal(isMatchDayEventUndoSupported({ eventType, eventStatus: 'voided' }), false)
    assert.ok(getMatchDayUndoReasonOptions(eventType).length >= 5)
  }

  for (const eventType of ['status_change', 'score_correction', 'note', 'match_started', 'half_time', 'full_time']) {
    assert.equal(isMatchDayEventUndoSupported({ eventType, eventStatus: 'active' }), false)
    assert.deepEqual(getMatchDayUndoReasonOptions(eventType), [])
  }
})

test('mandatory reason policy validates event-specific options and Other note', () => {
  assert.throws(
    () => validateMatchDayEventUndoInput({ eventType: 'goal', reasonCode: '' }),
    /Choose a reason for undo/,
  )
  assert.throws(
    () => validateMatchDayEventUndoInput({ eventType: 'goal', reasonCode: 'wrong_card_type' }),
    /Choose a reason for undo/,
  )
  assert.throws(
    () => validateMatchDayEventUndoInput({ eventType: 'substitution', reasonCode: 'other' }),
    /Add a short note/,
  )

  assert.deepEqual(
    validateMatchDayEventUndoInput({ eventType: 'goal', reasonCode: 'goal_disallowed' }),
    {
      eventType: 'goal',
      note: '',
      reasonCode: 'goal_disallowed',
      reasonLabel: 'Goal disallowed',
    },
  )
  assert.equal(
    validateMatchDayEventUndoInput({ eventType: 'water_break', reasonCode: 'other', note: 'Break logged before it happened' }).note,
    'Break logged before it happened',
  )
})

test('staff Manage Fixture and Game Mode expose the same permission-aware Undo event control', async () => {
  const source = await readFile(staffPageUrl, 'utf8')
  const timelineSource = source.slice(source.indexOf('function MatchTimelinePanel'))
  const gameModeSource = source.slice(
    source.indexOf('function MatchDayGameModePanel'),
    source.indexOf('function UndoEventModal'),
  )

  assert.match(timelineSource, /const canUndoEvent = !isReadOnly && isMatchDayEventUndoSupported\(event\)/)
  assert.match(timelineSource, /onClick=\{\(\) => onUndoEvent\(match, event\)\}/)
  assert.match(timelineSource, />\s*Undo event\s*</)
  assert.match(timelineSource, /event\.eventStatus === 'voided'[\s\S]*\? 'Voided'/)
  assert.match(timelineSource, /const isLatestEvent = eventIndex === 0/)
  assert.match(timelineSource, /Show all/)
  assert.match(timelineSource, /Show less/)
  assert.match(gameModeSource, /onUndoEvent/)
  assert.match(gameModeSource, /<MatchTimelinePanel[\s\S]*onUndoEvent=\{onUndoEvent\}/)
  assert.doesNotMatch(gameModeSource, /<MatchTimelinePanel[^>]*isReadOnly/)
  assert.match(source, /<MatchTimelinePanel[\s\S]*onCorrectGoal=\{onCorrectGoal\}[\s\S]*onUndoEvent=\{onUndoEvent\}/)
})

test('Undo event modal is mobile-safe and requires a preset reason before voiding', async () => {
  const source = await readFile(staffPageUrl, 'utf8')
  const modalSource = source.slice(
    source.indexOf('function UndoEventModal'),
    source.indexOf('function GoalCorrectionModal'),
  )

  assert.match(modalSource, /aria-labelledby="undo-event-title"/)
  assert.match(modalSource, />Undo event</)
  assert.match(modalSource, /Event type/)
  assert.match(modalSource, /Player or team/)
  assert.match(modalSource, /Minute/)
  assert.match(modalSource, /Score impact/)
  assert.match(modalSource, /Reason for undo/)
  assert.match(modalSource, /getMatchDayUndoReasonOptions\(event\)/)
  assert.match(modalSource, /required=\{isOtherReason\}/)
  assert.match(modalSource, /MATCH_DAY_UNDO_NOTE_MAX_LENGTH/)
  assert.match(modalSource, /disabled=\{isBusy \|\| !canConfirm\}/)
  assert.match(modalSource, />\s*\{isBusy \? 'Voiding\.\.\.' : 'Void event'\}\s*</)
  assert.match(modalSource, /100dvh|--fixture-modal-viewport-height/)
  assert.match(modalSource, /grid gap-2 sm:grid-cols-\[auto_auto\]/)
  assert.doesNotMatch(modalSource, />\s*(Delete|Remove|Erase|Clear)\s*</i)
})

test('universal void RPC is staff-only, validates reasons, preserves rows, and blocks repeat voids', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const rpc = migration.slice(
    migration.indexOf('create or replace function public.void_match_day_event'),
    migration.indexOf('revoke all on function public.void_match_day_event'),
  )

  assert.match(rpc, /security definer[\s\S]*set search_path = ''/i)
  assert.match(rpc, /auth\.uid\(\)/)
  assert.match(rpc, /public\.can_manage_match_day\(match_row\.team_id\)/)
  assert.match(rpc, /match_row\.club_id <> public\.current_user_club_id\(\)/)
  assert.match(rpc, /id = event_id_value[\s\S]*match_day_id = match_row\.id[\s\S]*club_id = match_row\.club_id/)
  assert.match(rpc, /event_row\.event_type not in \('goal', 'yellow_card', 'red_card', 'substitution', 'water_break'\)/)
  assert.match(rpc, /event_row\.event_status = 'voided'/)
  assert.match(rpc, /normalized_reason_code = 'other' and normalized_note = ''/)
  assert.match(rpc, /char_length\(normalized_note\) > 240/)
  assert.match(rpc, /event_status = 'voided'/)
  assert.match(rpc, /correction_reason = reason_label/)
  assert.match(rpc, /'undoNote', normalized_note/)
  assert.match(rpc, /insert into public\.match_day_event_log/)
  assert.doesNotMatch(rpc, /delete from public\.match_day_events/i)
  assert.match(migration, /revoke execute on function public\.void_match_day_event\(uuid, uuid, text, text\) from anon;/)
  assert.match(migration, /grant execute on function public\.void_match_day_event\(uuid, uuid, text, text\) to authenticated;/)
  assert.match(migration, /Parent views are read-only for event undo\./)
})

test('goal void recalculates authoritative score and timeline snapshots while non-score void keeps score unchanged', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const rpc = migration.slice(
    migration.indexOf('create or replace function public.void_match_day_event'),
    migration.indexOf('revoke all on function public.void_match_day_event'),
  )

  assert.match(rpc, /if event_row\.event_type = 'goal' then[\s\S]*next_home_score := 0;[\s\S]*next_away_score := 0;/)
  assert.match(rpc, /order by created_at asc, id asc[\s\S]*for update/)
  assert.match(rpc, /timeline_event\.event_type = 'goal' and coalesce\(timeline_event\.event_status, 'active'\) <> 'voided'/)
  assert.match(rpc, /update public\.match_day_events[\s\S]*home_score = greatest\(next_home_score, 0\)[\s\S]*away_score = greatest\(next_away_score, 0\)/)
  assert.match(rpc, /update public\.match_days[\s\S]*home_score = greatest\(next_home_score, 0\)[\s\S]*away_score = greatest\(next_away_score, 0\)/)
  assert.match(rpc, /else[\s\S]*next_home_score := greatest\(coalesce\(match_row\.home_score, 0\), 0\);[\s\S]*next_away_score := greatest\(coalesce\(match_row\.away_score, 0\), 0\);/)
  assert.match(rpc, /'events', updated_events/)
})

test('parent timeline stays undo-read-only and hides internal undo metadata', async () => {
  const [parentSource, domain] = await Promise.all([
    readFile(parentPageUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])

  assert.match(parentSource, /event\.eventStatus === 'voided'[\s\S]*`Reason: \$\{event\.correctionReason \|\| 'Event voided'\}`/)
  assert.doesNotMatch(parentSource, /voidMatchDayGoalAsScorer|onVoidGoal|handleVoidGoal|Undo event/)
  assert.doesNotMatch(parentSource, />\s*(Delete|Remove|Erase|Clear)\s*</i)
  assert.match(domain, /delete parentEvent\.correctionMetadata/)
  assert.match(domain, /delete parentEvent\.voidedByName/)
})
