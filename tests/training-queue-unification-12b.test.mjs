import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const processorUrl = new URL(
  '../netlify/functions/process-training-availability-requests.js',
  import.meta.url,
)
const scheduledProcessorUrl = new URL(
  '../netlify/functions/process-scheduled-emails.js',
  import.meta.url,
)
const manualInvitationUrl = new URL(
  '../netlify/functions/send-event-player-invitation.js',
  import.meta.url,
)
const emailSenderUrl = new URL(
  '../netlify/functions/send-parent-email.js',
  import.meta.url,
)
const actionableInvitationUrl = new URL(
  '../netlify/functions/lib/_match-day-actionable-invitation.js',
  import.meta.url,
)
const migrationUrl = new URL(
  '../supabase/migrations/20260731071546_training_queue_unification_12b.sql',
  import.meta.url,
)

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function createReadClient(rows) {
  return {
    from(table) {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[table] ?? null, error: null })
        },
      }
    },
  }
}

function buildCurrentFixture() {
  const rawToken = 'a'.repeat(64)
  const queueId = '10000000-0000-5000-a000-000000000001'
  const eventId = '10000000-0000-4000-8000-000000000002'
  const playerId = '10000000-0000-4000-8000-000000000003'
  const requestId = '10000000-0000-4000-8000-000000000004'
  const requestPlayerId = '10000000-0000-4000-8000-000000000005'
  const parentLinkId = '10000000-0000-4000-8000-000000000006'
  const occurrenceStartsAt = new Date(Date.now() + 86_400_000)
  const occurrenceDate = occurrenceStartsAt.toISOString().slice(0, 10)
  const scheduledAt = new Date(Date.now() + 60_000).toISOString()
  const request = {
    id: requestId,
    club_id: '10000000-0000-4000-8000-000000000007',
    team_id: '10000000-0000-4000-8000-000000000008',
    calendar_event_id: eventId,
    occurrence_date: occurrenceDate,
    occurrence_starts_at: occurrenceStartsAt.toISOString(),
    send_at: scheduledAt,
    generated_at: new Date().toISOString(),
    status: 'queued',
  }
  const event = {
    id: eventId,
    club_id: request.club_id,
    team_id: request.team_id,
    event_type: 'training',
    title: 'FP TEST Training',
    starts_at: occurrenceStartsAt.toISOString(),
    ends_at: new Date(occurrenceStartsAt.getTime() + 3_600_000).toISOString(),
    recurrence_frequency: 'none',
    recurrence_until: null,
    location: 'FP TEST',
    cancelled_at: null,
    teams: { name: 'FP TEST Team' },
    clubs: { name: 'FP TEST Club', logo_url: '' },
  }
  const requestPlayer = {
    id: requestPlayerId,
    request_id: requestId,
    email_queue_id: queueId,
    token_hash: hashToken(rawToken),
    status: 'queued',
    recipient_email: 'parent@example.test',
    recipient_name: 'Parent',
    recipient_type: 'parent',
    parent_link_id: parentLinkId,
    delivery_attempt: 1,
    invitation_type: 'training_rsvp',
  }
  const player = {
    id: playerId,
    club_id: request.club_id,
    team_id: request.team_id,
    player_name: 'FP TEST Player',
    contact_type: 'parent',
    parent_email: 'parent@example.test',
    status: 'active',
  }
  const row = {
    id: queueId,
    club_id: request.club_id,
    team_id: request.team_id,
    scheduled_at: scheduledAt,
    payload: {
      deliveryTelemetry: {
        originActionAt: request.generated_at,
        eligibleAt: scheduledAt,
        enqueuedAt: new Date().toISOString(),
        scheduledAt,
      },
      trainingInvitation: {
        version: 1,
        requestId,
        requestPlayerId,
        eventId,
        occurrenceDate,
        playerId,
        recipientEmail: requestPlayer.recipient_email,
        parentLinkId,
        recipientType: 'parent',
        rawToken,
        tokenHash: hashToken(rawToken),
        invitationType: 'training_rsvp',
        deliveryAttempt: 1,
        responseDeadlineAt: occurrenceStartsAt.toISOString(),
      },
    },
  }

  return {
    row,
    rows: {
      training_availability_request_players: requestPlayer,
      training_availability_requests: request,
      calendar_events: event,
      players: player,
      calendar_event_invites: {
        id: '10000000-0000-4000-8000-000000000009',
        invite_status: 'active',
        cancelled_at: null,
        notify_requested: true,
        response_requirement: 'response_required',
        training_availability_requested: true,
      },
      training_availability_settings: {
        id: '10000000-0000-4000-8000-000000000010',
        enabled: true,
      },
      parent_player_links: {
        id: parentLinkId,
        player_id: playerId,
        club_id: request.club_id,
        team_id: request.team_id,
        email: requestPlayer.recipient_email,
        status: 'active',
      },
    },
  }
}

test('automatic Training creates durable work before eligibility and uses one-minute claim path', async () => {
  const [processor, scheduledProcessor, manualInvitation] = await Promise.all([
    readFile(processorUrl, 'utf8'),
    readFile(scheduledProcessorUrl, 'utf8'),
    readFile(manualInvitationUrl, 'utf8'),
  ])

  assert.doesNotMatch(processor, /if \(sendAt\.getTime\(\) > now\.getTime\(\)\)/)
  assert.match(processor, /claimTrainingAvailabilityProcessorWork/)
  assert.match(processor, /completeTrainingAvailabilityProcessorWork/)
  assert.match(processor, /const requestResult = await upsertDueRequest\({[\s\S]*occurrence,[\s\S]*sendAt: getSendAt\(occurrence, setting\)/)
  assert.match(processor, /queueTrainingInvitationRecipient/)
  assert.match(processor, /\.from\('scheduled_email_queue'\)[\s\S]*\.upsert\(queueRecord/)
  assert.match(processor, /schedule: '\* \* \* \* \*'/)
  assert.doesNotMatch(processor, /\bsendEmail\(/)
  assert.match(scheduledProcessor, /prepareScheduledTrainingInvitationRow/)
  assert.match(scheduledProcessor, /sendScheduledEmail\(row\)/)
  assert.match(manualInvitation, /queueTrainingInvitationRecipient/)
  assert.doesNotMatch(manualInvitation, /\bsendEmail\(/)
})

test('automatic reconciliation preserves an already eligible manual invitation queue', async () => {
  const { getReconciledRequestSendAt } = await import(`${processorUrl.href}?manual-queue-preservation=${Date.now()}`)
  const now = new Date('2026-07-31T07:45:00.000Z')
  const automaticSendAt = new Date('2026-08-01T07:45:00.000Z')

  assert.equal(
    getReconciledRequestSendAt({
      existingRequest: {
        status: 'queued',
        send_at: '2026-07-31T07:44:30.000Z',
      },
      now,
      scheduledSendAt: automaticSendAt,
    }).toISOString(),
    '2026-07-31T07:44:30.000Z',
  )
  assert.equal(
    getReconciledRequestSendAt({
      existingRequest: {
        status: 'queued',
        send_at: '2026-08-01T07:44:30.000Z',
      },
      now,
      scheduledSendAt: automaticSendAt,
    }).toISOString(),
    automaticSendAt.toISOString(),
  )
  assert.equal(
    getReconciledRequestSendAt({
      existingRequest: {
        status: 'pending',
        send_at: '2026-07-31T07:44:30.000Z',
      },
      now,
      scheduledSendAt: automaticSendAt,
    }).toISOString(),
    automaticSendAt.toISOString(),
  )
})

test('canonical Training RSVP builder includes event context, response form, link and deadline', async () => {
  const {
    buildAvailabilityEmail,
    buildOccurrences,
  } = await import(`${processorUrl.href}?builder=${Date.now()}`)
  const fixture = buildCurrentFixture()
  const event = fixture.rows.calendar_events
  const occurrence = buildOccurrences(event)[0]
  const email = buildAvailabilityEmail({
    appOrigin: 'https://footballplayer.online',
    event,
    occurrence,
    occurrences: [occurrence],
    player: fixture.rows.players,
    recipient: {
      email: 'parent@example.test',
      name: 'Parent',
      parentLinkId: fixture.rows.parent_player_links.id,
      type: 'parent',
    },
    responseUrl: 'https://footballplayer.online/.netlify/functions/training-availability-response?token=valid-token',
    teamName: 'FP TEST Team',
  })

  assert.match(email.subject, /Training availability: FP TEST Training/)
  assert.match(email.html, /FP TEST Player/)
  assert.match(email.html, /FP TEST Team/)
  assert.match(email.html, /Open response form/)
  assert.match(email.html, /token=valid-token/)
  assert.match(email.html, /Please respond before/)
})

test('queue identity is stable for overlaps and distinct for resend or retry generations', async () => {
  const { getTrainingInvitationQueueId } = await import(
    `${processorUrl.href}?queue-id=${Date.now()}`
  )
  const base = {
    eventId: '10000000-0000-4000-8000-000000000002',
    occurrenceDate: '2026-08-01',
    playerId: '10000000-0000-4000-8000-000000000003',
    recipientEmail: 'PARENT@example.test',
    invitationType: 'training_rsvp',
  }
  const first = getTrainingInvitationQueueId({ ...base, deliveryAttempt: 1 })
  const overlapping = getTrainingInvitationQueueId({
    ...base,
    recipientEmail: 'parent@example.test',
    deliveryAttempt: 1,
  })
  const resend = getTrainingInvitationQueueId({ ...base, deliveryAttempt: 2 })

  assert.equal(first, overlapping)
  assert.notEqual(first, resend)
  assert.match(first, /^[0-9a-f-]{36}$/)
})

test('adult-player and fallback recipients keep an absent parent link as SQL null', async () => {
  const { resolveEligibleEventInvitationContacts } = await import(
    `${actionableInvitationUrl.href}?nullable-parent-link=${Date.now()}`
  )
  const contacts = await resolveEligibleEventInvitationContacts({
    rpc() {
      return Promise.resolve({
        data: [
          {
            player_id: '10000000-0000-4000-8000-000000000003',
            player_name: 'FP TEST Adult Player',
            recipient_email: 'adult@example.test',
            recipient_name: 'FP TEST Adult Player',
            recipient_type: 'player',
            parent_link_id: null,
          },
          {
            player_id: '10000000-0000-4000-8000-000000000004',
            player_name: 'FP TEST Fallback Player',
            recipient_email: 'fallback@example.test',
            recipient_name: 'FP TEST Fallback Parent',
            recipient_type: 'parent',
            parent_link_id: '',
          },
        ],
        error: null,
      })
    },
  }, {
    clubId: '10000000-0000-4000-8000-000000000007',
    playerIds: [
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
    ],
    teamId: '10000000-0000-4000-8000-000000000008',
  })

  assert.equal(contacts.length, 2)
  assert.equal(contacts[0].parentLinkId, null)
  assert.equal(contacts[1].parentLinkId, null)

  const processor = await readFile(processorUrl, 'utf8')
  assert.match(processor, /parent_link_id: normalizeText\(recipient\.parentLinkId\) \|\| null/)
})

test('claim preparation reconstructs the current RSVP and rejects cancelled or changed authority', async () => {
  const { prepareScheduledTrainingInvitationRow } = await import(
    `${processorUrl.href}?claim=${Date.now()}`
  )
  const fixture = buildCurrentFixture()
  const current = await prepareScheduledTrainingInvitationRow(fixture.row, {
    appOrigin: 'https://footballplayer.online',
    supabaseClient: createReadClient(fixture.rows),
  })

  assert.equal(current.skipped, false)
  assert.match(current.row.payload.resendPayload.html, /Open response form/)
  assert.match(current.row.payload.resendPayload.html, new RegExp(fixture.row.payload.trainingInvitation.rawToken))
  assert.equal(
    current.row.payload.deliveryTelemetry.logicalKey,
    `training_availability_request_player:${fixture.row.payload.trainingInvitation.requestPlayerId}:delivery:1`,
  )

  const cancelledFixture = buildCurrentFixture()
  cancelledFixture.rows.calendar_events.cancelled_at = new Date().toISOString()
  const cancelled = await prepareScheduledTrainingInvitationRow(cancelledFixture.row, {
    supabaseClient: createReadClient(cancelledFixture.rows),
  })
  assert.equal(cancelled.skipped, true)
  assert.match(cancelled.skipReason, /no longer valid/)

  const changedRecipientFixture = buildCurrentFixture()
  changedRecipientFixture.rows.parent_player_links.email = 'changed@example.test'
  const changedRecipient = await prepareScheduledTrainingInvitationRow(changedRecipientFixture.row, {
    supabaseClient: createReadClient(changedRecipientFixture.rows),
  })
  assert.equal(changedRecipient.skipped, true)
  assert.match(changedRecipient.skipReason, /recipient authority changed/)
})

test('claim preparation accepts a current legacy parent found by the authoritative recipient resolver', async () => {
  const { prepareScheduledTrainingInvitationRow } = await import(
    `${processorUrl.href}?legacy-authority=${Date.now()}`
  )
  const fixture = buildCurrentFixture()
  fixture.rows.training_availability_request_players.parent_link_id = null
  fixture.row.payload.trainingInvitation.parentLinkId = null
  const baseClient = createReadClient(fixture.rows)
  const client = {
    ...baseClient,
    rpc(name) {
      assert.equal(name, 'event_player_eligible_recipients')
      return Promise.resolve({
        data: [{
          player_id: fixture.rows.players.id,
          player_name: fixture.rows.players.player_name,
          recipient_email: fixture.rows.training_availability_request_players.recipient_email,
          recipient_name: 'Current Parent',
          recipient_type: 'parent',
          parent_link_id: null,
        }],
        error: null,
      })
    },
  }

  const current = await prepareScheduledTrainingInvitationRow(fixture.row, {
    appOrigin: 'https://footballplayer.online',
    supabaseClient: client,
  })

  assert.equal(current.skipped, false)
  assert.match(current.row.payload.resendPayload.html, /Open response form/)
})

test('manual Send, Resend and Retry share one invitation and reusable-token queue model', async () => {
  const [manualInvitation, processor] = await Promise.all([
    readFile(manualInvitationUrl, 'utf8'),
    readFile(processorUrl, 'utf8'),
  ])

  assert.match(manualInvitation, /const ACTIONS = new Set\(\['send', 'resend', 'retry'\]\)/)
  assert.match(manualInvitation, /action === 'send'[\s\S]*action === 'resend'[\s\S]*existing\.status === 'failed'/)
  assert.match(manualInvitation, /queueTrainingInvitationRecipient\({[\s\S]*action,/)
  assert.match(processor, /deliveryAttempt = reusableToken[\s\S]*Number\(existing\?\.delivery_attempt \|\| 0\) \+ 1/)
  assert.match(processor, /tokenReplaced: Boolean\(existing\?\.id && !reusableToken\)/)
  assert.match(processor, /email_queue_id: queueId/)
  assert.match(processor, /TRAINING_INVITATION_DELIVERY_IN_PROGRESS/)
  assert.match(processor, /existingQueue\.id !== finalQueue\.id[\s\S]*\.delete\(\)[\s\S]*\.eq\('status', 'scheduled'\)/)
})

test('delivery telemetry remains Training-specific through the shared sender', async () => {
  const [emailSender, scheduledProcessor] = await Promise.all([
    readFile(emailSenderUrl, 'utf8'),
    readFile(scheduledProcessorUrl, 'utf8'),
  ])

  assert.match(emailSender, /isTrainingInvitation/)
  assert.match(emailSender, /'training_availability'/)
  assert.match(emailSender, /'training_availability_request_player'/)
  assert.match(scheduledProcessor, /updateTrainingInvitationDelivery\({[\s\S]*status: 'sent'/)
  assert.match(scheduledProcessor, /status: 'failed'/)
  assert.match(scheduledProcessor, /status: 'cancelled'/)
})

test('migration links invitation recipients to one-minute jobs without opening RLS access', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /add column if not exists email_queue_id uuid[\s\S]*references public\.scheduled_email_queue\(id\)[\s\S]*on delete set null/i)
  assert.match(migration, /add column if not exists delivery_attempt integer not null default 0/i)
  assert.match(migration, /add column if not exists invitation_type text not null default 'training_rsvp'/i)
  assert.match(migration, /add column if not exists response_deadline_at timestamptz/i)
  assert.match(migration, /training_availability_request_players_email_queue_key/i)
  assert.doesNotMatch(migration, /grant .* to (anon|authenticated)/i)
  assert.doesNotMatch(migration, /disable row level security/i)
})

test('add-only, recurring isolation, Match queue and Development sender contracts remain explicit', async () => {
  const [processor, manualInvitation, scheduledProcessor] = await Promise.all([
    readFile(processorUrl, 'utf8'),
    readFile(manualInvitationUrl, 'utf8'),
    readFile(scheduledProcessorUrl, 'utf8'),
  ])

  assert.match(processor, /invite\.training_availability_requested === true/)
  assert.match(processor, /invite\.notify_requested === true/)
  assert.match(processor, /response_requirement\) === 'response_required'/)
  assert.match(processor, /occurrenceDate/)
  assert.match(processor, /training-availability[\s\S]*occurrenceDate[\s\S]*playerId[\s\S]*recipientEmail/)
  assert.match(manualInvitation, /sourceType === 'match-day'/)
  assert.match(scheduledProcessor, /prepareScheduledCalendarNotificationRow/)
  assert.match(scheduledProcessor, /prepareScheduledResourceNotificationRow/)
})
