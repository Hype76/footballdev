import { createHash } from 'node:crypto'
import { sanitizeAssessmentEmailSections } from '../../../src/lib/assessment-output-sanitizer.js'
import {
  buildPlayerProgressionData,
  buildProgressionEmailSections,
} from '../../../src/lib/player-progression.js'
import {
  getAssessmentScoreMax,
  isAssessmentScoreFieldType,
} from '../../../src/lib/assessment-scoring.js'
import {
  normalizeDevelopmentScorePresentation,
} from '../../../src/lib/development-score-contract.js'
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
const DEFAULT_PARENT_VISIBLE_FIELD_TYPES = new Map([
  ['Technical', 'score_1_10'],
  ['Tactical', 'score_1_10'],
  ['Physical', 'score_1_10'],
  ['Mentality', 'score_1_10'],
  ['Coachability', 'score_1_10'],
  ['Strengths', 'textarea'],
  ['Improvements', 'textarea'],
  ['Overall Comments', 'textarea'],
])
const SAFE_EMAIL_SECTION_KEYS = new Set(['attendanceSummary', 'progressionChart'])
const DEVELOPMENT_PARENT_REPORT_VERSION = 1

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

function isParentOutputEligibleField(field, explicitlySelected = false) {
  return isParentVisibleField(field) ||
    (explicitlySelected && isAssessmentScoreFieldType(normalizeText(field?.type)))
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
  const requestedItems = Array.isArray(requestedResponses) ? requestedResponses : []
  const requestedFieldIds = new Set(
    requestedItems.map((item) => normalizeText(item?.fieldId || item?.field_id)).filter(Boolean),
  )
  const requestedLabels = new Set(
    requestedItems.map((item) => normalizeText(item?.label)).filter(Boolean),
  )
  const allowedLabels = snapshotFields.length > 0
    ? new Set(
        snapshotFields
          .filter((field) => {
            const explicitlySelected =
              requestedFieldIds.has(normalizeText(field?.id)) ||
              requestedLabels.has(normalizeText(field?.label))
            return isParentOutputEligibleField(field, explicitlySelected)
          })
          .map((field) => normalizeText(field?.label))
          .filter(Boolean),
      )
    : DEFAULT_PARENT_VISIBLE_LABELS

  return requestedItems
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
    (Array.isArray(requestedSections) ? requestedSections : [])
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

function normalizeStoredValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : ''
  }

  if (typeof value === 'boolean') {
    return value
  }

  return normalizeText(value)
}

function hasStoredValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (typeof value === 'boolean') {
    return true
  }

  return Boolean(normalizeText(value))
}

function getAuthoritativeFieldValue(evaluation, field) {
  const savedResponses = evaluation?.form_responses && typeof evaluation.form_responses === 'object'
    ? evaluation.form_responses
    : {}
  const label = normalizeText(field?.label)

  if (label && Object.hasOwn(savedResponses, label)) {
    return normalizeStoredValue(savedResponses[label])
  }

  return normalizeStoredValue(field?.value)
}

function formatDevelopmentFieldValue(field, value) {
  const type = normalizeText(field?.type)

  if (isAssessmentScoreFieldType(type)) {
    return normalizeDevelopmentScorePresentation({
      type,
      rawValue: value,
      maxScore: getAssessmentScoreMax(type),
    })
  }

  return {
    displayValue: normalizeText(value),
    numericScore: null,
    maxScore: null,
    ratingLabel: '',
  }
}

function normalizeReportRecipient(recipient = {}) {
  return {
    linkId: normalizeText(recipient.linkId),
    name: normalizeText(recipient.name) || 'Parent or guardian',
  }
}

function getRequestedFieldSelection(requestedResponses) {
  if (!Array.isArray(requestedResponses)) {
    return null
  }

  return requestedResponses.slice(0, 200).map((item) => ({
    fieldId: normalizeText(item?.fieldId || item?.field_id),
    label: normalizeText(item?.label),
  }))
}

function getLegacyDefaultSnapshotFields(evaluation, requestedSelection) {
  const savedResponses = evaluation?.form_responses && typeof evaluation.form_responses === 'object'
    ? evaluation.form_responses
    : {}
  const selections = requestedSelection === null
    ? [...DEFAULT_PARENT_VISIBLE_LABELS].map((label) => ({ fieldId: '', label }))
    : requestedSelection

  return selections
    .filter((selection) =>
      DEFAULT_PARENT_VISIBLE_LABELS.has(selection.label) &&
      Object.hasOwn(savedResponses, selection.label),
    )
    .map((selection, index) => ({
      id: selection.fieldId || `default-development-field-${index + 1}`,
      label: selection.label,
      type: DEFAULT_PARENT_VISIBLE_FIELD_TYPES.get(selection.label) || 'text',
      isDefault: true,
      isEnabled: true,
      orderIndex: index + 1,
      parentVisible: true,
    }))
}

export function resolveDevelopmentParentReport({
  club,
  evaluation,
  evaluations = [],
  player,
  recipients = [],
  requestedResponses,
  requestedSections = [],
  team,
} = {}) {
  const snapshot = evaluation?.feedback_form_snapshot &&
    typeof evaluation.feedback_form_snapshot === 'object'
    ? evaluation.feedback_form_snapshot
    : {}
  const snapshotFields = Array.isArray(snapshot.fields) ? snapshot.fields : []
  const requestedSelection = getRequestedFieldSelection(requestedResponses)
  const authoritativeFields = snapshotFields.length > 0
    ? snapshotFields
    : getLegacyDefaultSnapshotFields(evaluation, requestedSelection)
  const selectedFields = requestedSelection === null
    ? authoritativeFields.filter(isParentVisibleField)
    : requestedSelection
        .map((selection) =>
          authoritativeFields.find((field) =>
            (selection.fieldId && normalizeText(field?.id) === selection.fieldId) ||
            (!selection.fieldId && selection.label && normalizeText(field?.label) === selection.label),
          ),
        )
        .filter(Boolean)
  const uniqueFields = selectedFields.filter((field, index, fields) => {
    const fieldId = normalizeText(field?.id)
    const label = normalizeText(field?.label)
    return fields.findIndex((candidate) =>
      (fieldId && normalizeText(candidate?.id) === fieldId) ||
      (!fieldId && label && normalizeText(candidate?.label) === label),
    ) === index
  })
  const responseItems = uniqueFields
    .map((field, index) => {
      if (!isParentOutputEligibleField(field, requestedSelection !== null)) {
        return null
      }

      const rawValue = getAuthoritativeFieldValue(evaluation, field)
      if (!hasStoredValue(rawValue)) {
        return null
      }

      const formatted = formatDevelopmentFieldValue(field, rawValue)

      return {
        fieldId: normalizeText(field?.id) || `snapshot-field-${index + 1}`,
        label: normalizeText(field?.label),
        type: normalizeText(field?.type) || 'text',
        rawValue,
        displayValue: formatted.displayValue,
        numericScore: formatted.numericScore,
        maxScore: formatted.maxScore,
        ratingLabel: formatted.ratingLabel,
        order: Number(field?.orderIndex ?? field?.order_index ?? index + 1) || index + 1,
        parentVisible: true,
        selected: true,
      }
    })
    .filter(Boolean)
  const emailSections = getParentVisibleDevelopmentEmailSections({
    evaluation,
    evaluations,
    requestedSections,
  })
  const normalizedRecipients = recipients
    .map(normalizeReportRecipient)
    .filter((recipient) => recipient.linkId)
    .filter((recipient, index, items) =>
      items.findIndex((candidate) => candidate.linkId === recipient.linkId) === index,
    )

  return {
    version: DEVELOPMENT_PARENT_REPORT_VERSION,
    finalizedAt: new Date().toISOString(),
    historyCutoffAt: normalizeText(evaluation?.created_at),
    evaluationId: normalizeText(evaluation?.id),
    club: {
      id: normalizeText(evaluation?.club_id || club?.id),
      name: normalizeText(club?.name),
    },
    team: {
      id: normalizeText(evaluation?.team_id || team?.id),
      name: normalizeText(team?.name || evaluation?.team),
    },
    player: {
      id: normalizeText(evaluation?.player_id || player?.id),
      name: normalizeText(evaluation?.player_name || player?.player_name),
    },
    author: {
      id: normalizeText(evaluation?.coach_id),
      name: normalizeText(evaluation?.created_by_name || evaluation?.coach),
    },
    section: normalizeText(evaluation?.section),
    recordDate: normalizeText(evaluation?.date),
    form: {
      id: normalizeText(evaluation?.feedback_form_id || snapshot?.formId || snapshot?.form_id),
      name: normalizeText(evaluation?.feedback_form_name || snapshot?.formName || snapshot?.form_name),
      version: Number(evaluation?.feedback_form_version || snapshot?.formVersion || snapshot?.form_version || 1) || 1,
      templateKey: normalizeText(snapshot?.templateKey || snapshot?.template_key),
    },
    recipients: normalizedRecipients,
    responseItems,
    overallScore: evaluation?.average_score !== null &&
      evaluation?.average_score !== undefined &&
      normalizeText(evaluation.average_score) &&
      Number.isFinite(Number(evaluation.average_score))
      ? Number(evaluation.average_score)
      : null,
    overallMaxScore: (() => {
      const maxima = authoritativeFields
        .filter((field) => isAssessmentScoreFieldType(normalizeText(field?.type)))
        .map((field) => getAssessmentScoreMax(normalizeText(field.type)))
        .filter((value, index, values) => value > 0 && values.indexOf(value) === index)

      return maxima.length === 1 ? maxima[0] : null
    })(),
    attendanceIncluded: emailSections.some((section) => section.key === 'attendanceSummary'),
    progressionIncluded: emailSections.some((section) => section.key === 'progressionChart'),
    emailSections,
  }
}

export function isDevelopmentParentReportSnapshot(value) {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Number(value.version) === DEVELOPMENT_PARENT_REPORT_VERSION &&
    Array.isArray(value.responseItems) &&
    Array.isArray(value.emailSections)
}

export function getDevelopmentParentReport({
  context,
  requestedResponses,
  requestedSections,
} = {}) {
  if (isDevelopmentParentReportSnapshot(context?.evaluation?.development_parent_report)) {
    return context.evaluation.development_parent_report
  }

  return resolveDevelopmentParentReport({
    club: context?.club,
    evaluation: context?.evaluation,
    evaluations: context?.evaluations,
    player: context?.player,
    recipients: context?.recipient ? [context.recipient] : [],
    requestedResponses,
    requestedSections,
    team: context?.team,
  })
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

export async function loadDevelopmentParentReportContext(
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
      .select('id, club_id, team_id, player_id, player_name, team, section, session, date, created_at, coach_id, coach, created_by_name, scores, average_score, comments, form_responses, feedback_form_id, feedback_form_name, feedback_form_version, feedback_form_snapshot')
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
    .lte('created_at', evaluation.created_at)
    .order('created_at', { ascending: true })
    .limit(100)

  if (evaluation.team_id || player.team_id) {
    evaluationHistoryQuery = evaluationHistoryQuery.eq('team_id', evaluation.team_id || player.team_id)
  }

  const { data: evaluations, error: evaluationsError } = await evaluationHistoryQuery

  if (evaluationsError) {
    throw evaluationsError
  }

  const { data: reportRow, error: reportError } = await supabaseAdmin
    .from('development_parent_reports')
    .select('evaluation_id, report_snapshot')
    .eq('evaluation_id', evaluation.id)
    .eq('club_id', evaluation.club_id)
    .maybeSingle()

  if (reportError) {
    throw reportError
  }

  evaluation.development_parent_report = reportRow?.report_snapshot ?? {}

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
    evaluation,
    player,
    club,
    team,
    links,
    evaluations: evaluations ?? [evaluation],
  }
}

export async function loadDevelopmentParentEmailContext(
  supabaseAdmin,
  {
    evaluationId,
    profile,
    selectedParentLinkIds = [],
  } = {},
) {
  const context = await loadDevelopmentParentReportContext(supabaseAdmin, {
    evaluationId,
    profile,
  })
  const recipientResolution = resolveDevelopmentRecipientsFromRows({
    evaluation: context.evaluation,
    player: context.player,
    links: context.links,
    selectedParentLinkIds,
  })

  if (recipientResolution.outcome === 'no_recipient') {
    return {
      ...context,
      ...recipientResolution,
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
  const outputKey = createDevelopmentOutputKey(context.evaluation.id, recipient.linkId)

  return {
    ...context,
    ...recipientResolution,
    recipient,
    outputKey,
    outputQueueId: createDevelopmentOutputQueueId(outputKey),
  }
}

export async function finalizeDevelopmentParentReportSnapshot(
  supabaseAdmin,
  {
    evaluationId,
    includeAttendance = false,
    includeProgression = true,
    profile,
    requestedResponses,
    selectedParentLinkIds = [],
  } = {},
) {
  const context = await loadDevelopmentParentReportContext(supabaseAdmin, {
    evaluationId,
    profile,
  })
  const normalizedSelectedLinkIds = uniqueIds(selectedParentLinkIds)
  const recipientResolution = normalizedSelectedLinkIds.length > 0
    ? resolveDevelopmentRecipientsFromRows({
        evaluation: context.evaluation,
        player: context.player,
        links: context.links,
        selectedParentLinkIds: normalizedSelectedLinkIds,
      })
    : { outcome: 'ready', recipients: [], unavailableLinkIds: [] }

  const requestedSections = [
    ...(includeAttendance ? [{ key: 'attendanceSummary' }] : []),
    ...(includeProgression ? [{ key: 'progressionChart' }] : []),
  ]
  const report = resolveDevelopmentParentReport({
    ...context,
    recipients: recipientResolution.outcome === 'ready'
      ? recipientResolution.recipients
      : recipientResolution.eligibleRecipients,
    requestedResponses,
    requestedSections,
  })
  const { data, error } = await supabaseAdmin
    .from('development_parent_reports')
    .upsert({
      evaluation_id: context.evaluation.id,
      club_id: context.evaluation.club_id,
      report_snapshot: report,
      finalized_at: report.finalizedAt,
      finalized_by: normalizeText(profile?.id) || null,
    }, {
      onConflict: 'evaluation_id',
    })
    .select('evaluation_id, report_snapshot')
    .single()

  if (error) {
    throw error
  }

  if (!isDevelopmentParentReportSnapshot(data?.report_snapshot)) {
    throw outputError(
      'The Development report snapshot could not be finalized.',
      500,
      'DEVELOPMENT_PARENT_REPORT_FINALIZE_FAILED',
    )
  }

  return {
    ...data.report_snapshot,
    recipientReviewRequired: recipientResolution.outcome !== 'ready',
    eligibleRecipients: recipientResolution.eligibleRecipients ?? recipientResolution.recipients,
    ineligibleRecipients: recipientResolution.ineligibleRecipients ?? [],
  }
}

export async function reauthorizePreparedDevelopmentParentEmail(
  supabaseAdmin,
  preparedEmail,
  {
    loadContext = loadDevelopmentParentEmailContext,
  } = {},
) {
  const storedPayload = preparedEmail?.storedPayload && typeof preparedEmail.storedPayload === 'object'
    ? preparedEmail.storedPayload
    : {}
  const outputKey = normalizeText(storedPayload.outputKey)

  if (!outputKey) {
    return preparedEmail
  }

  const evaluationId = normalizeText(storedPayload.evaluationId)
  const recipientLinkId = normalizeText(storedPayload.recipientLinkId)
  const actorId = normalizeText(storedPayload.actorId)
  const planProfile = preparedEmail?.planProfile && typeof preparedEmail.planProfile === 'object'
    ? preparedEmail.planProfile
    : {}

  if (!evaluationId || !recipientLinkId || !actorId) {
    throw outputError(
      'This Development email recipient is no longer available.',
      409,
      'DEVELOPMENT_PARENT_EMAIL_STORED_RECIPIENT_INVALID',
    )
  }

  const context = await loadContext(supabaseAdmin, {
    evaluationId,
    profile: {
      ...planProfile,
      id: normalizeText(planProfile.id) || actorId,
      clubId: normalizeText(planProfile.clubId) || normalizeText(storedPayload.clubId),
    },
    selectedParentLinkIds: [recipientLinkId],
  })
  const currentRecipient = context?.outcome === 'ready' ? context.recipient : null
  const expectedOutputKey = createDevelopmentOutputKey(evaluationId, recipientLinkId)

  if (
    !currentRecipient ||
    normalizeText(currentRecipient.linkId) !== recipientLinkId ||
    normalizeText(context.outputKey) !== expectedOutputKey ||
    outputKey !== expectedOutputKey
  ) {
    throw outputError(
      'This Development email recipient is no longer available.',
      409,
      'DEVELOPMENT_PARENT_EMAIL_RECIPIENT_NO_LONGER_ELIGIBLE',
    )
  }

  const recipients = [normalizeText(currentRecipient.email)]
  const emailPayload = {
    ...(preparedEmail.emailPayload || {}),
    to: recipients,
  }

  return {
    ...preparedEmail,
    emailPayload,
    recipients,
    storedPayload: {
      ...storedPayload,
      parentName: normalizeText(currentRecipient.name),
      resendPayload: {
        ...(storedPayload.resendPayload || emailPayload),
        to: recipients,
      },
    },
  }
}
