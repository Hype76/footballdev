import { normalizeRequiredDate, normalizeRequiredTime } from '../../../src/lib/calendar-datetime-integrity.js'

export const COACH_SESSION_TYPES = Object.freeze(['training', 'match'])
export const COACH_SESSION_STATUSES = Object.freeze(['open', 'completed', 'cancelled'])

function normalize(value) {
  return String(value ?? '').trim()
}

export function normalizeCoachSession(row) {
  const related = Array.isArray(row?.assessment_sessions) ? row.assessment_sessions[0] : row?.assessment_sessions
  const source = related || row || {}
  return Object.freeze({
    arrivalTime: normalize(source.arrival_time ?? source.arrivalTime).slice(0, 5),
    completedAt: normalize(source.completed_at ?? source.completedAt),
    completedByName: normalize(source.completed_by_name ?? source.completedByName),
    endTime: normalize(source.end_time ?? source.endTime).slice(0, 5),
    id: normalize(source.id),
    location: normalize(source.location),
    notes: normalize(source.notes),
    opponent: normalize(source.opponent),
    sessionDate: normalize(source.session_date ?? source.sessionDate),
    sessionType: COACH_SESSION_TYPES.includes(normalize(source.session_type ?? source.sessionType))
      ? normalize(source.session_type ?? source.sessionType)
      : 'training',
    startTime: normalize(source.start_time ?? source.startTime).slice(0, 5),
    status: COACH_SESSION_STATUSES.includes(normalize(source.status)) ? normalize(source.status) : 'open',
    team: normalize(source.team),
    teamId: normalize(source.team_id ?? source.teamId),
    title: normalize(source.title) || 'Training session',
    updatedAt: normalize(source.updated_at ?? source.updatedAt),
  })
}

export function normalizeCoachSessionPlayer(row) {
  const player = Array.isArray(row?.players) ? row.players[0] : row?.players
  return Object.freeze({
    id: normalize(row?.id),
    notes: normalize(row?.notes),
    playerId: normalize(row?.player_id ?? row?.playerId),
    playerName: normalize(row?.player_name ?? row?.playerName ?? player?.player_name) || 'Player',
    section: normalize(row?.section ?? player?.section) || 'Trial',
    sessionId: normalize(row?.session_id ?? row?.sessionId),
    status: normalize(player?.status || 'active'),
    team: normalize(row?.team ?? player?.team),
  })
}

export function filterCoachSessions(sessions = [], filter = 'upcoming', now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  if (filter === 'all') return [...sessions]
  if (filter === 'completed') return sessions.filter((session) => session.status === 'completed')
  if (filter === 'history') return sessions.filter((session) => session.sessionDate < today)
  return sessions.filter((session) => session.sessionDate >= today && session.status === 'open')
}

export function getCoachSessionMutationPolicy({ context, session = null } = {}) {
  const rank = Number(context?.roleRank || 0)
  const canMutate = context?.paymentAccess?.canMutate === true && rank >= 20 && Boolean(context?.teamId)
  return Object.freeze({
    canAddPlayers: canMutate && session?.status === 'open',
    canComplete: canMutate && rank >= 50 && session?.status === 'open',
    canCreate: canMutate,
    canDelete: false,
    canEdit: canMutate && session?.status === 'open',
    canUpdatePlayerNotes: canMutate && session?.status === 'open',
    onlineRequired: true,
  })
}

export function buildCoachSessionPayload({ context, form }) {
  const teamId = normalize(context?.teamId || context?.activeTeamId)
  const teamName = normalize(context?.teamName || context?.activeTeamName)
  if (!context?.clubId || !teamId) throw new Error('Choose an active Team context.')
  const sessionDate = normalizeRequiredDate(form?.sessionDate)
  if (!sessionDate) throw new Error('Session date is required.')
  const sessionType = COACH_SESSION_TYPES.includes(normalize(form?.sessionType)) ? normalize(form.sessionType) : 'training'
  const startTime = normalizeRequiredTime(form?.startTime)
  const endTime = normalize(form?.endTime) ? normalizeRequiredTime(form.endTime) : ''
  const arrivalTime = normalize(form?.arrivalTime) ? normalizeRequiredTime(form.arrivalTime) : ''
  if (!startTime) throw new Error(sessionType === 'match' ? 'Kick-off time is required.' : 'Choose a start time.')
  if (endTime && endTime <= startTime) throw new Error('End time must be after start time.')
  if (sessionType === 'match' && arrivalTime && arrivalTime > startTime) throw new Error('Arrival time must be before kick-off time.')
  const opponent = sessionType === 'match' ? normalize(form?.opponent) : ''
  const title = normalize(form?.title) || (opponent ? `Match vs ${opponent}` : 'Training session')
  if (sessionType === 'match' && !opponent && !normalize(form?.title)) throw new Error('Add an opponent or event title.')
  return Object.freeze({
    arrival_time: sessionType === 'match' ? arrivalTime || null : null,
    club_id: context.clubId,
    end_time: endTime || null,
    location: normalize(form?.location),
    notes: normalize(form?.notes),
    opponent,
    session_date: sessionDate,
    session_type: sessionType,
    start_time: startTime,
    team: teamName,
    team_id: teamId,
    title,
  })
}

export function coachSessionFormFromSession(session = null) {
  return {
    arrivalTime: session?.arrivalTime || '',
    endTime: session?.endTime || '',
    location: session?.location || '',
    notes: session?.notes || '',
    opponent: session?.opponent || '',
    sessionDate: session?.sessionDate || new Date().toISOString().slice(0, 10),
    sessionType: session?.sessionType || 'training',
    startTime: session?.startTime || '18:00',
    title: session?.title || '',
  }
}

export function getCoachSessionCanonicalExclusions() {
  return Object.freeze([
    Object.freeze({ capability: 'attendance_status', classification: 'unnecessary', reason: 'The current authoritative Session model has Player inclusion, notes, Development records, and completion, but no separate attendance status field.' }),
    Object.freeze({ capability: 'session_delete', classification: 'web_only_governance', reason: 'Web checks linked Development records and chooses cancel or delete. Mobile keeps this governed action online on web.' }),
    Object.freeze({ capability: 'drag_drop_plan_authoring', classification: 'web_only_governance', reason: 'No canonical structured mobile-safe session-plan schema exists.' }),
  ])
}
