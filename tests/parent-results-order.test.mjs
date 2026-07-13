import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  getParentResultDateForDisplay,
  getParentResultOrderKey,
  sortParentResultsNewestFirst,
} from '../src/lib/parent-results-order.js'

const pageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const cardUrl = new URL('../src/components/match-day/PreviousGameCard.jsx', import.meta.url)

function result(overrides = {}) {
  return {
    id: overrides.id || 'result-default',
    teamId: 'team-a',
    season: '2026',
    opponent: 'Fixture Opponent',
    homeScore: 3,
    awayScore: 1,
    status: 'full_time',
    createdAt: '2026-07-20T12:00:00Z',
    ...overrides,
  }
}

function ids(matches) {
  return sortParentResultsNewestFirst(matches).map((match) => match.id)
}

test('Parent Results use authoritative fixture dates newest first instead of creation order', () => {
  const matches = [
    result({ id: 'old-created-late', matchDate: '2026-06-01', kickoffTime: '10:00', createdAt: '2026-07-30T12:00:00Z' }),
    result({ id: 'new-created-early', matchDate: '2026-07-15', kickoffTime: '09:00', createdAt: '2026-07-01T12:00:00Z' }),
    result({ id: 'middle', matchDate: '2026-07-01', kickoffTime: '18:30' }),
  ]

  assert.deepEqual(ids(matches), ['new-created-early', 'middle', 'old-created-late'])
})

test('date hierarchy prefers match datetime, linked Calendar datetime, match date, and report match date', () => {
  const matchStart = getParentResultOrderKey(result({
    fixtureStartsAt: '2026-08-10T14:00:00Z',
    calendarEventStartsAt: '2026-08-11T14:00:00Z',
    matchDate: '2026-08-12',
  }))
  const calendarStart = getParentResultOrderKey(result({
    calendarEventStartsAt: '2026-08-11T14:00:00Z',
    matchDate: '2026-08-12',
  }))
  const matchDate = getParentResultOrderKey(result({ matchDate: '2026-08-12' }))
  const reportDate = getParentResultOrderKey(result({ finalReportMatchDate: '2026-08-13' }))

  assert.equal(matchStart.primarySource, 'match_start')
  assert.equal(calendarStart.primarySource, 'calendar_event')
  assert.equal(matchDate.primarySource, 'match_date')
  assert.equal(reportDate.primarySource, 'result_match_date')
  assert.deepEqual(
    getParentResultDateForDisplay(result({ calendarEventStartsAt: '2026-08-11T14:00:00Z', matchDate: '2026-08-12' })),
    { hasTime: true, source: 'calendar_event', value: '2026-08-11T14:00:00Z' },
  )
})

test('same-date results use kickoff time and stable identifiers deterministically', () => {
  const matches = [
    result({ id: 'same-b', matchDate: '2026-07-10', kickoffTime: '' }),
    result({ id: 'same-a', matchDate: '2026-07-10', kickoffTime: '' }),
    result({ id: 'evening', matchDate: '2026-07-10', kickoffTime: '18:00' }),
    result({ id: 'morning', matchDate: '2026-07-10', kickoffTime: '09:00' }),
  ]

  assert.deepEqual(ids(matches), ['evening', 'morning', 'same-b', 'same-a'])
  assert.deepEqual(ids([...matches].reverse()), ['evening', 'morning', 'same-b', 'same-a'])
})

test('undated and invalid records remain accessible after dated results with stable fallbacks', () => {
  const matches = [
    result({ id: 'invalid-newer', matchDate: 'not-a-date', concludedAt: '2026-07-12T12:00:00Z' }),
    result({ id: 'dated', matchDate: '2026-06-01' }),
    result({ id: 'undated-older', matchDate: '', concludedAt: '2026-07-01T12:00:00Z' }),
  ]

  assert.doesNotThrow(() => sortParentResultsNewestFirst(matches))
  assert.deepEqual(ids(matches), ['dated', 'invalid-newer', 'undated-older'])
  assert.equal(getParentResultOrderKey(matches[0]).hasPrimaryDate, false)
})

test('known dates without times remain date-only ordering values', () => {
  const key = getParentResultOrderKey(result({ matchDate: '2026-07-10', kickoffTime: '' }))

  assert.equal(key.hasPrimaryDate, true)
  assert.equal(key.hasPrimaryTime, false)
})

test('child, team, and season filters sort only their authorised result set', () => {
  const combined = [
    result({ id: 'child-a-old', childId: 'child-a', teamId: 'team-a', season: '2025', matchDate: '2025-11-01' }),
    result({ id: 'child-b', childId: 'child-b', teamId: 'team-b', season: '2026', matchDate: '2026-07-01' }),
    result({ id: 'child-a-new', childId: 'child-a', teamId: 'team-a', season: '2026', matchDate: '2026-06-01' }),
  ]
  const childA = combined.filter((match) => match.childId === 'child-a')
  const currentTeamSeason = combined.filter((match) => match.teamId === 'team-a' && match.season === '2026')

  assert.deepEqual(ids(childA), ['child-a-new', 'child-a-old'])
  assert.deepEqual(ids(currentTeamSeason), ['child-a-new'])
  assert.equal(sortParentResultsNewestFirst(childA).some((match) => match.childId === 'child-b'), false)
})

test('hard refresh, additional loading, host, and viewport inputs produce the same global order', () => {
  const firstPage = [
    result({ id: 'middle', matchDate: '2026-06-10' }),
    result({ id: 'oldest', matchDate: '2026-05-10' }),
  ]
  const additionalPage = [result({ id: 'newest', matchDate: '2026-07-10' })]
  const expected = ['newest', 'middle', 'oldest']

  assert.deepEqual(ids([...firstPage, ...additionalPage]), expected)
  assert.deepEqual(ids(structuredClone([...firstPage, ...additionalPage]).reverse()), expected)
  assert.deepEqual(ids([...firstPage, ...additionalPage].map((match) => ({ ...match, host: 'main', viewport: 'desktop' }))), expected)
  assert.deepEqual(ids([...firstPage, ...additionalPage].map((match) => ({ ...match, host: 'parent', viewport: 'mobile' }))), expected)
})

test('sorting preserves each result link, score, opponent, and object association', () => {
  const older = result({ id: 'older', matchDate: '2026-06-01', opponent: 'Older Opponent', homeScore: 1, awayScore: 0, href: '/result/older' })
  const newer = result({ id: 'newer', matchDate: '2026-07-01', opponent: 'Newer Opponent', homeScore: 4, awayScore: 2, href: '/result/newer' })
  const sorted = sortParentResultsNewestFirst([older, newer])

  assert.equal(sorted[0], newer)
  assert.deepEqual(
    sorted.map(({ href, homeScore, awayScore, opponent }) => ({ href, homeScore, awayScore, opponent })),
    [
      { href: '/result/newer', homeScore: 4, awayScore: 2, opponent: 'Newer Opponent' },
      { href: '/result/older', homeScore: 1, awayScore: 0, opponent: 'Older Opponent' },
    ],
  )
})

test('Parent Portal applies the shared sorter after result filtering and keeps loading and isolation safeguards', async () => {
  const [page, card] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(cardUrl, 'utf8'),
  ])

  assert.match(page, /sortParentResultsNewestFirst\(matches\.filter\(isPreviousMatch\)\)/)
  assert.match(page, /activeSection === 'results'[\s\S]*isLoading=\{isLoadingMatches\}/)
  assert.match(page, /isLoading \? \([\s\S]*Loading results\.\.\./)
  assert.match(page, /if \(showLoading\) \{[\s\S]*setMatches\(\[\]\)/)
  assert.match(page, /let isCurrent = true[\s\S]*if \(isCurrent\) \{[\s\S]*setMatches\(nextMatches\)/)
  assert.match(card, /onClick=\{\(\) => onOpen\(match\)\}/)
  assert.match(card, /getParentResultDateForDisplay\(match\)/)
  assert.match(card, /hour: resolvedDate\.hasTime \? '2-digit' : undefined/)
  assert.doesNotMatch(card, /Invalid Date/)
})
