import { supabase } from '../supabase-client.js'
import { isPlanAccessActive } from '../plans.js'
import { CAPABILITIES } from '../paywall-access.js'
import { blockDemoMutation } from './demo-guards.js'
import { createAuditLog } from './audit.js'
import {
  getEntryUserEmail,
  getEntryUserId,
  getEntryUserName,
  normalizeFieldOptions,
  normalizeFieldType,
} from './core-normalizers.js'
import { assertClubFeature } from './plan-gates.js'

export const FEEDBACK_FORM_FIELD_TYPES = Object.freeze([
  { value: 'score_1_10', label: 'Rating 1-10' },
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'select', label: 'Dropdown' },
  { value: 'traffic_light', label: 'Traffic light' },
])

const ACTIVE_STATUS = 'active'
const ARCHIVED_STATUS = 'archived'

function createFieldId() {
  return globalThis.crypto?.randomUUID?.() || `field-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeFixedOptions(type, options) {
  if (type === 'score_1_10') {
    return Array.from({ length: 10 }, (_, index) => String(index + 1))
  }

  if (type === 'yes_no') {
    return ['Yes', 'No']
  }

  if (type === 'traffic_light') {
    return ['Green', 'Amber', 'Red']
  }

  if (type === 'select') {
    return normalizeFieldOptions(options)
  }

  return []
}

export function canManageFeedbackForms(user) {
  return Boolean(user?.clubId)
    && Boolean(user?.activeTeamId)
    && !['admin', 'parent_portal', 'super_admin'].includes(String(user?.role ?? '').trim())
    && isPlanAccessActive(user)
    && Number(user?.roleRank ?? 0) >= 50
}

export function canCompleteFeedbackForms(user) {
  return Boolean(user?.clubId)
    && Boolean(user?.activeTeamId)
    && !['parent_portal', 'super_admin'].includes(String(user?.role ?? '').trim())
    && isPlanAccessActive(user)
}

export function normalizeFeedbackFormField(field = {}, index = 0) {
  const type = normalizeFieldType(field.type)
  const label = String(field.label ?? '').trim()

  return {
    id: String(field.id ?? '').trim() || createFieldId(),
    label,
    type,
    options: normalizeFixedOptions(type, field.options),
    required: Boolean(field.required),
    orderIndex: Number(field.orderIndex ?? field.order_index ?? index + 1),
    isEnabled: field.isEnabled ?? field.is_enabled ?? true,
  }
}

export function getUsableFeedbackFormFields(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map(normalizeFeedbackFormField)
    .filter((field) => field.label && field.isEnabled !== false)
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((field, index) => ({
      ...field,
      orderIndex: index + 1,
    }))
}

export function validateFeedbackFormDraft({ fields = [], name } = {}) {
  const trimmedName = String(name ?? '').trim()
  const usableFields = getUsableFeedbackFormFields(fields)

  if (!trimmedName) {
    throw new Error('Enter a form name before saving.')
  }

  if (usableFields.length === 0) {
    throw new Error('Add at least one usable field before saving this form.')
  }

  const invalidDropdown = usableFields.find((field) => field.type === 'select' && field.options.length === 0)
  if (invalidDropdown) {
    throw new Error(`Add at least one dropdown option for ${invalidDropdown.label}.`)
  }

  return {
    name: trimmedName,
    fields: usableFields,
  }
}

export function normalizeFeedbackFormRow(row = {}) {
  const status = String(row.status ?? ACTIVE_STATUS).trim() || ACTIVE_STATUS

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    name: String(row.name ?? '').trim(),
    fields: getUsableFeedbackFormFields(row.fields),
    status,
    isArchived: status === ARCHIVED_STATUS,
    version: Number(row.version ?? 1) || 1,
    duplicatedFromId: row.duplicated_from_id ?? row.duplicatedFromId ?? '',
    archivedAt: row.archived_at ?? row.archivedAt ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function mapFeedbackFormToRow({ fields, name, status = ACTIVE_STATUS, version }, user, extra = {}) {
  return {
    club_id: user.clubId,
    team_id: user.activeTeamId,
    name: String(name ?? '').trim(),
    fields,
    status,
    version: Number(version ?? 1) || 1,
    updated_by: getEntryUserId(user),
    updated_by_name: getEntryUserName(user),
    updated_by_email: getEntryUserEmail(user),
    updated_at: new Date().toISOString(),
    ...extra,
  }
}

async function assertFeedbackFormManager(user) {
  if (!canManageFeedbackForms(user)) {
    throw new Error('Only a Manager or Team Admin can manage feedback forms for the current team.')
  }

  await assertClubFeature({
    user,
    clubId: user.clubId,
    featureName: CAPABILITIES.customDevelopmentFields,
  })
}

export async function getFeedbackForms({ includeArchived = true, user } = {}) {
  if (!user?.clubId || !user?.activeTeamId) {
    return []
  }

  let query = supabase
    .from('feedback_forms')
    .select('*')
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .order('updated_at', { ascending: false })

  if (!includeArchived) {
    query = query.eq('status', ACTIVE_STATUS)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeFeedbackFormRow)
}

export async function getActiveFeedbackForms({ user } = {}) {
  if (!canCompleteFeedbackForms(user)) {
    return []
  }

  return getFeedbackForms({ includeArchived: false, user })
}

export async function getActiveFeedbackFormForSubmission({ formId, user } = {}) {
  const normalizedFormId = String(formId ?? '').trim()

  if (!normalizedFormId) {
    return null
  }

  if (!canCompleteFeedbackForms(user)) {
    throw new Error('Team access is required to complete feedback forms.')
  }

  const { data, error } = await supabase
    .from('feedback_forms')
    .select('*')
    .eq('id', normalizedFormId)
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .eq('status', ACTIVE_STATUS)
    .single()

  if (error) {
    console.error(error)
    throw new Error('The selected feedback form is not available for new submissions.')
  }

  return normalizeFeedbackFormRow(data)
}

export async function createFeedbackForm({ fields, name, user }) {
  await blockDemoMutation(user)
  await assertFeedbackFormManager(user)

  const draft = validateFeedbackFormDraft({ fields, name })
  const payload = mapFeedbackFormToRow(draft, user, {
    created_by: getEntryUserId(user),
    created_by_name: getEntryUserName(user),
    created_by_email: getEntryUserEmail(user),
  })

  const { data, error } = await supabase.from('feedback_forms').insert(payload).select('*').single()

  if (error) {
    console.error(error)
    throw error
  }

  const createdForm = normalizeFeedbackFormRow(data)

  await createAuditLog({
    user,
    action: 'feedback_form_created',
    entityType: 'feedback_form',
    entityId: createdForm.id,
    metadata: {
      formName: createdForm.name,
      fieldCount: createdForm.fields.length,
    },
  })

  return createdForm
}

export async function updateFeedbackForm({ fields, formId, name, user }) {
  await blockDemoMutation(user)
  await assertFeedbackFormManager(user)

  const draft = validateFeedbackFormDraft({ fields, name })
  const { data: existingRow, error: existingError } = await supabase
    .from('feedback_forms')
    .select('*')
    .eq('id', formId)
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .single()

  if (existingError) {
    console.error(existingError)
    throw existingError
  }

  const existingForm = normalizeFeedbackFormRow(existingRow)
  if (existingForm.isArchived) {
    throw new Error('Archived forms cannot be edited. Duplicate this form if coaches need it again.')
  }

  const payload = mapFeedbackFormToRow({
    ...draft,
    version: existingForm.version + 1,
  }, user)

  const { data, error } = await supabase
    .from('feedback_forms')
    .update(payload)
    .eq('id', formId)
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  const updatedForm = normalizeFeedbackFormRow(data)

  await createAuditLog({
    user,
    action: 'feedback_form_edited',
    entityType: 'feedback_form',
    entityId: updatedForm.id,
    metadata: {
      formName: updatedForm.name,
      version: updatedForm.version,
      fieldCount: updatedForm.fields.length,
    },
  })

  return updatedForm
}

export async function duplicateFeedbackForm({ formId, user }) {
  await blockDemoMutation(user)
  await assertFeedbackFormManager(user)

  const { data: existingRow, error: existingError } = await supabase
    .from('feedback_forms')
    .select('*')
    .eq('id', formId)
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .single()

  if (existingError) {
    console.error(existingError)
    throw existingError
  }

  const sourceForm = normalizeFeedbackFormRow(existingRow)
  const createdForm = await createFeedbackForm({
    user,
    name: `${sourceForm.name} copy`,
    fields: sourceForm.fields,
  })

  const { data, error } = await supabase
    .from('feedback_forms')
    .update({ duplicated_from_id: sourceForm.id })
    .eq('id', createdForm.id)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  const duplicatedForm = normalizeFeedbackFormRow(data)

  await createAuditLog({
    user,
    action: 'feedback_form_duplicated',
    entityType: 'feedback_form',
    entityId: duplicatedForm.id,
    metadata: {
      formName: duplicatedForm.name,
      sourceFormId: sourceForm.id,
      sourceFormName: sourceForm.name,
    },
  })

  return duplicatedForm
}

export async function archiveFeedbackForm({ formId, user }) {
  await blockDemoMutation(user)
  await assertFeedbackFormManager(user)

  const archivedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('feedback_forms')
    .update({
      status: ARCHIVED_STATUS,
      archived_at: archivedAt,
      updated_by: getEntryUserId(user),
      updated_by_name: getEntryUserName(user),
      updated_by_email: getEntryUserEmail(user),
      updated_at: archivedAt,
    })
    .eq('id', formId)
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  const archivedForm = normalizeFeedbackFormRow(data)

  await createAuditLog({
    user,
    action: 'feedback_form_archived',
    entityType: 'feedback_form',
    entityId: archivedForm.id,
    metadata: {
      formName: archivedForm.name,
      version: archivedForm.version,
    },
  })

  return archivedForm
}

export function buildFeedbackFormSnapshot({ form, formResponses = {} } = {}) {
  if (!form?.id) {
    return null
  }

  const fields = getUsableFeedbackFormFields(form.fields).map((field) => ({
    ...field,
    value: formResponses[field.label] ?? '',
  }))

  return {
    formId: form.id,
    formName: form.name,
    formVersion: Number(form.version ?? 1) || 1,
    fields,
  }
}
