import { formatUkDate, normalizeDateOnly } from '../date-format.js'
import {
  normalizeParentContacts,
  normalizePlayerContactType,
} from './contact-utils.js'
import { normalizeWords } from './core-normalizers.js'

export function createDefaultComments() {
  return {
    strengths: '',
    improvements: '',
    overall: '',
    selectedStrengths: [],
  }
}

export function normalizeComments(comments) {
  if (!comments || typeof comments !== 'object' || Array.isArray(comments)) {
    return createDefaultComments()
  }

  return {
    strengths: String(comments.strengths ?? '').trim(),
    improvements: String(comments.improvements ?? '').trim(),
    overall: String(comments.overall ?? '').trim(),
    selectedStrengths: Array.isArray(comments.selectedStrengths)
      ? comments.selectedStrengths.map((item) => String(item))
      : [],
  }
}

export function normalizeFormResponses(formResponses) {
  if (!formResponses || typeof formResponses !== 'object' || Array.isArray(formResponses)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(formResponses).map(([key, value]) => {
      if (typeof value === 'number') {
        return [String(key), value]
      }

      return [String(key), String(value ?? '').trim()]
    }),
  )
}

export function normalizeFeedbackFormSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null
  }

  const fields = Array.isArray(snapshot.fields)
    ? snapshot.fields.map((field, index) => ({
        id: String(field.id ?? '').trim() || `snapshot-field-${index + 1}`,
        label: String(field.label ?? '').trim(),
        type: String(field.type ?? 'text').trim() || 'text',
        options: Array.isArray(field.options) ? field.options.map((option) => String(option ?? '').trim()).filter(Boolean) : [],
        required: Boolean(field.required),
        orderIndex: Number(field.orderIndex ?? field.order_index ?? index + 1),
        value: field.value ?? '',
      })).filter((field) => field.label)
    : []

  return {
    formId: snapshot.formId ?? snapshot.form_id ?? '',
    formName: String(snapshot.formName ?? snapshot.form_name ?? '').trim(),
    formVersion: Number(snapshot.formVersion ?? snapshot.form_version ?? 1) || 1,
    fields,
  }
}

export function buildLegacyFormResponses(row) {
  const legacyResponses = {}
  const scores = row?.scores && typeof row.scores === 'object' && !Array.isArray(row.scores) ? row.scores : {}
  const comments = normalizeComments(row?.comments)

  Object.entries(scores).forEach(([label, value]) => {
    legacyResponses[normalizeWords(label)] = Number(value)
  })

  if (comments.strengths) {
    legacyResponses.Strengths = comments.strengths
  }

  if (comments.improvements) {
    legacyResponses.Improvements = comments.improvements
  }

  if (comments.overall) {
    legacyResponses['Overall Comments'] = comments.overall
  }

  return legacyResponses
}

export function createCommentsFromResponses(formResponses) {
  const entries = Object.entries(formResponses)
  const findResponse = (patterns) =>
    entries.find(([label]) => patterns.some((pattern) => label.toLowerCase().includes(pattern)))?.[1] ?? ''

  return {
    strengths: String(findResponse(['strength']))?.trim() || '',
    improvements: String(findResponse(['improvement', 'weakness', 'development']))?.trim() || '',
    overall: String(findResponse(['overall', 'summary', 'comment']))?.trim() || '',
    selectedStrengths: [],
  }
}

export function buildScoresFromResponses(formResponses) {
  return Object.fromEntries(
    Object.entries(formResponses)
      .filter(([, value]) => typeof value === 'number' && !Number.isNaN(value))
      .map(([label, value]) => [label, value]),
  )
}

export function calculateAverageScore(scores = {}) {
  const values = Object.values(scores)
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value))

  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function normalizeEvaluationRow(row) {
  const formResponses =
    row.form_responses && typeof row.form_responses === 'object' && !Array.isArray(row.form_responses)
      ? normalizeFormResponses(row.form_responses)
      : buildLegacyFormResponses(row)
  const comments = row.comments ? normalizeComments(row.comments) : createCommentsFromResponses(formResponses)
  const scores =
    row.scores && typeof row.scores === 'object' && !Array.isArray(row.scores)
      ? row.scores
      : buildScoresFromResponses(formResponses)
  const createdAtValue = row.created_at ? new Date(row.created_at).getTime() : Number(row.createdAt ?? row.id)
  const averageScore =
    typeof row.average_score === 'number' ? row.average_score : calculateAverageScore(scores)
  const parentContacts = normalizeParentContacts(row.parent_contacts, {
    parentName: row.parent_name ?? row.parentName,
    parentEmail: row.parent_email ?? row.parentEmail,
  })

  return {
    id: row.id,
    playerId: row.player_id ?? row.playerId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    playerName: String(row.player_name ?? row.playerName ?? '').trim() || 'Unknown Player',
    team: String(row.team ?? '').trim() || 'Unassigned Club',
    teamRequireApproval: Boolean(row.teamRequireApproval ?? row.team_require_approval ?? row.require_approval ?? true),
    section: String(row.section ?? row.evaluation_section ?? 'Trial').trim() || 'Trial',
    assessmentSessionId: row.assessment_session_id ?? row.assessmentSessionId ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    coachId: row.coach_id ?? row.coachId ?? '',
    coach: String(row.coach ?? row.coach_name ?? '').trim() || 'Unknown Coach',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    parentName: String(row.parent_name ?? row.parentName ?? '').trim(),
    parentEmail: String(row.parent_email ?? row.parentEmail ?? '').trim(),
    parentContacts,
    contactType: normalizePlayerContactType(row.contact_type ?? row.contactType ?? (row.is_adult || row.isAdult ? 'self' : 'parent')),
    session: String(row.session ?? '').trim(),
    date: String(row.date ?? '').trim(),
    scores,
    averageScore: averageScore !== null ? Number(averageScore) : null,
    comments,
    decision: String(row.decision ?? '').trim(),
    status: String(row.status ?? 'Submitted').trim() || 'Submitted',
    rejectionReason: String(row.rejection_reason ?? row.rejectionReason ?? '').trim(),
    reviewedBy: row.reviewed_by ?? row.reviewedBy ?? '',
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? '',
    createdAt: Number.isNaN(createdAtValue) ? Date.now() : createdAtValue,
    formResponses,
    feedbackFormId: row.feedback_form_id ?? row.feedbackFormId ?? '',
    feedbackFormName: String(row.feedback_form_name ?? row.feedbackFormName ?? '').trim(),
    feedbackFormVersion: row.feedback_form_version ?? row.feedbackFormVersion ?? null,
    feedbackFormSnapshot: normalizeFeedbackFormSnapshot(row.feedback_form_snapshot ?? row.feedbackFormSnapshot),
  }
}

export function mapEvaluationToRow(data) {
  const normalizedRecordDate = normalizeDateOnly(
    data.date ||
    data.reportDate ||
    data.report_date ||
    data.assessmentDate ||
    data.assessment_date ||
    data.developmentDate ||
    data.development_date ||
    data.sessionDate ||
    data.session_date ||
    data.session,
  )

  if (!normalizedRecordDate) {
    throw new Error('Please enter a report date before saving.')
  }

  const parentContacts = normalizeParentContacts(data.parentContacts, {
    parentName: data.parentName,
    parentEmail: data.parentEmail,
  })
  const primaryParent = parentContacts[0] ?? { name: '', email: '' }
  const createdByName = String(data.createdByName ?? data.coach ?? '').trim()
  const createdByEmail = String(data.createdByEmail ?? '').trim().toLowerCase()
  const updatedByName = String(data.updatedByName ?? createdByName).trim()
  const updatedByEmail = String(data.updatedByEmail ?? createdByEmail).trim().toLowerCase()
  const normalizedDecision = ['', 'Yes', 'No'].includes(String(data.decision ?? '').trim())
    ? String(data.decision ?? '').trim()
    : ''

  return {
    id: data.id || undefined,
    player_name: data.playerName,
    player_id: data.playerId || null,
    team: data.team,
    team_id: data.teamId || null,
    section: data.section || 'Trial',
    assessment_session_id: data.assessmentSessionId || data.assessment_session_id || null,
    club_id: data.clubId,
    coach_id: data.coachId,
    coach: data.coach,
    created_by_name: createdByName,
    created_by_email: createdByEmail,
    updated_by: data.updatedBy || null,
    updated_by_name: updatedByName,
    updated_by_email: updatedByEmail,
    parent_name: primaryParent.name,
    parent_email: primaryParent.email,
    parent_contacts: parentContacts,
    contact_type: normalizePlayerContactType(data.contactType ?? data.contact_type ?? (data.isAdult || data.is_adult ? 'self' : 'parent')),
    session: data.session,
    date: formatUkDate(normalizedRecordDate),
    scores: data.scores,
    average_score: data.averageScore,
    comments: data.comments,
    form_responses: data.formResponses,
    feedback_form_id: data.feedbackFormId || null,
    feedback_form_name: data.feedbackFormName || null,
    feedback_form_version: data.feedbackFormVersion || null,
    feedback_form_snapshot: data.feedbackFormSnapshot || {},
    decision: normalizedDecision,
    status: data.status,
    rejection_reason: data.rejectionReason || null,
    reviewed_by: data.reviewedBy || null,
    reviewed_at: data.reviewedAt || null,
    created_at: data.createdAt || new Date().toISOString(),
  }
}
