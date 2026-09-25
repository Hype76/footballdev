import assert from 'node:assert/strict'
import test from 'node:test'
import { upcomingFanSchedule } from '../src/lib/fan-schedule.js'
import { buildFanScheduleEvents, loadFanSchedule } from '../netlify/functions/lib/_fan-schedule.js'

test('Upcoming uses London time, keeps ongoing and time-TBC items, and excludes ended or terminal items', () => {
  const items = [
    { id: 'past', date: '2026-09-08', time: '18:00' },
    { id: 'ended', date: '2026-09-09', time: '10:00', end_time: '11:00' },
    { id: 'ongoing', date: '2026-09-09', time: '10:00', end_time: '12:00' },
    { id: 'next', starts_at: '2026-09-09T10:30:00Z' },
    { id: 'tbc', date: '2026-09-09', time: '' },
    { id: 'complete', date: '2026-09-10', status: 'full_time' },
    { id: 'cancelled', date: '2026-09-10', status: 'cancelled' },
    { id: 'invalid', date: 'wrong' },
  ]
  assert.deepEqual(upcomingFanSchedule(items, new Date('2026-09-09T10:00:00Z')).map(item => item.id), ['ongoing', 'next', 'tbc'])
  assert.deepEqual(upcomingFanSchedule([{ id: 'summer', date: '2026-07-01', time: '12:00' }], new Date('2026-07-01T11:00:00Z')), [])
  assert.deepEqual(upcomingFanSchedule([{ id: 'winter', date: '2026-12-01', time: '12:00' }], new Date('2026-12-01T12:00:00Z')), [])
  assert.equal(upcomingFanSchedule([{ id: 'overnight', date: '2026-09-08', time: '23:00', end_time: '01:00' }], new Date('2026-09-08T23:30:00Z')).length, 1)
})

test('Schedule filters historic fixtures and assessments after combining every permitted source', async () => {
  const match = { club_id: 'club', team_id: 'team', parent_visible: true, parent_audience: 'all_team_parents', opponent: 'Opponent', kickoff_time: '18:00', status: 'scheduled' }
  const tables = {
    match_days: [{ ...match, id: 'past-match', match_date: '2026-09-01' }, { ...match, id: 'future-match', match_date: '2026-09-11' }],
    calendar_event_invites: [{ assessment_session_id: 'past-assessment' }, { assessment_session_id: 'future-assessment' }],
    assessment_sessions: [{ id: 'past-assessment', session_date: '2026-08-01' }, { id: 'future-assessment', session_date: '2026-09-12', start_time: '12:00' }],
    calendar_events: [{ id: 'training', title: 'Training', starts_at: '2026-09-07T17:00:00Z', ends_at: '2026-09-07T18:00:00Z', recurrence_frequency: 'weekly', recurrence_until: '2026-09-21', parent_visible: true, parent_audience: 'all_team_parents', team_id: 'team' }],
  }
  const client = { from(table) {
    const query = { range: () => query, then(resolve) { return Promise.resolve({ data: tables[table] || [] }).then(resolve) } }
    for (const method of ['select', 'eq', 'neq', 'is', 'gte', 'order', 'limit', 'in']) query[method] = () => query
    return query
  } }
  const result = await loadFanSchedule(client, { club: { name: 'Test club' }, fan: { club_id: 'club', relationship_type: 'player', permissions: { schedule: true } }, parent: { club_id: 'club', team_id: 'team' }, player: { id: 'player', team_id: 'team' } }, new Date('2026-09-09T10:00:00Z'))
  assert.deepEqual(result.map(item => item.id), ['future-match', 'future-assessment', 'training:2026-09-14', 'training:2026-09-21'])
})

test('regular fans see games only even when schedule permissions include other event types', async () => {
  const tables = {
    match_days: [{ id: 'game', club_id: 'club', team_id: 'team', parent_visible: true, parent_audience: 'all_team_parents', match_date: '2026-09-11', kickoff_time: '18:00', status: 'scheduled' }],
    calendar_event_invites: [{ calendar_event_id: 'training', assessment_session_id: 'assessment' }],
    calendar_events: [{ id: 'training', title: 'Training', event_type: 'training', starts_at: '2026-09-11T17:00:00Z', parent_visible: true, parent_audience: 'all_team_parents', team_id: 'team' }],
    assessment_sessions: [{ id: 'assessment', session_date: '2026-09-12' }],
  }
  const client = { from(table) {
    const query = { then(resolve) { return Promise.resolve({ data: tables[table] || [] }).then(resolve) } }
    for (const method of ['select', 'eq', 'neq', 'is', 'gte', 'order', 'limit', 'in']) query[method] = () => query
    return query
  } }
  const scope = { club: { name: 'Test club' }, fan: { club_id: 'club', relationship_type: 'fan', permissions: { schedule: true } }, parent: { club_id: 'club', team_id: 'team' }, player: { id: 'player', team_id: 'team' } }
  const result = await loadFanSchedule(client, scope, new Date('2026-09-09T10:00:00Z'))
  assert.deepEqual(result.map(item => item.id), ['game'])
})

test('training appears only for a directly selected player', () => {
  const event = { id: 'training', title: 'Training', event_type: 'training', starts_at: '2026-09-11T17:00:00Z', ends_at: '2026-09-11T18:00:00Z', parent_visible: true, parent_audience: 'all_team_parents', team_id: 'team' }
  const input = { events: [event], occurrences: [], exclusions: [], parent: { team_id: 'team' }, now: new Date('2026-09-09T10:00:00Z') }
  assert.deepEqual(buildFanScheduleEvents({ ...input, invitedIds: new Set() }), [])
  assert.deepEqual(buildFanScheduleEvents({ ...input, invitedIds: new Set(['training']) }).map(item => item.id), ['training:2026-09-11'])
})
