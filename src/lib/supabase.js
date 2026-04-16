import { createClient } from '@supabase/supabase-js'

const fallbackSupabaseUrl = 'https://placeholder.supabase.co'
const fallbackSupabaseAnonKey = 'placeholder-anon-key'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || fallbackSupabaseUrl
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  fallbackSupabaseAnonKey

if (
  !import.meta.env.VITE_SUPABASE_URL ||
  (!import.meta.env.VITE_SUPABASE_ANON_KEY && !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
) {
  console.error(
    'Supabase environment variables are missing. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

const DEFAULT_FORM_FIELDS = [
  {
    id: 'default-technical',
    label: 'Technical',
    type: 'number',
    options: [],
    required: true,
    orderIndex: 1,
    isDefault: true,
  },
  {
    id: 'default-tactical',
    label: 'Tactical',
    type: 'number',
    options: [],
    required: true,
    orderIndex: 2,
    isDefault: true,
  },
  {
    id: 'default-physical',
    label: 'Physical',
    type: 'number',
    options: [],
    required: true,
    orderIndex: 3,
    isDefault: true,
  },
  {
    id: 'default-mentality',
    label: 'Mentality',
    type: 'number',
    options: [],
    required: true,
    orderIndex: 4,
    isDefault: true,
  },
  {
    id: 'default-coachability',
    label: 'Coachability',
    type: 'number',
    options: [],
    required: true,
    orderIndex: 5,
    isDefault: true,
  },
  {
    id: 'default-strengths',
    label: 'Strengths',
    type: 'textarea',
    options: [],
    required: false,
    orderIndex: 6,
    isDefault: true,
  },
  {
    id: 'default-improvements',
    label: 'Improvements',
    type: 'textarea',
    options: [],
    required: false,
    orderIndex: 7,
    isDefault: true,
  },
  {
    id: 'default-overall',
    label: 'Overall Comments',
    type: 'textarea',
    options: [],
    required: true,
    orderIndex: 8,
    isDefault: true,
  },
]

function normalizeWords(value) {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function normalizeRole(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (normalizedValue === 'super_admin') {
    return 'super_admin'
  }

  return normalizedValue === 'manager' ? 'manager' : 'coach'
}

function normalizeFieldType(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()
  const allowedTypes = ['text', 'textarea', 'number', 'select']

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

function getDisplayName(profile) {
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

  return {
    id: row.id,
    playerName: String(row.player_name ?? row.playerName ?? '').trim() || 'Unknown Player',
    team: String(row.team ?? '').trim() || 'Unassigned Club',
    clubId: row.club_id ?? row.clubId ?? '',
    coachId: row.coach_id ?? row.coachId ?? '',
    coach: String(row.coach ?? row.coach_name ?? '').trim() || 'Unknown Coach',
    parentEmail: String(row.parent_email ?? row.parentEmail ?? '').trim(),
    session: String(row.session ?? '').trim(),
    date:
      String(row.date ?? '').trim() ||
      (row.created_at ? new Date(row.created_at).toLocaleDateString() : new Date().toLocaleDateString()),
    scores,
    averageScore: averageScore !== null ? Number(averageScore) : null,
    comments,
    decision: String(row.decision ?? 'Progress').trim() || 'Progress',
    status: String(row.status ?? 'Submitted').trim() || 'Submitted',
    createdAt: Number.isNaN(createdAtValue) ? Date.now() : createdAtValue,
    formResponses,
  }
}

function mapEvaluationToRow(data) {
  return {
    player_name: data.playerName,
    team: data.team,
    club_id: data.clubId,
    coach_id: data.coachId,
    coach: data.coach,
    parent_email: data.parentEmail,
    session: data.session,
    date: data.date,
    scores: data.scores,
    average_score: data.averageScore,
    comments: data.comments,
    form_responses: data.formResponses,
    decision: data.decision,
    status: data.status,
    created_at: data.createdAt || new Date().toISOString(),
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
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

function mapFormFieldToRow(field, user, orderIndex) {
  return {
    club_id: field.clubId ?? user?.clubId ?? '',
    label: String(field.label ?? '').trim(),
    type: normalizeFieldType(field.type),
    options: normalizeFieldOptions(field.options),
    required: Boolean(field.required),
    order_index: orderIndex,
    is_default: Boolean(field.isDefault),
  }
}

export function getDefaultFormFields() {
  return DEFAULT_FORM_FIELDS.map((field) => ({ ...field }))
}

export function normalizeUserProfile(profile) {
  const role = normalizeRole(profile.role)
  const clubName =
    getClubName(profile.clubs) ||
    String(profile.team ?? '').trim() ||
    (role === 'super_admin' ? 'Platform' : 'Unassigned Club')

  return {
    id: profile.id,
    email: String(profile.email ?? '').trim().toLowerCase(),
    name: getDisplayName(profile),
    role,
    clubId: profile.club_id ?? profile.clubId ?? '',
    clubName,
    team: clubName,
  }
}

export async function fetchUserProfile(authUser) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, club_id')
    .eq('id', authUser.id)
    .maybeSingle()

  if (error) {
    console.error(error)
    throw error
  }

  if (!data) {
    throw new Error('User profile not found.')
  }

  let clubData = null

  if (data.club_id) {
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('name')
      .eq('id', data.club_id)
      .maybeSingle()

    if (clubError) {
      console.error(clubError)
    } else {
      clubData = club
    }
  }

  return normalizeUserProfile({
    ...data,
    clubs: clubData,
    email: data.email || authUser.email,
  })
}

export async function createClubAndManagerProfile({ authUser, clubName }) {
  const { data: club, error: clubError } = await supabase
    .from('clubs')
    .insert({
      name: String(clubName ?? '').trim(),
    })
    .select('id, name')
    .single()

  if (clubError) {
    console.error(clubError)
    throw clubError
  }

  const { data: userProfile, error: userError } = await supabase
    .from('users')
    .insert({
      id: authUser.id,
      email: authUser.email,
      role: 'manager',
      club_id: club.id,
    })
    .select('id, email, name, role, club_id')
    .single()

  if (userError) {
    console.error(userError)
    throw userError
  }

  return normalizeUserProfile({
    ...userProfile,
    clubs: { name: club.name },
  })
}

export async function getConfiguredFormFields({ user } = {}) {
  if (!user?.clubId) {
    return []
  }

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

export async function getFormFields({ user } = {}) {
  const configuredFields = await getConfiguredFormFields({ user })

  if (configuredFields.length > 0) {
    return {
      fields: configuredFields,
      isFallback: false,
    }
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

export async function updateFormField({ id, field, user }) {
  const payload = mapFormFieldToRow(field, user, Number(field.orderIndex ?? 0))
  const { data, error } = await supabase
    .from('form_fields')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeFormFieldRow(data)
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
      updateFormField({
        id: field.id,
        field: {
          ...field,
          clubId: field.clubId ?? user?.clubId ?? '',
          orderIndex: index + 1,
        },
        user,
      }),
    ),
  )
}

export async function getEvaluations({ user, status, playerName } = {}) {
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

  if (user.role === 'coach') {
    query = query.eq('coach_id', user.id)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeEvaluationRow)
}

export async function createEvaluation(data) {
  const payload = mapEvaluationToRow(data)
  const { data: createdRow, error } = await supabase
    .from('evaluations')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

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

export async function updateEvaluationStatus(id, status, clubId) {
  let query = supabase.from('evaluations').update({ status }).eq('id', id)

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
