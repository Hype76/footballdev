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

test('historical corrections use player IDs and preserve tied POM wins', () => {
  const stats = buildPlayerStats({ matches, player, events: [
    { match_day_id: 'home-win', event_type: 'goal', team_side: 'club', event_status: 'corrected', participant_identity_version: 1, scorer_player_id: player.id, scorer_name: 'Old player name' },
    { match_day_id: 'home-win', event_type: 'goal', team_side: 'club', event_status: 'corrected', participant_identity_version: 1, assist_player_id: player.id, scorer_name: player.player_name },
  ], polls: [{ id: 'poll-1', status: 'closed' }], votes: [
    { poll_id: 'poll-1', option_id: player.id }, { poll_id: 'poll-1', option_id: 'player-2' },
  ] })
  assert.equal(stats.personal.goals, 1)
  assert.equal(stats.personal.assists, 1)
  assert.equal(stats.personal.playerOfTheMatch, 1)
})

test('recorded playing time follows submitted starters and active substitutions', () => {
  const completed = [{ ...matches[0], timer_elapsed_seconds: 46 * 60 }]
  const startingSquads = [{ match_day_id: 'home-win', player_ids: [player.id] }]
  const events = [
    { match_day_id: 'home-win', event_type: 'substitution', team_side: 'club', minute: 20, scorer_player_id: player.id, assist_player_id: 'player-2', event_status: 'active' },
    { match_day_id: 'home-win', event_type: 'substitution', team_side: 'club', minute: 35, scorer_player_id: 'player-2', assist_player_id: player.id, event_status: 'active' },
    { match_day_id: 'home-win', event_type: 'substitution', team_side: 'club', minute: 40, scorer_player_id: player.id, assist_player_id: 'player-3', event_status: 'voided' },
  ]
  const stats = buildPlayerStats({ matches: completed, startingSquads, events, player })
  assert.equal(stats.personal.playingMinutes, 31)
  assert.equal(stats.personal.playingTimeMatches, 1)
})

test('playing time stays unavailable without a starting squad or a complete substitution identity', () => {
  const completed = [{ ...matches[0], timer_elapsed_seconds: 45 * 60 }]
  const noSquad = buildPlayerStats({ matches: completed, player })
  assert.equal(noSquad.personal.playingMinutes, null)
  const incomplete = buildPlayerStats({ matches: completed, player, startingSquads: [{ match_day_id: 'home-win', player_ids: [player.id] }], events: [
    { match_day_id: 'home-win', event_type: 'substitution', team_side: 'club', minute: 20, scorer_player_id: null, assist_player_id: 'player-2' },
  ] })
  assert.equal(incomplete.personal.playingMinutes, null)
})

test('recorded playing time respects added-time substitutions in both halves', () => {
  const completed = [{ ...matches[0], timer_elapsed_seconds: 95 * 60 }]
  const startingSquads = [{ match_day_id: 'home-win', player_ids: [player.id] }]
  const events = [
    { match_day_id: 'home-win', event_type: 'substitution', team_side: 'club', minute: 45, stoppage_minute: 3, scorer_player_id: player.id, assist_player_id: 'player-2' },
    { match_day_id: 'home-win', event_type: 'substitution', team_side: 'club', minute: 90, stoppage_minute: 2, scorer_player_id: 'player-2', assist_player_id: player.id },
  ]
  const stats = buildPlayerStats({ matches: completed, startingSquads, events, player })
  assert.equal(stats.personal.playingMinutes, 51)
})

test('a recorded red card ends playing time, while a Coach dismissal does not', () => {
  const completed = [{ ...matches[0], timer_elapsed_seconds: 95 * 60 }]
  const startingSquads = [{ match_day_id: 'home-win', player_ids: [player.id] }]
  const events = [
    { match_day_id: 'home-win', event_type: 'red_card', team_side: 'club', minute: 20, scorer_name: 'Coach: Alex', scorer_player_id: null },
    { match_day_id: 'home-win', event_type: 'red_card', team_side: 'club', minute: 75, stoppage_minute: 1, scorer_player_id: player.id },
  ]
  const stats = buildPlayerStats({ matches: completed, startingSquads, events, player })
  assert.equal(stats.personal.playingMinutes, 76)
  const unknown = buildPlayerStats({ matches: completed, startingSquads, events: [
    { match_day_id: 'home-win', event_type: 'red_card', team_side: 'club', minute: 75, scorer_name: 'Other: Unknown', scorer_player_id: null },
  ], player })
  assert.equal(unknown.personal.playingMinutes, null)
})
