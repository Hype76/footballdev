import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  assertCoachMutationOnline,
  boundCoachOfflineResource,
  COACH_ACCESSIBILITY_REQUIREMENTS,
  COACH_OFFLINE_MUTATION_POLICIES,
  COACH_OFFLINE_READ_POLICIES,
  COACH_PHASE_31F_MAX_CACHE_BYTES,
  COACH_SECURITY_HOSTILE_CASES,
  createCoachRuntimeGuard,
  evaluateCoachCachedScope,
  evaluateCoachSecurityBoundary,
  getCoachCacheByteLength,
  getCoachCacheFingerprint,
  getCoachOfflineMutationPolicy,
  getCoachOfflineReadPolicy,
  normalizeCoachCollection,
} from '../apps/mobile-core/src/coachPhase31FCore.js'
import {
  buildCoachNotificationPayload,
  COACH_NOTIFICATION_INTENTS,
  containsForbiddenCoachNotificationContent,
  getCoachInstallationOwnerKey,
  getCoachNotificationStatusLabel,
  getCoachNotificationStorageKeys,
  getCoachPushSetupFailureCode,
  isCoachInstallationId,
  normalizeCoachNotificationLevel,
  normalizeCoachNotificationState,
  resolveCoachNotificationOpen,
} from '../apps/mobile-core/src/coachNotificationsCore.js'
import {
  createCoachOfflineDocument,
  getCoachOfflineResources,
  setCoachOfflineResources,
} from '../apps/mobile-core/src/coachOfflineCore.js'
import {
  isCoachExpoPushToken,
  isCoachInstallationId as isTestCoachInstallationId,
  normalizeCoachDetailLevel,
  requireCoachFixture,
} from '../mobile-test-api/netlify/functions/_shared/coach-push.mjs'

const core = await readFile(new URL('../apps/mobile-core/src/coachPhase31FCore.js', import.meta.url), 'utf8')
const offlineCore = await readFile(new URL('../apps/mobile-core/src/offlineStorageCore.js', import.meta.url), 'utf8')
const coachOffline = await readFile(new URL('../apps/coach-mobile/src/offline.js', import.meta.url), 'utf8')
const notifications = await readFile(new URL('../apps/coach-mobile/src/notifications.js', import.meta.url), 'utf8')
const notificationCore = await readFile(new URL('../apps/mobile-core/src/coachNotificationsCore.js', import.meta.url), 'utf8')
const app = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
const matchDay = await readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
const phase31E = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
const endpoint = await readFile(new URL('../mobile-test-api/netlify/functions/coach-push-installation.mjs', import.meta.url), 'utf8')
const migration = await readFile(new URL('../mobile-test-api/migrations/20260809164500_coach_push_installations.sql', import.meta.url), 'utf8')

const contextA = {
  archivedAt: '', clubId: 'club-a', clubStatus: 'active', id: 'team:team-a', role: 'coach',
  teamId: 'team-a', teamStatus: 'active', paymentAccess: { canMutate: true },
}

test('offline read matrix covers every completed Coach domain with explicit sensitivity', () => {
  for (const key of ['home', 'calendar', 'players', 'playerDetail', 'sessions', 'matchDayList', 'matchDayDetail', 'development', 'resources', 'chat', 'messages', 'polls', 'invites', 'context', 'branding']) {
    const policy = getCoachOfflineReadPolicy(key)
    assert.equal(policy.cache, true, key)
    assert.notEqual(policy.sensitivity, 'unclassified', key)
    assert.match(policy.staleLabel, /Offline|Stale|Saved|authorised/i)
  }
  assert.equal(getCoachOfflineReadPolicy('unknown-private-record').cache, false)
  assert.equal(Object.isFrozen(COACH_OFFLINE_READ_POLICIES), true)
})

test('all high-risk writes remain online-only and durable Coach replay remains disabled', () => {
  for (const operation of ['matchday.goal', 'matchday.pause', 'calendar.cancel', 'players.identity_edit', 'sessions.complete', 'development.finalise', 'resources.share', 'chat.send', 'polls.close', 'invites.resend']) {
    const policy = getCoachOfflineMutationPolicy(operation)
    assert.equal(policy.offlineAllowed, false, operation)
    assert.equal(policy.replay, 'disabled', operation)
    assert.throws(() => assertCoachMutationOnline(operation, false), /online_connection_required/)
  }
  assert.equal(getCoachOfflineMutationPolicy('preferences.theme').offlineAllowed, true)
  assert.equal(getCoachOfflineMutationPolicy('preferences.biometric').replay, 'not-a-journal-command')
  assert.equal(Object.values(COACH_OFFLINE_MUTATION_POLICIES).some((policy) => policy.replay === 'durable'), false)
})

test('encrypted Coach cache isolates user, Club, Team, context, and schema metadata', () => {
  const first = createCoachOfflineDocument({ userScope: 'user-a' })
  const stored = setCoachOfflineResources(first, contextA, { players: [{ id: 'p1' }] }, '2026-08-09T16:00:00Z')
  const ready = getCoachOfflineResources(stored, contextA)
  assert.equal(ready.clubId, 'club-a')
  assert.equal(ready.teamId, 'team-a')
  assert.equal(ready.resources.players[0].id, 'p1')
  assert.equal(ready.resourceMetadata.players.sensitivity, 'child-data')
  assert.equal(getCoachOfflineResources(stored, { ...contextA, teamId: 'team-b' }), null)
  assert.deepEqual(evaluateCoachCachedScope({ context: contextA, entry: { clubId: 'club-a', contextId: contextA.id, teamId: 'team-a', userId: 'user-a' }, userId: 'user-a' }), { allowed: true, code: 'cache_scope_ready' })
  assert.equal(evaluateCoachCachedScope({ context: contextA, entry: { clubId: 'club-a', contextId: contextA.id, teamId: 'team-a', userId: 'user-b' }, userId: 'user-a' }).allowed, false)
})

test('cache writes are bounded and identical payloads do not rewrite the document', () => {
  const document = createCoachOfflineDocument({ userScope: 'user-a' })
  const large = Array.from({ length: 500 }, (_, index) => ({ id: index }))
  const bounded = boundCoachOfflineResource('chat', { messages: large })
  assert.equal(bounded.messages.length, 100)
  const first = setCoachOfflineResources(document, contextA, { chat: bounded }, '2026-08-09T16:01:00Z')
  const duplicate = setCoachOfflineResources(first, contextA, { chat: bounded }, '2026-08-09T16:02:00Z')
  assert.equal(duplicate, first)
  assert.equal(getCoachCacheByteLength(first) < COACH_PHASE_31F_MAX_CACHE_BYTES, true)
  assert.equal(getCoachCacheFingerprint(bounded), getCoachCacheFingerprint(structuredClone(bounded)))
})

test('oversized and corrupt cached data fail closed', () => {
  const document = createCoachOfflineDocument({ userScope: 'user-a' })
  assert.throws(() => setCoachOfflineResources(document, contextA, { chat: { body: 'x'.repeat(COACH_PHASE_31F_MAX_CACHE_BYTES + 1) } }), /offline_cache_payload_too_large/)
  assert.match(offlineCore, /xchacha20-poly1305/)
  assert.match(offlineCore, /scope_mismatch/)
  assert.match(offlineCore, /offline_storage_corrupt/)
  assert.match(coachOffline, /AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY/)
  assert.match(coachOffline, /JSON\.stringify\(next\.contexts\) === JSON\.stringify\(current\.contexts\)/)
})

test('notification installation identity is random, Coach-scoped, environment-scoped, and token-private', () => {
  const id = 'ad3d70b6-d2bc-40e4-91b0-959964e61780'
  assert.equal(isCoachInstallationId(id), true)
  assert.equal(isCoachInstallationId('android-id'), false)
  assert.equal(isTestCoachInstallationId(id), true)
  assert.match(notifications, /Crypto\.randomUUID\(\)/)
  assert.match(getCoachNotificationStorageKeys('test').installationId, /coach.*test/)
  assert.notEqual(getCoachNotificationStorageKeys('test').installationId, getCoachNotificationStorageKeys('production').installationId)
  assert.match(getCoachInstallationOwnerKey({ installationId: id, userId: 'user-a' }), /^coach:test:user-a:/)
  assert.doesNotMatch(notifications, /AsyncStorage\.(setItem|getItem)\([^\n]*(token|push)/i)
  assert.doesNotMatch(notifications, /deviceName|androidId|serial|imei|udid|advertisingId/i)
})

test('Coach notification levels default to Minimal and permission denial leaves startup usable', () => {
  assert.equal(normalizeCoachNotificationLevel(), 'minimal')
  assert.equal(normalizeCoachNotificationLevel('detailed'), 'detailed')
  assert.equal(normalizeCoachNotificationLevel('off'), 'off')
  assert.equal(normalizeCoachDetailLevel('unexpected'), 'minimal')
  assert.equal(getCoachNotificationStatusLabel({ permissionStatus: 'denied' }), 'Blocked in device settings')
  assert.equal(getCoachNotificationStatusLabel({ detailLevel: 'minimal', enabled: true, permissionGranted: true, registered: true }), 'On, Minimal')
  assert.match(notifications, /app remains fully usable/)
  const initialize = notifications.slice(notifications.indexOf('export async function initializeCoachNotifications'), notifications.indexOf('export function addCoachPushTokenListener'))
  assert.doesNotMatch(initialize, /requestPermissionsAsync/)
})

test('notification errors classify denial, token, network, auth, forbidden, and service failures', () => {
  assert.equal(getCoachPushSetupFailureCode({ message: 'permission denied' }, 'permission'), 'COACH_PUSH_PERMISSION_PERMISSION_UNAVAILABLE')
  assert.equal(getCoachPushSetupFailureCode({ message: 'network timeout' }, 'expo'), 'COACH_PUSH_EXPO_NETWORK')
  assert.equal(getCoachPushSetupFailureCode({ status: 401 }, 'api'), 'COACH_PUSH_API_SIGNED_OUT')
  assert.equal(getCoachPushSetupFailureCode({ status: 403 }, 'api'), 'COACH_PUSH_API_FORBIDDEN')
  assert.equal(getCoachPushSetupFailureCode({ status: 500 }, 'api'), 'COACH_PUSH_API_SERVICE')
  assert.equal(getCoachPushSetupFailureCode({ message: 'FirebaseApp failed' }, 'device'), 'COACH_PUSH_DEVICE_FIREBASE_CONFIGURATION')
})

test('notification categories are actual Coach product events with privacy-safe payloads', () => {
  const playerNames = ['Synthetic Player']
  assert.equal(Object.keys(COACH_NOTIFICATION_INTENTS).length, 14)
  for (const intent of Object.keys(COACH_NOTIFICATION_INTENTS)) {
    for (const level of ['minimal', 'detailed']) {
      const payload = buildCoachNotificationPayload(intent, level)
      assert.equal(payload.data.app, 'coach')
      assert.deepEqual(Object.keys(payload.data).sort(), ['app', 'intentType', 'route'])
      assert.equal(containsForbiddenCoachNotificationContent(`${payload.title} ${payload.body}`, playerNames), false)
    }
  }
  assert.equal(containsForbiddenCoachNotificationContent('Synthetic Player has a Development note', playerNames), true)
  assert.throws(() => buildCoachNotificationPayload('marketing'), /unsupported/)
})

test('deep links restore only current active staff authority and exact available targets', () => {
  const authority = { activeContextId: contextA.id, availableTargets: { matchday: ['match-1'] }, contexts: [contextA] }
  assert.deepEqual(resolveCoachNotificationOpen({ app: 'coach', contextId: contextA.id, route: 'matchday', targetId: 'match-1' }, authority), {
    allowed: true, code: 'notification_route_ready', contextId: contextA.id, route: 'matchday', targetId: 'match-1',
  })
  assert.equal(resolveCoachNotificationOpen({ app: 'coach', contextId: contextA.id, route: 'matchday', targetId: 'deleted' }, authority).code, 'notification_target_stale')
  assert.equal(resolveCoachNotificationOpen({ app: 'parent', route: 'matchday' }, authority).code, 'notification_app_mismatch')
  assert.equal(resolveCoachNotificationOpen({ app: 'coach', contextId: 'team:other', route: 'matchday' }, authority).code, 'notification_context_denied')
  assert.equal(resolveCoachNotificationOpen({ app: 'coach', contextId: contextA.id, route: 'matchday' }, { ...authority, contexts: [{ ...contextA, archivedAt: '2026-01-01' }] }).code, 'notification_context_inactive')
  assert.match(app, /resolveCoachNotificationOpen/)
  assert.match(app, /setSelectedContextId\(targetContext\.id\)/)
})

test('Coach installation registration is test-only, authenticated, context-authorised, and has duplicate-token protection', () => {
  assert.equal(isCoachExpoPushToken('ExponentPushToken[synthetic_token]'), true)
  assert.equal(isCoachExpoPushToken('invalid'), false)
  assert.equal(requireCoachFixture({ profile: { role: 'coach' } }).profile.role, 'coach')
  assert.throws(() => requireCoachFixture({ profile: { role: 'parent_portal' } }), /coach_authority_required/)
  assert.match(endpoint, /requireAuthenticatedFixture/)
  assert.match(endpoint, /requireCoachFixture/)
  assert.match(endpoint, /register_mobile_test_coach_push_installation/)
  assert.match(migration, /mobile_test_coach_context_allowed/)
  assert.match(migration, /team_staff/)
  assert.match(migration, /where expo_push_token = p_expo_push_token[\s\S]*installation_id <> p_installation_id/i)
  assert.match(migration, /force row level security/i)
  assert.match(migration, /revoke all on public\.mobile_test_coach_push_installations from public, anon, authenticated/i)
  assert.doesNotMatch(`${endpoint}\n${migration}`, /hvapkizujvsahvgspser|llpufwzvgxyczxcjwupu/)
})

test('Coach notification lifecycle covers token rotation, context refresh, preferences, and logout unbind', () => {
  assert.match(notifications, /Notifications\.addPushTokenListener/)
  assert.match(notifications, /getDevicePushTokenAsync/)
  assert.match(notifications, /getExpoPushTokenAsync/)
  assert.match(notifications, /requiresContextRefresh/)
  assert.match(notifications, /method: 'PATCH'/)
  assert.match(notifications, /method: 'DELETE'/)
  assert.match(notifications, /unregisterForNotificationsAsync/)
  assert.match(app, /addCoachPushTokenListener/)
  assert.match(app, /unbindCoachNotifications/)
  assert.match(app, /Minimal privacy/)
})

test('hostile security matrix fails closed for session, role, environment, archive, and payment transitions', () => {
  assert.equal(COACH_SECURITY_HOSTILE_CASES.length >= 16, true)
  assert.equal(evaluateCoachSecurityBoundary({ context: contextA, profile: { id: 'user-a' } }).allowed, true)
  assert.equal(evaluateCoachSecurityBoundary({ context: contextA, environment: 'production', profile: { id: 'user-a' } }).code, 'wrong_environment')
  assert.equal(evaluateCoachSecurityBoundary({ context: contextA, profile: null }).code, 'no_session')
  assert.equal(evaluateCoachSecurityBoundary({ context: { ...contextA, role: 'parent_portal' }, profile: { id: 'user-a' } }).code, 'forged_role')
  assert.equal(evaluateCoachSecurityBoundary({ context: { ...contextA, archivedAt: '2026-01-01' }, profile: { id: 'user-a' } }).code, 'archived_context')
  assert.equal(evaluateCoachSecurityBoundary({ context: { ...contextA, paymentAccess: { canMutate: false } }, profile: { id: 'user-a' } }).code, 'payment_required')
})

test('accessibility contract and source cover labels, stale state, touch size, text wrapping, and bounded Match timeline', () => {
  assert.equal(COACH_ACCESSIBILITY_REQUIREMENTS.touchTarget, 48)
  assert.match(COACH_ACCESSIBILITY_REQUIREMENTS.colour, /never colour alone/)
  assert.match(app, /accessibilityLabel=.*tab/)
  assert.match(app, /Offline, stale data/)
  assert.match(app, /minHeight: 48/)
  assert.match(phase31E, /accessibilityState=\{\{ disabled \}\}/)
  assert.match(matchDay, /slice\(-200\)/)
  assert.match(matchDay, /clearInterval/)
})

test('performance guard prevents duplicate listeners, request storms, and identical cache writes', () => {
  let time = 1000
  const guard = createCoachRuntimeGuard({ now: () => time })
  assert.equal(guard.beginListener('chat:team-a'), true)
  assert.equal(guard.beginListener('chat:team-a'), false)
  assert.equal(guard.getActiveListenerCount(), 1)
  assert.equal(guard.endListener('chat:team-a'), true)
  assert.equal(guard.getActiveListenerCount(), 0)
  assert.equal(guard.shouldRequest('calendar:team-a', 500), true)
  assert.equal(guard.shouldRequest('calendar:team-a', 500), false)
  time += 500
  assert.equal(guard.shouldRequest('calendar:team-a', 500), true)
  assert.equal(guard.shouldWriteCache('home:team-a', 'fp-1'), true)
  assert.equal(guard.shouldWriteCache('home:team-a', 'fp-1'), false)
})

test('production-shape helpers tolerate null, empty, and malformed optional collections', () => {
  assert.deepEqual(normalizeCoachCollection(null), [])
  assert.deepEqual(normalizeCoachCollection({}), [])
  assert.deepEqual(normalizeCoachCollection([null, { id: 'a' }, 'bad']), [{ id: 'a' }])
  assert.deepEqual(normalizeCoachNotificationState(null), {
    canAskAgain: true, detailLevel: 'minimal', enabled: false, message: '', permissionGranted: false,
    permissionStatus: 'undetermined', registered: false, requiresContextRefresh: false,
  })
})

test('Phase 31F source keeps production, communication, EAS, and Parent feature boundaries closed', () => {
  const combined = `${core}\n${notificationCore}\n${notifications}\n${endpoint}`
  assert.doesNotMatch(combined, /eas build|eas submit|sendEmail|sendSms|exp\.host\/--\/api\/v2\/push\/send/i)
  assert.match(notifications, /TEST_API_ORIGIN/)
  assert.match(notifications, /coach_notification_test_environment_required/)
  assert.doesNotMatch(combined, /hvapkizujvsahvgspser|productionAccess\s*:\s*true/)
})
