import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260702123330_training_availability_v1.sql', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const domainUrl = new URL('../src/lib/domain/training-availability.js', import.meta.url)
const processorUrl = new URL('../netlify/functions/process-training-availability-requests.js', import.meta.url)
const sendGateUrl = new URL('../netlify/functions/lib/_training-availability-send-gate.js', import.meta.url)
const responseUrl = new URL('../netlify/functions/training-availability-response.js', import.meta.url)
const netlifyTomlUrl = new URL('../netlify.toml', import.meta.url)
const matchDayProcessorUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)
const sendGateModuleUrl = new URL('../netlify/functions/lib/_training-availability-send-gate.js', import.meta.url)

function getFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}`)
  assert.notEqual(start, -1, `${name} function missing`)
  const next = source.indexOf('\ncreate or replace function public.', start + 1)
  return next === -1 ? source.slice(start) : source.slice(start, next)
}

test('training availability migration is team scoped with RLS and no direct anon table grants', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.training_availability_settings/i)
  assert.match(migration, /team_id uuid not null references public\.teams/i)
  assert.match(migration, /calendar_event_id uuid not null references public\.calendar_events/i)
  assert.match(migration, /create table if not exists public\.training_availability_requests/i)
  assert.match(migration, /occurrence_date date not null/i)
  assert.match(migration, /create table if not exists public\.training_availability_request_players/i)
  assert.match(migration, /create table if not exists public\.training_availability_responses/i)
  assert.match(migration, /create or replace function public\.set_training_availability_updated_at\(\)[\s\S]*set search_path = public/i)
  assert.match(migration, /alter table public\.training_availability_settings force row level security/i)
  assert.match(migration, /alter table public\.training_availability_requests force row level security/i)
  assert.match(migration, /alter table public\.training_availability_request_players force row level security/i)
  assert.match(migration, /alter table public\.training_availability_responses force row level security/i)
  assert.match(migration, /revoke all on public\.training_availability_settings from anon/i)
  assert.match(migration, /revoke all on public\.training_availability_requests from anon/i)
  assert.match(migration, /revoke all on public\.training_availability_request_players from anon/i)
  assert.match(migration, /revoke all on public\.training_availability_responses from anon/i)
  assert.doesNotMatch(migration, /grant (select|insert|update|delete).*training_availability_.* to anon/i)
})

test('training availability policies require same team training events and same team players', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const eventScope = getFunction(migration, 'training_availability_calendar_event_in_scope')
  const playerScope = getFunction(migration, 'training_availability_player_in_scope')

  assert.match(eventScope, /event\.team_id = target_team_id/i)
  assert.match(eventScope, /event\.event_type = 'training'/i)
  assert.match(eventScope, /event\.cancelled_at is null/i)
  assert.match(playerScope, /player\.team_id = target_team_id/i)
  assert.match(playerScope, /player\.club_id = target_club_id/i)
  assert.match(migration, /public\.training_availability_user_can_manage\(club_id, team_id\)/i)
  assert.match(migration, /public\.training_availability_user_can_view\(club_id, team_id\)/i)
})

test('parent token RPCs are the only anon training availability surface', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const getResponse = getFunction(migration, 'get_training_availability_response')
  const submitResponse = getFunction(migration, 'submit_training_availability_response')

  assert.match(getResponse, /token_hash_value text/i)
  assert.match(getResponse, /normalized_token_hash !~ '\^\[a-f0-9\]\{64\}\$'/i)
  assert.match(submitResponse, /normalized_status not in \('available', 'unavailable', 'maybe'\)/i)
  assert.match(submitResponse, /parent_link\.status = 'active'/i)
  assert.match(submitResponse, /#variable_conflict use_column/i)
  assert.match(migration, /grant execute on function public\.get_training_availability_response\(text\) to anon, authenticated/i)
  assert.match(migration, /grant execute on function public\.submit_training_availability_response\(text, text, text\) to anon, authenticated/i)
})

test('calendar UI exposes training-only availability controls and saves settings after event save', async () => {
  const source = await readFile(sessionsPageUrl, 'utf8')

  assert.match(source, /getDefaultTrainingAvailabilityForm\('training'\)/)
  assert.match(source, /requestTrainingAvailability: sourceEventType === 'training' \? setting\?\.enabled \?\? true : false/)
  assert.match(source, /const canShowTrainingAvailability = Boolean\(!isSessionCreate && !clubWideOnly && safeFormTeamId && form\.eventType === 'training'/)
  assert.match(source, /Request player availability from parents\?/)
  assert.match(source, /trainingAvailabilitySendDaysBefore/)
  assert.match(source, /For repeating training, this applies separately to each occurrence\./)
  assert.match(source, /saveTrainingAvailabilitySettings\({[\s\S]*event: savedEvent,[\s\S]*settings:/)
  assert.match(source, /cancelPendingTrainingAvailabilityRequests\({ user, calendarEventId: activeEvent\.sourceId }\)/)
  assert.match(source, /TrainingAvailabilitySummary/)
})

test('domain helpers default training to yes, non-training to no, and keep summaries per event', async () => {
  const source = await readFile(domainUrl, 'utf8')

  assert.match(source, /requestTrainingAvailability: normalizeText\(eventType\) === 'training'/)
  assert.match(source, /sendDaysBefore: clampSendDaysBefore/)
  assert.match(source, /\.from\('training_availability_settings'\)/)
  assert.match(source, /\.from\('training_availability_request_players'\)/)
  assert.match(source, /\.eq\('club_id', user\.clubId\)/)
  assert.match(source, /training_availability_settings_saved/)
  assert.match(source, /training_availability_requests_cancelled/)
})

test('training availability chip state mapping covers accepted, unavailable, pending, and maybe', async () => {
  const { getTrainingAvailabilityChipState } = await import(domainUrl.href)

  assert.deepEqual(getTrainingAvailabilityChipState('available'), { label: 'Available', tone: 'green' })
  assert.deepEqual(getTrainingAvailabilityChipState('accepted'), { label: 'Available', tone: 'green' })
  assert.deepEqual(getTrainingAvailabilityChipState('not accepted'), { label: 'Not available', tone: 'red' })
  assert.deepEqual(getTrainingAvailabilityChipState('unavailable'), { label: 'Not available', tone: 'red' })
  assert.deepEqual(getTrainingAvailabilityChipState('maybe'), { label: 'Maybe', tone: 'orange' })
  assert.deepEqual(getTrainingAvailabilityChipState(''), { label: 'No response', tone: 'blue' })
})

test('staff availability details include occurrence-specific response notes without parent emails', async () => {
  const {
    normalizeTrainingAvailabilityDetail,
    summarizeTrainingAvailabilityRows,
  } = await import(domainUrl.href)
  const row = {
    id: 'request-player-1',
    request_id: 'request-1',
    calendar_event_id: 'event-1',
    player_id: 'player-1',
    player_name: 'Jess Green',
    status: 'responded',
    recipient_email: 'parent@example.test',
    training_availability_requests: {
      id: 'request-1',
      occurrence_date: '2026-07-12',
      occurrence_starts_at: '2026-07-12T08:00:00+00:00',
    },
    training_availability_responses: {
      status: 'maybe',
      note: 'Might be late because of school trip.',
      responded_at: '2026-07-10T12:00:00+00:00',
      responded_by_email: 'parent@example.test',
      responded_by_name: 'Jess parent',
    },
  }

  const detail = normalizeTrainingAvailabilityDetail(row)
  assert.equal(detail.occurrenceDate, '2026-07-12')
  assert.equal(detail.playerId, 'player-1')
  assert.equal(detail.responseLabel, 'Maybe')
  assert.equal(detail.responseTone, 'orange')
  assert.equal(detail.note, 'Might be late because of school trip.')
  assert.equal(detail.respondedByName, 'Jess parent')
  assert.equal(Object.hasOwn(detail, 'recipientEmail'), false)

  const summary = summarizeTrainingAvailabilityRows([row])
  assert.equal(summary.responded, 1)
  assert.equal(summary.maybe, 1)
  assert.equal(summary.details[0].note, 'Might be late because of school trip.')
})

test('scheduled processor creates per occurrence parent email requests without push, sms, or volunteer roles', async () => {
  const [processor, netlifyToml] = await Promise.all([
    readFile(processorUrl, 'utf8'),
    readFile(netlifyTomlUrl, 'utf8'),
  ])

  assert.match(processor, /buildOccurrences/)
  assert.match(processor, /occurrenceDate/)
  assert.match(processor, /event\.recurrence_until \? new Date\(`\$\{event\.recurrence_until\}T23:59:59`\) : addMonths\(new Date\(\), 3\)/)
  assert.match(processor, /function getSendAt\(occurrence, setting\)/)
  assert.match(processor, /if \(sendAt\.getTime\(\) > now\.getTime\(\)\) {[\s\S]*continue[\s\S]*}[\s\S]*const due = await upsertDueRequest/)
  assert.match(processor, /training_availability_requests/)
  assert.match(processor, /training_availability_request_players/)
  assert.match(processor, /findExistingRecipient/)
  assert.match(processor, /\.select\('id, player_id, team_id, club_id, email, status'\)/)
  assert.doesNotMatch(processor, /parent_name, display_name/)
  assert.match(processor, /send_days_before/)
  assert.match(processor, /assertPlanFeature\({[\s\S]*getClubPlanProfile\(due\.request\.club_id\)[\s\S]*}, 'parentEmails'\)/)
  assert.match(processor, /sendEmail/)
  assert.match(processor, /getTrainingAvailabilitySendGate/)
  assert.match(processor, /const sendGate = getTrainingAvailabilitySendGate\(setting\)[\s\S]*if \(!sendGate\.allowed\) {[\s\S]*continue[\s\S]*}[\s\S]*const due = await upsertDueRequest/)
  assert.match(netlifyToml, /\[functions\."process-training-availability-requests"\]/)
  assert.doesNotMatch(processor, /sendParentMobilePushById/)
  assert.doesNotMatch(processor, /sms/i)
  assert.doesNotMatch(processor, /scorer|linesman|referee/i)
})

test('first recurring training availability email includes schedule while response remains occurrence-specific', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
  const {
    buildAvailabilityEmail,
    buildOccurrences,
    buildTrainingAvailabilityCalendarIcs,
    shouldIncludeRecurringSchedule,
  } = await import(processorUrl.href)
  const event = {
    id: 'event-1',
    title: 'U17 Green training',
    starts_at: '2026-07-05T08:00:00+00:00',
    ends_at: '2026-07-05T09:00:00+00:00',
    recurrence_frequency: 'weekly',
    recurrence_until: '2026-07-19',
    location: 'Football Player Stadium',
  }
  const occurrences = buildOccurrences(event)

  assert.equal(occurrences.length, 3)
  assert.equal(shouldIncludeRecurringSchedule({ occurrence: occurrences[0], occurrences }), true)
  assert.equal(shouldIncludeRecurringSchedule({ occurrence: occurrences[1], occurrences }), false)

  const firstEmail = buildAvailabilityEmail({
    event,
    includeRecurringSchedule: shouldIncludeRecurringSchedule({ occurrence: occurrences[0], occurrences }),
    occurrence: occurrences[0],
    occurrences,
    player: { player_name: 'Jess Green' },
    recipient: { email: 'parent@example.test' },
    responseUrl: 'https://footballplayer.online/.netlify/functions/training-availability-response?token=abc',
    teamName: 'U17 Green',
  })
  const laterEmail = buildAvailabilityEmail({
    event,
    includeRecurringSchedule: shouldIncludeRecurringSchedule({ occurrence: occurrences[1], occurrences }),
    occurrence: occurrences[1],
    occurrences,
    player: { player_name: 'Jess Green' },
    recipient: { email: 'parent@example.test' },
    responseUrl: 'https://footballplayer.online/.netlify/functions/training-availability-response?token=def',
    teamName: 'U17 Green',
  })
  const ics = buildTrainingAvailabilityCalendarIcs({ event, occurrences, teamName: 'U17 Green' })

  assert.match(firstEmail.html, /Upcoming dates/)
  assert.match(firstEmail.html, /Add schedule to calendar/)
  assert.match(firstEmail.html, /This availability response is for this session only\./)
  assert.match(firstEmail.html, /token=abc/)
  assert.doesNotMatch(firstEmail.html, /token=def/)
  assert.doesNotMatch(laterEmail.html, /Upcoming dates/)
  assert.match(laterEmail.html, /This availability response is for this session only\./)
  assert.match(laterEmail.html, /token=def/)
  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3)
})

test('training availability send gate uses explicit server environment flags', async () => {
  const source = await readFile(sendGateUrl, 'utf8')

  assert.match(source, /TRAINING_AVAILABILITY_REAL_EMAILS_ENABLED/)
  assert.match(source, /TRAINING_AVAILABILITY_FP_TEST_EMAILS_ENABLED/)
  assert.match(source, /TRAINING_AVAILABILITY_FP_TEST_CLUB_IDS/)
  assert.match(source, /allowed: isAllowlistedFpTest/)
})

test('training availability scheduled processor send gate fails closed for real email rollout', async () => {
  const { getTrainingAvailabilitySendGate } = await import(sendGateModuleUrl.href)
  const setting = { club_id: 'real-club-id' }

  assert.deepEqual(
    getTrainingAvailabilitySendGate(setting, {}),
    { allowed: false, mode: 'real-disabled' },
  )
  assert.deepEqual(
    getTrainingAvailabilitySendGate(setting, { TRAINING_AVAILABILITY_REAL_EMAILS_ENABLED: 'false' }),
    { allowed: false, mode: 'real-disabled' },
  )
  assert.deepEqual(
    getTrainingAvailabilitySendGate(setting, { TRAINING_AVAILABILITY_REAL_EMAILS_ENABLED: 'true' }),
    { allowed: true, mode: 'real-enabled' },
  )
  assert.deepEqual(
    getTrainingAvailabilitySendGate(
      { club_id: 'fp-test-club-id' },
      {
        TRAINING_AVAILABILITY_REAL_EMAILS_ENABLED: 'false',
        TRAINING_AVAILABILITY_FP_TEST_EMAILS_ENABLED: 'true',
        TRAINING_AVAILABILITY_FP_TEST_CLUB_IDS: 'other-club-id, fp-test-club-id',
      },
    ),
    { allowed: true, mode: 'fp-test-allowlist' },
  )
  assert.deepEqual(
    getTrainingAvailabilitySendGate(
      { club_id: 'fp-test-club-id' },
      {
        TRAINING_AVAILABILITY_FP_TEST_EMAILS_ENABLED: 'true',
        TRAINING_AVAILABILITY_FP_TEST_CLUB_IDS: 'other-club-id',
      },
    ),
    { allowed: false, mode: 'real-disabled' },
  )
})

test('parent response page only supports availability status and note', async () => {
  const source = await readFile(responseUrl, 'utf8')

  assert.match(source, /VALID_STATUSES = new Set\(\['available', 'unavailable', 'maybe'\]\)/)
  assert.match(source, /Optional note/)
  assert.match(source, /This availability response is for this session only\./)
  assert.match(source, /get_training_availability_response/)
  assert.match(source, /submit_training_availability_response/)
  assert.doesNotMatch(source, /volunteer/i)
  assert.doesNotMatch(source, /scorer|linesman|referee/i)
  assert.doesNotMatch(source, /sms/i)
})

test('Match Day availability volunteer behavior remains isolated', async () => {
  const [trainingProcessor, matchDayProcessor] = await Promise.all([
    readFile(processorUrl, 'utf8'),
    readFile(matchDayProcessorUrl, 'utf8'),
  ])

  assert.match(matchDayProcessor, /request_scorer/)
  assert.match(matchDayProcessor, /volunteer_scorer_response/)
  assert.doesNotMatch(trainingProcessor, /request_scorer/)
  assert.doesNotMatch(trainingProcessor, /volunteer_scorer_response/)
})
