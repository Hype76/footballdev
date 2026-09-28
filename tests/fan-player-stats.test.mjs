import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPlayerStats } from '../netlify/functions/lib/_fan-player-stats.js'

const player = { id: 'player-1', player_name: 'Jenson Bailey', team_id: 'team-1' }
const matches = [
  { id: 'home-win', team_id: 'team-1', status: 'full_time', home_away: 'home', home_score: 3, away_score: 1, motm_poll_id: 'poll-1' },
  { id: 'away-loss', team_id: 'team-1', status: 'full_time', home_away: 'away', home_score: 2, away_score: 0 },
  { id: 'draw', team_id: 'team-1', status: 'full_time', home_away: 'home', home_score: 1, away_score: 1 },
  { id: 'scheduled', team_id: 'team-1', status: 'scheduled', home_away: 'home', home_score: 0, away_score: 0 },
]

test('Player stats count completed team results and selected appearances', () => {
  const stats = buildPlayerStats({ matches, selections: [
    { match_day_id: 'home-win', player_id: player.id, status: 'selected' },
    { match_day_id: 'draw', player_id: player.id, status: 'selected' },
  ], player })
  assert.deepEqual(stats.matches, { won: 1, lost: 1, drawn: 1 })
  assert.equal(stats.personal.matches, 2)
})

test('Goals, assists and Player of the Match use active goals and winning closed polls', () => {
  const stats = buildPlayerStats({ matches, player, events: [
    { match_day_id: 'home-win', event_type: 'goal', team_side: 'club', scorer_name: 'Jenson Bailey', assist_name: 'Sam', event_status: 'active' },
    { match_day_id: 'draw', event_type: 'goal', team_side: 'club', scorer_name: 'Sam', assist_name: 'Jenson Bailey', event_status: 'active' },
    { match_day_id: 'home-win', event_type: 'goal', team_side: 'club', scorer_name: 'Jenson Bailey', event_status: 'voided' },
    { match_day_id: 'home-win', event_type: 'goal', team_side: 'club', scorer_name: 'Jenson Bailey', is_own_goal: true },
  ], polls: [{ id: 'poll-1', status: 'closed' }], votes: [
    { poll_id: 'poll-1', option_id: player.id }, { poll_id: 'poll-1', option_id: player.id }, { poll_id: 'poll-1', option_id: 'player-2' },
  ] })
  assert.equal(stats.personal.goals, 1)
  assert.equal(stats.personal.assists, 1)
  assert.equal(stats.personal.playerOfTheMatch, 1)
})
