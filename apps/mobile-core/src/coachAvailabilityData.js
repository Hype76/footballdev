import { getCoachAvailabilityMatches, normalizeCoachInvite } from './coachPhase31ECore.js'

const PAGE_SIZE = 250

export function normalizeCoachMatchAvailability({ matchResult, matchAvailabilityResult }) {
  const responses = new Map((matchAvailabilityResult.data || []).map(row =>
    [`${row.match_day_id}:${row.player_id}`, row]))
  return Object.freeze((matchResult.data || []).map(row => {
    const fixture = Array.isArray(row.match_days) ? row.match_days[0] : row.match_days
    const response = responses.get(`${row.match_day_id}:${row.player_id}`)
    return normalizeCoachInvite({ ...row, availability_status: response?.status,
      match_date: fixture?.match_date, title: fixture?.opponent,
      cancelled_at: fixture?.status === 'cancelled' ? new Date(0).toISOString() : '',
      deleted_at: fixture?.deleted_at }, 'match')
  }))
}

export async function readAllPages(createQuery) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await createQuery().order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < PAGE_SIZE) return rows
  }
}

export async function readCoachMatchAvailability(client, user, matches, today) {
  const matchIds = getCoachAvailabilityMatches(matches, user.activeTeamId, today).map((match) => match.id)
  if (!matchIds.length) return { matchResult: { data: [] }, matchAvailabilityResult: { data: [] } }
  const scoped = (table, fields) => client.from(table).select(fields)
    .eq('club_id', user.clubId).eq('team_id', user.activeTeamId).in('match_day_id', matchIds)
  const [requests, availability] = await Promise.all([
    readAllPages(() => scoped('match_day_availability_requests', '*,match_days:match_day_id(opponent,team_id,status,deleted_at,match_date)')),
    readAllPages(() => scoped('match_day_player_availability', 'match_day_id,player_id,status,selected_at,updated_at')),
  ])
  return { matchResult: { data: requests }, matchAvailabilityResult: { data: availability } }
}
