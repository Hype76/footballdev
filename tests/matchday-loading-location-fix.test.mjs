import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { normalizeMatchLocations } from '../src/lib/domain/match-day.js'

const matchDayDomainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)

test('Match Day list loading excludes the historical relationship graph', async () => {
  const source = await readFile(matchDayDomainUrl, 'utf8')
  const start = source.indexOf('export async function getMatchDays')
  const end = source.indexOf('export async function getMatchDay(', start)
  const listSource = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(listSource, /\.select\(buildMatchDayListSelect\(\)\)/)
  assert.doesNotMatch(listSource, /\.select\(buildMatchSelect\(\)\)/)
  assert.match(listSource, /\.eq\('club_id', user\.clubId\)/)
  assert.match(listSource, /\.is\('deleted_at', null\)/)
  assert.match(listSource, /\.order\('match_date'/)
  assert.match(listSource, /team_id\.is\.null,team_id\.eq\.\$\{user\.activeTeamId\}/)

  const selectStart = source.indexOf('function buildMatchDayListSelect()')
  const selectEnd = source.indexOf('function hasMatchDayDetails', selectStart)
  const selectSource = source.slice(selectStart, selectEnd)

  assert.doesNotMatch(selectSource, /match_day_scorer_interest|match_day_availability_requests|match_day_event_log|match_day_events|match_day_final_reports/)
  assert.match(selectSource, /teams:team_id \(name\)/)
})

test('heavy Match Day detail loading is restricted to one authorised match', async () => {
  const source = await readFile(matchDayDomainUrl, 'utf8')
  const start = source.indexOf('export async function getMatchDay(')
  const end = source.indexOf('export async function setMatchDayPlayerSquadDecision', start)
  const detailSource = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(detailSource, /\.select\(buildMatchSelect\(\)\)/)
  assert.match(detailSource, /\.eq\('id', normalizedMatchDayId\)/)
  assert.match(detailSource, /\.eq\('club_id', user\.clubId\)/)
  assert.match(detailSource, /scopeMatchDayQueryToActiveTeam\(query, user\)/)
  assert.match(detailSource, /\.maybeSingle\(\)/)
  assert.doesNotMatch(detailSource, /\.order\(/)
})

test('refresh is lightweight, single flight, and preserves hydrated detail', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const start = source.indexOf('async function refreshLiveMatches()')
  const end = source.indexOf('const intervalId = window.setInterval', start)
  const refreshSource = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(refreshSource, /refreshState\.inFlight/)
  assert.match(refreshSource, /liveRefreshStateRef\.current\.inFlight = true/)
  assert.match(refreshSource, /liveRefreshStateRef\.current\.inFlight = false/)
  assert.match(refreshSource, /getMatchDays\(\{ user \}\)/)
  assert.match(refreshSource, /mergeMatchDaySummaries\(currentMatches, nextMatches\)/)
  assert.doesNotMatch(refreshSource, /getMatchDay\(/)
  assert.doesNotMatch(refreshSource, /retry|setTimeout/)
})

test('fixture dependencies settle independently from Match Day list loading', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const start = source.indexOf('async function runLoad()')
  const end = source.indexOf('useEffect(() => {', start)
  const loadSource = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(loadSource, /Promise\.allSettled/)
  assert.match(loadSource, /locationsResult\.status === 'fulfilled'/)
  assert.match(loadSource, /setLocations\(locationsResult\.value\)/)
  assert.match(loadSource, /setIsFixtureDataLoading\(false\)/)
  assert.ok(loadSource.indexOf('setLocations(locationsResult.value)') < loadSource.indexOf("matchesResult.status === 'rejected'"))
  assert.match(loadSource, /getMatchDay\(\{ user, matchDayId: priorityMatch\.id \}\)/)
})

test('saved locations are scoped through prior team fixtures and normalized safely', async () => {
  const source = await readFile(matchDayDomainUrl, 'utf8')
  const start = source.indexOf('export async function getMatchLocations')
  const end = source.indexOf('export function normalizeMatchLocations', start)
  const locationSource = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(locationSource, /\.from\('match_days'\)/)
  assert.match(locationSource, /\.select\('location_id, venue_name, venue_address'\)/)
  assert.match(locationSource, /scopeMatchDayQueryToActiveTeam\(usageQuery, user\)/)
  assert.match(locationSource, /\.from\('match_locations'\)/)
  assert.match(locationSource, /\.in\('id', locationIds\)/)

  const locations = normalizeMatchLocations([
    { id: '1', name: '  Home Ground ', address: ' 1 Main Road ', notes: 'First' },
    { id: '2', name: 'home ground', address: '1 main road', notes: 'Duplicate' },
    { id: '3', name: '', address: 'Missing venue', notes: '' },
    { id: '4', name: 'Missing address', address: ' ', notes: '' },
    { id: '5', name: 'Away Ground', address: '2 High Street', notes: '' },
  ])

  assert.deepEqual(locations, [
    {
      id: '5',
      name: 'Away Ground',
      address: '2 High Street',
      label: 'Away Ground · 2 High Street',
      notes: '',
    },
    {
      id: '1',
      name: 'Home Ground',
      address: '1 Main Road',
      label: 'Home Ground · 1 Main Road',
      notes: 'First',
    },
  ])
})

test('saved location selection is controlled and manual entry remains available', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')

  assert.match(source, /value=\{selectedLocationId\} onChange=\{\(event\) => applyLocation\(event\.target\.value\)\}/)
  assert.match(source, /locations\.length > 0 \? 'Choose saved location' : 'No saved locations yet'/)
  assert.match(source, /\{location\.label\}/)
  assert.match(source, /venueName: location\.name/)
  assert.match(source, /venueAddress: location\.address/)
  assert.match(source, /const updateManualLocation = \(updates\) => \{\s*setSelectedLocationId\(''\)\s*updateForm\(updates\)/)
  assert.match(source, /updateManualLocation\(\{ venueName: event\.target\.value \}\)/)
  assert.match(source, /updateManualLocation\(\{ venueAddress: event\.target\.value \}\)/)
})
