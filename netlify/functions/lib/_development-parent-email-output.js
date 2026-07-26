import { createHash } from 'node:crypto'
import { sanitizeAssessmentEmailSections } from '../../../src/lib/assessment-output-sanitizer.js'
import {
  buildPlayerProgressionData,
  buildProgressionEmailSections,
} from '../../../src/lib/player-progression.js'
import {
  isValidDevelopmentParentRecipientEmail,
  getDevelopmentParentRecipientCandidates,
  normalizeDevelopmentParentRecipientEmail,
  resolveSelectedDevelopmentParentRecipients,
} from '../../../src/lib/development-parent-recipient-contract.js'
import {
  applyDevelopmentParentContactResolution,
} from '../../../src/lib/development-parent-contact-resolution.js'

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

export const normalizeDevelopmentRecipientEmail = normalizeDevelopmentParentRecipientEmail
export const isValidDevelopmentRecipientEmail = isValidDevelopmentParentRecipientEmail

function outputError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

export function resolveDevelopmentRecipientsFromRows({
  evaluation,
  player,
  links = [],
  selectedParentLinkIds = [],
} = {}) {
  const evaluationClubId = normalizeText(evaluation?.club_id)
  const evaluationTeamId = normalizeText(evaluation?.team_id || player?.team_id)
  const evaluationPlayerId = normalizeText(evaluation?.player_id || player?.id)

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
      recipients: [],
      unavailableLinkIds: [],
    }
  }

  return resolveSelectedDevelopmentParentRecipients({
    links,
    clubId: evaluationClubId,
    teamId: evaluationTeamId,
    playerId: evaluationPlayerId,
    parentContacts: player?.parent_contacts,
    selectedParentLinkIds,
  })
}

export function resolveDevelopmentRecipientFromRows(args = {}) {
  const result = resolveDevelopmentRecipientsFromRows(args)
  return {
    ...result,
    recipient: result.recipients?.[0] ?? null,
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

export function createDevelopmentOutputKey(evaluationId, recipientLinkId) {
  return createHash('sha256')
    .update(`development-parent-email:${normalizeText(evaluationId)}:${normalizeText(recipientLinkId)}`)
    .digest('hex')
}

export function createDevelopmentOutputQueueId(outputKey) {
  const source = normalizeText(outputKey).padEnd(32, '0').slice(0, 32).split('')
  source[12] = '5'
  source[16] = ((Number.parseInt(source[16], 16) || 0) & 0x3 | 0x8).toString(16)
  const hex = source.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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

function uniqueIds(values = []) {
  return [
    ...new Set(
      values
        .map(normalizeText)
        .filter(Boolean),
    ),
  ]
}

async function loadDevelopmentParentContactSources(supabaseAdmin, links = []) {
  const guardianIds = uniqueIds(links.map((link) => link.guardian_id))
  const authUserIds = uniqueIds(links.map((link) => link.auth_user_id))
  const [guardianResult, profileResult, authResults] = await Promise.all([
    guardianIds.length > 0
      ? supabaseAdmin
          .from('guardians')
          .select('id, club_id, first_name, last_name, email, status')
          .in('id', guardianIds)
      : Promise.resolve({ data: [], error: null }),
    authUserIds.length > 0
      ? supabaseAdmin
          .from('users')
          .select('id, club_id, email, name, display_name, role, status')
          .in('id', authUserIds)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(
      authUserIds.map(async (authUserId) => {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId)
        return {
          authUserId,
          error,
          user: data?.user ?? null,
        }
      }),
    ),
  ])

  if (guardianResult.error || profileResult.error) {
    throw guardianResult.error || profileResult.error
  }

  const guardiansById = new Map((guardianResult.data ?? []).map((row) => [normalizeText(row.id), row]))
  const profilesById = new Map((profileResult.data ?? []).map((row) => [normalizeText(row.id), row]))
  const authUsersById = new Map()

  authResults.forEach(({ authUserId, error, user }) => {
    if (error && !profilesById.has(authUserId)) {
      throw error
    }

    if (user) {
      authUsersById.set(authUserId, user)
    }
  })

  return links.map((link) =>
    applyDevelopmentParentContactResolution({
      link,
      guardian: guardiansById.get(normalizeText(link.guardian_id)),
      parentProfile: profilesById.get(normalizeText(link.auth_user_id)),
      authUser: authUsersById.get(normalizeText(link.auth_user_id)),
    }))
}

async function loadDevelopmentParentLinks(
  supabaseAdmin,
  {
    clubId,
    teamId,
    playerId,
  } = {},
) {
  let linkQuery = supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, player_id, guardian_id, auth_user_id, email, relationship, primary_contact, receives_communications, status, accepted_at, created_at')
    .eq('club_id', clubId)
    .eq('player_id', playerId)

  if (normalizeText(teamId)) {
    linkQuery = linkQuery.or(`team_id.eq.${normalizeText(teamId)},team_id.is.null`)
  } else {
    linkQuery = linkQuery.is('team_id', null)
  }

  const { data, error } = await linkQuery.order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return loadDevelopmentParentContactSources(supabaseAdmin, data ?? [])
}

export async function loadDevelopmentParentRecipientCandidates(
  supabaseAdmin,
  {
    profile,
    playerId,
    teamId,
  } = {},
) {
  const normalizedPlayerId = normalizeText(playerId)
  const profileClubId = normalizeText(profile?.clubId)

  if (
    !normalizedPlayerId ||
    !profileClubId ||
    normalizeText(profile?.role) === 'super_admin'
  ) {
    throw outputError(
      'Development parent recipients are not available.',
      403,
      'DEVELOPMENT_PARENT_RECIPIENTS_SCOPE_DENIED',
    )
  }

  const player = await loadOne(
    supabaseAdmin
      .from('players')
      .select('id, club_id, team_id, parent_contacts')
      .eq('id', normalizedPlayerId)
      .eq('club_id', profileClubId)
      .maybeSingle(),
    'DEVELOPMENT_PARENT_EMAIL_PLAYER_NOT_FOUND',
  )
  const resolvedTeamId = normalizeText(player.team_id)

  if (normalizeText(teamId) && normalizeText(teamId) !== resolvedTeamId) {
    throw outputError(
      'Development parent recipients are not available.',
      403,
      'DEVELOPMENT_PARENT_RECIPIENTS_TEAM_DENIED',
    )
  }

  await assertDevelopmentOutputScope(supabaseAdmin, profile, {
    club_id: player.club_id,
    team_id: resolvedTeamId,
  })

  const links = await loadDevelopmentParentLinks(supabaseAdmin, {
    clubId: player.club_id,
    teamId: resolvedTeamId,
    playerId: player.id,
  })

  return getDevelopmentParentRecipientCandidates({
    links,
    clubId: player.club_id,
    teamId: resolvedTeamId,
    playerId: player.id,
    parentContacts: player.parent_contacts,
  }).filter((candidate) => candidate.eligible)
}

export async function loadDevelopmentParentEmailContext(
  supabaseAdmin,
  {
    evaluationId,
    profile,
    selectedParentLinkIds = [],
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
      .select('id, club_id, team_id, player_name, team, parent_contacts')
      .eq('id', evaluation.player_id)
      .eq('club_id', evaluation.club_id)
      .maybeSingle(),
    'DEVELOPMENT_PARENT_EMAIL_PLAYER_NOT_FOUND',
  )
  const links = await loadDevelopmentParentLinks(supabaseAdmin, {
    clubId: evaluation.club_id,
    teamId: evaluation.team_id || player.team_id,
    playerId: player.id,
  })

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

  const recipientResolution = resolveDevelopmentRecipientsFromRows({
    evaluation,
    player,
    links,
    selectedParentLinkIds,
  })

  if (recipientResolution.outcome === 'no_recipient') {
    return {
      ...recipientResolution,
      evaluation,
      player,
    }
  }

  if (recipientResolution.recipients.length !== 1) {
    throw outputError(
      'Send one selected parent recipient per request.',
      400,
      'DEVELOPMENT_PARENT_EMAIL_ONE_RECIPIENT_PER_REQUEST',
    )
  }

  const recipient = recipientResolution.recipients[0]
  const outputKey = createDevelopmentOutputKey(evaluation.id, recipient.linkId)

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
    recipient,
    outputKey,
    outputQueueId: createDevelopmentOutputQueueId(outputKey),
  }
}
