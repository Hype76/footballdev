import {
  CLUB_LOGOS_BUCKET,
  EVALUATION_SECTIONS,
  MAX_LOGO_FILE_SIZE_BYTES,
  REQUEST_TIMEOUT_MS,
  supabase,
} from '../supabase-client.js'
export { supabase, CLUB_LOGOS_BUCKET, MAX_LOGO_FILE_SIZE_BYTES, EVALUATION_SECTIONS, REQUEST_TIMEOUT_MS } from '../supabase-client.js'
const VIEW_CACHE_PREFIX = 'view-cache:'
const MEMORY_CACHE_TTL_MS = 30 * 1000
const memoryCache = new Map()
const inFlightMemoryRequests = new Map()

export const SYSTEM_ROLE_OPTIONS = [
  { key: 'admin', label: 'Admin', rank: 90, isSystem: true },
  { key: 'head_manager', label: 'Head Manager', rank: 70, isSystem: true },
  { key: 'manager', label: 'Manager', rank: 50, isSystem: true },
  { key: 'coach', label: 'Coach', rank: 30, isSystem: true },
  { key: 'assistant_coach', label: 'Assistant Coach', rank: 20, isSystem: true },
]

const DEFAULT_FORM_FIELDS = [
  {
    id: 'default-technical',
    label: 'Technical',
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 1,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-tactical',
    label: 'Tactical',
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 2,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-physical',
    label: 'Physical',
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 3,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-mentality',
    label: 'Mentality',
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 4,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-coachability',
    label: 'Coachability',
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 5,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-strengths',
    label: 'Strengths',
    type: 'textarea',
    options: [],
    required: false,
    orderIndex: 6,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-improvements',
    label: 'Improvements',
    type: 'textarea',
    options: [],
    required: false,
    orderIndex: 7,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-overall',
    label: 'Overall Comments',
    type: 'textarea',
    options: [],
    required: true,
    orderIndex: 8,
    isDefault: true,
    isEnabled: true,
  },
]

function readMemoryCache(key) {
  if (!key) {
    return null
  }

  const cachedEntry = memoryCache.get(key)

  if (!cachedEntry) {
    return null
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    memoryCache.delete(key)
    return null
  }

  return cachedEntry.value
}

function writeMemoryCache(key, value, ttlMs = MEMORY_CACHE_TTL_MS) {
  if (!key) {
    return value
  }

  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })
  return value
}

function invalidateMemoryCacheByPrefix(prefix) {
  if (!prefix) {
    return
  }

  Array.from(memoryCache.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key)
    }
  })

  Array.from(inFlightMemoryRequests.keys()).forEach((key) => {
    if (key.startsWith(prefix)) {
      inFlightMemoryRequests.delete(key)
    }
  })
}

async function getCachedResource(cacheKey, task, ttlMs = MEMORY_CACHE_TTL_MS) {
  const cachedValue = readMemoryCache(cacheKey)

  if (cachedValue !== null) {
    return cachedValue
  }

  const pendingRequest = inFlightMemoryRequests.get(cacheKey)

  if (pendingRequest) {
    return pendingRequest
  }

  const nextRequest = Promise.resolve()
    .then(task)
    .then((value) => writeMemoryCache(cacheKey, value, ttlMs))
    .finally(() => {
      inFlightMemoryRequests.delete(cacheKey)
    })

  inFlightMemoryRequests.set(cacheKey, nextRequest)
  return nextRequest
}

function normalizeWords(value) {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function slugifyRole(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function getLegacyRoleDefaults(role) {
  const normalizedRole = slugifyRole(role)

  if (normalizedRole === 'super_admin') {
    return { key: 'super_admin', label: 'Super Admin', rank: 100 }
  }

  if (normalizedRole === 'manager') {
    return { key: 'manager', label: 'Manager', rank: 50 }
  }

  if (normalizedRole === 'coach') {
    return { key: 'coach', label: 'Coach', rank: 30 }
  }

  const matchedSystemRole = SYSTEM_ROLE_OPTIONS.find((option) => option.key === normalizedRole)

  if (matchedSystemRole) {
    return matchedSystemRole
  }

  return {
    key: normalizedRole || 'coach',
    label: normalizeWords(normalizedRole.replace(/_/g, ' ')) || 'Coach',
    rank: 10,
  }
}

function normalizeRoleKey(value) {
  return slugifyRole(value) || 'coach'
}

function normalizeRoleLabel(value, roleKey) {
  const normalizedLabel = String(value ?? '').trim()

  if (normalizedLabel) {
    return normalizedLabel
  }

  return getLegacyRoleDefaults(roleKey).label
}

function normalizeRoleRank(value, roleKey) {
  const numericValue = Number(value)

  if (!Number.isNaN(numericValue) && numericValue > 0) {
    return numericValue
  }

  return getLegacyRoleDefaults(roleKey).rank
}

function normalizeFieldType(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()
  const allowedTypes = ['text', 'textarea', 'number', 'select', 'score_1_5', 'score_1_10']

  if (normalizedValue === 'number') {
    return 'score_1_5'
  }

  return allowedTypes.includes(normalizedValue) ? normalizedValue : 'text'
}

function normalizeFieldOptions(options) {
  if (Array.isArray(options)) {
    return options.map((option) => String(option).trim()).filter(Boolean)
  }

  if (typeof options === 'string') {
    return options
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean)
  }

  return []
}

function getClubName(clubs) {
  if (Array.isArray(clubs)) {
    return String(clubs[0]?.name ?? '').trim()
  }

  return String(clubs?.name ?? '').trim()
}

function getClubValue(clubs, key) {
  if (Array.isArray(clubs)) {
    return clubs[0]?.[key]
  }

  return clubs?.[key]
}

function getDisplayName(profile) {
  const username = String(profile?.username ?? '').trim()

  if (username) {
    return username
  }

  const explicitName = String(profile?.name ?? '').trim()

  if (explicitName) {
    return explicitName
  }

  const email = String(profile?.email ?? '').trim().toLowerCase()
  const emailPrefix = email.split('@')[0]?.replace(/[._-]+/g, ' ') || 'Coach User'
  return normalizeWords(emailPrefix)
}

function createDefaultComments() {
  return {
    strengths: '',
    improvements: '',
    overall: '',
    selectedStrengths: [],
  }
}

function normalizeComments(comments) {
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

function normalizeFormResponses(formResponses) {
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

function buildLegacyFormResponses(row) {
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

function createCommentsFromResponses(formResponses) {
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

function buildScoresFromResponses(formResponses) {
  return Object.fromEntries(
    Object.entries(formResponses)
      .filter(([, value]) => typeof value === 'number' && !Number.isNaN(value))
      .map(([label, value]) => [label, value]),
  )
}

function calculateAverageScore(scores = {}) {
  const values = Object.values(scores)
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value))

  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizeEvaluationRow(row) {
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
    clubId: row.club_id ?? row.clubId ?? '',
    coachId: row.coach_id ?? row.coachId ?? '',
    coach: String(row.coach ?? row.coach_name ?? '').trim() || 'Unknown Coach',
    parentName: String(row.parent_name ?? row.parentName ?? '').trim(),
    parentEmail: String(row.parent_email ?? row.parentEmail ?? '').trim(),
    parentContacts,
    session: String(row.session ?? '').trim(),
    date:
      String(row.date ?? '').trim() ||
      (row.created_at ? new Date(row.created_at).toLocaleDateString() : ''),
    scores,
    averageScore: averageScore !== null ? Number(averageScore) : null,
    comments,
    decision: String(row.decision ?? 'Progress').trim() || 'Progress',
    status: String(row.status ?? 'Submitted').trim() || 'Submitted',
    rejectionReason: String(row.rejection_reason ?? row.rejectionReason ?? '').trim(),
    reviewedBy: row.reviewed_by ?? row.reviewedBy ?? '',
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? '',
    createdAt: Number.isNaN(createdAtValue) ? Date.now() : createdAtValue,
    formResponses,
  }
}

function mapEvaluationToRow(data) {
  const parentContacts = normalizeParentContacts(data.parentContacts, {
    parentName: data.parentName,
    parentEmail: data.parentEmail,
  })
  const primaryParent = parentContacts[0] ?? { name: '', email: '' }

  return {
    player_name: data.playerName,
    player_id: data.playerId || null,
    team: data.team,
    team_id: data.teamId || null,
    section: data.section || 'Trial',
    club_id: data.clubId,
    coach_id: data.coachId,
    coach: data.coach,
    parent_name: primaryParent.name,
    parent_email: primaryParent.email,
    parent_contacts: parentContacts,
    session: data.session,
    date: data.date,
    scores: data.scores,
    average_score: data.averageScore,
    comments: data.comments,
    form_responses: data.formResponses,
    decision: data.decision,
    status: data.status,
    rejection_reason: data.rejectionReason || null,
    reviewed_by: data.reviewedBy || null,
    reviewed_at: data.reviewedAt || null,
    created_at: data.createdAt || new Date().toISOString(),
  }
}

function normalizePlayerRow(row) {
  const positions = Array.isArray(row.positions)
    ? row.positions.map((position) => String(position ?? '').trim()).filter(Boolean)
    : []
  const parentContacts = normalizeParentContacts(row.parent_contacts, {
    parentName: row.parent_name ?? row.parentName,
    parentEmail: row.parent_email ?? row.parentEmail,
  })

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    playerName: String(row.player_name ?? row.playerName ?? '').trim(),
    section: String(row.section ?? 'Trial').trim() || 'Trial',
    team: String(row.team ?? '').trim(),
    positions,
    parentName: parentContacts[0]?.name ?? '',
    parentEmail: parentContacts[0]?.email ?? '',
    parentContacts,
    notes: String(row.notes ?? '').trim(),
    status: String(row.status ?? 'active').trim() || 'active',
    promotedAt: row.promoted_at ?? row.promotedAt ?? '',
    promotedBy: row.promoted_by ?? row.promotedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function normalizeAssessmentSessionRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    team: String(row.team ?? '').trim(),
    opponent: String(row.opponent ?? '').trim(),
    sessionType: String(row.session_type ?? row.sessionType ?? 'training').trim() || 'training',
    sessionDate: String(row.session_date ?? row.sessionDate ?? '').trim(),
    title: String(row.title ?? '').trim(),
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function normalizeAssessmentSessionPlayerRow(row) {
  const playerRow = Array.isArray(row.players) ? row.players[0] : row.players
  const parentContacts = normalizeParentContacts(row.parent_contacts ?? playerRow?.parent_contacts, {
    parentName: row.parent_name ?? playerRow?.parent_name,
    parentEmail: row.parent_email ?? playerRow?.parent_email,
  })

  return {
    id: row.id,
    sessionId: row.session_id ?? row.sessionId ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    playerName: String(row.player_name ?? playerRow?.player_name ?? row.playerName ?? '').trim(),
    section: String(row.section ?? playerRow?.section ?? 'Trial').trim() || 'Trial',
    team: String(row.team ?? playerRow?.team ?? '').trim(),
    parentName: parentContacts[0]?.name ?? '',
    parentEmail: parentContacts[0]?.email ?? '',
    parentContacts,
    notes: String(row.notes ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

export function normalizeParentContacts(parentContacts, fallback = {}) {
  const contacts = Array.isArray(parentContacts) ? parentContacts : []
  const normalizedContacts = contacts
    .map((contact) => ({
      name: String(contact?.name ?? contact?.parentName ?? '').trim(),
      email: String(contact?.email ?? contact?.parentEmail ?? '').trim(),
    }))
    .filter((contact) => contact.name || contact.email)

  if (normalizedContacts.length > 0) {
    return normalizedContacts
  }

  const fallbackName = String(fallback.parentName ?? fallback.parent_name ?? '').trim()
  const fallbackEmail = String(fallback.parentEmail ?? fallback.parent_email ?? '').trim()

  return fallbackName || fallbackEmail
    ? [
        {
          name: fallbackName,
          email: fallbackEmail,
        },
      ]
    : []
}

export function formatParentContactNames(parentContacts, fallbackName = '') {
  const contacts = normalizeParentContacts(parentContacts, {
    parentName: fallbackName,
  }).filter((contact) => contact.name)

  if (contacts.length === 0) {
    return String(fallbackName ?? '').trim()
  }

  if (contacts.length === 1) {
    return contacts[0].name
  }

  return `${contacts.slice(0, -1).map((contact) => contact.name).join(', ')} and ${contacts[contacts.length - 1].name}`
}

export function formatParentContactEmails(parentContacts, fallbackEmail = '') {
  const contacts = normalizeParentContacts(parentContacts, {
    parentEmail: fallbackEmail,
  }).filter((contact) => contact.email)

  return [...new Set(contacts.map((contact) => contact.email))].join(',')
}

function normalizePlatformFeedbackRow(row) {
  const clubRow = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs
  const userRow = Array.isArray(row.users) ? row.users[0] : row.users
  const votes = Array.isArray(row.platform_feedback_votes) ? row.platform_feedback_votes : []
  const commentRows = Array.isArray(row.platform_feedback_comments) ? row.platform_feedback_comments : []
  const comments = commentRows.map((comment) => {
    const commentUser = Array.isArray(comment.users) ? comment.users[0] : comment.users

    return {
      id: comment.id,
      feedbackId: comment.feedback_id ?? comment.feedbackId ?? '',
      createdBy: comment.created_by ?? comment.createdBy ?? '',
      createdByEmail: String(commentUser?.email ?? comment.createdByEmail ?? '').trim(),
      message: String(comment.message ?? '').trim(),
      createdAt: comment.created_at ?? comment.createdAt ?? '',
    }
  }).filter((comment) => comment.message)

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    clubName: String(clubRow?.name ?? row.clubName ?? '').trim() || 'Unknown club',
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByEmail: String(userRow?.email ?? row.createdByEmail ?? '').trim(),
    message: String(row.message ?? '').trim(),
    status: String(row.status ?? 'open').trim() || 'open',
    adminNote: String(row.admin_note ?? row.adminNote ?? '').trim(),
    comments,
    voteCount: Number(row.vote_count ?? row.voteCount ?? votes.length ?? 0),
    hasVoted: Boolean(row.has_voted ?? row.hasVoted ?? false),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function mapPlayerToRow(player, user) {
  const positions = Array.isArray(player.positions)
    ? player.positions.map((position) => String(position ?? '').trim()).filter(Boolean)
    : []
  const parentContacts = normalizeParentContacts(player.parentContacts, {
    parentName: player.parentName,
    parentEmail: player.parentEmail,
  })
  const primaryParent = parentContacts[0] ?? { name: '', email: '' }

  return {
    club_id: player.clubId ?? user?.clubId ?? '',
    player_name: normalizeWords(player.playerName),
    section: EVALUATION_SECTIONS.includes(player.section) ? player.section : 'Trial',
    team: String(player.team ?? '').trim(),
    positions,
    parent_name: primaryParent.name,
    parent_email: primaryParent.email,
    parent_contacts: parentContacts,
    notes: String(player.notes ?? '').trim(),
  }
}

export async function withRequestTimeout(task, message = 'Request timed out.', timeoutMs = REQUEST_TIMEOUT_MS) {
  let timeoutId

  try {
    const operation = typeof task === 'function' ? task() : task

    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(message))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId)
    }
  }
}

export function readViewCache(cacheKey) {
  if (!cacheKey) {
    return null
  }

  try {
    const storedValue = sessionStorage.getItem(`${VIEW_CACHE_PREFIX}${cacheKey}`)

    if (!storedValue) {
      return null
    }

    const parsedValue = JSON.parse(storedValue)
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : null
  } catch (error) {
    console.error(error)
    return null
  }
}

export function readViewCacheValue(cacheKey, propertyName, fallbackValue) {
  const cachedValue = readViewCache(cacheKey)

  if (!cachedValue || !(propertyName in cachedValue)) {
    return fallbackValue
  }

  return cachedValue[propertyName]
}

export function writeViewCache(cacheKey, value) {
  if (!cacheKey) {
    return
  }

  try {
    sessionStorage.setItem(`${VIEW_CACHE_PREFIX}${cacheKey}`, JSON.stringify(value))
  } catch (error) {
    console.error(error)
  }
}

export function clearViewCaches() {
  try {
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith(VIEW_CACHE_PREFIX))
      .forEach((key) => sessionStorage.removeItem(key))
  } catch (error) {
    console.error(error)
  }
}

function normalizeFormFieldRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    label: String(row.label ?? '').trim(),
    type: normalizeFieldType(row.type),
    options: normalizeFieldOptions(row.options),
    required: Boolean(row.required),
    orderIndex: Number(row.order_index ?? row.orderIndex ?? 0),
    isDefault: Boolean(row.is_default ?? row.isDefault),
    isEnabled: Boolean(row.is_enabled ?? row.isEnabled ?? true),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

function mapFormFieldToRow(field, user, orderIndex) {
  const payload = {}

  if (field.clubId !== undefined || user?.clubId) {
    payload.club_id = field.clubId ?? user?.clubId ?? ''
  }

  if (field.label !== undefined) {
    payload.label = String(field.label ?? '').trim()
  }

  if (field.type !== undefined) {
    payload.type = normalizeFieldType(field.type)
  }

  if (field.options !== undefined) {
    payload.options = normalizeFieldOptions(field.options)
  }

  if (field.required !== undefined) {
    payload.required = Boolean(field.required)
  }

  if (orderIndex !== undefined) {
    payload.order_index = orderIndex
  }

  if (field.isDefault !== undefined) {
    payload.is_default = Boolean(field.isDefault)
  }

  if (field.isEnabled !== undefined) {
    payload.is_enabled = Boolean(field.isEnabled)
  }

  return payload
}

function normalizeClubRoleRow(row) {
  const roleKey = normalizeRoleKey(row.role_key ?? row.roleKey)

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    roleKey,
    roleLabel: normalizeRoleLabel(row.role_label ?? row.roleLabel, roleKey),
    roleRank: normalizeRoleRank(row.role_rank ?? row.roleRank, roleKey),
    isSystem: Boolean(row.is_system ?? row.isSystem),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

function normalizeClubInviteRow(row) {
  const roleKey = normalizeRoleKey(row.role_key ?? row.roleKey)

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    email: String(row.email ?? '').trim().toLowerCase(),
    roleKey,
    roleLabel: normalizeRoleLabel(row.role_label ?? row.roleLabel, roleKey),
    roleRank: normalizeRoleRank(row.role_rank ?? row.roleRank, roleKey),
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

function normalizePlatformClubRow(row) {
  return {
    id: row.id,
    name: String(row.name ?? '').trim() || 'Unnamed club',
    contactEmail: String(row.contact_email ?? '').trim(),
    contactPhone: String(row.contact_phone ?? '').trim(),
    status: String(row.status ?? 'active').trim() || 'active',
    suspendedAt: row.suspended_at ?? '',
    createdAt: row.created_at ?? '',
  }
}

export function getDefaultFormFields() {
  return DEFAULT_FORM_FIELDS.map((field) => ({ ...field }))
}

export function getDefaultClubRoles() {
  return SYSTEM_ROLE_OPTIONS.map((role) => ({ ...role }))
}

async function seedDefaultFormFields() {
  const { error } = await supabase.rpc('seed_default_form_fields')

  if (error) {
    console.error(error)
    throw error
  }
}

function normalizeDateOnly(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

export async function seedDefaultClubRolesForClub(clubId) {
  if (!clubId) {
    return
  }

  const { error } = await supabase.rpc('seed_default_club_roles', {
    target_club_id: clubId,
  })

  if (error) {
    console.error(error)
    throw error
  }
}

function normalizeClubMembershipRow(row) {
  const clubRow = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs
  const roleKey = normalizeRoleKey(row.role ?? row.roleKey)

  return {
    id: row.id,
    authUserId: row.auth_user_id ?? row.authUserId ?? '',
    email: String(row.email ?? '').trim().toLowerCase(),
    username: String(row.username ?? '').trim(),
    name: String(row.name ?? '').trim(),
    role: roleKey,
    roleLabel: normalizeRoleLabel(row.role_label ?? row.roleLabel, roleKey),
    roleRank: normalizeRoleRank(row.role_rank ?? row.roleRank, roleKey),
    clubId: row.club_id ?? row.clubId ?? '',
    clubName: String(clubRow?.name ?? row.clubName ?? '').trim(),
    clubLogoUrl: String(clubRow?.logo_url ?? row.clubLogoUrl ?? '').trim(),
    clubContactEmail: String(clubRow?.contact_email ?? row.clubContactEmail ?? '').trim(),
    clubContactPhone: String(clubRow?.contact_phone ?? row.clubContactPhone ?? '').trim(),
    clubStatus: String(clubRow?.status ?? row.clubStatus ?? 'active').trim() || 'active',
    clubSuspendedAt: clubRow?.suspended_at ?? row.clubSuspendedAt ?? '',
    requireApproval: Boolean(clubRow?.require_approval ?? row.requireApproval ?? true),
  }
}

async function fetchClubDetails(clubId) {
  if (!clubId) {
    return null
  }

  return getCachedResource(`club:${clubId}`, async () => {
    const { data, error } = await supabase
      .from('clubs')
      .select('id, name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at')
      .eq('id', clubId)
      .maybeSingle()

    if (error) {
      console.error(error)
      throw error
    }

    return data
  })
}

export function normalizeUserProfile(profile) {
  const baseRole = getLegacyRoleDefaults(profile.role)
  const roleKey = normalizeRoleKey(profile.role ?? baseRole.key)
  const roleLabel = normalizeRoleLabel(profile.role_label ?? profile.roleLabel, roleKey)
  const roleRank = normalizeRoleRank(profile.role_rank ?? profile.roleRank, roleKey)
  const clubName =
    getClubName(profile.clubs) ||
    String(profile.team ?? '').trim() ||
    (roleKey === 'super_admin' ? 'Platform' : 'Unassigned Club')

  return {
    id: profile.id,
    email: String(profile.email ?? '').trim().toLowerCase(),
    username: String(profile.username ?? '').trim(),
    name: getDisplayName(profile),
    role: roleKey,
    roleLabel,
    roleRank,
    clubId: profile.club_id ?? profile.clubId ?? '',
    clubName,
    team: clubName,
    clubLogoUrl: String(getClubValue(profile.clubs, 'logo_url') ?? profile.clubLogoUrl ?? '').trim(),
    clubContactEmail: String(getClubValue(profile.clubs, 'contact_email') ?? profile.clubContactEmail ?? '').trim(),
    clubContactPhone: String(getClubValue(profile.clubs, 'contact_phone') ?? profile.clubContactPhone ?? '').trim(),
    clubStatus: String(getClubValue(profile.clubs, 'status') ?? profile.clubStatus ?? 'active').trim() || 'active',
    clubSuspendedAt: getClubValue(profile.clubs, 'suspended_at') ?? profile.clubSuspendedAt ?? '',
    requireApproval: Boolean(getClubValue(profile.clubs, 'require_approval') ?? profile.requireApproval ?? true),
    activeTeamId: String(profile.activeTeamId ?? '').trim(),
    activeTeamName: String(profile.activeTeamName ?? '').trim(),
  }
}

async function upsertClubMembershipFromInvite(authUser, invite) {
  const displayName = getDisplayName(authUser)
  const normalizedEmail = String(authUser?.email ?? invite.email ?? '').trim().toLowerCase()

  const { data, error } = await supabase
    .from('user_club_memberships')
    .upsert(
      {
        auth_user_id: authUser.id,
        email: normalizedEmail,
        username: displayName,
        name: displayName,
        role: invite.roleKey,
        role_label: invite.roleLabel,
        role_rank: invite.roleRank,
        club_id: invite.clubId,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'auth_user_id,club_id',
      },
    )
    .select('*, clubs:club_id (name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at)')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeClubMembershipRow(data)
}

async function claimInvitedUserProfiles(authUser) {
  const normalizedEmail = String(authUser?.email ?? '').trim().toLowerCase()

  if (!normalizedEmail) {
    return []
  }

  const { data: inviteRows, error: inviteError } = await supabase
    .from('club_user_invites')
    .select('*')
    .eq('email', normalizedEmail)
    .is('accepted_at', null)

  if (inviteError) {
    console.error(inviteError)
    throw inviteError
  }

  if (!inviteRows?.length) {
    return []
  }

  const memberships = await Promise.all(inviteRows.map((inviteRow) => upsertClubMembershipFromInvite(authUser, normalizeClubInviteRow(inviteRow))))
  const { error: inviteUpdateError } = await supabase
    .from('club_user_invites')
    .update({
      accepted_at: new Date().toISOString(),
    })
    .eq('email', normalizedEmail)
    .is('accepted_at', null)

  if (inviteUpdateError) {
    console.error(inviteUpdateError)
  }

  return memberships
}

async function getUserClubMemberships(authUser) {
  const normalizedEmail = String(authUser?.email ?? '').trim().toLowerCase()

  if (!authUser?.id && !normalizedEmail) {
    return []
  }

  const { data, error } = await supabase
    .from('user_club_memberships')
    .select('*, clubs:club_id (name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at)')
    .or(`auth_user_id.eq.${authUser.id},email.eq.${normalizedEmail}`)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeClubMembershipRow)
}

async function syncMembershipFromUserRow(data, authUser) {
  if (!data?.club_id || data.role === 'super_admin') {
    return null
  }

  const { data: membershipRow, error } = await supabase
    .from('user_club_memberships')
    .upsert(
      {
        auth_user_id: authUser.id,
        email: String(data.email ?? authUser.email ?? '').trim().toLowerCase(),
        username: String(data.username ?? '').trim(),
        name: String(data.name ?? '').trim(),
        role: data.role,
        role_label: data.role_label,
        role_rank: data.role_rank,
        club_id: data.club_id,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'auth_user_id,club_id',
      },
    )
    .select('*, clubs:club_id (name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at)')
    .single()

  if (error) {
    console.error(error)
    return null
  }

  return normalizeClubMembershipRow(membershipRow)
}

async function applyActiveMembership(authUser, membership) {
  const normalizedEmail = String(authUser?.email ?? membership.email ?? '').trim().toLowerCase()
  const displayName = getDisplayName({
    ...authUser,
    email: normalizedEmail,
    username: membership.username,
    name: membership.name,
  })

  const payload = {
    id: authUser.id,
    email: normalizedEmail,
    username: membership.username || displayName,
    name: membership.name || displayName,
    role: membership.role,
    role_label: membership.roleLabel,
    role_rank: membership.roleRank,
    club_id: membership.clubId,
  }

  const { data, error } = await supabase
    .from('users')
    .upsert(payload, {
      onConflict: 'id',
    })
    .select('id, email, username, name, role, role_label, role_rank, club_id, force_password_change')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`user-profile:${authUser.id}`)
  return data
}

export async function selectUserClub(authUser, clubId) {
  if (!authUser?.id || !clubId) {
    throw new Error('Choose a club to continue.')
  }

  await claimInvitedUserProfiles(authUser)
  const memberships = await getUserClubMemberships(authUser)
  const selectedMembership = memberships.find((membership) => String(membership.clubId) === String(clubId))

  if (!selectedMembership) {
    throw new Error('This club is not linked to your account.')
  }

  const data = await applyActiveMembership(authUser, selectedMembership)
  return normalizeUserProfile({
    ...data,
    clubs: {
      name: selectedMembership.clubName,
      logo_url: selectedMembership.clubLogoUrl,
      contact_email: selectedMembership.clubContactEmail,
      contact_phone: selectedMembership.clubContactPhone,
      require_approval: selectedMembership.requireApproval,
      status: selectedMembership.clubStatus,
      suspended_at: selectedMembership.clubSuspendedAt,
    },
  })
}

export async function fetchUserProfile(authUser, options = {}) {
  const selectedClubId = String(options.selectedClubId ?? '').trim()
  const cacheKey = `user-profile:${authUser?.id || ''}:${selectedClubId || 'active'}`

  if (!authUser?.id) {
    throw new Error('User profile not found.')
  }

  return getCachedResource(cacheKey, async () => {
    const loadUserRow = async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, username, name, role, role_label, role_rank, club_id, force_password_change')
        .eq('id', authUser.id)
        .maybeSingle()

      if (error) {
        console.error(error)
        throw error
      }

      return data
    }

    let data = await loadUserRow()

    if (data?.role === 'super_admin') {
      return normalizeUserProfile({
        ...data,
        email: data.email || authUser.email,
      })
    }

    await claimInvitedUserProfiles(authUser)

    if (!data) {
      const memberships = await getUserClubMemberships(authUser)

      if (memberships.length === 0) {
        throw new Error('User profile not found.')
      }

      if (memberships.length > 1 && !selectedClubId) {
        return {
          requiresClubSelection: true,
          clubOptions: memberships,
        }
      }

      const selectedMembership =
        memberships.find((membership) => String(membership.clubId) === selectedClubId) ?? memberships[0]
      data = await applyActiveMembership(authUser, selectedMembership)
    } else {
      await syncMembershipFromUserRow(data, authUser)
    }

    const authEmail = String(authUser.email ?? '').trim().toLowerCase()
    const profileEmail = String(data.email ?? '').trim().toLowerCase()

    if (authEmail && authEmail !== profileEmail) {
      const { data: syncedData, error: syncError } = await supabase
        .from('users')
        .update({
          email: authEmail,
        })
        .eq('id', authUser.id)
        .select('id, email, username, name, role, role_label, role_rank, club_id, force_password_change')
        .single()

      if (syncError) {
        console.error(syncError)
      } else {
        data = syncedData
      }
    }

    const memberships = data.role === 'super_admin' ? [] : await getUserClubMemberships(authUser)
    if (memberships.length > 1 && !selectedClubId) {
      return {
        requiresClubSelection: true,
        clubOptions: memberships,
      }
    }

    if (memberships.length > 1 && selectedClubId && String(data.club_id) !== selectedClubId) {
      const selectedMembership = memberships.find((membership) => String(membership.clubId) === selectedClubId)

      if (!selectedMembership) {
        return {
          requiresClubSelection: true,
          clubOptions: memberships,
        }
      }

      data = await applyActiveMembership(authUser, selectedMembership)
    }

    let clubData = null

    if (data.club_id) {
      try {
        clubData = await fetchClubDetails(data.club_id)
      } catch (error) {
        console.error(error)
      }
    }

    return normalizeUserProfile({
      ...data,
      clubs: clubData,
      email: data.email || authUser.email,
    })
  })
}

export async function createClubAndManagerProfile({ authUser, clubName }) {
  const { data: club, error: clubError } = await supabase
    .from('clubs')
    .insert({
      name: String(clubName ?? '').trim(),
    })
    .select('id, name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at')
    .single()

  if (clubError) {
    console.error(clubError)
    throw clubError
  }

  await seedDefaultClubRolesForClub(club.id)

  const { data: userProfile, error: userError } = await supabase
    .from('users')
    .insert({
      id: authUser.id,
      email: authUser.email,
      username: getDisplayName(authUser),
      name: getDisplayName(authUser),
      role: 'admin',
      role_label: 'Admin',
      role_rank: 90,
      club_id: club.id,
    })
    .select('id, email, username, name, role, role_label, role_rank, club_id, force_password_change')
    .single()

  if (userError) {
    console.error(userError)
    throw userError
  }

  await syncMembershipFromUserRow(userProfile, authUser)

  return normalizeUserProfile({
    ...userProfile,
    clubs: club,
  })
}

export async function updateOwnUserSettings({ authUser, username }) {
  if (!authUser?.id) {
    throw new Error('Signed in user is required.')
  }

  const normalizedUsername = normalizeWords(username)

  if (!normalizedUsername) {
    throw new Error('Username is required.')
  }

  const { data, error } = await supabase
    .from('users')
    .update({
      username: normalizedUsername,
      name: normalizedUsername,
    })
    .eq('id', authUser.id)
    .select('id, email, username, name, role, role_label, role_rank, club_id, force_password_change')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  const { error: authError } = await supabase.auth.updateUser({
    data: {
      username: normalizedUsername,
      name: normalizedUsername,
    },
  })

  if (authError) {
    console.error(authError)
  }

  invalidateMemoryCacheByPrefix(`user-profile:${authUser.id}`)

  let clubData = null

  if (data.club_id) {
    try {
      clubData = await fetchClubDetails(data.club_id)
    } catch (clubError) {
      console.error(clubError)
    }
  }

  return normalizeUserProfile({
    ...data,
    clubs: clubData,
  })
}

export async function requestLoginEmailChange({ authUser, email }) {
  if (!authUser?.id) {
    throw new Error('Signed in user is required.')
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase()

  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  if (normalizedEmail === String(authUser.email ?? '').trim().toLowerCase()) {
    return {
      email: normalizedEmail,
      pendingConfirmation: false,
    }
  }

  const { data, error } = await supabase.auth.updateUser({
    email: normalizedEmail,
  })

  if (error) {
    console.error(error)
    throw error
  }

  const confirmedEmail = String(data?.user?.email ?? '').trim().toLowerCase()
  const isConfirmedImmediately = confirmedEmail === normalizedEmail

  if (isConfirmedImmediately) {
    const { error: profileError } = await supabase
      .from('users')
      .update({
        email: normalizedEmail,
      })
      .eq('id', authUser.id)

    if (profileError) {
      console.error(profileError)
      throw profileError
    }

    invalidateMemoryCacheByPrefix(`user-profile:${authUser.id}`)
  }

  return {
    email: normalizedEmail,
    pendingConfirmation: !isConfirmedImmediately,
  }
}

export async function updateSignedInPassword(password) {
  const normalizedPassword = String(password ?? '')

  if (normalizedPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }

  const { error } = await supabase.auth.updateUser({
    password: normalizedPassword,
  })

  if (error) {
    console.error(error)
    throw error
  }
}

export async function getClubSettings(clubId) {
  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  const data = await getCachedResource(`club-settings:${clubId}`, () => fetchClubDetails(clubId))

  if (!data) {
    throw new Error('Club not found.')
  }

  return {
    id: data.id,
    name: String(data.name ?? '').trim(),
    logoUrl: String(data.logo_url ?? '').trim(),
    contactEmail: String(data.contact_email ?? '').trim(),
    contactPhone: String(data.contact_phone ?? '').trim(),
    requireApproval: Boolean(data.require_approval ?? true),
  }
}

export async function updateClubSettings({ clubId, data }) {
  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  const payload = {
    name: String(data.name ?? '').trim(),
    logo_url: String(data.logoUrl ?? '').trim(),
    contact_email: String(data.contactEmail ?? '').trim(),
    contact_phone: String(data.contactPhone ?? '').trim(),
  }

  if (data.requireApproval !== undefined) {
    payload.require_approval = Boolean(data.requireApproval)
  }

  const { data: updatedClub, error } = await supabase
    .from('clubs')
    .update(payload)
    .eq('id', clubId)
    .select('id, name, logo_url, contact_email, contact_phone, require_approval')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`club-settings:${clubId}`)
  invalidateMemoryCacheByPrefix(`club:${clubId}`)
  invalidateMemoryCacheByPrefix('user-profile:')

  return {
    id: updatedClub.id,
    name: String(updatedClub.name ?? '').trim(),
    logoUrl: String(updatedClub.logo_url ?? '').trim(),
    contactEmail: String(updatedClub.contact_email ?? '').trim(),
    contactPhone: String(updatedClub.contact_phone ?? '').trim(),
    requireApproval: Boolean(updatedClub.require_approval ?? true),
  }
}

function appendLogoCacheBuster(url) {
  const normalizedUrl = String(url ?? '').trim()

  if (!normalizedUrl) {
    return ''
  }

  const separator = normalizedUrl.includes('?') ? '&' : '?'
  return `${normalizedUrl}${separator}v=${Date.now()}`
}

function isStoredClubLogoUrl(clubId, logoUrl) {
  const normalizedLogoUrl = String(logoUrl ?? '').trim()

  if (!clubId || !normalizedLogoUrl) {
    return false
  }

  try {
    const parsedUrl = new URL(normalizedLogoUrl)
    return parsedUrl.pathname.includes(`/storage/v1/object/public/${CLUB_LOGOS_BUCKET}/${clubId}/logo.png`)
  } catch {
    return false
  }
}

function getLogoContentType(url, response, blob) {
  const headerType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const blobType = String(blob.type ?? '').trim().toLowerCase()

  if (headerType.startsWith('image/')) {
    return headerType
  }

  if (blobType.startsWith('image/')) {
    return blobType
  }

  const pathname = url.pathname.toLowerCase()

  if (pathname.endsWith('.png')) {
    return 'image/png'
  }

  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
    return 'image/jpeg'
  }

  if (pathname.endsWith('.webp')) {
    return 'image/webp'
  }

  if (pathname.endsWith('.gif')) {
    return 'image/gif'
  }

  if (pathname.endsWith('.svg')) {
    return 'image/svg+xml'
  }

  return ''
}

async function uploadClubLogoBlob({ clubId, blob }) {
  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  if (!(blob instanceof Blob)) {
    throw new Error('A logo image is required.')
  }

  if (!String(blob.type ?? '').toLowerCase().startsWith('image/')) {
    throw new Error('Logo must be an image file.')
  }

  if (blob.size > MAX_LOGO_FILE_SIZE_BYTES) {
    throw new Error('Logo must be 2MB or smaller.')
  }

  const objectPath = `${clubId}/logo.png`
  const { error: uploadError } = await supabase.storage.from(CLUB_LOGOS_BUCKET).upload(objectPath, blob, {
    cacheControl: '3600',
    contentType: blob.type || 'image/png',
    upsert: true,
  })

  if (uploadError) {
    console.error(uploadError)
    throw uploadError
  }

  const { data } = supabase.storage.from(CLUB_LOGOS_BUCKET).getPublicUrl(objectPath)
  const publicUrl = String(data?.publicUrl ?? '').trim()

  if (!publicUrl) {
    throw new Error('Could not generate logo URL.')
  }

  return appendLogoCacheBuster(publicUrl)
}

export async function uploadClubLogo({ clubId, file }) {
  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  if (!(file instanceof File)) {
    throw new Error('A logo file is required.')
  }

  if (!String(file.type ?? '').toLowerCase().startsWith('image/')) {
    throw new Error('Logo must be an image file.')
  }

  if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
    throw new Error('Logo must be 2MB or smaller.')
  }

  return uploadClubLogoBlob({ clubId, blob: file })
}

export async function importClubLogoFromUrl({ clubId, logoUrl }) {
  const normalizedLogoUrl = String(logoUrl ?? '').trim()

  if (!clubId) {
    throw new Error('Club ID is required.')
  }

  if (!normalizedLogoUrl) {
    return ''
  }

  if (isStoredClubLogoUrl(clubId, normalizedLogoUrl)) {
    return normalizedLogoUrl
  }

  let parsedUrl

  try {
    parsedUrl = new URL(normalizedLogoUrl)
  } catch {
    throw new Error('Enter a valid logo URL.')
  }

  let response

  try {
    response = await fetch(parsedUrl.toString(), {
      mode: 'cors',
    })
  } catch (error) {
    console.error(error)
    throw new Error('Logo image could not be downloaded. Upload the image file instead.')
  }

  if (!response.ok) {
    throw new Error('Logo image could not be downloaded. Upload the image file instead.')
  }

  const blob = await response.blob()
  const contentType = getLogoContentType(parsedUrl, response, blob)

  if (!contentType) {
    throw new Error('That URL did not download as an image. Upload the image file instead.')
  }

  return uploadClubLogoBlob({
    clubId,
    blob: new Blob([blob], {
      type: contentType,
    }),
  })
}

export async function getClubRoles(user) {
  if (!user?.clubId) {
    return []
  }

  const loadRoles = async () => {
    const { data, error } = await supabase
      .from('club_roles')
      .select('*')
      .eq('club_id', user.clubId)
      .order('role_rank', { ascending: false })
      .order('role_label', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeClubRoleRow)
  }

  let roles = await loadRoles()

  if (roles.length === 0) {
    await seedDefaultClubRolesForClub(user.clubId)
    roles = await loadRoles()
  }

  return roles
}

export async function createClubRole({ user, label, rank = 10 }) {
  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  const roleLabel = normalizeWords(label)
  const roleKey = normalizeRoleKey(label)
  const roleRank = Number(rank)

  const { data, error } = await supabase
    .from('club_roles')
    .upsert(
      {
        club_id: user.clubId,
        role_key: roleKey,
        role_label: roleLabel,
        role_rank: Number.isNaN(roleRank) ? 10 : roleRank,
        is_system: false,
      },
      {
        onConflict: 'club_id,role_key',
      },
    )
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeClubRoleRow(data)
}

export async function getClubUsers(user) {
  if (!user?.clubId) {
    return []
  }

  return getCachedResource(`club-users:${user.clubId}`, async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, username, name, role, role_label, role_rank, club_id, force_password_change')
      .eq('club_id', user.clubId)
      .order('role_rank', { ascending: false })
      .order('email', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map((profile) => normalizeUserProfile(profile))
  })
}

export async function getClubUserInvites(user) {
  if (!user?.clubId) {
    return []
  }

  const { data, error } = await supabase
    .from('club_user_invites')
    .select('*')
    .eq('club_id', user.clubId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeClubInviteRow)
}

function normalizeTeamRow(row) {
  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    name: String(row.name ?? '').trim(),
    requireApproval: Boolean(row.require_approval ?? row.requireApproval ?? true),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

function normalizeTeamStaffRow(row) {
  return {
    id: row.id,
    teamId: row.team_id ?? row.teamId ?? '',
    userId: row.user_id ?? row.userId ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

export async function getTeams(user) {
  if (!user?.clubId && user?.role !== 'super_admin') {
    return []
  }

  const cacheKey = user.role === 'super_admin' ? 'teams:super-admin' : `teams:${user.clubId}`

  return getCachedResource(cacheKey, async () => {
    let query = supabase.from('teams').select('*').order('name', { ascending: true })

    if (user.role !== 'super_admin') {
      query = query.eq('club_id', user.clubId)
    }

    const { data, error } = await query

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeTeamRow)
  })
}

export async function updateTeamSettings({ teamId, data }) {
  if (!teamId) {
    throw new Error('Team ID is required.')
  }

  const { data: currentTeam, error: currentTeamError } = await supabase
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .single()

  if (currentTeamError) {
    console.error(currentTeamError)
    throw currentTeamError
  }

  const previousTeamName = String(currentTeam.name ?? '').trim()
  const payload = {}

  if (data.name !== undefined) {
    payload.name = String(data.name ?? '').trim()
  }

  if (data.requireApproval !== undefined) {
    payload.require_approval = Boolean(data.requireApproval)
  }

  const { data: updatedTeam, error } = await supabase
    .from('teams')
    .update(payload)
    .eq('id', teamId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('teams:')
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('players:')

  if (payload.name && payload.name !== previousTeamName) {
    const linkedUpdateResults = await Promise.all([
      supabase.from('players').update({ team: payload.name }).eq('team', previousTeamName).eq('club_id', updatedTeam.club_id),
      supabase.from('evaluations').update({ team: payload.name }).eq('team', previousTeamName).eq('club_id', updatedTeam.club_id),
      supabase.from('evaluations').update({ team: payload.name }).eq('team_id', teamId).eq('club_id', updatedTeam.club_id),
    ])
    const firstLinkedUpdateError = linkedUpdateResults.find((result) => result.error)?.error

    if (firstLinkedUpdateError) {
      console.error(firstLinkedUpdateError)
      throw firstLinkedUpdateError
    }
  }

  return normalizeTeamRow(updatedTeam)
}

export async function getAvailableTeamsForUser(user) {
  if (!user) {
    return []
  }

  if (user.role === 'super_admin' || user.role === 'admin') {
    return getTeams(user)
  }

  if (!user.clubId) {
    return []
  }

  return getCachedResource(`available-teams:${user.id}:${user.clubId}`, async () => {
    const { data: assignmentRows, error: assignmentError } = await supabase
      .from('team_staff')
      .select('team_id')
      .eq('user_id', user.id)

    if (assignmentError) {
      console.error(assignmentError)
      throw assignmentError
    }

    const teamIds = [...new Set((assignmentRows ?? []).map((row) => String(row.team_id ?? '').trim()).filter(Boolean))]

    if (teamIds.length === 0) {
      return []
    }

    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('club_id', user.clubId)
      .in('id', teamIds)
      .order('name', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    const teams = (data ?? []).map(normalizeTeamRow)
    const activeTeamId = String(user.activeTeamId ?? '').trim()

    if (!activeTeamId) {
      return teams
    }

    const activeTeam = teams.find((team) => String(team.id) === activeTeamId)
    return activeTeam ? [activeTeam] : teams
  })
}

export async function getAssignedTeamsForUser(user) {
  if (!user?.id || !user?.clubId || user.role === 'super_admin') {
    return []
  }

  return getCachedResource(`assigned-teams:${user.id}:${user.clubId}`, async () => {
    const [{ data: assignmentRows, error: assignmentError }, { data: clubTeams, error: teamsError }] = await Promise.all([
      supabase.from('team_staff').select('team_id').eq('user_id', user.id),
      supabase.from('teams').select('*').eq('club_id', user.clubId).order('name', { ascending: true }),
    ])

    if (assignmentError || teamsError) {
      const error = assignmentError || teamsError
      console.error(error)
      throw error
    }

    const teams = (clubTeams ?? []).map(normalizeTeamRow)
    const teamIds = [...new Set((assignmentRows ?? []).map((row) => String(row.team_id ?? '').trim()).filter(Boolean))]

    if (teamIds.length === 0) {
      return teams.length === 1 ? teams : []
    }

    return teams.filter((team) => teamIds.includes(String(team.id)))
  })
}

async function getSessionTeamIdsForUser(user) {
  const activeTeamId = String(user?.activeTeamId ?? '').trim()

  if (activeTeamId) {
    return [activeTeamId]
  }

  const assignedTeams = await getAssignedTeamsForUser(user).catch((error) => {
    console.error(error)
    return []
  })

  return assignedTeams.map((team) => team.id).filter(Boolean)
}

export async function createTeam({ user, name }) {
  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  const { data, error } = await supabase
    .from('teams')
    .insert({
      club_id: user.clubId,
      name: String(name ?? '').trim(),
    })
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`teams:${user.clubId}`)
  invalidateMemoryCacheByPrefix('available-teams:')

  return normalizeTeamRow(data)
}

export async function deleteTeam(teamId) {
  const { error } = await supabase.from('teams').delete().eq('id', teamId)

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('teams:')
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('team-assignments:')
}

export async function getTeamStaffAssignments(user) {
  const teams = await getTeams(user)

  if (teams.length === 0) {
    return []
  }

  const teamIds = teams.map((team) => team.id)
  return getCachedResource(`team-assignments:${user.clubId || user.id}`, async () => {
    const { data, error } = await supabase
      .from('team_staff')
      .select('*')
      .in('team_id', teamIds)

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeTeamStaffRow)
  })
}

export async function replaceTeamStaffAssignments(teamId, userIds) {
  const normalizedUserIds = [...new Set((userIds ?? []).map((userId) => String(userId).trim()).filter(Boolean))]

  const { error: deleteError } = await supabase.from('team_staff').delete().eq('team_id', teamId)

  if (deleteError) {
    console.error(deleteError)
    throw deleteError
  }

  if (normalizedUserIds.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from('team_staff')
    .insert(normalizedUserIds.map((userId) => ({ team_id: teamId, user_id: userId })))
    .select('*')

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  invalidateMemoryCacheByPrefix('assessment-sessions:')
  invalidateMemoryCacheByPrefix('team-assignments:')

  return (data ?? []).map(normalizeTeamStaffRow)
}

export async function assignClubUserRole({ user, email, role }) {
  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase()
  const roleKey = normalizeRoleKey(role.roleKey ?? role.key)
  const roleLabel = normalizeRoleLabel(role.roleLabel ?? role.label, roleKey)
  const roleRank = normalizeRoleRank(role.roleRank ?? role.rank, roleKey)

  const { data: existingUsers, error: existingUsersError } = await supabase
    .from('users')
    .select('id, email, username, name, role, role_label, role_rank, club_id, force_password_change')
    .eq('club_id', user.clubId)
    .eq('email', normalizedEmail)
    .limit(1)

  if (existingUsersError) {
    console.error(existingUsersError)
    throw existingUsersError
  }

  const existingUser = existingUsers?.[0]

  if (existingUser) {
    const { data: updatedUserRow, error: updateError } = await supabase
      .from('users')
      .update({
        role: roleKey,
        role_label: roleLabel,
        role_rank: roleRank,
      })
      .eq('id', existingUser.id)
      .select('id, email, username, name, role, role_label, role_rank, club_id, force_password_change')
      .single()

    if (updateError) {
      console.error(updateError)
      throw updateError
    }

    invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)

    return {
      kind: 'user',
      record: normalizeUserProfile(updatedUserRow),
    }
  }

  const { data: inviteRow, error: inviteError } = await supabase
    .from('club_user_invites')
    .upsert(
      {
        club_id: user.clubId,
        email: normalizedEmail,
        role_key: roleKey,
        role_label: roleLabel,
        role_rank: roleRank,
        created_by: user.id,
      },
      {
        onConflict: 'club_id,email',
      },
    )
    .select('*')
    .single()

  if (inviteError) {
    console.error(inviteError)
    throw inviteError
  }

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)

  return {
    kind: 'invite',
    record: normalizeClubInviteRow(inviteRow),
  }
}

export async function createStaffUserWithPassword({ user, email, password, role }) {
  if (!user?.clubId) {
    throw new Error('Club ID is required.')
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase()
  const normalizedPassword = String(password ?? '')

  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  if (normalizedPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }

  const roleKey = normalizeRoleKey(role.roleKey ?? role.key)
  const roleLabel = normalizeRoleLabel(role.roleLabel ?? role.label, roleKey)
  const roleRank = normalizeRoleRank(role.roleRank ?? role.rank, roleKey)

  const { data, error } = await supabase.functions.invoke('create-staff-user', {
    body: {
      email: normalizedEmail,
      password: normalizedPassword,
      roleKey,
      roleLabel,
      roleRank,
      clubId: user.clubId,
    },
  })

  if (error) {
    console.error(error)
    throw error
  }

  if (data?.error) {
    throw new Error(data.error)
  }

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
  invalidateMemoryCacheByPrefix(`user-access:${user.clubId}`)

  return data
}

export function canRemoveClubUser(actor, targetUser) {
  if (!actor || !targetUser) {
    return false
  }

  if (String(actor.id) === String(targetUser.id)) {
    return false
  }

  if (actor.role === 'super_admin') {
    return targetUser.role !== 'super_admin'
  }

  return (
    Boolean(actor.clubId) &&
    String(actor.clubId) === String(targetUser.clubId) &&
    Number(actor.roleRank ?? 0) >= 50 &&
    Number(targetUser.roleRank ?? 0) < Number(actor.roleRank ?? 0)
  )
}

export async function removeClubUser({ user, member }) {
  if (!canRemoveClubUser(user, member)) {
    throw new Error('You can only remove users below your role.')
  }

  const targetUserId = String(member.id ?? '').trim()

  if (!targetUserId) {
    throw new Error('User ID is required.')
  }

  const teams = await getTeams(user)
  const teamIds = teams.map((team) => team.id).filter(Boolean)

  if (teamIds.length > 0) {
    const { error: teamStaffError } = await supabase
      .from('team_staff')
      .delete()
      .eq('user_id', targetUserId)
      .in('team_id', teamIds)

    if (teamStaffError) {
      console.error(teamStaffError)
      throw teamStaffError
    }
  }

  const { error: membershipError } = await supabase
    .from('user_club_memberships')
    .delete()
    .eq('auth_user_id', targetUserId)
    .eq('club_id', user.clubId)

  if (membershipError) {
    console.error(membershipError)
    throw membershipError
  }

  const { error: userError } = await supabase
    .from('users')
    .delete()
    .eq('id', targetUserId)
    .eq('club_id', user.clubId)

  if (userError) {
    console.error(userError)
    throw userError
  }

  invalidateMemoryCacheByPrefix(`club-users:${user.clubId}`)
  invalidateMemoryCacheByPrefix(`user-access:${user.clubId}`)
  invalidateMemoryCacheByPrefix('available-teams:')
  invalidateMemoryCacheByPrefix('team-assignments:')
  invalidateMemoryCacheByPrefix('assigned-teams:')
  clearViewCaches()

  await createAuditLog({
    user,
    action: 'club_user_removed',
    entityType: 'user',
    entityId: targetUserId,
    metadata: {
      email: member.email,
      role: member.roleLabel || member.role,
    },
  })
}

export async function deleteClubInvite(inviteId) {
  const { error } = await supabase.from('club_user_invites').delete().eq('id', inviteId)

  if (error) {
    console.error(error)
    throw error
  }
}

export async function getConfiguredFormFields({ user } = {}) {
  if (!user?.clubId) {
    return []
  }

  const loadConfiguredFields = async () => {
    const { data, error } = await supabase
      .from('form_fields')
      .select('*')
      .eq('club_id', user.clubId)
      .order('order_index', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeFormFieldRow)
  }

  const configuredFields = await loadConfiguredFields()

  if (configuredFields.length > 0) {
    return configuredFields
  }

  await seedDefaultFormFields()
  return loadConfiguredFields()
}

export async function getFormFields({ user } = {}) {
  try {
    const configuredFields = await getConfiguredFormFields({ user })

    if (configuredFields.length > 0) {
      return {
        fields: configuredFields,
        isFallback: false,
      }
    }
  } catch (error) {
    console.error(error)
  }

  return {
    fields: getDefaultFormFields(),
    isFallback: true,
  }
}

export async function addFormField({ user, field }) {
  const nextOrderIndex = Number(field.orderIndex ?? Date.now())
  const payload = mapFormFieldToRow(field, user, nextOrderIndex)
  const { data, error } = await supabase.from('form_fields').insert(payload).select('*').single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeFormFieldRow(data)
}

export async function updateFormField(id, fieldData, user) {
  const payload = mapFormFieldToRow(
    fieldData,
    user,
    fieldData.orderIndex !== undefined ? Number(fieldData.orderIndex) : undefined,
  )
  const { data: updatedRow, error } = await supabase
    .from('form_fields')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeFormFieldRow(updatedRow)
}

export async function deleteFormField(id) {
  const { error } = await supabase.from('form_fields').delete().eq('id', id)

  if (error) {
    console.error(error)
    throw error
  }
}

export async function reorderFormFields(fields, user) {
  await Promise.all(
    fields.map((field, index) =>
      updateFormField(
        field.id,
        {
          ...field,
          clubId: field.clubId ?? user?.clubId ?? '',
          orderIndex: index + 1,
        },
        user,
      ),
    ),
  )
}

export async function getEvaluations({ user, status, playerName, section } = {}) {
  if (!user) {
    return []
  }

  let query = supabase.from('evaluations').select('*').order('created_at', { ascending: false })

  if (user.role !== 'super_admin') {
    if (!user.clubId) {
      return []
    }

    query = query.eq('club_id', user.clubId)
  }

  if (status) {
    query = query.eq('status', status)
  }

  if (playerName) {
    query = query.eq('player_name', playerName)
  }

  if (section) {
    query = query.eq('section', section)
  }

  if (user.activeTeamName) {
    query = query.eq('team', user.activeTeamName)
  }

  if (user.roleRank < 50 && user.role !== 'super_admin') {
    query = query.eq('coach_id', user.id)
  }

  const [{ data, error }, teams] = await Promise.all([
    query,
    user.role === 'super_admin' ? Promise.resolve([]) : getTeams(user).catch(() => []),
  ])

  if (error) {
    console.error(error)
    throw error
  }

  const teamsByName = new Map(teams.map((team) => [String(team.name ?? '').trim().toLowerCase(), team]))

  return (data ?? []).map((row) => {
    const normalizedRow = normalizeEvaluationRow(row)
    const matchingTeam = teamsByName.get(normalizedRow.team.toLowerCase())

    return {
      ...normalizedRow,
      teamRequireApproval: Boolean(matchingTeam?.requireApproval ?? row.team_require_approval ?? true),
    }
  })
}

export async function getPlayers({ user, section, playerName } = {}) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const cacheKey = `players:${user.clubId}:${section || 'all'}:${playerName || 'all'}:${user.activeTeamId || user.activeTeamName || 'all'}`

  return getCachedResource(cacheKey, async () => {
    let query = supabase
      .from('players')
      .select('*')
      .eq('club_id', user.clubId)
      .order('section', { ascending: true })
      .order('player_name', { ascending: true })

    if (section) {
      query = query.eq('section', section)
    }

    if (user.activeTeamName) {
      query = query.eq('team', user.activeTeamName)
    }

    if (playerName) {
      query = query.eq('player_name', playerName)
    }

    const { data, error } = await query

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizePlayerRow)
  })
}

export async function createPlayer({ user, player }) {
  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to add players.')
  }

  const payload = mapPlayerToRow(player, user)
  const { data, error } = await supabase
    .from('players')
    .upsert(payload, {
      onConflict: 'club_id,section,player_name',
    })
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'player_created',
    entityType: 'player',
    entityId: data.id,
    metadata: {
      playerName: data.player_name,
      section: data.section,
      team: data.team,
    },
  })
  return normalizePlayerRow(data)
}

async function createAuditLog({ user, action, entityType, entityId, metadata = {} }) {
  if (!user?.id || !action || !entityType) {
    return
  }

  const { error } = await supabase.from('audit_logs').insert({
    club_id: user.clubId || null,
    actor_id: user.id,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    metadata,
  })

  if (error) {
    console.error(error)
  }
}

export async function createCommunicationLog({ user, playerId, evaluationId, channel = 'pdf', action, recipientEmail = '' }) {
  if (!user?.clubId || !user?.id || !action) {
    return
  }

  const { error } = await supabase.from('communication_logs').insert({
    club_id: user.clubId,
    player_id: playerId || null,
    evaluation_id: evaluationId || null,
    user_id: user.id,
    channel,
    action,
    recipient_email: String(recipientEmail ?? '').trim(),
  })

  if (error) {
    console.error(error)
  }
}

export async function updatePlayer({ user, playerId, player }) {
  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to update players.')
  }

  const { data: currentPlayerRow, error: currentPlayerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .single()

  if (currentPlayerError) {
    console.error(currentPlayerError)
    throw currentPlayerError
  }

  const currentPlayer = normalizePlayerRow(currentPlayerRow)
  const payload = mapPlayerToRow(player, user)
  const isPromotingToSquad = currentPlayer.section !== 'Squad' && payload.section === 'Squad'

  const { data, error } = await supabase
    .from('players')
    .update(payload)
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: isPromotingToSquad ? 'player_promoted' : 'player_updated',
    entityType: 'player',
    entityId: data.id,
    metadata: {
      playerName: data.player_name,
      section: data.section,
      team: data.team,
    },
  })
  return normalizePlayerRow(data)
}

export async function promotePlayerToSquad({ user, playerId }) {
  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to promote players.')
  }

  const { data: currentPlayerRow, error: currentPlayerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .single()

  if (currentPlayerError) {
    console.error(currentPlayerError)
    throw currentPlayerError
  }

  const currentPlayer = normalizePlayerRow(currentPlayerRow)

  if (currentPlayer.section === 'Squad') {
    return currentPlayer
  }

  const promotedAt = new Date().toISOString()
  const { data: promotedRow, error: promoteError } = await supabase
    .from('players')
    .update({
      section: 'Squad',
      status: 'promoted',
      promoted_at: promotedAt,
      promoted_by: user.id,
    })
    .eq('id', playerId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (promoteError) {
    console.error(promoteError)
    throw promoteError
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'player_promoted',
    entityType: 'player',
    entityId: promotedRow.id,
    metadata: {
      playerName: promotedRow.player_name,
      fromSection: currentPlayer.section,
      toSection: 'Squad',
      team: promotedRow.team,
    },
  })

  return normalizePlayerRow(promotedRow)
}

export async function deletePlayerRecord({ user, playerId }) {
  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to delete players.')
  }

  const { data, error } = await supabase.from('players').delete().eq('id', playerId).eq('club_id', user.clubId).select('id')

  if (error) {
    console.error(error)
    throw error
  }

  if (!data?.length) {
    throw new Error('No player record was deleted. Check permissions or refresh the player profile.')
  }

  invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'player_record_deleted',
    entityType: 'player',
    entityId: playerId,
  })
}

export async function getAssessmentSessions({ user } = {}) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const activeTeamId = String(user.activeTeamId ?? '').trim()
  const cacheKey = `assessment-sessions:${user.clubId}:${user.id}:${user.roleRank}:${activeTeamId || 'assigned'}`

  return getCachedResource(cacheKey, async () => {
    const teamIds = await getSessionTeamIdsForUser(user)

    if (teamIds.length === 0) {
      return []
    }

    const query = supabase
      .from('assessment_sessions')
      .select('*')
      .eq('club_id', user.clubId)
      .in('team_id', teamIds)
      .order('session_date', { ascending: false })
      .order('created_at', { ascending: false })

    const { data, error } = await query

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeAssessmentSessionRow)
  })
}

export async function createAssessmentSession({ user, session }) {
  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to create sessions.')
  }

  const sessionDate = normalizeDateOnly(session.sessionDate)

  if (!sessionDate) {
    throw new Error('Session date is required.')
  }

  const teamName = String(session.team ?? '').trim()
  const teamId = String(session.teamId ?? '').trim()
  const opponentName = String(session.opponent ?? '').trim()
  const sessionType = String(session.sessionType ?? '').trim() === 'match' ? 'match' : 'training'

  if (!teamId) {
    throw new Error('Choose a team before creating a session.')
  }

  const { data, error } = await supabase
    .from('assessment_sessions')
    .insert({
      club_id: user.clubId,
      team_id: teamId,
      team: teamName,
      opponent: opponentName,
      session_type: sessionType,
      session_date: sessionDate,
      title: opponentName ? `${teamName} vs ${opponentName}` : teamName,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-sessions:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'assessment_session_created',
    entityType: 'assessment_session',
    entityId: data.id,
    metadata: {
      team: teamName,
      opponent: opponentName,
      sessionType,
      sessionDate,
    },
  })

  return normalizeAssessmentSessionRow(data)
}

export async function getAssessmentSessionPlayers({ user, sessionId } = {}) {
  if (!user?.clubId || !sessionId || user.role === 'super_admin') {
    return []
  }

  return getCachedResource(`assessment-session-players:${sessionId}`, async () => {
    const { data, error } = await supabase
      .from('assessment_session_players')
      .select(
        '*, players:player_id (player_name, section, team, parent_name, parent_email, parent_contacts)',
      )
      .eq('session_id', sessionId)
      .order('player_name', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeAssessmentSessionPlayerRow)
  })
}

export async function addPlayersToAssessmentSession({ user, sessionId, players }) {
  if (!user?.clubId || !sessionId) {
    throw new Error('Session and club are required.')
  }

  const normalizedPlayers = (players ?? []).filter((player) => player?.id)

  if (normalizedPlayers.length === 0) {
    return getAssessmentSessionPlayers({ user, sessionId })
  }

  const { data, error } = await supabase
    .from('assessment_session_players')
    .upsert(
      normalizedPlayers.map((player) => ({
        session_id: sessionId,
        player_id: player.id,
        player_name: player.playerName,
        section: player.section,
        team: player.team,
        parent_name: player.parentName,
        parent_email: player.parentEmail,
        parent_contacts: normalizeParentContacts(player.parentContacts, {
          parentName: player.parentName,
          parentEmail: player.parentEmail,
        }),
      })),
      {
        onConflict: 'session_id,player_id',
      },
    )
    .select('*, players:player_id (player_name, section, team, parent_name, parent_email, parent_contacts)')

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-session-players:${sessionId}`)
  await createAuditLog({
    user,
    action: 'assessment_session_players_added',
    entityType: 'assessment_session',
    entityId: sessionId,
    metadata: {
      playerCount: normalizedPlayers.length,
    },
  })

  return (data ?? []).map(normalizeAssessmentSessionPlayerRow)
}

export async function updateAssessmentSessionPlayer({ user, sessionPlayerId, notes }) {
  if (!user?.clubId || !sessionPlayerId) {
    throw new Error('Session player is required.')
  }

  const { data, error } = await supabase
    .from('assessment_session_players')
    .update({
      notes: String(notes ?? '').trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionPlayerId)
    .select('*, players:player_id (player_name, section, team, parent_name, parent_email, parent_contacts)')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-session-players:${data.session_id}`)
  return normalizeAssessmentSessionPlayerRow(data)
}

export async function clearAssessmentSessionPlayers({ user, sessionId }) {
  if (!user?.clubId || !sessionId) {
    throw new Error('Session and club are required.')
  }

  const { error } = await supabase.from('assessment_session_players').delete().eq('session_id', sessionId)

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-session-players:${sessionId}`)
  await createAuditLog({
    user,
    action: 'assessment_session_players_cleared',
    entityType: 'assessment_session',
    entityId: sessionId,
  })
}

export async function getPlatformFeedback(user) {
  if (!user?.id) {
    return []
  }

  const cacheKey = user.role === 'super_admin' ? 'platform-feedback:admin' : `platform-feedback:${user.id}:${user.clubId || 'platform'}`
  const selectFields =
    user.role === 'super_admin'
      ? 'id, club_id, created_by, message, status, admin_note, created_at, updated_at, clubs:club_id (name), users:created_by (email), platform_feedback_votes (user_id), platform_feedback_comments (id, feedback_id, created_by, message, created_at, users:created_by (email))'
      : 'id, club_id, created_by, message, status, admin_note, created_at, updated_at, clubs:club_id (name), platform_feedback_votes (user_id), platform_feedback_comments (id, feedback_id, created_by, message, created_at, users:created_by (email))'

  return getCachedResource(cacheKey, async () => {
    const { data, error } = await supabase
      .from('platform_feedback')
      .select(selectFields)
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map((row) => {
      const votes = Array.isArray(row.platform_feedback_votes) ? row.platform_feedback_votes : []

      return normalizePlatformFeedbackRow({
        ...row,
        vote_count: votes.length,
        has_voted: votes.some((vote) => String(vote.user_id) === String(user.id)),
      })
    })
  })
}

export async function createPlatformFeedback({ user, message }) {
  const normalizedMessage = String(message ?? '').trim()

  if (!user?.id || !user?.clubId) {
    throw new Error('A club user is required to submit feedback.')
  }

  if (!normalizedMessage) {
    throw new Error('Add feedback before submitting.')
  }

  const { data, error } = await supabase
    .from('platform_feedback')
    .insert({
      club_id: user.clubId,
      created_by: user.id,
      message: normalizedMessage,
      status: 'open',
    })
    .select('id, club_id, created_by, message, status, admin_note, created_at, updated_at, clubs:club_id (name), platform_feedback_votes (user_id)')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
  await createAuditLog({
    user,
    action: 'platform_feedback_created',
    entityType: 'platform_feedback',
    entityId: data.id,
  })

  return normalizePlatformFeedbackRow(data)
}

export async function votePlatformFeedback({ user, feedbackId }) {
  if (!user?.id || !feedbackId) {
    throw new Error('Feedback and user are required.')
  }

  const { error } = await supabase.from('platform_feedback_votes').upsert(
    {
      feedback_id: feedbackId,
      user_id: user.id,
    },
    {
      onConflict: 'feedback_id,user_id',
    },
  )

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
}

export async function unvotePlatformFeedback({ user, feedbackId }) {
  if (!user?.id || !feedbackId) {
    throw new Error('Feedback and user are required.')
  }

  const { error } = await supabase
    .from('platform_feedback_votes')
    .delete()
    .eq('feedback_id', feedbackId)
    .eq('user_id', user.id)

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
}

export async function updatePlatformFeedback({ user, feedbackId, data }) {
  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can update feedback.')
  }

  const payload = {}

  if (data.status !== undefined) {
    payload.status = String(data.status ?? 'open').trim() || 'open'
  }

  const adminComment = String(data.adminComment ?? data.adminNote ?? '').trim()

  payload.updated_at = new Date().toISOString()

  const { data: updatedRow, error } = await supabase
    .from('platform_feedback')
    .update(payload)
    .eq('id', feedbackId)
    .select('id, club_id, created_by, message, status, admin_note, created_at, updated_at, clubs:club_id (name), users:created_by (email), platform_feedback_votes (user_id), platform_feedback_comments (id, feedback_id, created_by, message, created_at, users:created_by (email))')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  if (adminComment) {
    const { error: commentError } = await supabase.from('platform_feedback_comments').insert({
      feedback_id: feedbackId,
      created_by: user.id,
      message: adminComment,
    })

    if (commentError) {
      console.error(commentError)
      throw commentError
    }
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
  return normalizePlatformFeedbackRow(updatedRow)
}

export async function deletePlatformFeedback({ user, feedbackId }) {
  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can delete feedback.')
  }

  const { error } = await supabase.from('platform_feedback').delete().eq('id', feedbackId)

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
}

export async function createEvaluation(data) {
  let linkedPlayerId = data.playerId || ''
  let linkedTeamId = data.teamId || ''

  if (data.clubId && data.playerName && data.section) {
    const { data: playerRow, error: playerError } = await supabase.from('players').upsert(
      {
        club_id: data.clubId,
        player_name: normalizeWords(data.playerName),
        section: EVALUATION_SECTIONS.includes(data.section) ? data.section : 'Trial',
        team: String(data.team ?? '').trim(),
        parent_name: String(data.parentName ?? '').trim(),
        parent_email: String(data.parentEmail ?? '').trim(),
        parent_contacts: normalizeParentContacts(data.parentContacts, {
          parentName: data.parentName,
          parentEmail: data.parentEmail,
        }),
      },
      {
        onConflict: 'club_id,section,player_name',
      },
    ).select('id').single()

    if (playerError) {
      console.error(playerError)
    } else {
      linkedPlayerId = playerRow?.id || linkedPlayerId
    }
  }

  if (data.clubId && data.team) {
    const { data: teamRow, error: teamError } = await supabase
      .from('teams')
      .select('id')
      .eq('club_id', data.clubId)
      .eq('name', String(data.team ?? '').trim())
      .maybeSingle()

    if (teamError) {
      console.error(teamError)
    } else {
      linkedTeamId = teamRow?.id || linkedTeamId
    }
  }

  const payload = mapEvaluationToRow({
    ...data,
    playerId: linkedPlayerId,
    teamId: linkedTeamId,
  })
  const { data: createdRow, error } = await supabase
    .from('evaluations')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`players:${data.clubId}:`)
  await createAuditLog({
    user: {
      id: data.coachId,
      clubId: data.clubId,
    },
    action: 'evaluation_submitted',
    entityType: 'evaluation',
    entityId: createdRow.id,
    metadata: {
      playerName: data.playerName,
      section: data.section,
      team: data.team,
    },
  })

  return normalizeEvaluationRow(createdRow)
}

export async function updateEvaluation(id, data, clubId) {
  const payload = mapEvaluationToRow(data)
  let query = supabase.from('evaluations').update(payload).eq('id', id)

  if (clubId) {
    query = query.eq('club_id', clubId)
  }

  const { data: updatedRow, error } = await query.select('*').single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeEvaluationRow(updatedRow)
}

export async function updateEvaluationStatus(id, status, clubId, options = {}) {
  const payload = {
    status,
    rejection_reason: status === 'Rejected' ? String(options.rejectionReason ?? '').trim() : null,
    reviewed_by: options.user?.id || null,
    reviewed_at: new Date().toISOString(),
  }
  let query = supabase.from('evaluations').update(payload).eq('id', id)

  if (clubId) {
    query = query.eq('club_id', clubId)
  }

  const { data: updatedRow, error } = await query.select('*').single()

  if (error) {
    console.error(error)
    throw error
  }

  await createAuditLog({
    user: options.user,
    action: status === 'Approved' ? 'evaluation_approved' : 'evaluation_rejected',
    entityType: 'evaluation',
    entityId: id,
    metadata: {
      status,
      rejectionReason: payload.rejection_reason,
    },
  })

  return normalizeEvaluationRow(updatedRow)
}

export async function deletePlayer(playerName, user, options = {}) {
  if (!user?.clubId && user?.role !== 'super_admin') {
    throw new Error('Club ID is required.')
  }

  const playerIds = Array.from(new Set((options.playerIds ?? []).filter(Boolean)))

  if (playerIds.length > 0) {
    let evaluationIdQuery = supabase.from('evaluations').delete().in('player_id', playerIds)

    if (user.role !== 'super_admin') {
      evaluationIdQuery = evaluationIdQuery.eq('club_id', user.clubId)
    }

    const { error: evaluationIdDeleteError } = await evaluationIdQuery

    if (evaluationIdDeleteError) {
      console.error(evaluationIdDeleteError)
      throw evaluationIdDeleteError
    }
  }

  let evaluationQuery = supabase.from('evaluations').delete().eq('player_name', playerName)

  if (user.role !== 'super_admin') {
    evaluationQuery = evaluationQuery.eq('club_id', user.clubId)
  }

  const { error } = await evaluationQuery

  if (error) {
    console.error(error)
    throw error
  }

  if (user.role !== 'super_admin') {
    let playerDeleteQuery = supabase.from('players').delete().eq('club_id', user.clubId)

    if (playerIds.length > 0) {
      playerDeleteQuery = playerDeleteQuery.in('id', playerIds)
    } else {
      playerDeleteQuery = playerDeleteQuery.ilike('player_name', playerName)
    }

    const { data: deletedPlayers, error: playerDeleteError } = await playerDeleteQuery.select('id')

    if (playerDeleteError) {
      console.error(playerDeleteError)
      throw playerDeleteError
    }

    if (!deletedPlayers?.length) {
      throw new Error('No player record was deleted. Check permissions or refresh the player profile.')
    }

    invalidateMemoryCacheByPrefix(`players:${user.clubId}:`)
    clearViewCaches()
    await createAuditLog({
      user,
      action: 'player_deleted',
      entityType: 'player',
      metadata: {
        playerName,
      },
    })
  }
}

export async function createPlatformClub({ user, name, contactEmail = '', contactPhone = '' }) {
  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can create clubs.')
  }

  const normalizedName = String(name ?? '').trim()

  if (!normalizedName) {
    throw new Error('Club name is required.')
  }

  const { data, error } = await supabase
    .from('clubs')
    .insert({
      name: normalizedName,
      contact_email: String(contactEmail ?? '').trim(),
      contact_phone: String(contactPhone ?? '').trim(),
      status: 'active',
    })
    .select('id, name, contact_email, contact_phone, status, suspended_at, created_at')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  await seedDefaultClubRolesForClub(data.id)
  invalidateMemoryCacheByPrefix('platform-stats')
  await createAuditLog({
    user,
    action: 'club_created',
    entityType: 'club',
    entityId: data.id,
    metadata: {
      clubName: data.name,
    },
  })

  return normalizePlatformClubRow(data)
}

export async function updatePlatformClubStatus({ user, clubId, status }) {
  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can update club status.')
  }

  const nextStatus = status === 'suspended' ? 'suspended' : 'active'
  const { data, error } = await supabase
    .from('clubs')
    .update({
      status: nextStatus,
      suspended_at: nextStatus === 'suspended' ? new Date().toISOString() : null,
    })
    .eq('id', clubId)
    .select('id, name, contact_email, contact_phone, status, suspended_at, created_at')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-stats')
  invalidateMemoryCacheByPrefix(`club:${clubId}`)
  await createAuditLog({
    user,
    action: nextStatus === 'suspended' ? 'club_suspended' : 'club_reactivated',
    entityType: 'club',
    entityId: clubId,
    metadata: {
      clubName: data.name,
      status: nextStatus,
    },
  })

  return normalizePlatformClubRow(data)
}

export async function deletePlatformClub({ user, clubId }) {
  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can delete clubs.')
  }

  const { data: clubRow, error: clubError } = await supabase
    .from('clubs')
    .select('id, name')
    .eq('id', clubId)
    .single()

  if (clubError) {
    console.error(clubError)
    throw clubError
  }

  const deleteOperations = [
    supabase.from('evaluations').delete().eq('club_id', clubId),
    supabase.from('users').delete().eq('club_id', clubId),
  ]

  const deleteResults = await Promise.all(deleteOperations)
  const firstDeleteError = deleteResults.find((result) => result.error)?.error

  if (firstDeleteError) {
    console.error(firstDeleteError)
    throw firstDeleteError
  }

  const { error: deleteClubError } = await supabase.from('clubs').delete().eq('id', clubId)

  if (deleteClubError) {
    console.error(deleteClubError)
    throw deleteClubError
  }

  invalidateMemoryCacheByPrefix('platform-stats')
  invalidateMemoryCacheByPrefix(`club:${clubId}`)
  await createAuditLog({
    user,
    action: 'club_deleted',
    entityType: 'club',
    entityId: clubId,
    metadata: {
      clubName: clubRow.name,
    },
  })
}

export async function getPlatformStats(user) {
  if (user?.role !== 'super_admin') {
    return {
      totals: {
        clubs: 0,
        users: 0,
        teams: 0,
        players: 0,
        evaluations: 0,
        communications: 0,
      },
      clubs: [],
    }
  }

  return getCachedResource('platform-stats', async () => {
    const [clubsResult, usersResult, teamsResult, playersResult, evaluationsResult, communicationLogsResult, auditLogsResult] = await Promise.all([
      supabase
        .from('clubs')
        .select('id, name, contact_email, contact_phone, status, suspended_at, created_at')
        .order('name', { ascending: true }),
      supabase.from('users').select('id, email, role_label, role_rank, club_id').order('email', { ascending: true }),
      supabase.from('teams').select('id, name, club_id').order('name', { ascending: true }),
      supabase.from('players').select('id, club_id, section, status, created_at'),
      supabase.from('evaluations').select('id, club_id, section, status, created_at'),
      supabase.from('communication_logs').select('id, club_id, channel, action, created_at'),
      supabase.from('audit_logs').select('id, club_id, action, created_at'),
    ])

    const results = [clubsResult, usersResult, teamsResult, playersResult, evaluationsResult, communicationLogsResult, auditLogsResult]
    const firstError = results.find((result) => result.error)?.error

    if (firstError) {
      console.error(firstError)
      throw firstError
    }

    const clubs = clubsResult.data ?? []
    const users = usersResult.data ?? []
    const teams = teamsResult.data ?? []
    const players = playersResult.data ?? []
    const evaluations = evaluationsResult.data ?? []
    const communicationLogs = communicationLogsResult.data ?? []
    const auditLogs = auditLogsResult.data ?? []
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const isRecent = (row) => {
      const timestamp = new Date(row.created_at).getTime()
      return !Number.isNaN(timestamp) && timestamp >= sevenDaysAgo
    }

    return {
      totals: {
        clubs: clubs.length,
        users: users.length,
        teams: teams.length,
        players: players.length,
        evaluations: evaluations.length,
        communications: communicationLogs.length,
        recentEvaluations: evaluations.filter(isRecent).length,
        recentCommunications: communicationLogs.filter(isRecent).length,
      },
      clubs: clubs.map((club) => {
        const clubUsers = users.filter((member) => member.club_id === club.id)
        const clubTeams = teams.filter((team) => team.club_id === club.id)
        const clubPlayers = players.filter((player) => player.club_id === club.id)
        const clubEvaluations = evaluations.filter((evaluation) => evaluation.club_id === club.id)
        const clubCommunicationLogs = communicationLogs.filter((log) => log.club_id === club.id)
        const clubAuditLogs = auditLogs.filter((log) => log.club_id === club.id)
        const clubActivityTimestamps = [...clubEvaluations, ...clubCommunicationLogs, ...clubAuditLogs]
          .map((row) => new Date(row.created_at).getTime())
          .filter((timestamp) => !Number.isNaN(timestamp))
        const latestActivityAt =
          clubActivityTimestamps.length > 0 ? new Date(Math.max(...clubActivityTimestamps)).toISOString() : ''
        const roleCounts = clubUsers.reduce((map, member) => {
          const roleLabel = String(member.role_label ?? '').trim() || 'User'
          map[roleLabel] = (map[roleLabel] ?? 0) + 1
          return map
        }, {})

        return {
          id: club.id,
          name: String(club.name ?? '').trim() || 'Unnamed club',
          contactEmail: String(club.contact_email ?? '').trim(),
          contactPhone: String(club.contact_phone ?? '').trim(),
          status: String(club.status ?? 'active').trim() || 'active',
          suspendedAt: club.suspended_at,
          createdAt: club.created_at,
          userCount: clubUsers.length,
          teamCount: clubTeams.length,
          playerCount: clubPlayers.length,
          evaluationCount: clubEvaluations.length,
          communicationCount: clubCommunicationLogs.length,
          recentEvaluationCount: clubEvaluations.filter(isRecent).length,
          recentCommunicationCount: clubCommunicationLogs.filter(isRecent).length,
          submittedCount: clubEvaluations.filter((evaluation) => evaluation.status === 'Submitted').length,
          approvedCount: clubEvaluations.filter((evaluation) => evaluation.status === 'Approved').length,
          rejectedCount: clubEvaluations.filter((evaluation) => evaluation.status === 'Rejected').length,
          trialCount: clubEvaluations.filter((evaluation) => evaluation.section === 'Trial').length,
          squadCount: clubEvaluations.filter((evaluation) => evaluation.section === 'Squad').length,
          trialPlayerCount: clubPlayers.filter((player) => player.section === 'Trial').length,
          squadPlayerCount: clubPlayers.filter((player) => player.section === 'Squad').length,
          promotedPlayerCount: clubPlayers.filter((player) => player.status === 'promoted').length,
          latestActivityAt,
          roleCounts: Object.entries(roleCounts)
            .map(([label, count]) => ({ label, count }))
            .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
          users: clubUsers.map((member) => ({
            id: member.id,
            email: String(member.email ?? '').trim(),
            roleLabel: String(member.role_label ?? '').trim() || 'User',
            roleRank: Number(member.role_rank ?? 0),
          })),
          teams: clubTeams.map((team) => ({
            id: team.id,
            name: String(team.name ?? '').trim() || 'Unnamed team',
          })),
        }
      }),
    }
  })
}
