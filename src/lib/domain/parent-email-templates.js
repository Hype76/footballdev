import {
  EVALUATION_SECTIONS,
  supabase,
} from '../supabase-client.js'
import { isDemoEmail } from '../demo.js'
import {
  createFeatureUpgradeMessage,
  hasPlanFeature,
} from '../plans.js'
import {
  EMAIL_TEMPLATE_AUDIENCES,
  getDefaultEmailTemplates,
  normalizeEmailTemplateAudience,
  normalizePlayerNameTemplateField,
  validateParentEmailTemplateContent,
} from '../email-templates.js'

const DEMO_MUTATION_ERROR_MESSAGE = 'Demo accounts cannot save changes.'
const CLUB_PLAN_SELECT = 'id, plan_key, plan_status, is_plan_comped, tester_access_expires_at'

function getEntryUserName(user) {
  return String(user?.username ?? user?.name ?? user?.email ?? '').trim()
}

function getEntryUserEmail(user) {
  return String(user?.email ?? '').trim().toLowerCase()
}

function getEntryIdentity(user, prefix = 'created_by') {
  return {
    [`${prefix}_name`]: getEntryUserName(user),
    [`${prefix}_email`]: getEntryUserEmail(user),
  }
}

function getEntryUserId(user) {
  return user?.id || null
}

function isPastDate(value) {
  if (!value) {
    return false
  }

  const timestamp = new Date(value).getTime()
  return !Number.isNaN(timestamp) && timestamp < Date.now()
}

async function isCurrentSessionDemoUser() {
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    console.error(error)
    return false
  }

  return isDemoEmail(data?.user?.email)
}

async function blockDemoMutation(account) {
  const hasDemoIdentity = Boolean(account?.isDemoAccount || account?.email)

  if (Boolean(account?.isDemoAccount) || isDemoEmail(account?.email) || (!hasDemoIdentity && await isCurrentSessionDemoUser())) {
    throw new Error(DEMO_MUTATION_ERROR_MESSAGE)
  }
}

async function fetchClubPlan(clubId) {
  if (!clubId) {
    return null
  }

  const { data, error } = await supabase
    .from('clubs')
    .select(CLUB_PLAN_SELECT)
    .eq('id', clubId)
    .maybeSingle()

  if (error) {
    console.error(error)
    throw error
  }

  return data
}

async function getPlanGateUser({ user = null, clubId = '' } = {}) {
  if (user?.planKey || user?.plan_key || user?.role === 'super_admin') {
    return user
  }

  const normalizedClubId = String(clubId || user?.clubId || user?.club_id || '').trim()

  if (!normalizedClubId) {
    return user
  }

  const club = await fetchClubPlan(normalizedClubId)
  const testerAccessExpiresAt = user?.testerAccessExpiresAt ?? user?.tester_access_expires_at ?? club?.tester_access_expires_at
  const testerAccessExpired = isPastDate(testerAccessExpiresAt)

  return {
    ...user,
    planKey: user?.planKey ?? user?.plan_key ?? club?.plan_key,
    planStatus: user?.planStatus ?? user?.plan_status ?? club?.plan_status,
    isPlanComped: testerAccessExpired ? false : (user?.isPlanComped ?? user?.is_plan_comped ?? club?.is_plan_comped),
    testerAccessExpired,
  }
}

async function assertClubFeature({ user = null, clubId = '', featureName }) {
  const planUser = await getPlanGateUser({ user, clubId })

  if (!hasPlanFeature(planUser, featureName)) {
    throw new Error(createFeatureUpgradeMessage(featureName))
  }
}

function normalizeParentEmailTemplateRow(row) {
  const rawSectionAvailability = row.section_availability ?? row.sectionAvailability ?? []
  const sectionAvailability = Array.isArray(rawSectionAvailability)
    ? rawSectionAvailability
        .map((section) => String(section ?? '').trim())
        .filter((section) => EVALUATION_SECTIONS.includes(section))
    : []

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    key: String(row.template_key ?? row.key ?? '').trim(),
    audience: normalizeEmailTemplateAudience(row.audience),
    label: String(row.label ?? '').trim(),
    subject: normalizePlayerNameTemplateField(row.subject).trim(),
    body: normalizePlayerNameTemplateField(row.body).trim(),
    isEnabled: Boolean(row.is_enabled ?? row.isEnabled ?? true),
    sectionAvailability: sectionAvailability.length > 0 ? sectionAvailability : [...EVALUATION_SECTIONS],
    orderIndex: Number(row.order_index ?? row.orderIndex ?? 0),
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

function normalizeParentEmailTemplatePayload({ user, template }) {
  const templateKey = String(template?.key ?? template?.templateKey ?? '').trim().toLowerCase()
  const audience = normalizeEmailTemplateAudience(template?.audience)
  const label = String(template?.label ?? '').trim()
  const subject = normalizePlayerNameTemplateField(template?.subject).trim()
  const body = normalizePlayerNameTemplateField(template?.body).trim()
  const sectionAvailability = Array.isArray(template?.sectionAvailability)
    ? template.sectionAvailability
        .map((section) => String(section ?? '').trim())
        .filter((section) => EVALUATION_SECTIONS.includes(section))
    : [...EVALUATION_SECTIONS]

  if (!templateKey) {
    throw new Error('Template key is required.')
  }

  if (!/^[a-z0-9][a-z0-9_-]{1,60}$/.test(templateKey)) {
    throw new Error('Template key can only use lowercase letters, numbers, dashes, and underscores.')
  }

  if (!label) {
    throw new Error('Template name is required.')
  }

  if (!subject) {
    throw new Error('Template subject is required.')
  }

  if (!body) {
    throw new Error('Template body is required.')
  }

  if (sectionAvailability.length === 0) {
    throw new Error('Choose at least one section for this template.')
  }

  validateParentEmailTemplateContent({ subject, body })

  return {
    club_id: user.clubId,
    template_key: templateKey,
    audience,
    label,
    subject,
    body,
    is_enabled: template?.isEnabled !== false,
    section_availability: sectionAvailability,
    order_index: Number(template?.orderIndex ?? 0),
    updated_by: getEntryUserId(user),
    ...getEntryIdentity(user, 'updated_by'),
  }
}

function isDefaultParentEmailTemplateKey(templateKey, audience) {
  const normalizedTemplateKey = String(templateKey ?? '').trim().toLowerCase()

  return getDefaultEmailTemplates(audience).some((template) => template.key === normalizedTemplateKey)
}

export function getDefaultClubParentEmailTemplates(audience = EMAIL_TEMPLATE_AUDIENCES.parent) {
  return getDefaultEmailTemplates(audience)
}

export async function getParentEmailTemplates({ user, includeDisabled = false, audience = EMAIL_TEMPLATE_AUDIENCES.parent } = {}) {
  if (!user?.clubId || !hasPlanFeature(await getPlanGateUser({ user, clubId: user.clubId }), 'parentEmail')) {
    return []
  }

  const normalizedAudience = String(audience ?? '').trim().toLowerCase()

  let query = supabase
    .from('parent_email_templates')
    .select('*')
    .eq('club_id', user.clubId)
    .order('order_index', { ascending: true })
    .order('label', { ascending: true })

  if (!includeDisabled) {
    query = query.eq('is_enabled', true)
  }

  if (normalizedAudience !== 'all') {
    query = query.eq('audience', normalizeEmailTemplateAudience(audience))
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeParentEmailTemplateRow)
}

export async function upsertParentEmailTemplate({ user, template }) {
  await blockDemoMutation(user)

  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  if (Number(user.roleRank ?? 0) < 50 || user.role === 'super_admin') {
    throw new Error('Only managers and above can manage parent email templates.')
  }

  await assertClubFeature({
    user,
    clubId: user.clubId,
    featureName: 'parentEmail',
  })

  const payload = {
    ...normalizeParentEmailTemplatePayload({ user, template }),
    created_by: getEntryUserId(user),
    ...getEntryIdentity(user),
  }

  const { data, error } = await supabase
    .from('parent_email_templates')
    .upsert(payload, {
      onConflict: 'club_id,audience,template_key',
    })
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeParentEmailTemplateRow(data)
}

export async function deleteParentEmailTemplate({ user, template }) {
  await blockDemoMutation(user)

  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  if (Number(user.roleRank ?? 0) < 50 || user.role === 'super_admin') {
    throw new Error('Only managers and above can manage parent email templates.')
  }

  const templateKey = String(template?.key ?? template?.templateKey ?? '').trim().toLowerCase()
  const audience = normalizeEmailTemplateAudience(template?.audience)

  if (!templateKey) {
    throw new Error('Template key is required.')
  }

  if (isDefaultParentEmailTemplateKey(templateKey, audience)) {
    throw new Error('Default templates cannot be deleted.')
  }

  await assertClubFeature({
    user,
    clubId: user.clubId,
    featureName: 'parentEmail',
  })

  const { error } = await supabase
    .from('parent_email_templates')
    .delete()
    .eq('club_id', user.clubId)
    .eq('audience', audience)
    .eq('template_key', templateKey)

  if (error) {
    console.error(error)
    throw error
  }

  return {
    audience,
    key: templateKey,
  }
}
