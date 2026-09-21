import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatSeasonDate,
  getEndSeasonStats,
  getCurrentFootballSeasonDateRange,
  getSeasonDateRangeError,
  isValidIsoDate,
} from '../src/lib/domain/season-stats.js'
import { supabase } from '../src/lib/supabase-client.js'

test('football season defaults run from 1 July through 30 June', () => {
  assert.deepEqual(getCurrentFootballSeasonDateRange(new Date('2026-06-30T12:00:00Z')), {
    startDate: '2025-07-01',
    endDate: '2026-06-30',
  })
  assert.deepEqual(getCurrentFootballSeasonDateRange(new Date('2026-07-01T12:00:00Z')), {
    startDate: '2026-07-01',
    endDate: '2027-06-30',
  })
})

test('season date ranges require real ISO dates in chronological order', () => {
  assert.equal(isValidIsoDate('2026-02-29'), false)
  assert.equal(isValidIsoDate('2026-99-99'), false)
  assert.equal(isValidIsoDate('2028-02-29'), true)
  assert.equal(formatSeasonDate('2026-07-01'), '1 July 2026')
  assert.equal(getSeasonDateRangeError('2026-08-01', '2026-07-31'), 'The From date must be on or before the To date.')
  assert.equal(getSeasonDateRangeError('2026-07-01', '2027-06-30'), '')
})

test('season stats client uses the range RPC only when both selected dates are present', async () => {
  const calls = []
  const originalRpc = supabase.rpc
  supabase.rpc = async (...args) => {
    calls.push(args)
    return { data: [], error: null }
  }

  try {
    const user = { clubId: 'club-1', role: 'admin', roleRank: 100 }
    await getEndSeasonStats({ user, teamId: 'team-1' })
    await getEndSeasonStats({ user, teamId: 'team-1', startDate: '2026-07-01', endDate: '2027-06-30' })
  } finally {
    supabase.rpc = originalRpc
  }

  assert.deepEqual(calls, [
    ['get_end_season_stats', { team_id_value: 'team-1' }],
    ['get_end_season_stats_range', {
      team_id_value: 'team-1',
      start_date_value: '2026-07-01',
      end_date_value: '2027-06-30',
    }],
  ])
})
