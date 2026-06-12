import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizePlatformStatsPayload } from '../src/lib/domain/platform-normalizers.js'

test('normalizePlatformStatsPayload keeps valid platform stats intact', () => {
  const stats = normalizePlatformStatsPayload({
    totals: {
      clubs: 1,
      users: 2,
      clubUsers: 1,
      platformAdmins: 1,
      teams: 1,
      players: 5,
      playerRecords: 6,
      archivedPlayers: 1,
      evaluations: 3,
      communications: 2,
      communicationRows: 4,
      auditEvents: 9,
      recentEvaluations: 1,
      recentCommunications: 1,
    },
    platformAdmins: [
      {
        id: 'admin-1',
        email: 'owner@example.test',
        name: 'Owner',
        role: 'super_admin',
        roleLabel: 'Super Admin',
        roleRank: 100,
        status: 'active',
      },
    ],
    clubs: [
      {
        id: 'club-1',
        name: 'Cambourne Town FC',
        users: [{ id: 'user-1', email: 'coach@example.test', roleLabel: 'Coach' }],
        teams: [{ id: 'team-1', name: 'U12' }],
        roleCounts: [{ label: 'Coach', count: 1 }],
      },
    ],
  })

  assert.equal(stats.totals.clubs, 1)
  assert.equal(stats.clubs.length, 1)
  assert.equal(stats.clubs[0].id, 'club-1')
  assert.equal(stats.clubs[0].users.length, 1)
  assert.equal(stats.clubs[0].teams.length, 1)
  assert.equal(stats.clubs[0].roleCounts.length, 1)
})

test('normalizePlatformStatsPayload removes malformed rows before UI reads ids', () => {
  const stats = normalizePlatformStatsPayload({
    totals: {
      clubs: '2',
      users: 'bad',
    },
    platformAdmins: [
      null,
      {},
      { id: 'admin-1', email: 'owner@example.test' },
    ],
    clubs: [
      null,
      {},
      {
        id: 'club-1',
        name: '',
        users: [null, {}, { id: 'user-1' }],
        teams: [null, {}, { id: 'team-1' }],
        roleCounts: [null, {}, { label: 'Coach', count: '2' }],
      },
    ],
  })

  assert.equal(stats.totals.clubs, 2)
  assert.equal(stats.totals.users, 0)
  assert.deepEqual(stats.platformAdmins.map((admin) => admin.id), ['admin-1'])
  assert.deepEqual(stats.clubs.map((club) => club.id), ['club-1'])
  assert.equal(stats.clubs[0].name, 'Unnamed club')
  assert.deepEqual(stats.clubs[0].users.map((member) => member.id), ['user-1'])
  assert.deepEqual(stats.clubs[0].teams.map((team) => team.id), ['team-1'])
  assert.deepEqual(stats.clubs[0].roleCounts, [{ label: 'Coach', count: 2 }])
})
