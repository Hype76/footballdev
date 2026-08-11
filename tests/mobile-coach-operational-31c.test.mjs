import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildCoachCalendarMonth,
  buildCoachCalendarEvents,
  buildCoachCalendarPayload,
  filterCoachCalendarEvents,
  getCoachCalendarContextModel,
  getCoachCalendarMonthKey,
  getCoachCalendarMutationPolicy,
  groupCoachCalendarEvents,
  londonLocalToUtcIso,
  normalizeCoachCalendarEvent,
  shiftCoachCalendarMonth,
} from '../apps/mobile-core/src/coachCalendarCore.js'
import {
  buildCoachPlayerPayload,
  filterCoachPlayers,
  getCoachPlayerMutationPolicy,
  getCoachPlayerSensitiveFieldPolicy,
  normalizeCoachPlayer,
  normalizeCoachPlayerEvaluation,
} from '../apps/mobile-core/src/coachPlayersCore.js'
import {
  buildCoachSessionPayload,
  filterCoachSessions,
  getCoachSessionCanonicalExclusions,
  getCoachSessionMutationPolicy,
  normalizeCoachSession,
  normalizeCoachSessionPlayer,
} from '../apps/mobile-core/src/coachSessionsCore.js'
import {
  createCoachOfflineDocument,
  getCoachOfflineResources,
  setCoachOfflineResources,
} from '../apps/mobile-core/src/coachOfflineCore.js'
import { COACH_OPERATIONAL_BACKEND_DELTAS } from '../apps/mobile-core/src/coachOperationalCore.js'

const teamContext = Object.freeze({
  clubId: 'club-test',
  id: 'team:team-test',
  paymentAccess: { canMutate: true },
  role: 'coach',
  roleRank: 30,
  teamId: 'team-test',
  teamName: 'FP TEST',
})

test('Calendar normalizes canonical events, Match Day fixtures, and Sessions into one ordered view', () => {
  const events = buildCoachCalendarEvents({
    calendarEvents: [{ id: 'event-1', event_type: 'meeting', starts_at: '2026-08-10T17:00:00Z', ends_at: '2026-08-10T18:00:00Z', team_id: 'team-test', title: 'Review' }],
    matches: [{ id: 'match-1', kickoff_time: '19:00', match_date: '2026-08-11', opponent: 'Visitors', team_id: 'team-test', teams: { name: 'FP TEST' } }],
    sessions: [{ id: 'session-1', session_date: '2026-08-09', session_type: 'training', start_time: '18:00', team_id: 'team-test', title: 'Training' }],
  })
  assert.deepEqual(events.map((event) => event.sourceType), ['assessment_session', 'calendar_event', 'match_day'])
  assert.equal(events[1].eventType, 'meeting')
  assert.equal(events[2].title, 'FP TEST v Visitors')
  const deduplicated = buildCoachCalendarEvents({ sessions: [
    { id: 'session-1', session_date: '2026-08-09', start_time: '18:00', team_id: 'team-test' },
    { id: 'session-1', session_date: '2026-08-09', start_time: '18:00', team_id: 'team-test' },
  ] })
  assert.equal(deduplicated.length, 1)
})

test('Calendar uses Europe/London conversion and rejects the spring clock-change gap', () => {
  assert.equal(londonLocalToUtcIso('2026-01-10', '18:00'), '2026-01-10T18:00:00.000Z')
  assert.equal(londonLocalToUtcIso('2026-08-10', '18:00'), '2026-08-10T17:00:00.000Z')
  assert.throws(() => londonLocalToUtcIso('2026-03-29', '01:30'), /clocks change/)
  assert.match(londonLocalToUtcIso('2026-10-25', '01:30'), /^2026-10-25T0[01]:30:00\.000Z$/)
})

test('Calendar filters and groups upcoming, history, and cancelled data without hiding null-safe rows', () => {
  const rows = [
    normalizeCoachCalendarEvent({ id: '1', starts_at: '2026-08-09T10:00:00Z', title: 'Today' }),
    normalizeCoachCalendarEvent({ id: '2', starts_at: '2026-08-10T10:00:00Z', title: 'Cancelled', cancelled_at: '2026-08-08T00:00:00Z' }),
    normalizeCoachCalendarEvent({ id: '3', starts_at: '2026-08-08T10:00:00Z', title: 'Past' }),
  ]
  assert.equal(filterCoachCalendarEvents(rows, 'upcoming', new Date('2026-08-09T12:00:00Z')).length, 1)
  assert.equal(filterCoachCalendarEvents(rows, 'history', new Date('2026-08-09T12:00:00Z')).length, 1)
  assert.equal(filterCoachCalendarEvents(rows, 'cancelled').length, 1)
  assert.equal(groupCoachCalendarEvents(rows).length, 3)
})

test('Calendar builds a Monday-first six-week month grid with event counts and deterministic navigation', () => {
  const events = [
    normalizeCoachCalendarEvent({ id: 'event-1', starts_at: '2026-08-11T17:00:00Z', title: 'Training' }),
    normalizeCoachCalendarEvent({ id: 'event-2', starts_at: '2026-08-11T18:00:00Z', title: 'Review' }),
  ]
  const month = buildCoachCalendarMonth(events, '2026-08', '2026-08-11', new Date('2026-08-11T10:00:00Z'))
  assert.equal(month.title, 'August 2026')
  assert.equal(month.days.length, 42)
  assert.equal(month.weeks.length, 6)
  assert.equal(month.days[0].date, '2026-07-27')
  assert.equal(month.days.find((day) => day.date === '2026-08-11').events.length, 2)
  assert.equal(month.days.find((day) => day.date === '2026-08-11').isSelected, true)
  assert.equal(getCoachCalendarMonthKey('2026-08-11'), '2026-08')
  assert.equal(shiftCoachCalendarMonth('2026-08', -1), '2026-07')
  assert.equal(shiftCoachCalendarMonth('2026-12', 1), '2027-01')
})

test('Calendar routes completed sessions to History and exposes explicit authorised Team scope', () => {
  const completed = normalizeCoachCalendarEvent({ id: 'completed', session_date: '2026-08-11', start_time: '18:00', status: 'completed', team_id: 'team-test' }, 'assessment_session')
  assert.equal(filterCoachCalendarEvents([completed], 'upcoming', new Date('2026-08-09T12:00:00Z')).length, 0)
  assert.equal(filterCoachCalendarEvents([completed], 'history', new Date('2026-08-09T12:00:00Z')).length, 1)
  const clubContext = { ...teamContext, id: 'club:club-test', role: 'admin', teamId: '', teamName: '' }
  const teamTwo = { ...teamContext, id: 'team:team-two', teamId: 'team-two', teamName: 'FP TEST Two' }
  const model = getCoachCalendarContextModel({ context: clubContext, contexts: [clubContext, teamContext, teamTwo] })
  assert.equal(model.currentLabel, 'Club: Club')
  assert.equal(model.teamContextCount, 2)
  assert.deepEqual(model.options.map((option) => option.id), ['club:club-test', 'team:team-test', 'team:team-two'])
})

test('Calendar payload preserves canonical types, recurrence, visibility, Team scope, and London times', () => {
  const payload = buildCoachCalendarPayload({ context: teamContext, form: {
    date: '2026-08-12', endTime: '19:30', eventType: 'training', location: 'Pitch 1', notes: 'Bring water',
    parentAudience: 'all_team_parents', parentVisible: true, recurrenceFrequency: 'weekly', recurrenceUntil: '2026-09-30', startTime: '18:00', title: 'Team training',
  } })
  assert.equal(payload.team_id, 'team-test')
  assert.equal(payload.parent_audience, 'all_team_parents')
  assert.equal(payload.recurrence_frequency, 'weekly')
  assert.equal(payload.starts_at, '2026-08-12T17:00:00.000Z')
  const selectedUser = { ...teamContext, activeTeamId: teamContext.teamId, teamId: undefined }
  assert.equal(buildCoachCalendarPayload({ context: selectedUser, form: { date: '2026-08-12', endTime: '19:00', eventType: 'meeting', startTime: '18:00', title: 'Review' } }).team_id, 'team-test')
  assert.throws(() => buildCoachCalendarPayload({ context: teamContext, form: { date: '2026-08-12', endTime: '19:00', eventType: 'meeting', parentAudience: 'all_club_parents', parentVisible: true, startTime: '18:00', title: 'Review' } }), /Club Admins/)
  assert.throws(() => buildCoachCalendarPayload({ context: teamContext, form: { date: '2026-08-12', endTime: '17:00', eventType: 'invalid', startTime: '18:00', title: 'Bad' } }), /supported/)
})

test('Calendar mutation policy blocks payment, inherited Team edits, and derived Match Day edits', () => {
  assert.equal(getCoachCalendarMutationPolicy({ context: teamContext }).canCreate, true)
  assert.equal(getCoachCalendarMutationPolicy({ context: { ...teamContext, paymentAccess: { canMutate: false } } }).canCreate, false)
  assert.equal(getCoachCalendarMutationPolicy({ context: teamContext, event: { isInheritedClubEvent: true, sourceType: 'calendar_event' } }).canEdit, false)
  assert.equal(getCoachCalendarMutationPolicy({ context: teamContext, event: { sourceType: 'match_day' } }).canEdit, false)
})

test('Players normalize contacts, null-safe Development records, and role-sensitive visibility', () => {
  const visible = normalizeCoachPlayer({ id: 'p1', parent_email: 'PARENT@EXAMPLE.COM', parent_name: 'Parent', player_name: 'Alex player', section: 'Squad', team_id: 'team-test' })
  const hidden = normalizeCoachPlayer({ id: 'p1', parent_email: 'parent@example.com', player_name: 'Alex' }, { canViewContacts: false })
  assert.equal(visible.parentEmail, 'parent@example.com')
  assert.equal(hidden.parentContacts.length, 0)
  assert.equal(normalizeCoachPlayerEvaluation({ id: 'e1', comments: null, scores: null }).comments, '')
  assert.equal(getCoachPlayerSensitiveFieldPolicy(teamContext).canViewContactDetails, true)
  assert.equal(getCoachPlayerSensitiveFieldPolicy({ roleRank: 10, teamId: 'team-test' }).canViewContactDetails, false)
})

test('Player filters and payload remain fixed to the active Team context', () => {
  const rows = [
    normalizeCoachPlayer({ id: 'p1', player_name: 'Alex Smith', positions: ['Goalkeeper'], section: 'Squad', status: 'active' }),
    normalizeCoachPlayer({ id: 'p2', player_name: 'Jamie Jones', section: 'Trial', status: 'active' }),
  ]
  assert.deepEqual(filterCoachPlayers(rows, { query: 'goal', section: 'Squad', status: 'active' }).map((row) => row.id), ['p1'])
  const payload = buildCoachPlayerPayload({ context: teamContext, form: { contactType: 'parent', parentEmail: 'PARENT@EXAMPLE.COM', parentName: 'Parent', playerName: '  alex  smith ', positions: 'left wing, striker', section: 'Squad', teamId: 'attacker' } })
  assert.equal(payload.player_name, 'Alex Smith')
  assert.equal(payload.team_id, 'team-test')
  assert.deepEqual(payload.positions, ['Left Wing', 'Striker'])
  const selectedUserPayload = buildCoachPlayerPayload({ context: { ...teamContext, activeTeamId: teamContext.teamId, activeTeamName: teamContext.teamName, teamId: undefined, teamName: undefined }, form: { playerName: 'Taylor Player', section: 'Trial' } })
  assert.equal(selectedUserPayload.team_id, 'team-test')
})

test('Player mutation policy blocks payment, wrong role, archive, and Team transfer', () => {
  assert.equal(getCoachPlayerMutationPolicy({ context: teamContext }).canCreate, true)
  const policy = getCoachPlayerMutationPolicy({ context: { ...teamContext, paymentAccess: { canMutate: false } }, player: { status: 'active' } })
  assert.equal(policy.canEdit, false)
  assert.equal(policy.canArchive, false)
  assert.equal(policy.canTransferTeam, false)
})

test('Sessions normalize canonical roster relationships and do not invent attendance states', () => {
  const session = normalizeCoachSession({ id: 's1', session_date: '2026-08-10', session_type: 'training', start_time: '18:00', status: 'open', title: 'Training' })
  const player = normalizeCoachSessionPlayer({ id: 'sp1', player_id: 'p1', players: [{ player_name: 'Alex', section: 'Squad', status: 'active' }], session_id: 's1' })
  assert.equal(session.startTime, '18:00')
  assert.equal(player.playerName, 'Alex')
  assert.equal(Object.hasOwn(player, 'attendanceStatus'), false)
  assert.equal(getCoachSessionCanonicalExclusions().some((entry) => entry.capability === 'attendance_status'), true)
})

test('Session filtering distinguishes upcoming, completed, and history', () => {
  const rows = [
    normalizeCoachSession({ id: '1', session_date: '2026-08-10', status: 'open' }),
    normalizeCoachSession({ id: '2', session_date: '2026-08-08', status: 'open' }),
    normalizeCoachSession({ id: '3', session_date: '2026-08-07', status: 'completed' }),
  ]
  assert.equal(filterCoachSessions(rows, 'upcoming', new Date('2026-08-09T10:00:00Z')).length, 1)
  assert.equal(filterCoachSessions(rows, 'history', new Date('2026-08-09T10:00:00Z')).length, 2)
  assert.equal(filterCoachSessions(rows, 'completed').length, 1)
})

test('Session payload validates canonical training and match fields and fixes Team scope', () => {
  const training = buildCoachSessionPayload({ context: teamContext, form: { endTime: '19:30', location: 'Pitch', sessionDate: '2026-08-12', sessionType: 'training', startTime: '18:00', teamId: 'attacker', title: 'Training' } })
  assert.equal(training.team_id, 'team-test')
  assert.equal(training.arrival_time, null)
  const selectedUser = { ...teamContext, activeTeamId: teamContext.teamId, activeTeamName: teamContext.teamName, teamId: undefined, teamName: undefined }
  assert.equal(buildCoachSessionPayload({ context: selectedUser, form: { sessionDate: '2026-08-12', sessionType: 'training', startTime: '18:00' } }).team_id, 'team-test')
  assert.throws(() => buildCoachSessionPayload({ context: teamContext, form: { arrivalTime: '19:30', opponent: 'Visitors', sessionDate: '2026-08-12', sessionType: 'match', startTime: '19:00' } }), /before kick-off/)
})

test('Session policy requires online mutation and senior authority for completion', () => {
  const open = { status: 'open' }
  const coach = getCoachSessionMutationPolicy({ context: teamContext, session: open })
  const manager = getCoachSessionMutationPolicy({ context: { ...teamContext, roleRank: 70 }, session: open })
  assert.equal(coach.canEdit, true)
  assert.equal(coach.canComplete, false)
  assert.equal(manager.canComplete, true)
  assert.equal(manager.canDelete, false)
  assert.equal(manager.onlineRequired, true)
})

test('operational role matrix preserves five staff roles and fails closed for Parent, Player, and Platform Admin', () => {
  for (const [role, roleRank] of [['assistant_coach', 20], ['coach', 30], ['manager', 50], ['head_manager', 70], ['admin', 90]]) {
    const context = { ...teamContext, role, roleRank }
    assert.equal(getCoachPlayerMutationPolicy({ context }).canCreate, true, role)
    assert.equal(getCoachSessionMutationPolicy({ context, session: { status: 'open' } }).canEdit, true, role)
  }
  for (const role of ['parent_portal', 'adult_player']) {
    const context = { ...teamContext, role, roleRank: 0 }
    assert.equal(getCoachPlayerMutationPolicy({ context }).canCreate, false, role)
    assert.equal(getCoachSessionMutationPolicy({ context, session: { status: 'open' } }).canEdit, false, role)
  }
})

test('Phase 31C backend deltas classify reused contracts, unnecessary models, test omissions, and web-only governance', () => {
  assert.deepEqual([...new Set(COACH_OPERATIONAL_BACKEND_DELTAS.map((item) => item.category))].sort(), ['B', 'C', 'D', 'E'])
  assert.equal(COACH_OPERATIONAL_BACKEND_DELTAS.some((item) => item.capability === 'Separate Session attendance status' && item.category === 'C'), true)
  assert.equal(COACH_OPERATIONAL_BACKEND_DELTAS.filter((item) => item.category === 'E').every((item) => /Web-only/.test(item.decision)), true)
})

test('Coach encrypted offline document isolates resources by user and context', () => {
  const empty = createCoachOfflineDocument({ userScope: 'user-a' })
  const first = setCoachOfflineResources(empty, 'team:a', { players: [{ id: 'p1' }] }, '2026-08-09T10:00:00Z')
  const second = setCoachOfflineResources(first, 'team:b', { sessions: [{ id: 's1' }] }, '2026-08-09T11:00:00Z')
  assert.equal(getCoachOfflineResources(second, 'team:a').resources.players[0].id, 'p1')
  assert.equal(getCoachOfflineResources(second, 'team:b').resources.sessions[0].id, 's1')
  assert.equal(getCoachOfflineResources(second, 'team:c'), null)
  assert.equal(getCoachOfflineResources(second, 'team:a').stale, true)
})

test('Calendar adapter uses canonical scoped tables and RPC while external communications stay disabled', async () => {
  const [source, operations] = await Promise.all([
    readFile(new URL('../apps/mobile-core/src/coachCalendarData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachOperationalData.js', import.meta.url), 'utf8'),
  ])
  for (const marker of ["from('calendar_events')", "from('match_days')", "from('assessment_sessions')", "rpc('sync_calendar_event_parent_scope_v2'"]) assert.match(source, new RegExp(marker.replace(/[()']/g, '\\$&')))
  assert.match(operations, /rpc\('record_security_audit_event'/)
  assert.doesNotMatch(source, /notify_calendar_event_parents|sendParent|process.*deliver/i)
  assert.match(source, /externalDeliveryAllowed: false/)
  assert.match(source, /productionAccess: false/)
  assert.match(source, /schedulesAllowed: false/)
})

test('Players and Sessions adapters use authoritative Team-scoped read and write paths', async () => {
  const [players, sessions] = await Promise.all([
    readFile(new URL('../apps/mobile-core/src/coachPlayersData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachSessionsData.js', import.meta.url), 'utf8'),
  ])
  assert.match(players, /rpc\('get_team_players'/)
  assert.match(players, /from\('players'\)/)
  assert.match(players, /from\('evaluations'\)/)
  assert.match(players, /Archived Players are read-only/)
  assert.match(sessions, /from\('assessment_sessions'\)/)
  assert.match(sessions, /from\('assessment_session_players'\)/)
  assert.doesNotMatch(sessions, /attendance_status|present|absent|late/)
  assert.doesNotMatch(sessions, /\.delete\(/)
})

test('Coach operational screens expose real Calendar, Players, and Sessions routes with online-only writes', async () => {
  const [app, screens] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /activeRoute === 'calendar'.*CoachCalendarScreen/)
  assert.match(app, /activeRoute === 'players'.*CoachPlayersScreen/)
  assert.match(app, /activeRoute === 'sessions'.*CoachSessionsScreen/)
  assert.match(screens, /Showing encrypted data saved on this device/)
  assert.match(screens, /Changes require an online connection/)
  assert.match(screens, /External communications and schedules are disabled/)
  assert.match(screens, /Assessment sessions are Team-scoped/)
  assert.match(screens, /Open Assessment Sessions/)
  assert.match(screens, /Open Development/)
  assert.match(screens, /calendarMonth\.weeks\.map/)
  assert.match(screens, /Show all dates/)
})

test('Coach offline cache uses authenticated encryption, SecureStore key ownership, and app-role isolation', async () => {
  const source = await readFile(new URL('../apps/coach-mobile/src/offline.js', import.meta.url), 'utf8')
  assert.match(source, /xchacha20poly1305/)
  assert.match(source, /SecureStore\.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY/)
  assert.match(source, /appRole: 'coach'/)
  assert.match(source, /APPROVED_MOBILE_TEST/)
})

test('Phase 31C sources contain no production project reference and do not modify Parent feature sources', async () => {
  const sources = await Promise.all([
    '../apps/mobile-core/src/coachCalendarData.js',
    '../apps/mobile-core/src/coachPlayersData.js',
    '../apps/mobile-core/src/coachSessionsData.js',
    '../apps/coach-mobile/src/CoachOperationalScreens.js',
    '../apps/coach-mobile/src/offline.js',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
  for (const source of sources) assert.doesNotMatch(source, /hvapkizujvsahvgspser/)
  assert.equal(sources.join('\n').includes('parent-mobile/src'), false)
})
