import { createHash } from 'node:crypto'
import { sanitizeAssessmentEmailSections } from '../../../src/lib/assessment-output-sanitizer.js'
import {
  buildPlayerProgressionData,
  buildProgressionEmailSections,
} from '../../../src/lib/player-progression.js'

const CLUB_WIDE_ROLE_RANK = 50
const DEFAULT_PARENT_VISIBLE_LABELS = new Set([
  'Technical',
  'Tactical',
  'Physical',
  'Mentality',
  'Coachability',
  'Strengths',
  'Improvements',
  'Overall Comments',
])
const SAFE_EMAIL_SECTION_KEYS = new Set(['attendanceSummary', 'progressionChart'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function normalizeDevelopmentRecipientEmail(value) {
  return normalizeText(value).toLowerCase()
}

export function isValidDevelopmentRecipientEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeDevelopmentRecipientEmail(value))
}

function outputError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function getGuardianName(guardian, link) {
  const name = [guardian?.first_name, guardian?.last_name]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ')

  return name || normalizeText(link?.relationship) || 'Parent or guardian'
}

function getGuardianById(guardians) {
  return new Map(
    (Array.isArray(guardians) ? guardians : [])
      .filter((guardian) => guardian?.id)
      .map((guardian) => [normalizeText(guardian.id), guardian]),
  )
}

export function resolveDevelopmentRecipientFromRows({
  evaluation,
  player,
  links = [],
  guardians = [],
} = {}) {
  const evaluationClubId = normalizeText(evaluation?.club_id)
  const evaluationTeamId = normalizeText(evaluation?.team_id || player?.team_id)
  const evaluationPlayerId = normalizeText(evaluation?.player_id || player?.id)
  const guardianById = getGuardianById(guardians)

  if (
    !evaluation?.id ||
    !player?.id ||
    !evaluationClubId ||
    normalizeText(player.club_id) !== evaluationClubId ||
    normalizeText(player.id) !== evaluationPlayerId ||
    (evaluationTeamId && normalizeText(player.team_id) !== evaluationTeamId)
  ) {
    return {
      outcome: 'no_recipient',
      code: 'DEVELOPMENT_PARENT_EMAIL_PLAYER_SCOPE_MISSING',
      recipient: null,
    }
  }

  const recipients = (Array.isArray(links) ? links : [])
    .filter((link) =>
      normalizeText(link?.club_id) === evaluationClubId &&
      normalizeText(link?.player_id) === evaluationPlayerId &&
      (!evaluationTeamId || normalizeText(link?.team_id) === evaluationTeamId) &&
      normalizeText(link?.status) === 'active' &&
      link?.receives_communications !== false)
    .map((link) => {
      const guardian = guardianById.get(normalizeText(link.guardian_id))
      const guardianIsUsable = !guardian || (
        normalizeText(guardian.club_id) === evaluationClubId &&
        normalizeText(guardian.status) === 'active'
      )
      const email = normalizeDevelopmentRecipientEmail(
        guardianIsUsable ? guardian?.email || link?.email : '',
      )

      if (!guardianIsUsable || !isValidDevelopmentRecipientEmail(email)) {
        return null
      }

      return {
        email,
        name: getGuardianName(guardian, link),
        primary: link?.primary_contact === true,
      }
    })
    .filter(Boolean)
    .sort((left, right) => Number(right.primary) - Number(left.primary) || left.email.localeCompare(right.email))

  const recipient = recipients[0]

  if (!recipient) {
    return {
      outcome: 'no_recipient',
      code: 'DEVELOPMENT_PARENT_EMAIL_NO_LINKED_RECIPIENT',
      recipient: null,
    }
  }

  return {
    outcome: 'ready',
    code: 'DEVELOPMENT_PARENT_EMAIL_RECIPIENT_RESOLVED',
    recipient,
  }
}

function getSnapshotFields(evaluation) {
  const snapshot = evaluation?.feedback_form_snapshot
  return Array.isArray(snapshot?.fields) ? snapshot.fields : []
}

function isParentVisibleField(field) {
  return field?.isDefault === true ||
    field?.is_default === true ||
    field?.parentVisible === true ||
    field?.parent_visible === true
}

function normalizeDevelopmentProgressionEvaluation(evaluation = {}) {
  return {
    ...evaluation,
    averageScore: evaluation.averageScore ?? evaluation.average_score,
    createdAt: evaluation.createdAt ?? evaluation.created_at,
    feedbackFormId: evaluation.feedbackFormId ?? evaluation.feedback_form_id,
    feedbackFormName: evaluation.feedbackFormName ?? evaluation.feedback_form_name,
    feedbackFormSnapshot: evaluation.feedbackFormSnapshot ?? evaluation.feedback_form_snapshot,
    formResponses: evaluation.formResponses ?? evaluation.form_responses ?? {},
  }
}

export function getParentVisibleDevelopmentResponses(evaluation, requestedResponses = []) {
  const savedResponses = evaluation?.form_responses && typeof evaluation.form_responses === 'object'
    ? evaluation.form_responses
    : {}
  const snapshotFields = getSnapshotFields(evaluation)
  const allowedLabels = snapshotFields.length > 0
    ? new Set(snapshotFields.filter(isParentVisibleField).map((field) => normalizeText(field?.label)).filter(Boolean))
    : DEFAULT_PARENT_VISIBLE_LABELS

  return (Array.isArray(requestedResponses) ? requestedResponses : [])
    .map((item) => {
      const label = normalizeText(item?.label)

      if (!label || !allowedLabels.has(label) || !Object.hasOwn(savedResponses, label)) {
        return null
      }

      const value = savedResponses[label]
      const hasValue = typeof value === 'number'
        ? Number.isFinite(value)
        : Boolean(normalizeText(value))

      return hasValue ? { label, value } : null
    })
    .filter(Boolean)
}

export function getParentVisibleDevelopmentEmailSections({
  evaluation,
  evaluations = [],
  requestedSections = [],
} = {}) {
  const requestedKeys = new Set(
    sanitizeAssessmentEmailSections(requestedSections)
      .map((section) => normalizeText(section?.key))
      .filter((key) => SAFE_EMAIL_SECTION_KEYS.has(key)),
  )
  const progressionData = buildPlayerProgressionData({
    evaluations: evaluations.map(normalizeDevelopmentProgressionEvaluation),
    staffNotes: [],
    fields: getSnapshotFields(evaluation),
  })
  const authoritativeSections = buildProgressionEmailSections({
    progressionData,
    sections: {
      latestSessionNotes: false,
      attendanceSummary: requestedKeys.has('attendanceSummary'),
      progressionChart: requestedKeys.has('progressionChart'),
      coachComments: false,
      matchNotes: false,
      nextFocusAreas: false,
    },
  })

  return sanitizeAssessmentEmailSections(authoritativeSections)
    .filter((section) => SAFE_EMAIL_SECTION_KEYS.has(normalizeText(section?.key)))
    .map((section) => ({
      key: normalizeText(section.key),
      title: normalizeText(section.title),
      body: normalizeText(section.body),
      ...(Array.isArray(section.chartPoints) ? { chartPoints: section.chartPoints } : {}),
    }))
}

function createDevelopmentOutputKey(evaluationId, recipientEmail) {
  return createHash('sha256')
    .update(`development-parent-email:${normalizeText(evaluationId)}:${normalizeDevelopmentRecipientEmail(recipientEmail)}`)
    .digest('hex')
}

async function loadOne(query, notFoundCode) {
  const { data, error } = await query

  if (error) {
    throw error
  }

  if (!data) {
    throw outputError('This Development Record is not available.', 404, notFoundCode)
  }

  return data
}

async function assertDevelopmentOutputScope(supabaseAdmin, profile, evaluation) {
  const profileClubId = normalizeText(profile?.clubId)
  const evaluationClubId = normalizeText(evaluation?.club_id)
  const evaluationTeamId = normalizeText(evaluation?.team_id)

  if (
    !profile?.id ||
    !evaluationClubId ||
    (normalizeText(profile.role) !== 'super_admin' && profileClubId !== evaluationClubId)
  ) {
    throw outputError('This Development Record is not available.', 403, 'DEVELOPMENT_PARENT_EMAIL_CROSS_CLUB_DENIED')
  }

  if (normalizeText(profile.role) === 'super_admin' || Number(profile.roleRank ?? 0) >= CLUB_WIDE_ROLE_RANK) {
    return
  }

  if (!evaluationTeamId) {
    throw outputError('This Development Record is not available.', 403, 'DEVELOPMENT_PARENT_EMAIL_TEAM_SCOPE_DENIED')
  }

  const assignment = await loadOne(
    supabaseAdmin
      .from('team_staff')
      .select('team_id')
      .eq('team_id', evaluationTeamId)
      .eq('user_id', profile.id)
      .maybeSingle(),
    'DEVELOPMENT_PARENT_EMAIL_TEAM_SCOPE_DENIED',
  )

  if (normalizeText(assignment.team_id) !== evaluationTeamId) {
    throw outputError('This Development Record is not available.', 403, 'DEVELOPMENT_PARENT_EMAIL_TEAM_SCOPE_DENIED')
  }
}

export async function loadDevelopmentParentEmailContext(
  supabaseAdmin,
  {
    evaluationId,
    profile,
  } = {},
) {
  const normalizedEvaluationId = normalizeText(evaluationId)

  if (!normalizedEvaluationId) {
    throw outputError('This Development Record is not available.', 400, 'DEVELOPMENT_PARENT_EMAIL_ID_REQUIRED')
  }

  const evaluation = await loadOne(
    supabaseAdmin
      .from('evaluations')
      .select('id, club_id, team_id, player_id, player_name, team, section, session, form_responses, feedback_form_snapshot')
      .eq('id', normalizedEvaluationId)
      .maybeSingle(),
    'DEVELOPMENT_PARENT_EMAIL_NOT_FOUND',
  )

  await assertDevelopmentOutputScope(supabaseAdmin, profile, evaluation)

  const player = await loadOne(
    supabaseAdmin
      .from('players')
      .select('id, club_id, team_id, player_name, team')
      .eq('id', evaluation.player_id)
      .eq('club_id', evaluation.club_id)
      .maybeSingle(),
    'DEVELOPMENT_PARENT_EMAIL_PLAYER_NOT_FOUND',
  )
  const { data: links, error: linksError } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, player_id, guardian_id, email, relationship, primary_contact, receives_communications, status')
    .eq('player_id', player.id)

  if (linksError) {
    throw linksError
  }

  let evaluationHistoryQuery = supabaseAdmin
    .from('evaluations')
    .select('id, club_id, team_id, player_id, player_name, team, section, session, date, created_at, scores, average_score, comments, form_responses, feedback_form_id, feedback_form_name, feedback_form_snapshot')
    .eq('club_id', evaluation.club_id)
    .eq('player_id', player.id)
    .order('created_at', { ascending: true })
    .limit(100)

  if (evaluation.team_id || player.team_id) {
    evaluationHistoryQuery = evaluationHistoryQuery.eq('team_id', evaluation.team_id || player.team_id)
  }

  const { data: evaluations, error: evaluationsError } = await evaluationHistoryQuery

  if (evaluationsError) {
    throw evaluationsError
  }

  const guardianIds = Array.from(new Set(
    (links ?? []).map((link) => normalizeText(link.guardian_id)).filter(Boolean),
  ))
  let guardians = []

  if (guardianIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('guardians')
      .select('id, club_id, first_name, last_name, email, status')
      .in('id', guardianIds)

    if (error) {
      throw error
    }

    guardians = data ?? []
  }

  const recipientResolution = resolveDevelopmentRecipientFromRows({
    evaluation,
    player,
    links,
    guardians,
  })

  if (recipientResolution.outcome === 'no_recipient') {
    return {
      ...recipientResolution,
      evaluation,
      player,
    }
  }

  const [{ data: club, error: clubError }, { data: team, error: teamError }] = await Promise.all([
    supabaseAdmin
      .from('clubs')
      .select('id, name, contact_email, logo_url')
      .eq('id', evaluation.club_id)
      .maybeSingle(),
    supabaseAdmin
      .from('teams')
      .select('id, club_id, name')
      .eq('id', evaluation.team_id || player.team_id)
      .eq('club_id', evaluation.club_id)
      .maybeSingle(),
  ])

  if (clubError || teamError) {
    throw clubError || teamError
  }

  if (!club?.id || !team?.id) {
    throw outputError('This Development Record is not available.', 404, 'DEVELOPMENT_PARENT_EMAIL_SCOPE_NOT_FOUND')
  }

  return {
    ...recipientResolution,
    evaluation,
    player,
    club,
    team,
    evaluations: evaluations ?? [evaluation],
    outputKey: createDevelopmentOutputKey(evaluation.id, recipientResolution.recipient.email),
  }
}
