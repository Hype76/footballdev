import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { buildParentMatchDayNotificationCopy } from '../netlify/functions/lib/_match-day-notification-copy.js'
import { resolveParentNotificationOpen } from '../apps/mobile-core/src/parentNotificationsCore.js'
import { getTabForNotificationRoute } from '../apps/mobile-core/src/routes.js'

const senderSource = readFileSync(new URL('../netlify/functions/send-match-day-push.js', import.meta.url), 'utf8')
const parentAppSource = readFileSync(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')

const match = {
  id: 'match-34c',
  opponent: 'Riverside Juniors',
  home_away: 'home',
  home_score: 2,
  away_score: 1,
  status: 'live',
  teams: { name: 'FP TEST U16' },
}

const cases = [
  { type: 'live', title: 'Match started' },
  { type: 'goal', event: { id: 'goal-club', event_type: 'goal', team_side: 'club', scorer_name: 'Private Player Name' }, title: 'Goal update' },
  { type: 'goal', event: { id: 'goal-opponent', event_type: 'goal', team_side: 'opponent', scorer_name: 'Opposition Player Name' }, title: 'Opposition goal' },
  { type: 'event', event: { id: 'yellow', event_type: 'yellow_card', player_name: 'Private Player Name' }, title: 'Yellow card update' },
  { type: 'event', event: { id: 'red', event_type: 'red_card', player_name: 'Private Player Name' }, title: 'Red card update' },
  { type: 'event', event: { id: 'sub', event_type: 'substitution', player_name: 'Private Player Name', player_on_name: 'Another Private Name' }, title: 'Substitution update' },
  { type: 'event', event: { id: 'pause', event_type: 'water_break', notes: 'Private pause note' }, title: 'Match pause' },
  { type: 'half_time', title: 'Half time' },
  { type: 'second_half', title: 'Second half started' },
  { type: 'extra_time', title: 'Extra time' },
  { type: 'penalties', title: 'Penalties' },
  { type: 'full_time', title: 'Full time' },
  { type: 'score_correction', event: { id: 'correction', event_type: 'score_correction', notes: 'Private correction note' }, title: 'Score corrected' },
  { type: 'status_change', override: { status: 'cancelled' }, title: 'Match cancelled', includeScore: false },
  { type: 'status_change', override: { status: 'postponed' }, title: 'Match postponed', includeScore: false },
  { type: 'scorer_selected', title: 'Match Day scorer selected', includeScore: false },
  { type: 'scorer_request', title: 'Scorer needed', includeScore: false },
  { type: 'unknown_event', title: 'Match update' },
]

test('Minimal and Detailed Match Day copy follows event taxonomy without private person data', () => {
  for (const scenario of cases) {
    const copy = buildParentMatchDayNotificationCopy({
      match: { ...match, ...(scenario.override || {}) },
      type: scenario.type,
      event: scenario.event,
    })

    assert.equal(copy.title, scenario.title)
    assert.match(copy.minimalBody, /FP TEST U16 v Riverside Juniors/)
    assert.doesNotMatch(copy.minimalBody, /2\s*-\s*1/)
    assert.doesNotMatch(`${copy.title} ${copy.minimalBody} ${copy.detailedBody}`, /Private Player Name|Another Private Name|Opposition Player Name|Private correction note/)

    if (scenario.includeScore !== false) {
      assert.match(copy.detailedBody, /Score 2\s*-\s*1/)
    } else {
      assert.doesNotMatch(copy.detailedBody, /Score 2\s*-\s*1/)
    }
  }
})

test('unknown Match Day events fail closed to a useful privacy-safe generic update', () => {
  const copy = buildParentMatchDayNotificationCopy({
    match,
    type: 'unexpected_internal_event',
    event: {
      event_type: 'unexpected_internal_event',
      notes: '<p>Private body</p>',
      scorer_name: 'Private Player Name',
    },
  })

  assert.equal(copy.title, 'Match update')
  assert.equal(copy.minimalBody, 'Match update for FP TEST U16 v Riverside Juniors.')
  assert.equal(copy.detailedBody, 'Match information was updated for FP TEST U16 v Riverside Juniors. Score 2 - 1.')
})

test('native and web Parent notification delivery use canonical copy and exact Match targets', () => {
  assert.match(senderSource, /buildParentMatchDayNotificationCopy\(\{ match, type, event: eventRow \}\)/)
  assert.match(senderSource, /body: notificationCopy\.detailedBody/)
  assert.match(senderSource, /minimalBody: notificationCopy\.minimalBody/)
  assert.match(senderSource, /detailedBody: notificationCopy\.detailedBody/)
  assert.match(senderSource, /route: 'matchday'/)
  assert.match(senderSource, /matchDayId: match\.id/)
  assert.match(senderSource, /parent-portal\?section=matches&matchDayId=/)
  assert.match(senderSource, /\.neq\('detail_level', 'off'\)/)
  assert.doesNotMatch(senderSource, /Your team has a new Matchday update|Matchday information has been updated/)
})

test('Parent notification tap opens Matchday and promotes the exact authorised Match card', () => {
  assert.equal(getTabForNotificationRoute('parent', 'matchday'), 'matchday')
  assert.deepEqual(
    resolveParentNotificationOpen(
      { app: 'parent', route: 'matchday', matchDayId: 'match-34c' },
      { matchday: ['match-34c'] },
    ),
    { tab: 'matchday', targetId: 'match-34c' },
  )
  assert.deepEqual(
    resolveParentNotificationOpen(
      { app: 'parent', route: 'matchday', matchDayId: 'wrong-match' },
      { matchday: ['match-34c'] },
    ),
    { tab: 'matchday', targetId: '' },
  )
  assert.match(parentAppSource, /resolveParentNotificationOpen\(notificationData/)
  assert.match(parentAppSource, /setSelectedMatchId\(destination\.tab === 'matchday' \? destination\.targetId : ''\)/)
  assert.match(parentAppSource, /This notification no longer has an available Parent item\./)
})
