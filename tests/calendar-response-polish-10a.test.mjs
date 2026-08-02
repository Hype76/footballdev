import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildEventResponseManagerModel } from '../src/lib/domain/event-response-manager.js'
import {
  buildEventResponseReadModel,
  getEventResponseDisplayState,
} from '../src/lib/domain/event-response-read-model.js'

const files = {
  component: new URL('../src/components/sessions/EventResponseManager.jsx', import.meta.url),
  currentContactMigration: new URL('../supabase/migrations/20260730161926_match_response_current_contact_alignment.sql', import.meta.url),
  invitationClient: new URL('../src/lib/domain/event-player-invitation-actions.js', import.meta.url),
  invitationFunction: new URL('../netlify/functions/send-event-player-invitation.js', import.meta.url),
  matchSendFunction: new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url),
  migration: new URL('../supabase/migrations/20260730151849_calendar_response_polish_10a.sql', import.meta.url),
  trainingCurrentContactMigration: new URL('../supabase/migrations/20260730162800_training_response_current_contact_alignment.sql', import.meta.url),
  trainingUpsertMigration: new URL('../supabase/migrations/20260730160636_training_invitation_upsert_constraint.sql', import.meta.url),
  sessions: new URL('../src/pages/SessionsPage.jsx', import.meta.url),
}

async function sources() {
  return Object.fromEntries(await Promise.all(
    Object.entries(files).map(async ([key, url]) => [key, await readFile(url, 'utf8')]),
  ))
}

function participant({
  deliveryState = 'delivered',
  invitationState = 'created',
  matchSelectionState = 'not_selected',
  responseState = 'awaiting_response',
} = {}) {
  const display = getEventResponseDisplayState({
    deliveryState,
    eventType: 'match',
    invitationState,
    matchSelectionState,
    responseState,
  })
  const invitationAction = invitationState === 'not_sent'
    ? 'send'
    : ['failed', 'partial_failure'].includes(deliveryState)
      ? 'retry'
      : 'resend'

  return {
    deliveryState,
    id: 'player-1',
    invitationState,
    matchSelectionState,
    player: { id: 'player-1', playerName: 'FP TEST Player' },
    playerId: 'player-1',
    respondedAt: '',
    responseState,
    staffActions: {
      canAcceptOnBehalf: display.canAcceptOnBehalf,
      canMarkUnavailable: responseState !== 'unavailable' && invitationState !== 'not_sent',
      canSelectForSquad: responseState === 'available' && matchSelectionState !== 'selected',
      invitationAction,
    },
  }
}

test('manager rows expose state-aware invitation, unavailable, and match selection actions', () => {
  const awaiting = buildEventResponseManagerModel({
    eventType: 'match',
    participants: [participant()],
  }).rows[0]
  assert.equal(awaiting.invitationActionLabel, 'Resend invitation')
  assert.equal(awaiting.canMarkUnavailable, true)
  assert.equal(awaiting.canSelectForSquad, false)

  const available = buildEventResponseManagerModel({
    eventType: 'match',
    participants: [participant({ responseState: 'available' })],
  }).rows[0]
  assert.equal(available.canMarkUnavailable, true)
  assert.equal(available.canSelectForSquad, true)

  const failed = buildEventResponseManagerModel({
    eventType: 'match',
    participants: [participant({ deliveryState: 'failed' })],
  }).rows[0]
  assert.equal(failed.invitationActionLabel, 'Retry invitation')

  const unsent = buildEventResponseManagerModel({
    eventType: 'match',
    participants: [participant({
      deliveryState: 'not_requested',
      invitationState: 'not_sent',
      responseState: 'not_invited',
    })],
  }).rows[0]
  assert.equal(unsent.invitationActionLabel, 'Send invitation')
})

test('response manager is compact, expandable, accessible, and keeps one expanded row state', async () => {
  const { component } = await sources()

  assert.match(component, /aria-controls=\{detailsId\}/)
  assert.match(component, /aria-expanded=\{expanded\}/)
  assert.match(component, /expandedPlayerId/)
  assert.match(component, /setExpandedPlayerId\(playerId\)/)
  assert.match(component, /Mark Unavailable/)
  assert.match(component, /Select for squad/)
  assert.match(component, /row\.invitationActionLabel/)
  assert.match(component, /100dvh/)
  assert.match(component, /safe-area-inset-top/)
  assert.match(component, /safe-area-inset-bottom/)
  assert.match(component, /min-h-0/)
  assert.match(component, /overflow-y-auto/)
})

test('Add Event route handlers are hoisted in the unconditional hook region and opening does not save', async () => {
  const { sessions } = await sources()
  const routeEffect = sessions.indexOf("const requestedAction = String(searchParams.get('action')")
  const calendarHandler = sessions.indexOf("function handleOpenCalendarCreate(date = '', requestedEventType = '')")
  const sessionHandler = sessions.indexOf('function handleOpenSessionCreateModal()')

  assert.ok(routeEffect > 0)
  assert.ok(calendarHandler > routeEffect)
  assert.ok(sessionHandler > routeEffect)
  assert.match(sessions.slice(routeEffect, routeEffect + 1200), /handleOpenCalendarCreate\('', requestedType\)/)
  assert.doesNotMatch(sessions.slice(routeEffect, routeEffect + 1200), /createCalendarEvent|updateCalendarEvent/)
  assert.deepEqual(buildEventResponseReadModel({ event: null }).counts, {
    available: 0,
    awaitingResponse: 0,
    deliveryIssues: 0,
    invitationNotSent: 0,
    maybe: 0,
    selected: 0,
    total: 0,
    unavailable: 0,
  })
})

test('response-link repair permits only a still-current server-side contact and leaves stale contacts denied', async () => {
  const {
    currentContactMigration,
    migration,
    trainingCurrentContactMigration,
  } = await sources()
  const predicate = currentContactMigration

  assert.match(predicate, /request\.expires_at >= timezone\('utc', now\(\)\)/)
  assert.match(predicate, /match_day\.status[\s\S]*not in \('cancelled', 'full_time', 'postponed'\)/)
  assert.match(predicate, /parent_link\.status = 'active'/)
  assert.match(predicate, /player\.parent_email/)
  assert.match(predicate, /jsonb_array_elements\(coalesce\(player\.parent_contacts/)
  assert.match(predicate, /current_contacts\.self_match/)
  assert.match(predicate, /current_contacts\.parent_match/)
  assert.match(predicate, /current_contacts\.usable_count = 0/)
  assert.match(predicate, /lower\(btrim\(request\.recipient_email\)\)/)
  assert.doesNotMatch(predicate, /request\.recipient_type = 'player'\)\s*or/)
  assert.match(migration, /mark_event_player_unavailable_on_behalf/)

  assert.match(
    trainingCurrentContactMigration,
    /is_training_availability_token_current_internal/,
  )
  assert.match(trainingCurrentContactMigration, /player\.parent_email/)
  assert.match(trainingCurrentContactMigration, /parent_link\.status = 'active'/)
  assert.match(
    trainingCurrentContactMigration,
    /request_player\.recipient_type = 'player'[\s\S]*player\.contact_type = 'self'/,
  )
  assert.match(
    trainingCurrentContactMigration,
    /request_player\.recipient_type = 'parent'[\s\S]*not exists \([\s\S]*active_parent_link/,
  )
  assert.equal(
    (
      trainingCurrentContactMigration.match(
        /if not public\.is_training_availability_token_current_internal\(normalized_token_hash\) then/g,
      ) ?? []
    ).length,
    2,
  )
})

test('single-player invitation endpoint resolves recipients server-side and uses durable idempotency', async () => {
  const {
    invitationClient,
    invitationFunction,
    matchSendFunction,
    migration,
    trainingUpsertMigration,
  } = await sources()

  assert.match(invitationClient, /playerId: normalizedPlayerId/)
  assert.doesNotMatch(invitationClient, /recipientEmail|parentEmail|to:/)
  assert.match(invitationFunction, /playerIds: \[playerId\]/)
  assert.match(invitationFunction, /event_player_invitation_actions/)
  assert.match(invitationFunction, /idempotency_key: idempotencyKey/)
  assert.match(invitationFunction, /previous\?\.club_id !== scopedEvent\.club_id/)
  assert.match(invitationFunction, /previous\?\.player_id !== playerId/)
  assert.match(invitationFunction, /getPlayerContacts\(\{ parentLinks: parentLinks \?\? \[\], player \}\)/)
  assert.match(invitationFunction, /preview: true/)
  assert.match(invitationFunction, /address: maskEmail\(contact\.email\)/)
  assert.doesNotMatch(invitationFunction, /\.select\('id, player_id, email, parent_name/)
  assert.doesNotMatch(invitationFunction, /\.select\('id, player_id, email, display_name/)
  assert.match(invitationFunction, /const recipientPreview = await loadRecipientPreview\([\s\S]*if \(preview\)[\s\S]*const actionCommand = await beginAction/)
  assert.match(invitationFunction, /status: failedCount > 0 \? 'partial_failed' : 'queued'/)
  assert.match(invitationFunction, /queueTrainingInvitationRecipient/)
  assert.doesNotMatch(invitationFunction, /\bsendEmail\(/)
  assert.match(invitationFunction, /existing\.status === 'failed'/)
  assert.match(matchSendFunction, /target exactly one player/)
  assert.match(matchSendFunction, /eventPlayerInvitationAction/)
  assert.doesNotMatch(matchSendFunction, /invitationAction === 'resend' && \(existingQueues \?\? \[\]\)\.length === 0/)
  assert.match(matchSendFunction, /existingRequest\?\.id && targetedInvitationAction[\s\S]*getReusableMatchDayResponseToken\(existingRequest, existingQueues \|\| \[\]\)/)
  assert.match(matchSendFunction, /const createdToken = reusableToken \? null : createInvitationToken\(\)/)
  assert.doesNotMatch(
    matchSendFunction.slice(
      matchSendFunction.indexOf('existingRequest?.id && targetedInvitationAction'),
      matchSendFunction.indexOf(': supabase', matchSendFunction.indexOf('existingRequest?.id && targetedInvitationAction')),
    ),
    /status: 'pending'|volunteer_scorer_response|volunteer_responded_at/,
  )
  assert.match(migration, /idempotency_key uuid not null unique/)
  assert.match(migration, /revoke all on public\.event_player_invitation_actions from public, anon, authenticated/)
  assert.match(
    trainingUpsertMigration,
    /training_availability_request_players\(request_id, player_id, recipient_email\)/,
  )
  assert.doesNotMatch(invitationFunction, /resendAll|resend_all/)
})

test('unavailable and squad actions retain server authority and preserve independent state', async () => {
  const { migration, sessions } = await sources()

  assert.match(migration, /mark_event_player_unavailable_on_behalf/)
  assert.match(migration, /public\.can_manage_match_day\(match_row\.team_id\)/)
  assert.match(migration, /event_player_availability_marked_unavailable_on_behalf/)
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf('create or replace function public.mark_event_player_unavailable_on_behalf'),
      migration.indexOf('create unique index if not exists scheduled_email_queue_single_player_invitation_action_key'),
    ),
    /update public\.match_day_player_squad_decisions|delete from public\.match_day_player_squad_decisions/,
  )
  assert.match(sessions, /setMatchDayPlayerSquadDecision\(\{[\s\S]*decision: 'selected'/)
  assert.match(sessions, /Their availability response was not changed/)
})
