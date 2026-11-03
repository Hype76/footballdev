import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createLiveMatchState } from '../apps/mobile-core/src/liveMatchState.js'

const now = Date.parse('2026-11-03T12:30:00Z')
const fixture = {
  status: 'second_half', currentMatchPhase: 'second_half', teamName: 'Rovers', opponent: 'City', homeAway: 'away',
  homeScore: 2, awayScore: 3, matchDurationMinutes: 90, timerStatus: 'running',
  timerElapsedSeconds: 2700, timerStartedAt: new Date(now - 30000).toISOString(),
}

test('live activity state follows the match clock and home/away order', () => {
  const state = createLiveMatchState(fixture, now)
  assert.equal(state.homeName, 'City')
  assert.equal(state.awayName, 'Rovers')
  assert.equal(state.homeScore, 2)
  assert.equal(state.awayScore, 3)
  assert.equal(state.elapsedSeconds, 2730)
  assert.equal(state.running, true)
  assert.equal(state.sampledAtMs, now)
  assert.equal(state.phase, 'Second half')
})

test('pauses, shootouts, conclusion and cancellation do not present a running timer', () => {
  const paused = createLiveMatchState({ ...fixture, timerStatus: 'paused' }, now)
  assert.equal(paused.elapsedSeconds, 2700)
  assert.equal(paused.running, false)
  const shootout = createLiveMatchState({ ...fixture, status: 'penalties', currentMatchPhase: 'penalties', homeShootoutScore: 4, awayShootoutScore: 3 }, now)
  assert.equal(shootout.running, false)
  assert.equal(shootout.homeShootoutScore, 4)
  assert.equal(shootout.awayShootoutScore, 3)
  assert.equal(createLiveMatchState({ ...fixture, concludedAt: new Date(now).toISOString() }, now).end, true)
  assert.deepEqual(createLiveMatchState({ ...fixture, status: 'cancelled' }, now), { end: true })
})

test('scheduled match score has no pre-match label or clock', () => {
  const state = createLiveMatchState({ ...fixture, status: 'scheduled', currentMatchPhase: 'pre_match', timerStatus: 'not_started', timerElapsedSeconds: 0 }, now)
  assert.equal(state.phase, '')
  assert.equal(state.elapsedSeconds, null)
  assert.equal(state.running, false)
  assert.equal(state.homeScore, 2)
  assert.equal(state.awayScore, 3)
  for (const role of ['coach', 'parent']) {
    const source = readFileSync(new URL(`../apps/${role}-mobile/widgets/Module.swift`, import.meta.url), 'utf8')
    assert.match(source, /staleDate: Date\(\)\.addingTimeInterval\(4 \* 60 \* 60\)/)
  }
})

test('the payload does not include player, parent or unsent command data', () => {
  const state = createLiveMatchState({ ...fixture, players: [{ name: 'Private' }], journal: [{ pending: true }] }, now)
  assert.equal(JSON.stringify(state).includes('Private'), false)
  assert.equal('journal' in state, false)
  assert.throws(() => createLiveMatchState(fixture, NaN), /live_match_snapshot_invalid/)
})

test('card totals follow home and away sides without depending on goals', () => {
  const state = createLiveMatchState({ ...fixture, homeScore: 0, awayScore: 0, match_day_events: [
    { event_type: 'yellow_card', team_side: 'club', event_status: 'active' },
    { event_type: 'red_card', team_side: 'opponent', event_status: 'active' },
    { event_type: 'yellow_card', team_side: 'opponent', event_status: 'voided' },
  ] }, now)
  assert.equal(state.clubIsHome, false)
  assert.equal(state.homeRedCards, 1)
  assert.equal(state.awayYellowCards, 1)
  assert.equal(state.homeYellowCards, 0)
  assert.equal(state.running, true)
})
