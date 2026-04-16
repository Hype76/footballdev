import { createClient } from '@supabase/supabase-js'

const fallbackSupabaseUrl = 'https://placeholder.supabase.co'
const fallbackSupabaseAnonKey = 'placeholder-anon-key'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || fallbackSupabaseUrl
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || fallbackSupabaseAnonKey

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.error('Supabase environment variables are missing. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

function normalizeWords(value) {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function createDefaultProfile(authUser) {
  const email = String(authUser?.email ?? '').trim().toLowerCase()
  const nameSource = email.split('@')[0]?.replace(/[._-]+/g, ' ') || 'Coach User'

  return {
    id: authUser.id,
    name: normalizeWords(nameSource),
    role: 'Coach',
    team: 'Unassigned Team',
  }
}

function normalizeUserProfile(profile) {
  return {
    id: profile.id,
    name: String(profile.name ?? '').trim() || 'Coach User',
    role: profile.role === 'Manager' ? 'Manager' : 'Coach',
    team: String(profile.team ?? '').trim() || 'Unassigned Team',
  }
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

function calculateAverageScore(scores = {}) {
  const values = Object.values(scores)
    .map((value) => Number(value))
    .filter((value) => !Number.isNaN(value) && value > 0)

  if (values.length === 0) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizeEvaluationRow(row) {
  const scores = row.scores && typeof row.scores === 'object' && !Array.isArray(row.scores) ? row.scores : {}
  const comments = normalizeComments(row.comments)
  const createdAtValue = row.created_at ? new Date(row.created_at).getTime() : Number(row.createdAt ?? row.id)
  const averageScore =
    typeof row.average_score === 'number' ? row.average_score : calculateAverageScore(scores)

  return {
    id: row.id,
    playerName: String(row.player_name ?? row.playerName ?? '').trim() || 'Unknown Player',
    team: String(row.team ?? '').trim() || 'Unassigned Team',
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
  }
}

function mapEvaluationToRow(data) {
  return {
    player_name: data.playerName,
    team: data.team,
    coach_id: data.coachId,
    coach: data.coach,
    parent_email: data.parentEmail,
    session: data.session,
    date: data.date,
    scores: data.scores,
    average_score: data.averageScore,
    comments: data.comments,
    decision: data.decision,
    status: data.status,
    created_at: data.createdAt || new Date().toISOString(),
  }
}

export async function fetchOrCreateUserProfile(authUser) {
  const { data: existingProfile, error: selectError } = await supabase
    .from('users')
    .select('id, name, role, team')
    .eq('id', authUser.id)
    .maybeSingle()

  if (selectError) {
    console.error(selectError)
    throw selectError
  }

  if (existingProfile) {
    return normalizeUserProfile(existingProfile)
  }

  const defaultProfile = createDefaultProfile(authUser)
  const { data: createdProfile, error: insertError } = await supabase
    .from('users')
    .insert(defaultProfile)
    .select('id, name, role, team')
    .single()

  if (insertError) {
    console.error(insertError)
    throw insertError
  }

  return normalizeUserProfile(createdProfile)
}

export async function getEvaluations({ user, status, playerName } = {}) {
  let query = supabase.from('evaluations').select('*').order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  if (playerName) {
    query = query.eq('player_name', playerName)
  }

  if (user?.role === 'Coach') {
    query = query.eq('coach_id', user.id).eq('team', user.team)
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

export async function updateEvaluation(id, data) {
  const payload = mapEvaluationToRow(data)
  const { data: updatedRow, error } = await supabase
    .from('evaluations')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeEvaluationRow(updatedRow)
}

export async function updateEvaluationStatus(id, status) {
  const { data: updatedRow, error } = await supabase
    .from('evaluations')
    .update({ status })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  return normalizeEvaluationRow(updatedRow)
}
