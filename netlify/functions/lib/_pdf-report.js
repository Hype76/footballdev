import {
  PDF_REPORT_TYPES,
  buildParentMessagePdfDocument,
  validatePdfDocument,
} from '../../../src/lib/pdf-document.js'
import { resolvePdfBranding } from './_pdf-branding.js'
import {
  assertPdfScope,
  normalizePdfText,
  pdfForbidden,
  pdfMissingResource,
} from './_pdf-authority.js'

const normalizeText = normalizePdfText
const forbidden = pdfForbidden
const missingResource = pdfMissingResource

export { assertPdfScope }

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

export async function authorizeAssessmentPdfReport({
  supabaseAdmin,
  profile,
  clubId,
  teamId = '',
  evaluationId = '',
  playerId = '',
  document,
  diagnostics = null,
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
  const { branding, scope } = await resolvePdfBranding({
    supabaseAdmin,
    profile,
    clubId: normalizedClubId,
    teamId: resourceTeamId,
    reportType: validatedDocument.reportType,
    diagnostics,
  })
  const authorizedDocument = validatePdfDocument({
    ...validatedDocument,
    context: {
      ...validatedDocument.context,
      clubName: branding.clubName,
      playerName: normalizeText(evaluation?.player_name || player?.player_name) || validatedDocument.context.playerName,
      teamName: branding.teamName || normalizeText(evaluation?.team || player?.team) || validatedDocument.context.teamName,
      section: normalizeText(evaluation?.section) || validatedDocument.context.section,
      session: normalizeText(evaluation?.session) || validatedDocument.context.session,
    },
  })

  return {
    branding,
    document: authorizedDocument,
    scope: {
      clubId: normalizeText(scope.club?.id),
      teamId: normalizeText(scope.team?.id),
    },
  }
}

export async function loadCommunicationPdfReport({
  supabaseAdmin,
  profile,
  clubId,
  communicationLogId,
  diagnostics = null,
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
  const { branding, scope } = await resolvePdfBranding({
    supabaseAdmin,
    profile,
    clubId: normalizedClubId,
    teamId: resourceTeamId,
    reportType: PDF_REPORT_TYPES.parentMessage,
    diagnostics,
  })

  if (diagnostics) {
    diagnostics.teamId = normalizeText(scope.team?.id)
    diagnostics.authorityResult = 'authorized'
    diagnostics.rendererStage = 'resource_resolved'
  }

  const assessmentFields = Array.isArray(metadata.assessmentFields)
    ? metadata.assessmentFields.map((item) => ({
        label: item?.label,
        value: item?.value,
      }))
    : []

  return {
    branding,
    document: buildParentMessagePdfDocument({
      clubName: branding.clubName,
      playerName: normalizeText(evaluation?.player_name || player?.player_name || metadata.playerName) || 'Player',
      teamName: branding.teamName || normalizeText(evaluation?.team || player?.team || metadata.team),
      subject: normalizeText(metadata.subject) || 'Parent message',
      body: normalizeText(metadata.body),
      assessmentFields,
    }),
    scope: {
      clubId: normalizeText(scope.club?.id),
      teamId: normalizeText(scope.team?.id),
    },
  }
}
