import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  applyCoachContext,
  createCoachContextMarker,
  createCoachContextTransition,
  getCoachPaymentAccess,
  parseCoachContextMarker,
  resolveCoachStaffContext,
} from '../apps/mobile-core/src/coachContextCore.js'
import {
  getCoachBackTarget,
  getCoachNavigationModel,
  resolveCoachRoute,
} from '../apps/coach-mobile/src/coachNavigationCore.js'
import {
  createCoachTheme,
  getCoachContrastRatio,
  normalizeCoachLogoUrl,
  resolveCoachBranding,
} from '../apps/coach-mobile/src/coachThemeCore.js'
import {
  getCoachLocalStateKeys,
  getParentLocalStateKeys,
} from '../apps/coach-mobile/src/coachLocalStateCore.js'
import {
  MOBILE_STARTUP_STATES,
  runMobileStartup,
} from '../apps/mobile-core/src/startupStateCore.js'

const teamA = Object.freeze({
  authorityId: 'assignment-a', authoritySource: 'team_staff', clubAccent: 'blue', clubButtonStyle: 'solid',
  clubId: 'club-a', clubLogoUrl: 'https://cdn.example.com/club-a.png', clubName: 'Club A', clubStatus: 'active',
  hasActivePlanAccess: true, id: 'team:team-a', planKey: 'single_team', planStatus: 'active', role: 'coach',
  roleLabel: 'Coach', roleRank: 30, teamAccent: 'red', teamId: 'team-a', teamName: 'Team A', teamStatus: 'active', workspaceScope: 'team',
})

const teamB = Object.freeze({ ...teamA, authorityId: 'assignment-b', id: 'team:team-b', teamId: 'team-b', teamName: 'Team B' })
const clubContext = Object.freeze({ ...teamA, authorityId: 'membership-a', authoritySource: 'user_club_memberships', id: 'club:club-a', role: 'admin', roleLabel: 'Club Admin', roleRank: 90, teamId: '', teamName: '', workspaceScope: 'club' })

test('canonical Coach context accepts active operational membership and applies exact context', () => {
  const profile = { accountStatus: 'active', activeCoachContextId: teamA.id, coachContexts: [teamA, teamB], id: 'user-a', role: 'coach' }
  const resolved = resolveCoachStaffContext({ profile, requestedContextId: teamB.id })
  assert.equal(resolved.allowed, true)
  assert.equal(resolved.context.id, teamB.id)
  const applied = applyCoachContext(profile, resolved.context)
  assert.equal(applied.activeTeamId, 'team-b')
  assert.equal(applied.role, 'coach')
})

test('single-Team staff default to their operational Team instead of an empty Club context', () => {
  const profile = { accountStatus: 'active', coachContexts: [clubContext, teamA], id: 'user-a', role: 'admin' }
  const resolved = resolveCoachStaffContext({ profile })
  assert.equal(resolved.context.id, teamA.id)
})

test('context switch invalidates domain and mutation scope without carrying Team A state', () => {
  assert.deepEqual(createCoachContextTransition(teamA, teamB), {
    clearDomainState: true,
    nextContextId: 'team:team-b',
    previousContextId: 'team:team-a',
    resetMutationScope: true,
  })
})

test('stale, archived, removed, and tampered contexts fail closed', () => {
  const archived = { ...teamA, archivedAt: '2026-08-09T00:00:00Z' }
  const profile = { accountStatus: 'active', coachContexts: [archived], id: 'user-a', role: 'coach' }
  assert.equal(resolveCoachStaffContext({ profile }).code, 'active_staff_membership_required')
  const live = resolveCoachStaffContext({ profile: { ...profile, coachContexts: [teamA] }, requestedContextId: 'team:attacker' })
  assert.equal(live.context.id, teamA.id)
  assert.throws(() => applyCoachContext(profile, { ...teamA, teamStatus: 'archived' }), /coach_context_not_authorised/)
})

test('Parent-only, Player-only, suspended, and Platform Admin without membership are denied', () => {
  for (const role of ['parent_portal', 'adult_player', 'super_admin']) {
    const result = resolveCoachStaffContext({ profile: { accountStatus: 'active', coachContexts: [], id: `user-${role}`, role } })
    assert.equal(result.allowed, false)
  }
  assert.equal(resolveCoachStaffContext({ profile: { accountStatus: 'suspended', coachContexts: [teamA], id: 'user-x', role: 'coach' } }).code, 'staff_account_inactive')
})

test('dual-role Parent plus staff remains in authorised Coach staff context', () => {
  const result = resolveCoachStaffContext({ profile: { accountStatus: 'active', coachContexts: [teamA], hasParentAccess: true, id: 'dual', role: 'coach' } })
  assert.equal(result.allowed, true)
  assert.equal(result.context.role, 'coach')
})

test('context markers store identifiers only and reject corrupt state', () => {
  const marker = createCoachContextMarker(teamA)
  assert.deepEqual(parseCoachContextMarker(JSON.stringify(marker)), marker)
  assert.equal(parseCoachContextMarker('{bad'), null)
  assert.equal(JSON.stringify(marker).includes('Team A'), false)
})

test('role-aware navigation exposes no dead Team routes or Platform Admin governance', () => {
  const coachNavigation = getCoachNavigationModel(teamA)
  assert.deepEqual(coachNavigation.primary.map((route) => route.key), ['home', 'calendar', 'players', 'matchday', 'more'])
  assert.equal(coachNavigation.more.some((route) => route.key === 'club'), false)
  assert.equal(coachNavigation.more.some((route) => route.key === 'payment'), false)
  const adminNavigation = getCoachNavigationModel(clubContext)
  assert.equal(adminNavigation.primary.some((route) => route.key === 'matchday'), false)
  assert.equal(adminNavigation.more.some((route) => route.key === 'club'), true)
  assert.equal(adminNavigation.more.some((route) => route.key === 'payment'), true)
  assert.equal(adminNavigation.more.some((route) => route.key === 'platform'), false)
})

test('deep-link and native back models resolve only authorised routes', () => {
  assert.equal(resolveCoachRoute('match-day', teamA), 'matchday')
  assert.equal(resolveCoachRoute('club', teamA), '')
  assert.deepEqual(getCoachBackTarget({ activeRoute: 'more', moreRoute: 'resources' }), { activeRoute: 'more', moreRoute: '' })
  assert.deepEqual(getCoachBackTarget({ activeRoute: 'calendar' }), { activeRoute: 'home', moreRoute: '' })
  assert.equal(getCoachBackTarget({ activeRoute: 'home' }), null)
})

test('payment foundation is read-only when payment is required and limits payer authority', () => {
  assert.deepEqual(getCoachPaymentAccess({ ...teamA, hasActivePlanAccess: false }), {
    canMutate: false, canRead: true, payerAuthority: 'none', state: 'payment_required',
  })
  assert.equal(getCoachPaymentAccess(clubContext).payerAuthority, 'club')
  assert.equal(getCoachPaymentAccess({ ...teamA, role: 'head_manager', roleRank: 70 }).payerAuthority, 'team')
})

test('Coach semantic theme supports light, dark, Club-first branding, Team fallback, and safe logo URLs', () => {
  const dark = createCoachTheme({ context: teamA, mode: 'dark' })
  const light = createCoachTheme({ context: teamA, mode: 'light' })
  for (const key of ['background', 'surface', 'surfaceRaised', 'textPrimary', 'textSecondary', 'textMuted', 'border', 'accent', 'accentForeground', 'selected', 'selectedForeground', 'success', 'warning', 'danger', 'disabled', 'overlay']) {
    assert.ok(dark.tokens[key], `missing dark token ${key}`)
    assert.ok(light.tokens[key], `missing light token ${key}`)
  }
  assert.equal(resolveCoachBranding(teamA).accent, 'blue')
  assert.equal(resolveCoachBranding({ ...teamA, clubAccent: 'invalid' }).accent, 'red')
  assert.equal(resolveCoachBranding({ ...teamA, clubAccent: 'invalid', teamAccent: 'invalid' }).accent, 'green')
  assert.equal(normalizeCoachLogoUrl('http://unsafe.example/logo.png'), '')
  assert.ok(getCoachContrastRatio(dark.tokens.accentForeground, dark.tokens.accent) >= 4.5)
})

test('Coach and Parent local state namespaces never collide', () => {
  const coach = getCoachLocalStateKeys('user-a')
  const parent = getParentLocalStateKeys('user-a')
  for (const category of Object.keys(coach)) {
    assert.notEqual(coach[category], parent[category])
    assert.match(coach[category], /\.coach\./)
    assert.match(parent[category], /\.parent\./)
  }
})

test('shared biometric, push, session, runtime, and offline implementations declare app-role ownership', async () => {
  const files = await Promise.all([
    readFile(new URL('../apps/mobile-core/src/biometrics.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/secureSessionStorageCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/runtimeState.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/offlineStorageCore.js', import.meta.url), 'utf8'),
  ])
  for (const source of files) assert.match(source, /appRole|\.coach|\.parent/)
})

test('Coach local reset and environment quarantine purge app-owned push state', async () => {
  const [localStateSource, notificationsSource, startupSource] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/src/localState.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/startup.js', import.meta.url), 'utf8'),
  ])
  assert.match(notificationsSource, /export async function clearNativeNotificationLocalState\(appRole\)/)
  assert.match(localStateSource, /clearNativeNotificationLocalState\('coach'\)/)
  assert.match(startupSource, /clearCoachAllLocalState\(\)/)
})

test('Coach startup explicitly resolves staff context before ready signed in', async () => {
  const transitions = []
  const result = await runMobileStartup({
    clearInvalidSession: async () => {},
    config: { isUsable: true },
    getBiometricEnabled: async () => false,
    getSession: async () => ({ data: { session: { user: { id: 'staff-a' } } }, error: null }),
    loadProfile: async () => ({ id: 'staff-a' }),
    onLock: () => {},
    onSession: () => {},
    onTransition: (state) => transitions.push(state),
    prepare: async () => {},
    resolvingProfileState: MOBILE_STARTUP_STATES.RESOLVING_STAFF_CONTEXT,
  })
  assert.equal(result.state, MOBILE_STARTUP_STATES.READY_SIGNED_IN)
  assert.deepEqual(transitions, [
    MOBILE_STARTUP_STATES.BOOTING,
    MOBILE_STARTUP_STATES.RESTORING_SESSION,
    MOBILE_STARTUP_STATES.RESOLVING_STAFF_CONTEXT,
  ])
})

test('expired session clears local Auth and returns to signed out without a blank startup state', async () => {
  let cleared = 0
  const result = await runMobileStartup({
    clearInvalidSession: async () => { cleared += 1 },
    config: { isUsable: true },
    getBiometricEnabled: async () => false,
    getSession: async () => { const error = new Error('jwt expired'); error.code = 'JWT_EXPIRED'; throw error },
    loadProfile: async () => {},
    onSession: () => {},
    onTransition: () => {},
    prepare: async () => {},
  })
  assert.equal(cleared, 1)
  assert.equal(result.state, MOBILE_STARTUP_STATES.READY_SIGNED_OUT)
})

test('startup corruption and watchdog failures surface privacy-safe recoverable state', async () => {
  const result = await runMobileStartup({
    clearInvalidSession: async () => {},
    config: { isUsable: true },
    getBiometricEnabled: async () => false,
    getSession: async () => ({ data: { session: null }, error: null }),
    loadProfile: async () => {},
    onSession: () => {},
    onTransition: () => {},
    prepare: async () => { const error = new Error('corrupt local cache contains private value'); error.code = 'COACH_LOCAL_STATE_CORRUPT'; throw error },
  })
  assert.equal(result.state, MOBILE_STARTUP_STATES.RECOVERABLE_ERROR)
  assert.equal(result.diagnosticCode, 'COACH_LOCAL_STATE_CORRUPT')
  assert.equal(JSON.stringify(result).includes('private value'), false)
})

test('Coach shell wires error boundary, context race reset, semantic theme, deep links, and local-only reset', async () => {
  const appSource = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
  assert.match(appSource, /class CoachRootErrorBoundary extends Component/)
  assert.match(appSource, /RESOLVING_STAFF_CONTEXT/)
  assert.match(appSource, /requestIdRef\.current \+= 1/)
  assert.match(appSource, /Linking\.addEventListener\('url'/)
  assert.match(appSource, /BackHandler\.addEventListener\('hardwareBackPress'/)
  assert.match(appSource, /onResetLocalData=\{clearCoachAllLocalState\}/)
  assert.doesNotMatch(appSource, /#[0-9a-fA-F]{6}/)
})

test('restored Coach Auth events stay in staff-context resolution until profile authority is ready', async () => {
  const authSource = await readFile(new URL('../apps/mobile-core/src/auth.js', import.meta.url), 'utf8')
  assert.match(authSource, /setStartupState\(appRole === 'coach'[\s\S]*RESOLVING_STAFF_CONTEXT[\s\S]*RESTORING_SESSION\)/)
})

test('Coach profile derives operational contexts from authoritative memberships and assignments', async () => {
  const profileSource = await readFile(new URL('../apps/mobile-core/src/profile.js', import.meta.url), 'utf8')
  assert.match(profileSource, /from\('user_club_memberships'\)/)
  assert.match(profileSource, /from\('team_staff'\)/)
  assert.match(profileSource, /authoritySource: 'user_club_memberships'/)
  assert.match(profileSource, /authoritySource: 'team_staff'/)
  assert.match(profileSource, /resolveCoachStaffContext/)
  assert.doesNotMatch(profileSource, /const isClubWideRole = profile\.roleRank >= 50/)
})
