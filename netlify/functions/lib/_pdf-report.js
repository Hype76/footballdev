import {
  PDF_REPORT_TYPES,
  buildParentMessagePdfDocument,
  validatePdfDocument,
} from '../../../src/lib/pdf-document.js'

const CLUB_WIDE_ROLE_RANK = 50

function normalizeText(value) {
  return String(value ?? '').trim()
}

function forbidden(code = 'PDF_SCOPE_DENIED') {
  throw Object.assign(new Error('This PDF report is not available.'), {
    code,
    statusCode: 403,
  })
}

function missingResource() {
  throw Object.assign(new Error('This PDF report is not available.'), {
    code: 'PDF_REPORT_NOT_FOUND',
    statusCode: 404,
  })
}

export function assertPdfScope({
  profile,
  targetClubId,
  targetTeamId = '',
  teamExists = true,
  teamAssigned = false,
} = {}) {
  const actorId = normalizeText(profile?.id)
  const actorClubId = normalizeText(profile?.clubId)
  const actorRole = normalizeText(profile?.role)
  const actorRank = Number(profile?.roleRank ?? 0)
  const clubId = normalizeText(targetClubId)
  const teamId = normalizeText(targetTeamId)

  if (!actorId || !clubId) {
    forbidden()
  }

  if (actorRole !== 'super_admin' && actorClubId !== clubId) {
    forbidden('PDF_CROSS_CLUB_DENIED')
  }

  if (teamId && !teamExists) {
    forbidden('PDF_CROSS_TEAM_DENIED')
  }

  if (actorRole === 'super_admin' || actorRank >= CLUB_WIDE_ROLE_RANK) {
    return true
  }

  if (!teamId || !teamAssigned) {
    forbidden('PDF_CROSS_TEAM_DENIED')
  }

  return true
}

async function loadTeamScope(supabaseAdmin, { profile, clubId, teamId }) {
  const normalizedTeamId = normalizeText(teamId)

  if (!normalizedTeamId) {
    assertPdfScope({ profile, targetClubId: clubId })
    return { id: '', name: '', teamAssigned: false }
  }

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, club_id, name')
    .eq('id', normalizedTeamId)
    .eq('club_id', clubId)
    .maybeSingle()

  if (teamError) {
    throw teamError
  }

  let teamAssigned = false

  if (team?.id && normalizeText(profile.role) !== 'super_admin' && Number(profile.roleRank ?? 0) < CLUB_WIDE_ROLE_RANK) {
    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from('team_staff')
      .select('team_id')
      .eq('team_id', team.id)
      .eq('user_id', profile.id)
      .maybeSingle()

    if (assignmentError) {
      throw assignmentError
    }

    teamAssigned = Boolean(assignment?.team_id)
  }

  assertPdfScope({
    profile,
    targetClubId: clubId,
    targetTeamId: normalizedTeamId,
    teamExists: Boolean(team?.id),
    teamAssigned,
  })

  return {
    id: normalizeText(team?.id),
    name: normalizeText(team?.name),
    teamAssigned,
  }
}

async function loadClubName(supabaseAdmin, clubId) {
  const { data: club, error } = await supabaseAdmin
    .from('clubs')
    .select('id, name')
    .eq('id', clubId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!club?.id) {
    missingResource()
  }

  return normalizeText(club.name) || 'Club'
}

async function loadEvaluation(supabaseAdmin, evaluationId, clubId) {
  const normalizedEvaluationId = normalizeText(evaluationId)

  if (!normalizedEvaluationId) {
    return null
  }

  const { data: evaluation, error } = await supabaseAdmin
    .from('evaluations')
    .select('id, club_id, team_id, player_id, player_name, team, section, session')
    .eq('id', normalizedEvaluationId)
    .eq('club_id', clubId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!evaluation?.id) {
    missingResource()
  }

  return evaluation
}

async function loadPlayer(supabaseAdmin, playerId, clubId) {
  const normalizedPlayerId = normalizeText(playerId)

  if (!normalizedPlayerId) {
    return null
  }

  const { data: player, error } = await supabaseAdmin
    .from('players')
    .select('id, club_id, team_id, player_name, team')
    .eq('id', normalizedPlayerId)
    .eq('club_id', clubId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!player?.id) {
    missingResource()
  }

  return player
}

export async function authorizeAssessmentPdfDocument({
  supabaseAdmin,
  profile,
  clubId,
  teamId = '',
  evaluationId = '',
  playerId = '',
  document,
}) {
  const validatedDocument = validatePdfDocument(document)

  if (validatedDocument.reportType !== PDF_REPORT_TYPES.assessment) {
    forbidden('PDF_REPORT_TYPE_DENIED')
  }

  const normalizedClubId = normalizeText(clubId)
  const evaluation = await loadEvaluation(supabaseAdmin, evaluationId, normalizedClubId)
  const player = evaluation?.player_id
    ? await loadPlayer(supabaseAdmin, evaluation.player_id, normalizedClubId)
    : await loadPlayer(supabaseAdmin, playerId, normalizedClubId)
  const resourceTeamId = normalizeText(evaluation?.team_id || player?.team_id || teamId)
  const [clubName, team] = await Promise.all([
    loadClubName(supabaseAdmin, normalizedClubId),
    loadTeamScope(supabaseAdmin, {
      profile,
      clubId: normalizedClubId,
      teamId: resourceTeamId,
    }),
  ])

  return validatePdfDocument({
    ...validatedDocument,
    context: {
      ...validatedDocument.context,
      clubName,
      playerName: normalizeText(evaluation?.player_name || player?.player_name) || validatedDocument.context.playerName,
      teamName: team.name || normalizeText(evaluation?.team || player?.team) || validatedDocument.context.teamName,
      section: normalizeText(evaluation?.section) || validatedDocument.context.section,
      session: normalizeText(evaluation?.session) || validatedDocument.context.session,
    },
  })
}

export async function loadCommunicationPdfDocument({
  supabaseAdmin,
  profile,
  clubId,
  communicationLogId,
}) {
  const normalizedClubId = normalizeText(clubId)
  const normalizedLogId = normalizeText(communicationLogId)

  if (!normalizedLogId) {
    missingResource()
  }

  const { data: log, error } = await supabaseAdmin
    .from('communication_logs')
    .select('id, club_id, player_id, evaluation_id, channel, action, metadata')
    .eq('id', normalizedLogId)
    .eq('club_id', normalizedClubId)
    .maybeSingle()

  if (error) {
    throw error
  }

  const metadata = log?.metadata && typeof log.metadata === 'object' ? log.metadata : {}

  if (
    !log?.id ||
    normalizeText(log.channel) !== 'email' ||
    !['parent_email_sent', 'parent_email_scheduled'].includes(normalizeText(log.action)) ||
    metadata.hasAttachment !== true
  ) {
    missingResource()
  }

  const evaluation = await loadEvaluation(supabaseAdmin, log.evaluation_id, normalizedClubId)
  const player = evaluation?.player_id
    ? await loadPlayer(supabaseAdmin, evaluation.player_id, normalizedClubId)
    : await loadPlayer(supabaseAdmin, log.player_id, normalizedClubId)
  const resourceTeamId = normalizeText(evaluation?.team_id || player?.team_id)
  const [clubName, team] = await Promise.all([
    loadClubName(supabaseAdmin, normalizedClubId),
    loadTeamScope(supabaseAdmin, {
      profile,
      clubId: normalizedClubId,
      teamId: resourceTeamId,
    }),
  ])

  return buildParentMessagePdfDocument({
    clubName,
    playerName: normalizeText(evaluation?.player_name || player?.player_name || metadata.playerName) || 'Player',
    teamName: team.name || normalizeText(evaluation?.team || player?.team || metadata.team),
    subject: normalizeText(metadata.subject) || 'Parent message',
    body: normalizeText(metadata.body),
    assessmentFields: Array.isArray(metadata.assessmentFields) ? metadata.assessmentFields : [],
  })
}
