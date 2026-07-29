import { createHash } from 'node:crypto'

const DEVELOPMENT_OUTPUT_CONTEXTS_REQUIRING_CONFIRMATION = new Set([
  'development_record',
  'development_record_recipient',
])
const SEND_MODES = new Set(['none', 'now', 'scheduled'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeText(value) {
  return String(value ?? '').trim()
}

function uniqueIds(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeText)
        .filter((value) => UUID_PATTERN.test(value)),
    ),
  ].sort()
}

function operationError(message, statusCode, code) {
  return Object.assign(new Error(message), {
    code,
    publicMessage: message,
    statusCode,
  })
}

function getSendMode(value) {
  const sendMode = normalizeText(value).toLowerCase()
  return SEND_MODES.has(sendMode) ? sendMode : ''
}

function normalizeScheduledAt(value, sendMode) {
  if (sendMode !== 'scheduled') {
    return null
  }

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    throw operationError(
      'Choose a valid scheduled send date and time.',
      400,
      'DEVELOPMENT_SUBMISSION_SCHEDULE_INVALID',
    )
  }

  return timestamp.toISOString()
}

function normalizeReminderDate(value) {
  const reminderDate = normalizeText(value)
  if (!reminderDate) {
    return null
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(reminderDate)) {
    throw operationError(
      'Choose a valid next review reminder date.',
      400,
      'DEVELOPMENT_SUBMISSION_REMINDER_INVALID',
    )
  }

  return reminderDate
}

function sameTimestamp(left, right) {
  if (!left && !right) {
    return true
  }

  const leftTimestamp = new Date(left).getTime()
  const rightTimestamp = new Date(right).getTime()
  return Number.isFinite(leftTimestamp) &&
    Number.isFinite(rightTimestamp) &&
    leftTimestamp === rightTimestamp
}

function stableConfirmationPayload(value) {
  return JSON.stringify({
    actorId: value.actorId,
    attachPdf: value.attachPdf,
    clubId: value.clubId,
    evaluationId: value.evaluationId,
    includeAttendance: value.includeAttendance,
    operationId: value.operationId,
    playerId: value.playerId,
    reminderDate: value.reminderDate,
    scheduledAt: value.scheduledAt,
    selectedParentLinkIds: value.selectedParentLinkIds,
    selectedResponseCount: value.selectedResponseCount,
    sendMode: value.sendMode,
    teamId: value.teamId,
  })
}

export function normalizeDevelopmentSubmissionConfirmation(body = {}, profile = {}) {
  const operationId = normalizeText(body.operationId || body.submissionOperationId)
  const evaluationId = normalizeText(body.evaluationId)
  const clubId = normalizeText(profile.clubId)
  const teamId = normalizeText(body.teamId)
  const playerId = normalizeText(body.playerId)
  const actorId = normalizeText(profile.id)
  const sendMode = getSendMode(body.sendMode)

  if (
    !UUID_PATTERN.test(operationId) ||
    !UUID_PATTERN.test(evaluationId) ||
    operationId !== evaluationId ||
    !UUID_PATTERN.test(clubId) ||
    !UUID_PATTERN.test(actorId) ||
    (teamId && !UUID_PATTERN.test(teamId)) ||
    (playerId && !UUID_PATTERN.test(playerId)) ||
    !sendMode
  ) {
    throw operationError(
      'The Development submission confirmation is not valid.',
      400,
      'DEVELOPMENT_SUBMISSION_CONFIRMATION_INVALID',
    )
  }

  const selectedParentLinkIds = uniqueIds(body.selectedParentLinkIds)

  const normalized = {
    operationId,
    evaluationId,
    clubId,
    teamId: teamId || null,
    playerId: playerId || null,
    actorId,
    sendMode,
    scheduledAt: normalizeScheduledAt(body.scheduledAt, sendMode),
    attachPdf: sendMode !== 'none' && body.attachPdf === true,
    includeAttendance: body.includeAttendance === true,
    selectedParentLinkIds,
    selectedResponseCount: Math.max(0, Math.min(Number(body.selectedResponseCount) || 0, 500)),
    reminderDate: normalizeReminderDate(body.reminderDate),
  }

  return {
    ...normalized,
    confirmationHash: createHash('sha256')
      .update(stableConfirmationPayload(normalized))
      .digest('hex'),
  }
}

export async function confirmDevelopmentSubmissionOperation(
  supabaseAdmin,
  {
    body,
    profile,
  } = {},
) {
  const confirmation = normalizeDevelopmentSubmissionConfirmation(body, profile)
  const { data, error } = await supabaseAdmin
    .from('development_submission_operations')
    .upsert({
      operation_id: confirmation.operationId,
      evaluation_id: confirmation.evaluationId,
      club_id: confirmation.clubId,
      team_id: confirmation.teamId,
      player_id: confirmation.playerId,
      actor_id: confirmation.actorId,
      send_mode: confirmation.sendMode,
      scheduled_at: confirmation.scheduledAt,
      attach_pdf: confirmation.attachPdf,
      include_attendance: confirmation.includeAttendance,
      selected_parent_link_ids: confirmation.selectedParentLinkIds,
      selected_response_count: confirmation.selectedResponseCount,
      reminder_date: confirmation.reminderDate,
      confirmation_hash: confirmation.confirmationHash,
      confirmed_at: new Date().toISOString(),
    }, {
      onConflict: 'operation_id',
    })
    .select('operation_id, evaluation_id, confirmation_hash, confirmed_at')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function assertDevelopmentSubmissionOperation(
  supabaseAdmin,
  {
    body,
    profile,
    outputContext,
  } = {},
) {
  const normalizedOutputContext = normalizeText(outputContext)
  if (!DEVELOPMENT_OUTPUT_CONTEXTS_REQUIRING_CONFIRMATION.has(normalizedOutputContext)) {
    return null
  }

  const operationId = normalizeText(body.submissionOperationId)
  const evaluationId = normalizeText(body.evaluationId)

  if (!UUID_PATTERN.test(operationId) || operationId !== evaluationId) {
    throw operationError(
      'Return to the Development record and complete the final submission review before sending.',
      409,
      'DEVELOPMENT_SUBMISSION_FINAL_CONFIRMATION_REQUIRED',
    )
  }

  const { data, error } = await supabaseAdmin
    .from('development_submission_operations')
    .select('operation_id, evaluation_id, club_id, team_id, player_id, actor_id, send_mode, scheduled_at, attach_pdf, include_attendance, selected_parent_link_ids, confirmation_hash, confirmed_at')
    .eq('operation_id', operationId)
    .maybeSingle()

  if (error) {
    throw error
  }

  const expectedSendMode = normalizeText(body.scheduledAt) ? 'scheduled' : 'now'
  const expectedScheduledAt = expectedSendMode === 'scheduled'
    ? normalizeScheduledAt(body.scheduledAt, expectedSendMode)
    : null
  const selectedLinkIds = uniqueIds(body.selectedParentLinkIds)
  const confirmedLinkIds = uniqueIds(data?.selected_parent_link_ids)
  const selectedLinksConfirmed = selectedLinkIds.every((linkId) => confirmedLinkIds.includes(linkId))

  if (
    !data ||
    normalizeText(data.evaluation_id) !== evaluationId ||
    normalizeText(data.club_id) !== normalizeText(profile.clubId) ||
    normalizeText(data.actor_id) !== normalizeText(profile.id) ||
    normalizeText(data.send_mode) !== expectedSendMode ||
    !sameTimestamp(data.scheduled_at, expectedScheduledAt) ||
    Boolean(data.attach_pdf) !== (body.attachPdf === true) ||
    Boolean(data.include_attendance) !== (body.includeAttendance === true) ||
    !selectedLinksConfirmed
  ) {
    throw operationError(
      'The Development output choices changed after final confirmation. Review and confirm them again.',
      409,
      'DEVELOPMENT_SUBMISSION_CONFIRMATION_MISMATCH',
    )
  }

  return data
}
