import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { normalizeMatchDay } from '../src/lib/domain/match-day.js'
import {
  buildCompletedMatchEventPresentation,
  buildFinalMatchReportSummary,
  compareCompletedMatchEventsChronologically,
  formatCompletedMatchEventMinute,
  resolveCompletedMatchEventTeam,
  resolveCompletedMatchPlayerName,
  sortCompletedMatchEvents,
} from '../src/lib/matchday-final-report.js'

const match = {
  id: 'match-spain-argentina',
  teamId: 'team-spain',
  opponentTeamId: 'team-argentina',
  teamName: 'Spain',
  opponent: 'Argentina',
  homeAway: 'home',
}

function event(id, minute, overrides = {}) {
  return {
    id,
    eventType: 'yellow_card',
    eventStatus: 'active',
    teamSide: 'opponent',
    teamSideRecorded: true,
    minute,
    scorerName: `Player ${id}`,
    createdAt: `2026-07-22T18:${String(minute % 60).padStart(2, '0')}:00Z`,
    ...overrides,
  }
}

test('completed report resolves canonical team attribution without silent home fallback', () => {
  assert.deepEqual(resolveCompletedMatchEventTeam({ teamSide: 'club' }, match), {
    id: 'team-spain',
    name: 'Spain',
    side: 'club',
  })
  assert.deepEqual(resolveCompletedMatchEventTeam({ teamSide: 'opponent' }, match), {
    id: 'team-argentina',
    name: 'Argentina',
    side: 'opponent',
  })
  assert.equal(resolveCompletedMatchEventTeam({ teamSide: 'opponent', scorerName: 'Manual Argentina Player' }, match).name, 'Argentina')
  assert.equal(resolveCompletedMatchEventTeam({ eventTeamId: 'team-spain', teamSide: 'opponent' }, match).name, 'Spain')
  assert.equal(resolveCompletedMatchEventTeam({ teamLabel: 'Historical XI', teamSideRecorded: false }, match).name, 'Historical XI')
  assert.deepEqual(resolveCompletedMatchEventTeam({ teamSide: 'club', teamSideRecorded: false }, match), {
    id: '',
    name: 'Team not recorded',
    side: 'unknown',
  })
})

test('home and away side labels remain correct when the club is the away team', () => {
  const awayMatch = { ...match, homeAway: 'away' }

  assert.equal(resolveCompletedMatchEventTeam({ teamSide: 'home' }, awayMatch).name, 'Argentina')
  assert.equal(resolveCompletedMatchEventTeam({ teamSide: 'away' }, awayMatch).name, 'Spain')
})

test('full player names win over initials with explicit shirt and unknown fallbacks', () => {
  const namedCases = [
    'Enzo Fernández',
    'María del Carmen Ruiz',
    'Jean-Pierre Papin',
    "Dara O'Brien",
  ]

  for (const playerName of namedCases) {
    assert.equal(resolveCompletedMatchPlayerName({ scorerName: `  ${playerName}  `, scorerInitials: 'X' }), playerName)
  }

  assert.equal(resolveCompletedMatchPlayerName({ scorerShirtNumber: '17', scorerInitials: 'Q' }), 'Shirt #17')
  assert.equal(resolveCompletedMatchPlayerName({ scorerInitials: 'Q' }), 'Unknown player')
  assert.equal(resolveCompletedMatchPlayerName({ assistName: 'Mikel Merino' }, 'secondary'), 'Mikel Merino')
})

test('Spain versus Argentina card pattern is newest first and never sorted alphabetically', () => {
  const cards = [116, 128, 35, 52, 80, 90].map((minute) => event(`card-${minute}`, minute))
  const originalOrder = cards.map((item) => item.id)
  const summary = buildFinalMatchReportSummary({ ...match, events: cards })

  assert.deepEqual(summary.activeCards.map((item) => item.minute), [128, 116, 90, 80, 52, 35])
  assert.deepEqual(summary.timelineEvents.map((item) => item.minute), [35, 52, 80, 90, 116, 128])
  assert.deepEqual(cards.map((item) => item.id), originalOrder)
})

test('same-minute event order is deterministic and refresh-stable', () => {
  const first = event('same-minute-first', 52, { eventSequence: 1, createdAt: '2026-07-22T18:52:00Z' })
  const second = event('same-minute-second', 52, { eventSequence: 2, createdAt: '2026-07-22T18:52:01Z' })
  const events = [second, first]
  const firstRender = sortCompletedMatchEvents(events, { newestFirst: true }).map((item) => item.id)
  const refreshedRender = sortCompletedMatchEvents(structuredClone(events), { newestFirst: true }).map((item) => item.id)

  assert.deepEqual(firstRender, ['same-minute-second', 'same-minute-first'])
  assert.deepEqual(refreshedRender, firstRender)
})

test('phase, stoppage, timestamp and stable identifiers complete chronological ordering', () => {
  const ordered = sortCompletedMatchEvents([
    event('second-half', 1, { matchPhase: 'second_half' }),
    event('stoppage-four', '90+4', { matchPhase: 'first_half' }),
    event('stoppage-two', '90+2', { matchPhase: 'first_half' }),
    event('same-time-b', 45, { matchPhase: 'first_half', createdAt: '2026-07-22T18:45:00Z' }),
    event('same-time-a', 45, { matchPhase: 'first_half', createdAt: '2026-07-22T18:45:00Z' }),
  ])

  assert.deepEqual(ordered.map((item) => item.id), [
    'same-time-a',
    'same-time-b',
    'stoppage-two',
    'stoppage-four',
    'second-half',
  ])
  assert.equal(formatCompletedMatchEventMinute({ minute: '90+4' }), "90+4'")
  assert.ok(compareCompletedMatchEventsChronologically({ minute: 9 }, { minute: 100 }) < 0)
})

test('all completed summary sections use newest-first while the narrative remains oldest-first', () => {
  const events = [
    event('goal-10', 10, { eventType: 'goal', teamSide: 'club' }),
    event('goal-70', 70, { eventType: 'goal', teamSide: 'club' }),
    event('sub-20', 20, { eventType: 'substitution' }),
    event('sub-60', 60, { eventType: 'substitution' }),
    event('injury-30', 30, { eventType: 'injury' }),
    event('water-40', 40, { eventType: 'water_break', scorerName: '' }),
    event('note-50', 50, { eventType: 'note', notes: 'Shape changed' }),
  ]
  const summary = buildFinalMatchReportSummary({ ...match, events })

  assert.deepEqual(summary.activeGoals.map((item) => item.minute), [70, 10])
  assert.deepEqual(summary.activeSubstitutions.map((item) => item.minute), [60, 20])
  assert.deepEqual(summary.activeInjuries.map((item) => item.minute), [30])
  assert.deepEqual(summary.activeWaterBreaks.map((item) => item.minute), [40])
  assert.deepEqual(summary.activeOtherEvents.map((item) => item.minute), [50])
  assert.deepEqual(summary.timelineEvents.map((item) => item.minute), [10, 20, 30, 40, 50, 60, 70])
})

test('staff and parent presentation share facts while parent-safe rendering omits event notes', () => {
  const card = event('card-42', 42, {
    scorerName: 'Enzo Fernández',
    scorerInitials: 'E',
    notes: 'Staff tactical note',
  })
  const staff = buildCompletedMatchEventPresentation(card, match, { includeNotes: true })
  const parent = buildCompletedMatchEventPresentation(card, match, { includeNotes: false })

  assert.equal(staff.team.name, parent.team.name)
  assert.equal(staff.detail, parent.detail)
  assert.equal(staff.minuteLabel, parent.minuteLabel)
  assert.equal(staff.notes, 'Staff tactical note')
  assert.equal(parent.notes, '')
})

test('historical normalization records whether team attribution was actually present', () => {
  const historical = normalizeMatchDay({
    id: 'historical-match',
    team_id: 'team-spain',
    opponent: 'Argentina',
    teams: { name: 'Spain' },
    match_day_events: [{ id: 'historical-card', event_type: 'yellow_card', minute: 42 }],
  })

  assert.equal(historical.events[0].teamSide, 'club')
  assert.equal(historical.events[0].teamSideRecorded, false)
  assert.equal(resolveCompletedMatchEventTeam(historical.events[0], historical).name, 'Team not recorded')
})

test('staff and parent pages use the shared completed-report component with privacy filtering', async () => {
  const [staffPage, parentPage, parentDomain, sharedComponent] = await Promise.all([
    readFile(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/match-day/PreviousGameCard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/domain/match-day.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/match-day/CompletedMatchEventReport.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(staffPage, /<CompletedMatchEventReport includeEventNotes match=\{match\} \/>/)
  assert.match(parentPage, /<CompletedMatchEventReport match=\{match\} \/>/)
  assert.match(parentDomain, /delete match\.finalReport/)
  assert.match(parentDomain, /delete parentEvent\.correctionMetadata/)
  assert.match(parentDomain, /delete parentEvent\.createdByName/)
  assert.match(parentDomain, /delete parentEvent\.correctedByName/)
  assert.match(parentDomain, /delete parentEvent\.voidedByName/)
  assert.doesNotMatch(sharedComponent, /email|phone|authUserId|parentLinkId|teamId|clubId/)
})
