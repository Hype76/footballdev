import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260729090000_event_player_communications_v1.sql', import.meta.url)
const resendConfirmationMigrationUrl = new URL('../supabase/migrations/20260729093000_event_player_comms_resend_confirmation.sql', import.meta.url)
const recipientTypeMigrationUrl = new URL('../supabase/migrations/20260729094500_event_player_recipient_type_alignment.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/event-player-management.js', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const scheduledEmailProcessorUrl = new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url)

const [migration, resendConfirmationMigration, recipientTypeMigration, domain, sessionsPage, matchDayPage, scheduledEmailProcessor] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(resendConfirmationMigrationUrl, 'utf8'),
  readFile(recipientTypeMigrationUrl, 'utf8'),
  readFile(domainUrl, 'utf8'),
  readFile(sessionsPageUrl, 'utf8'),
  readFile(matchDayPageUrl, 'utf8'),
  readFile(scheduledEmailProcessorUrl, 'utf8'),
])

test('participant command is idempotent, append-only for history, and server authoritative', () => {
  assert.match(migration, /create table if not exists public\.event_player_change_commands/)
  assert.match(migration, /unique \(requested_by, request_token\)/)
  assert.match(migration, /create or replace function public\.preview_event_player_changes/)
  assert.match(migration, /create or replace function public\.apply_event_player_changes/)
  assert.match(migration, /security definer/)
  assert.match(migration, /actor\.role in \('parent_portal', 'super_admin'\)/)
  assert.match(migration, /assignment\.team_id = source_team_id/)
  assert.match(migration, /player\.club_id = source_club_id/)
  assert.match(migration, /player\.team_id = source_team_id/)
  assert.match(migration, /invite_status = 'cancelled'/)
  assert.match(migration, /cancelled_at = coalesce/)
  assert.doesNotMatch(migration, /delete from public\.calendar_event_invites/i)
})

test('server preview returns exact delta, contact, and selected-removal state', () => {
  assert.match(migration, /'addedPlayerIds'/)
  assert.match(migration, /'removedPlayerIds'/)
  assert.match(migration, /'unchangedPlayerIds'/)
  assert.match(migration, /'selectedRemovalPlayerIds'/)
  assert.match(migration, /'addedRecipientCount'/)
  assert.match(migration, /'removedRecipientCount'/)
  assert.match(migration, /'currentRecipientCount'/)
  assert.match(migration, /'addedMissingContactPlayerIds'/)
  assert.match(migration, /event_player_eligible_recipients/)
  assert.match(migration, /contact_type in \('parent', 'both'\)/)
  assert.match(migration, /player\.contact_type = 'self'/)
})

test('ordinary save and explicit communication modes stay separate', () => {
  assert.match(domain, /none: 'none'/)
  assert.match(domain, /notifyAdded: 'notify_added'/)
  assert.match(domain, /notifyRemoved: 'notify_removed'/)
  assert.match(domain, /resendAll: 'resend_all'/)
  assert.match(sessionsPage, /Save player changes without notifications/)
  assert.match(sessionsPage, /Notify newly added players only/)
  assert.match(sessionsPage, /Notify removed players only/)
  assert.match(sessionsPage, /Separate resend action/)
  assert.match(sessionsPage, /Resend invitations to everyone/)
  assert.match(sessionsPage, /No notifications will be sent\./)
})

test('notifications are delta scoped and retries cannot duplicate queue ledgers', () => {
  assert.match(migration, /target_player_ids := added_player_ids/)
  assert.match(migration, /target_player_ids := removed_player_ids/)
  assert.match(migration, /target_player_ids := selected_player_ids/)
  assert.match(migration, /event_player_notification_events_command_recipient_key/)
  assert.match(migration, /on conflict on constraint event_player_notification_events_command_recipient_key/)
  assert.match(migration, /'idempotencyKey'/)
  assert.match(domain, /playerIds: addedPlayerIds/)
  assert.match(domain, /source: 'calendar_edit'/)
  assert.match(scheduledEmailProcessor, /from\('event_player_notification_events'\)/)
  assert.match(scheduledEmailProcessor, /updateEventPlayerNotificationEvent\(lockedRow\.id, 'processing'\)/)
  assert.match(scheduledEmailProcessor, /updateEventPlayerNotificationEvent\(lockedRow\.id, 'sent'\)/)
  assert.match(scheduledEmailProcessor, /updateEventPlayerNotificationEvent\(lockedRow\.id, 'failed'/)
  assert.match(resendConfirmationMigration, /confirm_resend_all_value is not true/)
  assert.match(resendConfirmationMigration, /Confirm the separate resend-to-all action/)
  assert.match(domain, /confirm_resend_all_value: confirmResendAll === true/)
  assert.match(sessionsPage, /confirmResendAll: communicationMode === EVENT_PLAYER_COMMUNICATION_MODES\.resendAll/)
  assert.match(recipientTypeMigration, /'parent_guardian'::text as recipient_type/)
  assert.doesNotMatch(recipientTypeMigration, /else 'parent'/)
})

test('match selection and training history safeguards are explicit', () => {
  assert.match(migration, /Confirm that selected match players will be removed from the squad decision/)
  assert.match(migration, /status = 'not_selected'/)
  assert.match(migration, /'player_squad_decision_changed'/)
  assert.match(migration, /participantRemoved/)
  assert.match(migration, /training_availability_request_players/)
  assert.match(migration, /request_player\.status in \('pending', 'queued', 'sent', 'failed'\)/)
  assert.match(migration, /notify_requested = case/)
  assert.match(migration, /responded_at is not null/)
})

test('player management review is exposed in Calendar and Match Day', () => {
  assert.match(sessionsPage, /data-testid="event-player-management"/)
  assert.match(sessionsPage, /Review player changes/)
  assert.match(sessionsPage, /Players added/)
  assert.match(sessionsPage, /Players removed/)
  assert.match(sessionsPage, /Players unchanged/)
  assert.match(sessionsPage, /Added, not notified/)
  assert.match(sessionsPage, /Invitation not sent/)
  assert.match(sessionsPage, /Selected-player confirmation required/)
  assert.match(matchDayPage, /Manage invited players/)
  assert.match(matchDayPage, /action=manage-players&source=match-day/)
})

test('training communication defaults off for new events', () => {
  assert.match(sessionsPage, /notifyInvitedFamilies: false/)
  assert.match(sessionsPage, /requestTrainingAvailability: false/)
  assert.doesNotMatch(sessionsPage, /requestTrainingAvailability: eventType === 'training'/)
})
