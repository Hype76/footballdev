import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getCoachMatchDayActions,
  hasCoachMatchDayCommandResult,
  isCoachMatchDayEventVoided,
  isCoachMatchDayFinalReportApplied,
  isCoachMatchDayGoalCorrectionApplied,
  isCoachMatchDayShootoutKickApplied,
  isCoachMatchDayShootoutKickVoided,
  isCoachMatchDaySquadDecisionApplied,
  isCoachMatchDayTimerActionApplied,
  isCoachMatchDayVolunteerSelectionApplied,
} from '../apps/mobile-core/src/coachMatchDayCore.js'
import {
  isCoachMatchAvailabilityRequestCreationApplied,
  sanitizeCoachChatOfflineValue,
} from '../apps/mobile-core/src/coachPhase31ECore.js'
import {
  createCoachOfflineDocument,
  getCoachOfflineResources,
  setCoachOfflineResources,
} from '../apps/mobile-core/src/coachOfflineCore.js'
import { COACH_PHASE_31F_CACHE_SCHEMA_VERSION } from '../apps/mobile-core/src/coachPhase31FCore.js'

test('Match Day uncertain-result classifiers distinguish applied commands from safe retries', () => {
  const match = {
    concludedAt: '2026-08-10T12:00:00Z',
    currentMatchPhase: 'full_time',
    events: [
      { id: 'event-command', requestId: 'command-35' },
      { correctionReason: 'Wrong scorer', eventStatus: 'active', id: 'goal-1', minute: 35, scorerName: 'Alex', scorerShirtNumber: '9', assistName: 'Sam', teamSide: 'club' },
      { eventStatus: 'voided', id: 'void-1' },
    ],
    finalReport: { staffNotes: 'Confirmed report' },
    roleAssignments: [{ parentLinkId: 'parent-link-1', role: 'scorer' }],
    shootoutEvents: [{ eventStatus: 'active', id: 'kick-new', outcome: 'scored', playerName: 'Alex', teamSide: 'club' }, { eventStatus: 'voided', id: 'kick-void' }],
    squadDecisions: [{ playerId: 'player-1', status: 'selected' }],
    status: 'full_time',
    timerStatus: 'full_time',
  }
  assert.equal(hasCoachMatchDayCommandResult(match, 'command-35'), true)
  assert.equal(hasCoachMatchDayCommandResult(match, 'missing'), false)
  assert.equal(isCoachMatchDayTimerActionApplied(match, 'full_time'), true)
  assert.equal(isCoachMatchDayGoalCorrectionApplied(match, 'goal-1', { assistName: 'Sam', minute: 35, scorerName: 'Alex', scorerShirtNumber: '9', teamSide: 'club' }, 'Wrong scorer'), true)
  assert.equal(isCoachMatchDayEventVoided(match, 'void-1'), true)
  assert.equal(isCoachMatchDayShootoutKickApplied(match, ['kick-old'], { outcome: 'scored', playerName: 'Alex', teamSide: 'club' }), true)
  assert.equal(isCoachMatchDayShootoutKickVoided(match, 'kick-void'), true)
  assert.equal(isCoachMatchDayFinalReportApplied(match, 'Confirmed report'), true)
  assert.equal(isCoachMatchDaySquadDecisionApplied(match, 'player-1', 'selected'), true)
  assert.equal(isCoachMatchDayVolunteerSelectionApplied(match, { parentLinkId: 'parent-link-1' }, 'scorer', true), true)
})

test('Match Day mutation gates remain closed while reconciliation is incomplete', () => {
  const actions = getCoachMatchDayActions({
    context: { paymentAccess: { canMutate: true }, role: 'coach', roleRank: 50 },
    match: { concludedAt: '', currentMatchPhase: 'first_half', status: 'live', timerStatus: 'running' },
    reconciling: true,
  })
  assert.equal(actions.canMutate, false)
  assert.equal(actions.canRecordEvents, false)
  assert.match(actions.blockedReason, /Reconciling/)
})

test('Parent Chat offline data is removed and Staff Chat preview content is minimized', () => {
  const sanitized = sanitizeCoachChatOfflineValue({
    parent: [{ id: 'parent-room', latestMessage: 'Private Parent message', unreadCount: 2 }],
    staff: [{ id: 'staff-room', latestMessage: 'Private Staff preview', unreadCount: 3 }],
  })
  assert.deepEqual(sanitized.parent, [])
  assert.equal(sanitized.staff[0].id, 'staff-room')
  assert.equal(sanitized.staff[0].latestMessage, '')
  assert.equal(sanitized.staff[0].unreadCount, 0)
})

test('encrypted cache schema includes exact staff authority identity and rejects reassignment', () => {
  const originalContext = { authorityId: 'team-staff-1', authoritySource: 'team_staff', clubId: 'club-1', id: 'context-1', role: 'coach', teamId: 'team-1' }
  const document = setCoachOfflineResources(createCoachOfflineDocument({ userScope: 'user-1' }), originalContext, { home: { count: 1 } }, '2026-08-10T12:00:00Z')
  assert.equal(document.cacheSchemaVersion, COACH_PHASE_31F_CACHE_SCHEMA_VERSION)
  assert.equal(getCoachOfflineResources(document, originalContext)?.authorityId, 'team-staff-1')
  assert.equal(getCoachOfflineResources(document, { ...originalContext, authorityId: 'team-staff-2' }), null)
  assert.equal(getCoachOfflineResources(document, { ...originalContext, role: 'assistant_coach' }), null)
  const reassigned = setCoachOfflineResources(document, { ...originalContext, authorityId: 'team-staff-2' }, { branding: { name: 'Current Team' } }, '2026-08-10T12:05:00Z')
  const reassignedResources = getCoachOfflineResources(reassigned, { ...originalContext, authorityId: 'team-staff-2' })?.resources
  assert.equal(reassignedResources.home, undefined)
  assert.deepEqual(reassignedResources.branding, { name: 'Current Team' })
})

test('Match availability request reconciliation requires every selected Player in the canonical Match response', () => {
  const data = { match: [
    { cancelled: false, eventId: 'match-1', playerId: 'player-1', stale: false },
    { cancelled: false, eventId: 'match-1', playerId: 'player-2', stale: false },
  ] }
  assert.equal(isCoachMatchAvailabilityRequestCreationApplied(data, 'match-1', ['player-1', 'player-2']), true)
  assert.equal(isCoachMatchAvailabilityRequestCreationApplied(data, 'match-1', ['player-1', 'player-3']), false)
  assert.equal(isCoachMatchAvailabilityRequestCreationApplied(data, 'match-2', ['player-1']), false)
})

test('native corrective source preserves state, canonical communication authority, and context rebinding', async () => {
  const [appSource, buildGuard, matchScreen, phaseScreen, phaseData, submitGuard] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(matchScreen, /AppState\.addEventListener/)
  assert.match(matchScreen, /getCoachMatchDayDetail\(user, match\.id\)/)
  assert.match(matchScreen, /Reconciling the last action/)
  assert.match(matchScreen, /hasCoachMatchDayCommandResult/)
  assert.match(phaseScreen, /sanitizeCoachChatOfflineValue/)
  assert.match(phaseScreen, /setMessages\(\[\]\)[\s\S]*setRoomId\(nextRoom\.id\)/)
  assert.match(phaseScreen, /Reconcile last request/)
  assert.match(phaseData, /send-match-day-availability-requests/)
  assert.match(phaseData, /createCoachMatchAvailabilityRequests[\s\S]*minimumRank: 20/)
  assert.match(phaseData, /body: JSON\.stringify\(\{ matchDayId: match\.id, playerIds: selectedPlayerIds \}\)/)
  assert.match(phaseData, /filter\(\(room\) => room\.teamId === user\.activeTeamId\)/)
  assert.match(phaseData, /Parent Chat is not assigned to the active Team context/)
  assert.match(appSource, /requiresContextRefresh && next\.permissionGranted && next\.detailLevel !== 'off'/)
  assert.match(buildGuard, /FP-MOBILE-COACH-LIVE-QA-CORRECTIVE-35/)
  assert.match(submitGuard, /FP-MOBILE-COACH-LIVE-QA-CORRECTIVE-35/)
  assert.match(submitGuard, /--groups', 'Internal Testers'/)
})
