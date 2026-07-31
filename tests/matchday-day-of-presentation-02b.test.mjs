import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { sortMatchDayPresentation } from '../src/lib/matchday-presentation.js'

const migrationUrl = new URL('../supabase/migrations/20260731131726_fp_v1_gameday_day_of_presentation_02b.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const parentPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const staffPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const sharedModalUrl = new URL('../src/components/match-day/StartMatchConfirmModal.jsx', import.meta.url)
const confirmModalUrl = new URL('../src/components/ui/ConfirmModal.jsx', import.meta.url)
const scheduledProcessorUrl = new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url)

test('02B presentation uses server-derived today state and required ordering', async () => {
  const [migration, domain, parentPage, staffPage] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
    readFile(parentPageUrl, 'utf8'),
    readFile(staffPageUrl, 'utf8'),
  ])

  assert.match(migration, /create or replace function public\.get_match_day_presentation_states/)
  assert.match(migration, /get_match_day_presentation_states[\s\S]*current_user_has_active_authority\(\)[\s\S]*current_user_role\(\) = 'parent_portal'/)
  assert.match(migration, /fixture\.match_date = timezone\([\s\S]*statement_timestamp\(\)[\s\S]*\)::date as is_today/)
  assert.match(migration, /when fixture\.status in \('live', 'half_time', 'second_half', 'extra_time', 'penalties'\) then 0/)
  assert.match(migration, /when fixture\.status in \('scheduled', 'scorer_request'\)[\s\S]*then 1/)
  assert.match(migration, /fixture\.status = 'full_time' or fixture\.concluded_at is not null then 3/)
  assert.match(domain, /attachMatchDayPresentationStates/)
  assert.match(domain, /export \{ sortMatchDayPresentation \}/)
  assert.match(parentPage, /data-testid="parent-match-day-hero"/)
  assert.match(parentPage, /You are today&apos;s scorer/)
  assert.match(parentPage, /Fixture information only/)
  assert.match(staffPage, /data-testid="staff-match-day-hero-heading"/)
  assert.match(staffPage, /todayMatches\[0\]/)
})

test('02B sorts multiple today fixtures live, upcoming, later, then completed', () => {
  const ordered = sortMatchDayPresentation([
    { id: 'completed', presentationPriority: 3, scheduledKickoffAt: '2026-07-31T10:00:00Z' },
    { id: 'later', presentationPriority: 1, scheduledKickoffAt: '2026-07-31T18:00:00Z' },
    { id: 'live', presentationPriority: 0, scheduledKickoffAt: '2026-07-31T12:00:00Z' },
    { id: 'next', presentationPriority: 1, scheduledKickoffAt: '2026-07-31T14:00:00Z' },
  ])

  assert.deepEqual(ordered.map((match) => match.id), ['live', 'next', 'later', 'completed'])
})

test('02B uses one shared safe Start Match confirmation on staff and scorer routes', async () => {
  const [migration, domain, parentPage, staffPage, sharedModal, confirmModal] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
    readFile(parentPageUrl, 'utf8'),
    readFile(staffPageUrl, 'utf8'),
    readFile(sharedModalUrl, 'utf8'),
    readFile(confirmModalUrl, 'utf8'),
  ])

  assert.match(sharedModal, /title="Start this match\?"/)
  assert.match(sharedModal, /Starting the match will begin the game timer/)
  assert.match(sharedModal, /Scheduled kick-off:/)
  assert.match(sharedModal, /Match duration:/)
  assert.match(sharedModal, /Scorer:/)
  assert.match(sharedModal, /before the scheduled kick-off time/)
  assert.match(parentPage, /<StartMatchConfirmModal/)
  assert.match(staffPage, /<StartMatchConfirmModal/)
  assert.match(domain, /export async function startParentScorerMatchDay[\s\S]*supabase\.rpc\('start_match_day'/)
  assert.match(staffPage, /saveTimerAction: startMatchDay/)
  assert.match(confirmModal, /cancelButtonRef\.current\?\.focus\(\)/)
  assert.match(confirmModal, /event\.key === 'Escape'/)
  assert.match(confirmModal, /event\.target === event\.currentTarget/)
  assert.match(confirmModal, /isBusy \|\| isSubmitting \|\| submittingRef\.current \|\| confirmDisabled/)
  assert.match(confirmModal, /submittingRef\.current/)

  const startFunctionStart = migration.indexOf('create or replace function public.start_match_day')
  const startFunctionEnd = migration.indexOf('revoke all on function public.start_match_day', startFunctionStart)
  const startFunction = migration.slice(startFunctionStart, startFunctionEnd)
  assert.match(startFunction, /public\.can_manage_match_day/)
  assert.match(startFunction, /public\.current_user_is_match_day_scorer/)
  assert.match(startFunction, /public\.match_day_local_date_is_today/)
  assert.match(startFunction, /alreadyStarted', true/)
  assert.match(startFunction, /status in \('full_time', 'cancelled', 'postponed'\)/)
  assert.match(startFunction, /public\.set_match_day_timer_state\(match_row\.id, 'start'\)/)
})

test('02B reminder is prospective, durable, local-time scheduled, and replacement safe', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.match_day_scorer_reminder_operations/)
  assert.match(migration, /create unique index if not exists match_day_scorer_reminder_operations_key_key/)
  assert.match(migration, /'match_day_scorer_0600'/)
  assert.match(migration, /match_row\.match_date \+ time '06:00'/)
  assert.match(migration, /at time zone timezone_value/)
  assert.match(migration, /if match_row\.match_date = local_today and reminder_at <= statement_timestamp\(\)/)
  assert.match(migration, /perform public\.cancel_match_day_scorer_reminders\(match_row\.id, 'scorer_or_fixture_changed'\)/)
  assert.match(migration, /after insert or update of parent_link_id, auth_user_id, updated_at/)
  assert.match(migration, /fixture\.status not in \('cancelled', 'postponed', 'full_time'\)/)
  assert.match(migration, /exception when others then[\s\S]*return jsonb_build_object\('scheduled', false, 'reason', 'queue_failure'\)/)
  const preFunctionDdl = migration.slice(0, migration.indexOf('create or replace function'))
  assert.doesNotMatch(preFunctionDdl, /insert into public\.match_day_scorer_reminder_operations/i)
})

test('02B reminder processor revalidates current authority immediately before delivery', async () => {
  const [migration, processor] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(scheduledProcessorUrl, 'utf8'),
  ])

  const validationStart = migration.indexOf('create or replace function public.validate_match_day_scorer_reminder')
  const validationEnd = migration.indexOf('revoke all on function public.validate_match_day_scorer_reminder', validationStart)
  const validation = migration.slice(validationStart, validationEnd)
  assert.match(validation, /assignment\.id = operation_row\.role_assignment_id/)
  assert.match(validation, /parent_link\.status = 'active'/)
  assert.match(validation, /fixture\.deleted_at is null/)
  assert.match(validation, /fixture\.concluded_at is null/)
  assert.match(validation, /fixture\.match_date = timezone/)
  assert.match(processor, /validateMatchDayScorerReminder\(lockedRow\)/)
  assert.match(processor, /discardSkippedScheduledEmail\(lockedRow, scorerReminderValidation\.reason\)/)
  assert.match(processor, /markMatchDayScorerReminderSent\(lockedRow\)/)
})
