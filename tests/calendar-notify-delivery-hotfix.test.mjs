import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  applyTrialPlayerSelection,
  applyWholeSquadSelection,
  getSelectedInvitePlayers,
  getWholeSquadSelectionState,
} from '../src/lib/domain/calendar-invite-scope.js'
import { getCalendarNotificationToast } from '../src/lib/domain/calendar-notification-status.js'
import { buildPreparedScheduledEmail } from '../netlify/functions/lib/_scheduled-email-payload.js'
import { sendEmail } from '../netlify/functions/lib/_email-provider.js'

const players = [
  { id: 'squad-1', section: 'Squad', playerName: 'Squad One' },
  { id: 'squad-2', section: 'squad', playerName: 'Squad Two' },
  { id: 'trial-1', section: 'Trial', playerName: 'Trial One' },
]

test('Whole squad checking selects every eligible squad player without trials', () => {
  assert.deepEqual(applyWholeSquadSelection({ checked: true, invitePlayers: players }), ['squad-1', 'squad-2'])
})

test('Whole squad includes trials only when Include trial players is selected', () => {
  assert.deepEqual(applyWholeSquadSelection({
    checked: true,
    includeTrialPlayers: true,
    invitePlayers: players,
  }), ['squad-1', 'squad-2', 'trial-1'])
})

test('unchecking Whole squad clears squad players while preserving the trial control', () => {
  assert.deepEqual(applyWholeSquadSelection({
    checked: false,
    includeTrialPlayers: true,
    invitePlayers: players,
  }), ['trial-1'])
  assert.deepEqual(applyWholeSquadSelection({ checked: false, invitePlayers: players }), [])
})

test('manual selection derives checked, indeterminate and unchecked Whole squad states', () => {
  assert.deepEqual(getWholeSquadSelectionState({
    invitePlayers: players,
    selectedPlayerIds: ['squad-1', 'squad-2'],
  }), { checked: true, indeterminate: false, scopeCount: 2, selectedScopeCount: 2 })
  assert.deepEqual(getWholeSquadSelectionState({
    invitePlayers: players,
    selectedPlayerIds: ['squad-1'],
  }), { checked: false, indeterminate: true, scopeCount: 2, selectedScopeCount: 1 })
  assert.deepEqual(getWholeSquadSelectionState({ invitePlayers: players, selectedPlayerIds: [] }), {
    checked: false,
    indeterminate: false,
    scopeCount: 2,
    selectedScopeCount: 0,
  })
})

test('editing an existing all-squad event derives Whole squad as checked', () => {
  const existingInviteIds = ['squad-1', 'squad-2']
  assert.equal(getWholeSquadSelectionState({ invitePlayers: players, selectedPlayerIds: existingInviteIds }).checked, true)
  assert.deepEqual(getSelectedInvitePlayers(players, existingInviteIds).map((player) => player.id), existingInviteIds)
})

test('extra manually selected players keep authoritative save mode manual', async () => {
  const sessionsPage = await readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')
  assert.match(sessionsPage, /hasOnlyWholeSquadScopePlayers = notificationPlayers\.every/)
  assert.match(sessionsPage, /wholeSquadSelectionState\.checked && hasOnlyWholeSquadScopePlayers/)
})

test('Include trial players expands and removes only trial selection', () => {
  const expanded = applyTrialPlayerSelection({
    checked: true,
    invitePlayers: players,
    selectedPlayerIds: ['squad-1', 'squad-2'],
    wholeSquadSelected: true,
  })
  assert.deepEqual(new Set(expanded), new Set(['squad-1', 'squad-2', 'trial-1']))
  assert.deepEqual(applyTrialPlayerSelection({
    checked: false,
    invitePlayers: players,
    selectedPlayerIds: expanded,
    wholeSquadSelected: true,
  }).sort(), ['squad-1', 'squad-2'])
})

test('selected player chips cannot include a stale hidden player after team membership changes', () => {
  assert.deepEqual(getSelectedInvitePlayers(players.slice(0, 2), ['squad-1', 'removed-player']).map((player) => player.id), ['squad-1'])
})

test('queue insertion alone is processing and provider confirmation is sent', () => {
  assert.match(getCalendarNotificationToast({
    eligibleRecipientCount: 5,
    portalRecordCount: 16,
    processingCount: 5,
  }, { entity: 'Event', action: 'updated' }).message, /5 parent emails are being delivered/)
  assert.match(getCalendarNotificationToast({
    deliveredCount: 5,
    eligibleRecipientCount: 5,
    portalRecordCount: 16,
  }, { entity: 'Event', action: 'updated' }).message, /5 parent emails sent/)
})

test('truthful status distinguishes partial, no-recipient, failure and duplicate outcomes', () => {
  assert.match(getCalendarNotificationToast({ deliveredCount: 4, failedCount: 1, eligibleRecipientCount: 5, portalRecordCount: 16 }).message, /4 emails were sent and 1 could not be sent/)
  assert.match(getCalendarNotificationToast({ eligibleRecipientCount: 0, portalRecordCount: 16 }).message, /no eligible parent email addresses/)
  assert.match(getCalendarNotificationToast({ eligibleRecipientCount: 5, failedCount: 5, portalRecordCount: 16 }).message, /could not be sent/)
  assert.match(getCalendarNotificationToast({ deliveredCount: 5, duplicateCount: 5, eligibleRecipientCount: 5, portalRecordCount: 16 }).message, /no duplicate email was sent/)
})

test('Calendar queue payload reconstructs a valid sender and reaches the mocked provider', async () => {
  const prepared = buildPreparedScheduledEmail({
    subject: 'Fixture update',
    to_email: 'parent@example.com',
    payload: {
      displayName: 'Coach Name',
      teamName: 'U17 Green',
      clubName: 'Jeluma QA',
      resendPayload: {
        to: ['parent@example.com'],
        subject: 'Fixture update',
        html: '<p>Updated</p>',
      },
    },
  }, { clubId: 'club-1' })
  const calls = []

  await sendEmail(prepared.emailPayload, {
    env: {
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
    },
    resendClient: {
      emails: {
        send: async (payload) => {
          calls.push(payload)
          return { data: { id: 'email_123' } }
        },
      },
    },
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0].from, /<feedback@footballplayer\.online>$/)
})

test('delivery migration keeps internal control and immediate due-time rules server-side', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260716110436_calendar_notify_delivery_hotfix.sql', import.meta.url), 'utf8')
  assert.match(migration, /sync_calendar_event_parent_scope_v2/)
  assert.match(migration, /Whole squad player scope is resolved by the server/)
  assert.match(migration, /communicationLog,metadata,source/)
  assert.match(migration, /new\.scheduled_at := now\(\)/)
  assert.match(migration, /status in \('pending', 'queued', 'processing', 'sent', 'failed'\)/)
  assert.match(migration, /revoke all on function public\.sync_calendar_event_parent_scope_v2/)
})

test('immediate processor is command-scoped and preserves periodic processing', async () => {
  const [processor, manager, calendarDomain, sessionsPage] = await Promise.all([
    readFile(new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/manage-scheduled-emails.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/domain/calendar-events.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(processor, /processCalendarNotificationCommand/)
  assert.match(processor, /\.eq\('requested_by', profile\.id\)/)
  assert.match(processor, /\.eq\('club_id', profile\.clubId\)/)
  assert.match(processor, /\.from\('team_staff'\)/)
  assert.match(processor, /processScheduledEmails/)
  assert.match(manager, /action === 'processCalendarNotification'/)
  assert.match(calendarDomain, /processCalendarNotificationDelivery/)
  assert.doesNotMatch(calendarDomain, /recipientEmail|toEmail|queueStatus/)
  assert.match(sessionsPage, /input\.indeterminate = wholeSquadSelectionState\.indeterminate/)
  assert.match(sessionsPage, /aria-checked=\{wholeSquadSelectionState\.indeterminate \? 'mixed'/)
  assert.match(sessionsPage, /Parents will see the event in their Parent Portal and receive an email notification\./)
  assert.doesNotMatch(sessionsPage, /holding queue/)
})
