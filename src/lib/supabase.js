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
    decision: data.decision,
    status: data.status,
    created_at: data.createdAt || new Date().toISOString(),
  }
}

export async function fetchUserProfile(authUser) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, club_id, clubs(name)')
    .eq('id', authUser.id)
    .maybeSingle()

  if (error) {
    console.error(error)
    throw error
  }

  if (!data) {
    throw new Error('User profile not found.')
  }

  return normalizeUserProfile({
    ...data,
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
    .select('id, email, name, role, club_id, clubs(name)')
    .single()

  if (userError) {
    console.error(userError)
    throw userError
  }

  return normalizeUserProfile({
    ...userProfile,
    clubs: userProfile.clubs || { name: club.name },
  })
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
