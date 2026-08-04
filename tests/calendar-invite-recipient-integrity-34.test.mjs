import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260804120936_fp_v1_calendar_invite_recipient_integrity_34.sql', import.meta.url)
const fp33MigrationUrl = new URL('../supabase/migrations/20260804084949_fp_v1_gameday_squad_decisions_resend_33.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/event-player-management.js', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)

const [migration, fp33Migration, domain, sessionsPage] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(fp33MigrationUrl, 'utf8'),
  readFile(domainUrl, 'utf8'),
  readFile(sessionsPageUrl, 'utf8'),
])

test('FP34 restores the canonical Calendar invitation recipient contract after FP33', () => {
  assert.match(fp33Migration, /'parent'::text as recipient_type/)
  assert.match(migration, /create or replace function public\.canonical_calendar_invite_recipient_type/)
  assert.match(migration, /when 'parent' then 'parent_guardian'/)
  assert.match(migration, /when 'guardian' then 'parent_guardian'/)
  assert.match(migration, /when 'adult_player' then 'player'/)
  assert.match(migration, /when 'parent_and_player' then 'parent_and_player'/)
  assert.match(migration, /else null/)
  assert.match(migration, /Unsupported Calendar invitation recipient class/)
  assert.match(migration, /before insert or update of recipient_type/)
  assert.match(migration, /public\.canonical_calendar_invite_recipient_type\('parent'\) as recipient_type/)
  assert.match(migration, /public\.canonical_calendar_invite_recipient_type\('adult_player'\) as recipient_type/)
  assert.doesNotMatch(migration, /drop constraint calendar_event_invites_recipient_type_check/i)
  assert.doesNotMatch(migration, /disable row level security/i)
})

test('player management failures stay inside the modal and never expose raw database details', () => {
  assert.match(domain, /We could not update the invited Players\. Your selection has been kept\. Please try again\./)
  assert.match(domain, /Reference: \$\{reference\}/)
  assert.match(domain, /Players were updated, but \$\{failedSummary\}/)
  assert.match(domain, /No duplicate messages were sent\. Retry from this window\./)
  assert.match(sessionsPage, /id="event-player-management-error"/)
  assert.match(sessionsPage, /role="alert"/)
  assert.match(sessionsPage, /aria-live="assertive"/)
  assert.match(sessionsPage, /errorSummaryRef\.current\?\.focus\(\)/)
  assert.match(sessionsPage, /setCalendarPlayerActionError\(message\)/)
  assert.match(sessionsPage, /if \(result\.communicationFailure\)/)
  assert.match(sessionsPage, /Players updated, invitations not queued/)
  assert.doesNotMatch(sessionsPage, /setCalendarPlayerActionError\(error\.message \|\| 'new row for relation/)
})

test('player selection and communication choice remain available for retry', () => {
  const failureBranch = sessionsPage.slice(
    sessionsPage.indexOf('if (result.communicationFailure)'),
    sessionsPage.indexOf("setCalendarModal((current) => ({ ...current, mode: 'view' }))"),
  )

  assert.match(failureBranch, /setCalendarPlayerActionError/)
  assert.match(failureBranch, /return/)
  assert.doesNotMatch(failureBranch, /setCalendarPlayerReview\(null\)/)
  assert.doesNotMatch(failureBranch, /setCalendarPlayerCommunicationMode\(EVENT_PLAYER_COMMUNICATION_MODES\.none\)/)
  assert.doesNotMatch(failureBranch, /invitedPlayerIds:/)
})
