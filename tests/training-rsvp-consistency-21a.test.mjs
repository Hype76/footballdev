import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { buildCalendarNotificationHtml } from '../src/lib/calendar-notification-email.js'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const calendarNotificationUrl = new URL('../src/lib/calendar-notification-email.js', import.meta.url)
const calendarClaimUrl = new URL('../netlify/functions/lib/_calendar-notification-email.js', import.meta.url)
const trainingProcessorUrl = new URL('../netlify/functions/process-training-availability-requests.js', import.meta.url)
const manualInvitationUrl = new URL('../netlify/functions/send-event-player-invitation.js', import.meta.url)
const scheduledProcessorUrl = new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url)

test('Add Event and Add Session use the same Training calendar form and persistence path', async () => {
  const sessionsPage = await readFile(sessionsPageUrl, 'utf8')

  assert.match(sessionsPage, /const canShowTrainingAvailability = Boolean\(!clubWideOnly/)
  assert.doesNotMatch(sessionsPage, /canShowTrainingAvailability = Boolean\(!isSessionCreate/)
  assert.match(sessionsPage, /const canShowTeamResourceArea = Boolean\(!clubWideOnly/)
  assert.match(sessionsPage, /const saveTrainingAsSession = isTraining && sourceType === 'session'/)
  assert.match(sessionsPage, /<TrainingAvailabilitySettings[\s\S]*form=\{form\}/)
  assert.match(sessionsPage, /form\.requestTrainingAvailability === true \? \([\s\S]*Send days before/)
  assert.match(sessionsPage, /notifyInvitedFamilies: calendarForm\.notifyInvitedFamilies/)
  assert.match(sessionsPage, /requestTrainingAvailability: calendarForm\.requestTrainingAvailability/)
  assert.match(sessionsPage, /trainingAvailabilitySendDaysBefore: calendarForm\.trainingAvailabilitySendDaysBefore/)
})

test('response-required Training bypasses the informational command and remains communication-aware', async () => {
  const [sessionsPage, calendarClaim, scheduledProcessor] = await Promise.all([
    readFile(sessionsPageUrl, 'utf8'),
    readFile(calendarClaimUrl, 'utf8'),
    readFile(scheduledProcessorUrl, 'utf8'),
  ])

  assert.match(sessionsPage, /shouldQueueCalendarNotification = notifyRequested[\s\S]*!\(isTraining && calendarForm\.requestTrainingAvailability\)/)
  assert.match(calendarClaim, /training_response_delivery_owned_by_rsvp_queue/)
  assert.match(calendarClaim, /calendarInvite\?\.response_requirement === 'response_required'/)
  assert.match(calendarClaim, /calendarInvite\?\.training_availability_requested === true/)
  assert.match(scheduledProcessor, /isTrainingRsvpQueueHandoff\(skipReason\) \? 'sent' : 'failed'/)
  assert.match(scheduledProcessor, /isTrainingRsvpQueueHandoff\(skipReason\) \? null : skipReason/)
})

test('informational Training copy is truthful and contains no RSVP action or token', () => {
  const html = buildCalendarNotificationHtml({
    clubName: 'FP TEST Club',
    eventTitle: 'FP TEST Training',
    eventType: 'training',
    parentName: 'FP TEST Parent',
    playerName: 'FP TEST Player',
    portalUrl: 'https://parent.footballplayer.online/parent-portal?section=calendar',
    startsAt: '2026-08-02T10:00:00.000Z',
    teamName: 'FP TEST Team',
  })

  assert.match(html, /This Training session has been shared with you\. No attendance response has been requested\./)
  assert.match(html, /View event details/)
  assert.doesNotMatch(html, /Open response form|Respond to invitation|[?&]token=/i)
})

test('automatic, manual, resend, and retry keep the canonical Training builder', async () => {
  const [trainingProcessor, manualInvitation, scheduledProcessor, calendarNotification] = await Promise.all([
    readFile(trainingProcessorUrl, 'utf8'),
    readFile(manualInvitationUrl, 'utf8'),
    readFile(scheduledProcessorUrl, 'utf8'),
    readFile(calendarNotificationUrl, 'utf8'),
  ])

  assert.match(trainingProcessor, /export function buildAvailabilityEmail/)
  assert.match(trainingProcessor, /Can \$\{escapeHtml\(player\.player_name[\s\S]*attend\?[\s\S]*Please confirm availability for this training session\./)
  assert.match(trainingProcessor, /Open response form/)
  assert.match(trainingProcessor, /responseDeadlineAt/)
  assert.match(manualInvitation, /queueTrainingInvitationRecipient/)
  assert.match(scheduledProcessor, /prepareScheduledTrainingInvitationRow/)
  assert.match(calendarNotification, /No attendance response has been requested/)
})
