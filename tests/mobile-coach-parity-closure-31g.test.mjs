import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveCoachStaffContext } from '../apps/mobile-core/src/coachContextCore.js'
import {
  buildCoachHomeOperationalSnapshot,
  countPendingCoachAvailability,
  COACH_PHASE_31G_BACKEND_INVENTORY,
  COACH_PHASE_31G_CROSS_DOMAIN_TRANSITIONS,
  COACH_PHASE_31G_HOSTILE_JOURNEYS,
} from '../apps/mobile-core/src/coachPhase31GCore.js'
import {
  COACH_PHASE_31G_EXCLUSIONS,
  COACH_PHASE_31G_PARITY_MATRIX,
  COACH_PHASE_31G_UNRESOLVED_ROWS,
} from '../apps/coach-mobile/src/coachPhase31GParity.js'
import { getCoachNavigationModel, resolveCoachRoute } from '../apps/coach-mobile/src/coachNavigationCore.js'

const app = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
const operationalScreens = await readFile(new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url), 'utf8')
const matchDayScreen = await readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
const phase31EScreens = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
const homeData = await readFile(new URL('../apps/mobile-core/src/coachPhase31GData.js', import.meta.url), 'utf8')
const navigation = await readFile(new URL('../apps/coach-mobile/src/coachNavigationCore.js', import.meta.url), 'utf8')
const config = await readFile(new URL('../apps/coach-mobile/app.config.js', import.meta.url), 'utf8')
const sharedConfig = await readFile(new URL('../apps/mobile-core/appConfig.cjs', import.meta.url), 'utf8')
const coachPackage = JSON.parse(await readFile(new URL('../apps/coach-mobile/package.json', import.meta.url), 'utf8'))

const teamContext = Object.freeze({
  archivedAt: '', clubId: 'club-1', clubStatus: 'active', hasActivePlanAccess: true, id: 'team:team-1',
  paymentAccess: { canMutate: true, canRead: true, payerAuthority: 'none', state: 'active' },
  role: 'coach', roleLabel: 'Coach', roleRank: 30, teamId: 'team-1', teamStatus: 'active', type: 'team', workspaceScope: 'team',
})

test('final parity matrix resolves all 47 original Phase 31A rows with complete evidence columns', () => {
  assert.equal(COACH_PHASE_31G_PARITY_MATRIX.length, 47)
  assert.deepEqual(COACH_PHASE_31G_UNRESOLVED_ROWS, [])
  for (const [index, row] of COACH_PHASE_31G_PARITY_MATRIX.entries()) {
    assert.equal(row.row, index + 1)
    for (const field of ['capability', 'webProduct', 'mobileDestination', 'readParity', 'writeParity', 'authorityPath', 'offlineClassification', 'notificationDeepLinkClassification', 'billingBehaviour', 'archiveInactiveBehaviour', 'finalStatus']) {
      assert.equal(typeof row[field], 'string', `${index + 1}:${field}`)
      assert.notEqual(row[field].trim(), '', `${index + 1}:${field}`)
    }
    assert.equal(Array.isArray(row.roles), true)
    assert.equal(['MISSING', 'DEFECT'].includes(row.finalStatus), false)
  }
})

test('every non-complete parity row has a concrete bounded reason', () => {
  assert.equal(COACH_PHASE_31G_EXCLUSIONS.length > 0, true)
  for (const row of COACH_PHASE_31G_EXCLUSIONS) {
    assert.equal(row.exclusionReason.length > 45, true, `${row.row}:${row.capability}`)
    assert.doesNotMatch(row.exclusionReason, /too hard|not implemented|later phase/i)
  }
})

test('known destructive, dense, financial, and platform exclusions remain deliberately web-only', () => {
  const byRow = new Map(COACH_PHASE_31G_PARITY_MATRIX.map((row) => [row.row, row]))
  for (const rowNumber of [10, 15, 42, 43, 44, 45, 46, 47]) {
    assert.equal(byRow.get(rowNumber).finalStatus, 'INTENTIONAL_WEB_ONLY')
  }
  assert.equal(byRow.get(23).finalStatus, 'PRODUCT_BACKEND_DECISION_REQUIRED')
  assert.equal(byRow.get(24).finalStatus, 'INTENTIONAL_TEST_EXCLUSION')
})

test('Home operational snapshot uses canonical domain results without inventing a task model', () => {
  const snapshot = buildCoachHomeOperationalSnapshot({
    now: '2026-08-24T07:55:00Z',
    calendar: [
      { id: 'past-histon', eventType: 'match', startsAt: '2026-08-20T23:59:00Z', status: 'scheduled', title: 'U14s EJA v Histon' },
      { id: 'c1', eventType: 'training', startsAt: '2026-08-24T19:00:00Z', status: 'scheduled', title: 'Monday Training' },
      { id: 'cancelled-training', eventType: 'training', startsAt: '2026-08-24T18:00:00Z', status: 'cancelled', title: 'Cancelled Training' },
    ],
    chatRooms: [{ id: 'r1', unreadCount: 2 }],
    development: { records: [{ id: 'd1' }, { id: 'd2' }] },
    invites: { all: [
      { eventId: 'm1', id: 'i1', kind: 'match', playerId: 'p1', sentAt: '2026-08-23T09:00:00Z', status: 'pending' },
      { eventId: 'm1', id: 'i2', kind: 'match', playerId: 'p2', sentAt: '2026-08-23T09:00:00Z', status: 'available' },
    ] },
    matches: [{ id: 'm1', kickoffTime: '10:00:00', matchDate: '2026-08-30', status: 'scheduled' }],
    messages: [{ id: 'x1', readAt: '' }, { id: 'x2', readAt: 'now' }],
    polls: [{ id: 'p1', status: 'open' }, { id: 'p2', status: 'closed' }],
    sessions: [{ id: 's1', sessionDate: '2026-08-25', startTime: '18:00:00', status: 'scheduled' }],
    summary: { activePlayers: 12 },
  })
  assert.equal(snapshot.pendingAvailability, 1)
  assert.equal(snapshot.activePolls, 1)
  assert.equal(snapshot.unreadChat, 2)
  assert.equal(snapshot.unreadCommunication, 0)
  assert.equal(snapshot.developmentRecords, 2)
  assert.equal(snapshot.nextMatch.id, 'm1')
  assert.equal(snapshot.nextSession.id, 'c1')
  assert.equal(snapshot.nextCalendar.id, 'c1')
  assert.notEqual(snapshot.nextCalendar.id, 'past-histon')
  assert.equal('tasks' in snapshot, false)
})

test('Home pending availability counts sent invitations per child instead of recipient email', () => {
  const rows = [
    { eventId: 'match-1', id: 'p1-email-1', kind: 'match', playerId: 'player-1', sentAt: '2026-08-23T09:00:00Z', status: 'pending' },
    { eventId: 'match-1', id: 'p1-email-2', kind: 'match', playerId: 'player-1', sentAt: '2026-08-23T09:01:00Z', status: 'pending' },
    { eventId: 'match-1', id: 'p2-unsent', kind: 'match', playerId: 'player-2', sentAt: '', status: 'pending' },
    { eventId: 'match-1', id: 'p3-email-1', kind: 'match', playerId: 'player-3', sentAt: '2026-08-23T09:02:00Z', status: 'pending' },
    { eventId: 'match-1', id: 'p3-response', kind: 'match', playerId: 'player-3', respondedAt: '2026-08-23T09:03:00Z', sentAt: '', status: 'available' },
    { eventId: 'training-1', id: 'p4-training', kind: 'training', playerId: 'player-4', sentAt: '2026-08-23T09:04:00Z', status: 'pending' },
    { eventId: 'calendar-1', id: 'p5-information', kind: 'calendar', playerId: 'player-5', sentAt: '2026-08-23T09:05:00Z', status: 'pending' },
  ]

  assert.equal(countPendingCoachAvailability(rows), 2)
})

test('Home tolerates partial response shapes and exposes the degraded state', () => {
  const snapshot = buildCoachHomeOperationalSnapshot({ errors: ['polls:timeout'], matches: null, sessions: {}, summary: null })
  assert.equal(snapshot.partial, true)
  assert.deepEqual(snapshot.matches, [])
  assert.deepEqual(snapshot.sessions, [])
  assert.deepEqual(snapshot.summary, {})
  assert.deepEqual(snapshot.errors, ['polls:timeout'])
})

test('Home data composes current authoritative adapters with partial failure containment', () => {
  for (const symbol of ['getCoachHomeSummary', 'getCoachMatchDays', 'getCoachSessions', 'getCoachCalendarResources', 'getCoachDevelopmentWorkspace', 'getCoachChatRooms', 'getCoachPolls', 'getCoachInvitesAndAvailability']) {
    assert.match(homeData, new RegExp(symbol))
  }
  assert.doesNotMatch(homeData, /getCoachMessages/)
  assert.match(homeData, /Promise\.allSettled/)
  assert.match(homeData, /buildCoachHomeOperationalSnapshot/)
  assert.match(app, /Operational attention/)
  assert.match(app, /Unread totals come from the current Chat room read state/)
  assert.doesNotMatch(app, /unread communication updates|Open Messages/)
})

test('Settings exposes identity, role, context, branding, security, notification, cache, environment, build, and logout state', () => {
  for (const label of ['Name', 'Email', 'Role', 'Context', 'Branding', 'Accent source', 'Biometric lock', 'Status', 'Encrypted cache', 'Cache ownership', 'Environment', 'Production access', 'Version', 'Build']) {
    assert.match(app, new RegExp(`label="${label}"`))
  }
  assert.match(app, /Minimal privacy/)
  assert.match(app, /Log out/)
  assert.doesNotMatch(app, /installation identifier|ExpoPushToken|access token|refresh token/i)
})

test('native navigation reaches every complete mobile destination and contains no active placeholder route', () => {
  const model = getCoachNavigationModel(teamContext)
  const routes = [...model.primary, ...model.more].map((row) => row.key)
  for (const route of ['home', 'calendar', 'players', 'matchday', 'sessions', 'development', 'resources', 'chat', 'polls', 'invites', 'settings']) {
    assert.equal(routes.includes(route), true, route)
    assert.equal(resolveCoachRoute(route, teamContext), route)
  }
  assert.equal(routes.includes('messages'), false)
  assert.equal(resolveCoachRoute('messages', teamContext), 'chat')
  assert.doesNotMatch(app, /Full feature parity is completed in the next domain phase|ready for its authoritative data adapter/)
  assert.match(app, /No hidden route is available/)
  assert.match(navigation, /getCoachBackTarget/)
})

test('cross-domain operational transitions are visible and authority-scoped', () => {
  assert.equal(COACH_PHASE_31G_CROSS_DOMAIN_TRANSITIONS.length, 13)
  assert.match(operationalScreens, /Open Match Day/)
  assert.match(operationalScreens, /Open Session/)
  assert.match(operationalScreens, /Open Development/)
  assert.match(operationalScreens, /Open Resources/)
  assert.match(operationalScreens, /Open Players/)
  assert.match(matchDayScreen, /Availability/)
  assert.match(matchDayScreen, /Team Chat/)
  assert.match(matchDayScreen, /label="Calendar"/)
  assert.match(phase31EScreens, /Open Calendar/)
  assert.match(app, /resolveCoachNotificationOpen/)
})

test('context switching preserves an authorised destination and clears previous domain state', () => {
  const selectStart = app.indexOf('const selectContext = useCallback')
  const selectSource = app.slice(selectStart, app.indexOf('const toggleTheme', selectStart))
  assert.match(selectSource, /currentDestination = moreRoute \|\| activeRoute/)
  assert.match(selectSource, /resolveCoachRoute\(currentDestination, nextContext\)/)
  assert.match(selectSource, /resetContextDomainState\(\)/)
  assert.match(selectSource, /setSelectedContextId\(nextContext\.id\)/)
})

test('the full eight-role boundary allows operational staff and denies hostile portal identities', () => {
  const staffRoles = [
    ['assistant_coach', 20], ['coach', 30], ['manager', 50], ['head_manager', 70], ['admin', 90],
  ]
  for (const [role, rank] of staffRoles) {
    const result = resolveCoachStaffContext({ profile: { accountStatus: 'active', coachContexts: [{ ...teamContext, role, roleRank: rank }], id: `user-${role}`, role } })
    assert.equal(result.allowed, true, role)
  }
  for (const role of ['parent_portal', 'adult_player', 'super_admin']) {
    const result = resolveCoachStaffContext({ profile: { accountStatus: 'active', coachContexts: [], id: `user-${role}`, role } })
    assert.equal(result.allowed, false, role)
  }
  const dual = resolveCoachStaffContext({ profile: { accountStatus: 'active', coachContexts: [teamContext], id: 'dual', role: 'parent_portal' } })
  assert.equal(dual.allowed, true)
  assert.equal(dual.context.role, 'coach')
})

test('multi-context journeys retain Team and Club isolation across all operational domains', () => {
  const required = ['calendar', 'players', 'sessions', 'matchday', 'development', 'resources', 'chat', 'polls']
  for (const route of required) assert.match(app + operationalScreens + phase31EScreens + matchDayScreen, new RegExp(route, 'i'))
  assert.match(app, /createCoachContextTransition/)
  assert.match(app, /requestIdRef\.current \+= 1/)
  assert.match(app, /key=\{`\$\{props\.context\.id\}:\$\{moreRoute\}`\}/)
})

test('payment_required is application-wide and ordinary Coaches never receive plan purchase control', () => {
  assert.match(app, /activeContext\.paymentAccess\.state === 'payment_required'/)
  assert.match(app, /Viewing remains available, but operational changes are blocked/)
  assert.match(app, /Payer authority/)
  assert.match(app, /Ordinary Coaches cannot gain plan purchase control/)
  assert.match(navigation, /route\.payerOnly/)
  assert.match(navigation, /\['club', 'team'\]\.includes\(payerAuthority\)/)
})

test('archive and membership-loss journeys fail closed without retaining unsafe actions', () => {
  assert.equal(COACH_PHASE_31G_HOSTILE_JOURNEYS.includes('team_archived'), true)
  assert.equal(COACH_PHASE_31G_HOSTILE_JOURNEYS.includes('staff_removed'), true)
  assert.match(app, /That Coach context is no longer available/)
  assert.match(app, /active operational Coach context is required/)
  assert.match(app, /This Coach destination is stale or no longer authorised/)
})

test('offline end-to-end journey uses encrypted reads, obvious stale state, online writes, and clean refresh', () => {
  assert.match(app, /Offline, stale data/)
  assert.match(app, /Refresh when online/)
  assert.match(operationalScreens, /Showing saved information\. Connect before making changes/)
  assert.match(matchDayScreen, /Every change is disabled until a successful refresh/)
  assert.match(phase31EScreens, /Offline and read-only/)
  assert.doesNotMatch(phase31EScreens, /Unsafe offline replay is disabled/)
})

test('notification fixtures cover cold, warm, signed-out, wrong-Team, removed, archived, stale, and context-switch paths without delivery', () => {
  for (const journey of ['notification_cold_start', 'notification_warm_app', 'notification_signed_out', 'notification_wrong_team', 'notification_removed_staff', 'notification_archived_target', 'notification_stale_match']) {
    assert.equal(COACH_PHASE_31G_HOSTILE_JOURNEYS.includes(journey), true, journey)
  }
  assert.match(app, /useLastNotificationResponse/)
  assert.match(app, /resolveCoachNotificationOpen/)
})

test('production-promotion inventory classifies all dependencies A through D without promotion', () => {
  const classes = new Set(COACH_PHASE_31G_BACKEND_INVENTORY.map((row) => row.classification))
  assert.deepEqual([...classes].sort(), ['A', 'B', 'C', 'D'])
  assert.equal(COACH_PHASE_31G_BACKEND_INVENTORY.every((row) => row.dependency && row.disposition && row.scope), true)
  assert.equal(COACH_PHASE_31G_BACKEND_INVENTORY.some((row) => row.dependency === 'Coach v3 installation contract' && row.classification === 'C'), true)
})

test('theme and branding remain semantic in active Coach screens', () => {
  const active = `${app}\n${operationalScreens}\n${matchDayScreen}\n${phase31EScreens}`
  assert.doesNotMatch(active, /#[0-9a-f]{3,8}/i)
  assert.match(app, /createCoachTheme/)
  assert.match(app, /Team accent/)
  assert.match(app, /Club accent/)
})

test('accessibility and performance final source guards remain present', () => {
  const active = `${app}\n${operationalScreens}\n${matchDayScreen}\n${phase31EScreens}`
  assert.match(active, /accessibilityLabel/)
  assert.match(active, /accessibilityLiveRegion/)
  assert.match(active, /minHeight: 48/)
  assert.match(matchDayScreen, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/)
  assert.match(matchDayScreen, /clearInterval/)
  assert.match(matchDayScreen, /slice\(-200\)/)
  assert.match(app, /subscription\.remove\(\)/)
})

test('Coach Expo configuration remains aligned without dependency churn', () => {
  assert.equal(coachPackage.dependencies.expo, '~54.0.37')
  assert.equal(coachPackage.dependencies['react-native'], '0.81.5')
  assert.match(config, /footballplayercoach/)
  assert.match(config, /com\.footballplayer\.coach/)
  assert.match(sharedConfig, /expo-notifications/)
  assert.match(sharedConfig, /expo-secure-store/)
  assert.match(sharedConfig, /expo-local-authentication/)
})

test('final active source contains no pilot shortcuts, hidden test routes, production refs, or release actions', () => {
  const active = `${app}\n${operationalScreens}\n${matchDayScreen}\n${phase31EScreens}\n${homeData}`
  assert.doesNotMatch(active, /updateCoachMatchStatus|addCoachMatchGoal|submitCoachAssessment/)
  assert.doesNotMatch(active, /TODO|FIXME|debug-only|productionAccess\s*:\s*true|hvapkizujvsahvgspser|llpufwzvgxyczxcjwupu/i)
  assert.doesNotMatch(active, /eas build|eas submit|sendEmail|sendSms/i)
})
