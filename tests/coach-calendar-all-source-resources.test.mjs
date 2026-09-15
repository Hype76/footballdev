import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildCoachCalendarOccurrenceDates,
  getCoachCalendarEventResourceIds,
  normalizeCoachCalendarEvent,
  normalizeCoachCalendarFormDate,
} from '../apps/mobile-core/src/coachCalendarCore.js'

const dataSource = await readFile(new URL('../apps/mobile-core/src/coachCalendarData.js', import.meta.url), 'utf8')
const operationalSource = await readFile(new URL('../apps/mobile-core/src/coachOperationalData.js', import.meta.url), 'utf8')
const operationalGuards = operationalSource.slice(operationalSource.indexOf('export function assertCoachOperationalRead'), operationalSource.indexOf('export function assertCoachCapability')).replaceAll('export ', '')
const syncSource = dataSource.slice(dataSource.indexOf('export async function syncCoachCalendarEventResources'), dataSource.indexOf('async function callCoachCalendarChangeNotifications')).replace('export ', '')
const user = { id: 'staff', clubId: 'club', activeTeamId: 'team', role: 'team_admin', roleRank: 50, hasActivePlanAccess: true, email: 'staff@synthetic.test' }
const tablesByType = { calendar_event: 'calendar_events', match_day: 'match_days', assessment_session: 'assessment_sessions' }
const baseSource = { id: 'source', club_id: 'club', team_id: 'team', status: 'open', starts_at: '2026-09-10T16:00:00Z', recurrence_frequency: 'weekly', recurrence_until: '2026-09-24', cancelled_at: null }
const event = type => ({ sourceType: type, sourceId: 'source', teamId: 'team', calendarDate: '2026-09-17', occurrenceDate: '2026-09-17', recurrenceFrequency: 'weekly', recurrenceUntil: '2026-09-24' })
const link = (id, resourceId, linkedType = 'calendar_event', date = '2026-09-17') => ({
  id, resource_id: resourceId, club_id: 'club', team_id: 'team', linked_type: linkedType,
  linked_id: 'source', calendar_occurrence_date: date, removed_at: null,
})

function fixture({ sourceType = 'calendar_event', source = baseSource, links = [], resources, failTable = '' } = {}) {
  const tables = {
    [tablesByType[sourceType]]: source ? [{ ...source }] : [],
    resource_library_items: resources || ['one', 'two', 'three'].map(id => ({ id, club_id: 'club', team_id: 'team', archived_at: null })),
    resource_library_links: links.map(row => ({ ...row })),
  }
  const writes = [], queries = [], audits = []
  const db = {
    from(table) {
      queries.push(table)
      const filters = []
      let inserted = null
      const builder = {
        select(fields) {
          if (table === 'match_days') assert.ok(fields.split(',').includes('deleted_at'))
          if (table === 'assessment_sessions') assert.ok(!fields.split(',').includes('deleted_at'))
          return builder
        },
        eq(key, value) { filters.push(row => row[key] === value); return builder },
        is(key, value) { filters.push(row => row[key] === value); return builder },
        in(key, values) { filters.push(row => values.includes(row[key])); return builder },
        insert(rows) { inserted = rows; return builder },
        async single() { const result = await builder; return { ...result, data: result.data?.length === 1 ? result.data[0] : null } },
        then(resolve, reject) {
          if (inserted) writes.push({ table, inserted })
          return Promise.resolve({ data: (tables[table] || []).filter(row => filters.every(filter => filter(row))), error: failTable === table ? new Error('Synthetic read failure') : null }).then(resolve, reject)
        },
      }
      return builder
    },
    async rpc(name, args) {
      assert.equal(name, 'remove_resource_library_link')
      writes.push({ rpc: name, args })
      return { error: null }
    },
  }
  const sync = new Function('supabase', 'recordCoachOperationalAudit', 'buildCoachCalendarOccurrenceDates', 'normalizeCoachCalendarEvent', 'normalizeCoachCalendarFormDate',
    `const normalize = value => String(value ?? '').trim(); ${operationalGuards} ${syncSource}; return syncCoachCalendarEventResources`)(
    db, async audit => audits.push(audit), buildCoachCalendarOccurrenceDates, normalizeCoachCalendarEvent, normalizeCoachCalendarFormDate,
  )
  return { sync, writes, queries, audits }
}

test('resource lookup isolates source type and keeps dated training occurrences separate', () => {
  const resources = [
    { id: 'training', links: [{ linkedType: 'calendar_event', linkedId: 'source', calendarOccurrenceDate: '2026-09-17' }] },
    { id: 'other-date', links: [{ linkedType: 'calendar_event', linkedId: 'source', calendarOccurrenceDate: '2026-09-24' }] },
    { id: 'fixture', links: [{ linkedType: 'match_day', linkedId: 'source', calendarOccurrenceDate: null }] },
    { id: 'session', links: [{ linkedType: 'assessment_session', linkedId: 'source', calendar_occurrence_date: null }] },
    { id: 'wrong-dated-match', links: [{ linkedType: 'match_day', linkedId: 'source', calendarOccurrenceDate: '2026-09-17' }] },
  ]
  assert.deepEqual(getCoachCalendarEventResourceIds(resources, 'source', '2026-09-17'), ['training'])
  assert.deepEqual(getCoachCalendarEventResourceIds(resources, 'source', '2026-09-24'), ['other-date'])
  assert.deepEqual(getCoachCalendarEventResourceIds(resources, 'source', '', 'match_day'), ['fixture'])
  assert.deepEqual(getCoachCalendarEventResourceIds(resources, 'source', '2026-09-17', 'assessment_session'), ['session'])
  assert.deepEqual(getCoachCalendarEventResourceIds(resources, 'source', '', 'player'), [])
})

test('all three source types save canonical links after checking the current source and team', async () => {
  for (const sourceType of Object.keys(tablesByType)) {
    const db = fixture({ sourceType })
    assert.deepEqual(await db.sync(user, event(sourceType), ['one', 'one']), ['one'])
    assert.equal(db.queries[0], tablesByType[sourceType])
    assert.equal(db.writes.length, 1)
    assert.equal(db.writes[0].inserted.length, 1)
    assert.equal(db.writes[0].inserted[0].linked_type, sourceType)
    assert.equal(db.writes[0].inserted[0].linked_id, 'source')
    assert.equal(db.writes[0].inserted[0].calendar_occurrence_date, sourceType === 'calendar_event' ? '2026-09-17' : null)
    assert.equal(db.audits[0].entityType, sourceType)
  }
})

test('training sync only removes links for the selected occurrence and preserves neighbouring weeks', async () => {
  const db = fixture({ links: [link('this-week', 'one'), link('next-week', 'two', 'calendar_event', '2026-09-24')] })
  await db.sync(user, event('calendar_event'), ['three'])
  assert.deepEqual(db.writes.filter(write => write.rpc).map(write => write.args.target_link_id), ['this-week'])
  assert.equal(db.writes.find(write => write.inserted).inserted[0].calendar_occurrence_date, '2026-09-17')
})

test('match and session changes cannot remove links belonging to another canonical source', async () => {
  for (const sourceType of ['match_day', 'assessment_session']) {
    const db = fixture({ sourceType, links: [link('current', 'one', sourceType, null), link('training', 'one'),
      link('malformed-date', 'one', sourceType, '2026-09-17'), link('unrelated', 'one', sourceType === 'match_day' ? 'assessment_session' : 'match_day', null)] })
    await db.sync(user, event(sourceType), [])
    assert.deepEqual(db.writes.filter(write => write.rpc).map(write => write.args.target_link_id), ['current'])
  }
})

test('real recurrence rules override stale or forged dates supplied by the screen', async () => {
  const db = fixture()
  await assert.rejects(db.sync(user, { ...event('calendar_event'), recurrenceFrequency: 'daily', recurrenceUntil: '2027-01-01' }, ['one'], '2026-09-18'), /valid dated occurrence/)
  assert.equal(db.writes.length, 0)
  assert.deepEqual(db.queries, ['calendar_events'])
  await db.sync(user, event('calendar_event'), ['one'], '2026-09-24')
  assert.equal(db.writes[0].inserted[0].calendar_occurrence_date, '2026-09-24')
})

test('missing, cross-club, cross-team and cancelled sources reject before any link mutation', async () => {
  for (const sourceType of Object.keys(tablesByType)) {
    const deniedSources = [null, { ...baseSource, club_id: 'other' }, { ...baseSource, team_id: 'other' },
      sourceType === 'calendar_event' ? { ...baseSource, cancelled_at: '2026-09-15T12:00:00Z' } : { ...baseSource, status: 'cancelled' }]
    if (sourceType === 'match_day') deniedSources.push({ ...baseSource, deleted_at: '2026-09-15T12:00:00Z' })
    for (const source of deniedSources) {
      const db = fixture({ sourceType, source })
      await assert.rejects(db.sync(user, event(sourceType), ['one']), /no longer available/)
      assert.equal(db.writes.length, 0)
    }
  }
})

test('role, subscription and active team guards run before database reads', async () => {
  for (const change of [{ roleRank: 30 }, { roleRank: 'invalid' }, { roleRank: undefined }, { hasActivePlanAccess: false },
    { activeTeamId: '' }, { activeTeamId: 'other' }, { role: 'super_admin' }]) {
    const db = fixture()
    await assert.rejects(db.sync({ ...user, ...change }, event('calendar_event'), ['one']))
    assert.equal(db.queries.length, 0)
    assert.equal(db.writes.length, 0)
  }
})

test('postponed and completed sources retain resource management in line with server policy', async () => {
  for (const [sourceType, status] of [['match_day', 'postponed'], ['match_day', 'full_time'], ['assessment_session', 'completed']]) {
    const db = fixture({ sourceType, source: { ...baseSource, status } })
    await db.sync(user, event(sourceType), ['one'])
    assert.equal(db.writes.length, 1)
  }
})

test('archived and cross-team resources cannot be linked and source read failures do not mutate links', async () => {
  for (const resource of [{ id: 'one', club_id: 'club', team_id: 'other', archived_at: null },
    { id: 'one', club_id: 'club', team_id: 'team', archived_at: '2026-09-15' }]) {
    const db = fixture({ resources: [resource] })
    await assert.rejects(db.sync(user, event('calendar_event'), ['one']), /active Team only/)
    assert.equal(db.writes.length, 0)
  }
  const failed = fixture({ failTable: 'calendar_events' })
  await assert.rejects(failed.sync(user, event('calendar_event'), ['one']), /Synthetic read failure/)
  assert.equal(failed.writes.length, 0)
})
