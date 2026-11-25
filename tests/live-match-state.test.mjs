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
  assert.equal(shootout.elapsedSeconds, null)
  assert.equal(shootout.homeShootoutScore, 4)
  assert.equal(shootout.awayShootoutScore, 3)
  const fullTime = createLiveMatchState({ ...fixture, status: 'full_time', currentMatchPhase: 'full_time', timerStatus: 'full_time', homeShootoutScore: 4, awayShootoutScore: 3, shootoutWinner: 'home' }, now)
  assert.equal(fullTime.phase, 'Full time')
  assert.equal(fullTime.elapsedSeconds, null)
  assert.equal(fullTime.running, false)
  assert.equal(fullTime.homeShootoutScore, 4)
  assert.equal(fullTime.awayShootoutScore, 3)
  assert.equal(createLiveMatchState({ ...fixture, concludedAt: new Date(now).toISOString() }, now).end, true)
  assert.deepEqual(createLiveMatchState({ ...fixture, status: 'cancelled' }, now), { end: true })
})

test('hydration break freezes both live activity clocks until play resumes', () => {
  const hydration = createLiveMatchState({ ...fixture, status: 'live', currentMatchPhase: 'first_half',
    timerStatus: 'hydration', timerElapsedSeconds: 259, timerStartedAt: null }, now)
  assert.equal(hydration.elapsedSeconds, 259)
  assert.equal(hydration.running, false)
  const resumed = createLiveMatchState({ ...fixture, status: 'live', currentMatchPhase: 'first_half',
    timerElapsedSeconds: 259, timerStartedAt: new Date(now - 5000).toISOString() }, now)
  assert.equal(resumed.elapsedSeconds, 264)
  assert.equal(resumed.running, true)
})

test('iPhone Lock Screen centres the match status and hides the clock at full time', () => {
  for (const role of ['coach', 'parent']) {
    const source = readFileSync(new URL(`../apps/${role}-mobile/widgets/MatchLiveActivityWidget.swift`, import.meta.url), 'utf8')
    const lockScreen = source.split('ActivityConfiguration(for: MatchActivityAttributes.self)')[1].split('} dynamicIsland:')[0]
    assert.match(lockScreen, /Text\(context\.state\.phase\)/)
    assert.match(lockScreen, /if context\.state\.phase != "Full time", context\.state\.elapsedSeconds != nil \{\s*MatchClock\(state: context\.state\)/)
    assert.match(lockScreen, /\.multilineTextAlignment\(\.center\)\s*\.frame\(maxWidth: \.infinity, alignment: \.center\)/)
  }
})

test('Android centres the notification status and clock and disables the clock at full time', () => {
  const android = new URL('../apps/mobile-core/modules/live-match/android/src/main/', import.meta.url)
  const source = readFileSync(new URL('java/online/footballplayer/livematch/MatchNotification.kt', android), 'utf8')
  const layout = readFileSync(new URL('res/layout/live_match_notification.xml', android), 'utf8')
  assert.match(layout, /android:gravity="center"\s+android:orientation="horizontal">[\s\S]+@\+id\/live_match_status[\s\S]+<Chronometer[\s\S]+@\+id\/live_match_clock/)
  assert.match(source, /val elapsed = if \(state\.phase == "Full time"\) null else state\.elapsedSeconds/)
  assert.match(source, /if \(clockBase != null\) setChronometer\(R\.id\.live_match_clock, clockBase, null, true\)/)
  assert.match(source, /setCustomContentView\(matchView\(/)
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
