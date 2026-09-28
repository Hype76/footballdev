import { loadFanMatches } from './_fan-schedule.js'

const normalizeName = (value) => String(value || '').replace(/^Other:\s*/i, '').trim().toLocaleLowerCase('en-GB')

async function rows(query) {
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export function buildPlayerStats({ matches = [], selections = [], events = [], votes = [], polls = [], player }) {
  const completed = matches.filter(match => match.status === 'full_time' && match.team_id === player.team_id)
  const selectedIds = new Set(selections.filter(row => row.player_id === player.id && row.status === 'selected').map(row => row.match_day_id))
  const matchIds = new Set(completed.map(match => match.id))
  const record = { won: 0, lost: 0, drawn: 0 }
  for (const match of completed) {
    if (match.home_score == null || match.away_score == null) continue
    const home = Number(match.home_score)
    const away = Number(match.away_score)
    if (!Number.isFinite(home) || !Number.isFinite(away)) continue
    const club = match.home_away === 'away' ? away : home
    const opponent = match.home_away === 'away' ? home : away
    record[club === opponent ? 'drawn' : club > opponent ? 'won' : 'lost'] += 1
  }
  const playerName = normalizeName(player.player_name)
  const activeGoals = events.filter(event => matchIds.has(event.match_day_id) && event.event_type === 'goal' && event.team_side === 'club' && (event.event_status || 'active') === 'active' && !event.voided_at && !event.is_own_goal)
  const closedPolls = new Set(polls.filter(poll => poll.status === 'closed' || (poll.closes_at && Date.parse(poll.closes_at) <= Date.now())).map(poll => poll.id))
  const awards = completed.filter(match => match.motm_poll_id && closedPolls.has(match.motm_poll_id)).reduce((count, match) => {
    const totals = new Map()
    for (const vote of votes) if (vote.poll_id === match.motm_poll_id) totals.set(vote.option_id, (totals.get(vote.option_id) || 0) + 1)
    const highest = Math.max(0, ...totals.values())
    return count + (highest > 0 && totals.get(player.id) === highest ? 1 : 0)
  }, 0)
  return {
    period: 'Last 12 months',
    matches: record,
    personal: {
      matches: completed.filter(match => selectedIds.has(match.id)).length,
      goals: activeGoals.filter(event => normalizeName(event.scorer_name) === playerName).length,
      assists: activeGoals.filter(event => normalizeName(event.assist_name) === playerName).length,
      playerOfTheMatch: awards,
    },
  }
}

export async function loadFanPlayerStats(client, scope) {
  if (scope.fan.relationship_type !== 'player') throw Object.assign(new Error('Player account access is required.'), { statusCode: 403 })
  const matches = (await loadFanMatches(client, scope, '', { limit: 500 })).filter(match => match.status === 'full_time' && match.team_id === scope.player.team_id)
  const matchIds = matches.map(match => match.id)
  if (!matchIds.length) return buildPlayerStats({ player: scope.player })
  const pollIds = [...new Set(matches.map(match => match.motm_poll_id).filter(Boolean))]
  const [selections, events, polls, votes] = await Promise.all([
    rows(client.from('match_day_player_squad_decisions').select('match_day_id,player_id,status').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id).in('match_day_id', matchIds)),
    rows(client.from('match_day_events').select('match_day_id,event_type,team_side,event_status,voided_at,is_own_goal,scorer_name,assist_name').in('match_day_id', matchIds).eq('event_type', 'goal')),
    pollIds.length ? rows(client.from('polls').select('id,status,closes_at').in('id', pollIds)) : [],
    pollIds.length ? rows(client.from('poll_votes').select('poll_id,option_id').in('poll_id', pollIds)) : [],
  ])
  return buildPlayerStats({ matches, selections, events, polls, votes, player: scope.player })
}
