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
import {
  getCustomMetricKey,
  getStableCategoryKey,
  getStableCategoryLabel,
  getStableMetricKey,
} from '../elite-development.js'

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
const GRAPHABLE_FEEDBACK_FORM_FIELD_TYPES = new Set(['score_1_10'])
export const STARTER_FEEDBACK_FORM_SELECTION_PREFIX = 'platform-starter:'

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

export function isGraphableFeedbackFormFieldType(type) {
  return GRAPHABLE_FEEDBACK_FORM_FIELD_TYPES.has(String(type ?? '').trim())
}

export function updateFeedbackFormEditorFields(fields = [], fieldId, nextValues = {}) {
  return fields.map((field) => (
    field.id === fieldId
      ? {
          ...field,
          ...nextValues,
          ...(nextValues.type && !isGraphableFeedbackFormFieldType(nextValues.type)
            ? {
                metricKey: '',
                categoryKey: '',
                categoryLabel: '',
                includeInProgressChart: false,
              }
            : {}),
        }
      : field
  ))
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
  const includeInProgressChart = field.includeInProgressChart ?? field.include_in_progress_chart
  const id = String(field.id ?? '').trim() || createFieldId()
  const isGraphable = isGraphableFeedbackFormFieldType(type)
  const includeInProgressChartValue = isGraphable ? Boolean(includeInProgressChart) : false
  const metricKey = includeInProgressChartValue
    ? getStableMetricKey(field) || getCustomMetricKey(id)
    : ''
  const categoryKey = includeInProgressChartValue
    ? getStableCategoryKey(field) || 'custom'
    : ''
  const categoryLabel = includeInProgressChartValue
    ? getStableCategoryLabel(field) || 'Custom'
    : ''

  return {
    id,
    label,
    type,
    options: normalizeFixedOptions(type, field.options),
    required: Boolean(field.required),
    orderIndex: Number(field.orderIndex ?? field.order_index ?? index + 1),
    isEnabled: field.isEnabled ?? field.is_enabled ?? true,
    includeInProgressChart: includeInProgressChartValue,
    parentVisible: Boolean(field.parentVisible ?? field.parent_visible ?? false),
    metricKey,
    categoryKey,
    categoryLabel,
  }
}

export function getStarterFeedbackFormSelectionId(templateKey, version) {
  const normalizedKey = String(templateKey ?? '').trim()
  const normalizedVersion = Number(version ?? 0)
  return normalizedKey && normalizedVersion > 0
    ? `${STARTER_FEEDBACK_FORM_SELECTION_PREFIX}${normalizedKey}:${normalizedVersion}`
    : ''
}

export function parseStarterFeedbackFormSelectionId(selectionId) {
  const normalizedSelectionId = String(selectionId ?? '').trim()
  if (!normalizedSelectionId.startsWith(STARTER_FEEDBACK_FORM_SELECTION_PREFIX)) {
    return null
  }

  const value = normalizedSelectionId.slice(STARTER_FEEDBACK_FORM_SELECTION_PREFIX.length)
  const separatorIndex = value.lastIndexOf(':')
  const templateKey = value.slice(0, separatorIndex).trim()
  const version = Number(value.slice(separatorIndex + 1))

  return templateKey && Number.isInteger(version) && version > 0
    ? { templateKey, version }
    : null
}

export function getExplicitTeamAge(ageGroup) {
  const match = String(ageGroup ?? '').trim().toUpperCase().match(/^U(\d{1,2})$/)
  return match ? Number(match[1]) : null
}

export function isStarterTemplateRecommendedForAge(template, ageGroup) {
  const age = getExplicitTeamAge(ageGroup)
  return age !== null
    && age >= Number(template?.ageMin ?? 0)
    && age <= Number(template?.ageMax ?? 0)
}

export function normalizeStarterFeedbackFormRow(
  row = {},
  {
    ageGroup = '',
    hidden = false,
    installedFormId = '',
    installedFormName = '',
    teamId = '',
  } = {},
) {
  const templateKey = String(row.template_key ?? row.templateKey ?? '').trim()
  const version = Number(row.version ?? 1) || 1

  return {
    id: String(row.id ?? '').trim(),
    selectionId: getStarterFeedbackFormSelectionId(templateKey, version),
    templateKey,
    teamId,
    name: String(row.name ?? '').trim(),
    description: String(row.description ?? '').trim(),
    ageBand: String(row.age_band ?? row.ageBand ?? '').trim(),
    ageMin: Number(row.age_min ?? row.ageMin ?? 0),
    ageMax: Number(row.age_max ?? row.ageMax ?? 0),
    fields: getUsableFeedbackFormFields(row.fields),
    version,
    isCurrent: row.is_current ?? row.isCurrent ?? true,
    isPlatformTemplate: true,
    installedFormId: String(installedFormId ?? '').trim(),
    installedFormName: String(installedFormName ?? '').trim(),
    isInstalled: Boolean(installedFormId),
    isHidden: hidden === true,
    isRecommended: isStarterTemplateRecommendedForAge({
      ageMin: row.age_min ?? row.ageMin,
      ageMax: row.age_max ?? row.ageMax,
    }, ageGroup),
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
    starterTemplateKey: String(row.starter_template_key ?? row.starterTemplateKey ?? '').trim(),
    starterTemplateVersion: row.starter_template_version ?? row.starterTemplateVersion ?? null,
    sourceTemplateKey: String(row.source_template_key ?? row.sourceTemplateKey ?? '').trim(),
    sourceTemplateVersion: row.source_template_version ?? row.sourceTemplateVersion ?? null,
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

  const [teamForms, starterForms] = await Promise.all([
    getFeedbackForms({ includeArchived: false, user }),
    getStarterFeedbackForms({ user }),
  ])

  return [...starterForms, ...teamForms]
}

export async function getStarterFeedbackForms({ includeHidden = false, user } = {}) {
  if (!canCompleteFeedbackForms(user)) {
    return []
  }

  const teamId = String(user.activeTeamId ?? '').trim()
  const clubId = String(user.clubId ?? '').trim()
  if (!teamId || !clubId) return []

  const [
    { data: templateRows, error: templateError },
    { data: preferenceRows, error: preferenceError },
    { data: teamRow, error: teamError },
    { data: installedRows, error: installedError },
  ] = await Promise.all([
    supabase
      .from('feedback_form_starter_templates')
      .select('*')
      .eq('is_current', true)
      .order('age_min', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('feedback_form_starter_preferences')
      .select('template_key, hidden')
      .eq('club_id', clubId)
      .eq('team_id', teamId),
    supabase
      .from('teams')
      .select('age_group')
      .eq('club_id', clubId)
      .eq('id', teamId)
      .maybeSingle(),
    supabase
      .from('feedback_forms')
      .select('id, name, starter_template_key, starter_template_version')
      .eq('club_id', clubId)
      .eq('team_id', teamId)
      .eq('status', ACTIVE_STATUS)
      .not('starter_template_key', 'is', null),
  ])

  const error = templateError || preferenceError || teamError || installedError
  if (error) {
    console.error(error)
    throw error
  }

  const hiddenByKey = new Map((preferenceRows ?? []).map((row) => [
    String(row.template_key ?? '').trim(),
    row.hidden === true,
  ]))
  const ageGroup = String(teamRow?.age_group ?? '').trim()
  const installedByKey = new Map((installedRows ?? []).map((row) => [
    String(row.starter_template_key ?? '').trim(),
    {
      installedFormId: String(row.id ?? '').trim(),
      installedFormName: String(row.name ?? '').trim(),
    },
  ]))

  return (templateRows ?? [])
    .map((row) => normalizeStarterFeedbackFormRow(row, {
      ageGroup,
      hidden: hiddenByKey.get(String(row.template_key ?? '').trim()) === true,
      teamId,
      ...installedByKey.get(String(row.template_key ?? '').trim()),
    }))
    .filter((form) => includeHidden || !form.isHidden)
}

export async function getActiveFeedbackFormForSubmission({ formId, user } = {}) {
  const normalizedFormId = String(formId ?? '').trim()

  if (!normalizedFormId) {
    return null
  }

  if (!canCompleteFeedbackForms(user)) {
    throw new Error('Team access is required to complete feedback forms.')
  }

  const starterSelection = parseStarterFeedbackFormSelectionId(normalizedFormId)
  if (starterSelection) {
    const starterForms = await getStarterFeedbackForms({ user })
    const starterForm = starterForms.find((form) => form.selectionId === normalizedFormId)

    if (!starterForm) {
      throw new Error('The selected starter template is not available for new submissions.')
    }

    return starterForm
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

export async function setStarterFeedbackFormHidden({ hidden, templateId, templateKey, user } = {}) {
  await blockDemoMutation(user)
  await assertFeedbackFormManager(user)

  const normalizedTemplateKey = String(templateKey ?? '').trim()
  const templateIdValue = String(templateId ?? '').trim()
  const normalizedTemplateId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(templateIdValue)
    ? templateIdValue
    : ''
  if (!normalizedTemplateKey) {
    throw new Error('Choose a starter template before changing its visibility.')
  }

  const updatedAt = new Date().toISOString()
  const { error } = await supabase
    .from('feedback_form_starter_preferences')
    .upsert({
      club_id: user.clubId,
      team_id: user.activeTeamId,
      template_key: normalizedTemplateKey,
      hidden: hidden === true,
      updated_by: getEntryUserId(user),
      updated_at: updatedAt,
    }, { onConflict: 'team_id,template_key' })

  if (error) {
    console.error(error)
    throw error
  }

  await createAuditLog({
    user,
    action: hidden ? 'starter_feedback_form_hidden' : 'starter_feedback_form_shown',
    entityType: 'feedback_form_starter_template',
    entityId: normalizedTemplateId || null,
    metadata: {
      hidden: hidden === true,
      templateKey: normalizedTemplateKey,
    },
  })
}

export function buildFeedbackFormCopyDraft({ action = 'duplicate', sourceForm, sourceType = 'team' } = {}) {
  const normalizedAction = String(action ?? '').trim().toLowerCase()
  const normalizedSourceType = String(sourceType ?? '').trim().toLowerCase()

  if (!['customise', 'duplicate'].includes(normalizedAction)) {
    throw new Error('Choose Duplicate or Customise before copying a feedback form.')
  }

  if (!sourceForm?.name || !Array.isArray(sourceForm.fields)) {
    throw new Error('The source feedback form is not available to copy.')
  }

  if (normalizedSourceType === 'team' && normalizedAction === 'customise') {
    throw new Error('Use Edit to customise a team-owned feedback form.')
  }

  const sourceTemplateKey = String(
    sourceForm.templateKey
      ?? sourceForm.sourceTemplateKey
      ?? sourceForm.starterTemplateKey
      ?? '',
  ).trim()
  const sourceTemplateVersion = Number(
    sourceForm.sourceTemplateVersion
      ?? sourceForm.starterTemplateVersion
      ?? sourceForm.version
      ?? 0,
  )

  return {
    duplicatedFromId: normalizedSourceType === 'team' ? String(sourceForm.id ?? '').trim() : '',
    fields: sourceForm.fields.map((field) => normalizeFeedbackFormField(field)),
    name: `${String(sourceForm.name).trim()} ${normalizedAction === 'customise' ? 'custom' : 'copy'}`,
    sourceTemplateKey,
    sourceTemplateVersion: sourceTemplateKey && sourceTemplateVersion > 0 ? sourceTemplateVersion : null,
  }
}

export async function duplicateStarterFeedbackForm({ action = 'duplicate', selectionId, user } = {}) {
  await blockDemoMutation(user)
  await assertFeedbackFormManager(user)
  const normalizedAction = String(action ?? '').trim().toLowerCase()

  const starterForms = await getStarterFeedbackForms({ includeHidden: true, user })
  const sourceForm = starterForms.find((form) => form.selectionId === selectionId)

  if (!sourceForm) {
    throw new Error('The selected starter template is not available to duplicate.')
  }

  const copyDraft = buildFeedbackFormCopyDraft({
    action: normalizedAction,
    sourceForm,
    sourceType: 'platform',
  })

  const createdForm = await createFeedbackForm({
    user,
    ...copyDraft,
  })

  await createAuditLog({
    user,
    action: normalizedAction === 'customise' ? 'starter_feedback_form_customised' : 'starter_feedback_form_duplicated',
    entityType: 'feedback_form',
    entityId: createdForm.id,
    metadata: {
      copyAction: normalizedAction,
      sourceTemplateKey: sourceForm.templateKey,
      sourceTemplateVersion: sourceForm.version,
      formName: createdForm.name,
    },
  })

  return createdForm
}

export async function createFeedbackForm({
  duplicatedFromId = '',
  fields,
  name,
  sourceTemplateKey = '',
  sourceTemplateVersion = null,
  starterTemplateKey = '',
  starterTemplateVersion = null,
  user,
}) {
  await blockDemoMutation(user)
  await assertFeedbackFormManager(user)

  const draft = validateFeedbackFormDraft({ fields, name })
  const payload = mapFeedbackFormToRow(draft, user, {
    created_by: getEntryUserId(user),
    created_by_name: getEntryUserName(user),
    created_by_email: getEntryUserEmail(user),
    duplicated_from_id: String(duplicatedFromId ?? '').trim() || null,
    source_template_key: String(sourceTemplateKey ?? '').trim() || null,
    source_template_version: Number(sourceTemplateVersion) > 0 ? Number(sourceTemplateVersion) : null,
    starter_template_key: String(starterTemplateKey ?? '').trim() || null,
    starter_template_version: Number(starterTemplateVersion) > 0 ? Number(starterTemplateVersion) : null,
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
  const copyDraft = buildFeedbackFormCopyDraft({
    sourceForm,
    sourceType: 'team',
  })
  const createdForm = await createFeedbackForm({
    user,
    ...copyDraft,
  })

  await createAuditLog({
    user,
    action: 'feedback_form_duplicated',
    entityType: 'feedback_form',
    entityId: createdForm.id,
    metadata: {
      formName: createdForm.name,
      sourceFormId: sourceForm.id,
      sourceFormName: sourceForm.name,
    },
  })

  return createdForm
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
  if (!form?.id && !form?.templateKey) {
    return null
  }

  const fields = getUsableFeedbackFormFields(form.fields).map((field) => ({
    ...field,
    value: formResponses[field.label] ?? '',
  }))

  return {
    formId: form.isPlatformTemplate === true ? null : form.id || null,
    templateKey: form.templateKey || form.sourceTemplateKey || form.starterTemplateKey || null,
    formName: form.name,
    formVersion: Number(form.version ?? 1) || 1,
    isPlatformTemplate: form.isPlatformTemplate === true,
    fields,
  }
}
