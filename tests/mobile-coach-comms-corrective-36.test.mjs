import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { resolveCoachNotificationOpen } from '../apps/mobile-core/src/coachNotificationsCore.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../apps/coach-mobile/App.js')
const buildGuard = read('../apps/scripts/mobile-build-guard.mjs')
const phaseData = read('../apps/mobile-core/src/coachPhase31EData.js')
const phaseScreen = read('../apps/coach-mobile/src/CoachPhase31EScreens.js')

const contexts = [
  { id: 'team:team-a', teamId: 'team-a', clubStatus: 'active', teamStatus: 'active' },
  { id: 'team:team-b', teamId: 'team-b', clubStatus: 'active', teamStatus: 'active' },
]

test('Coach Chat notification resolves exact current context and distinct room type', () => {
  assert.deepEqual(resolveCoachNotificationOpen({
    app: 'coach',
    contextId: 'team:team-b',
    roomId: 'parent-room-b',
    route: 'chat',
    teamId: 'team-b',
    type: 'parent_chat',
  }, {
    activeContextId: 'team:team-a',
    contexts,
  }), {
    allowed: true,
    chatKind: 'parent',
    code: 'notification_route_ready',
    contextId: 'team:team-b',
    route: 'chat',
    targetId: 'parent-room-b',
  })

  assert.deepEqual(resolveCoachNotificationOpen({
    app: 'coach',
    conversationId: 'staff-room-a',
    route: 'chat',
    teamId: 'team-a',
    type: 'staff_chat',
  }, {
    activeContextId: 'team:team-b',
    contexts,
  }), {
    allowed: true,
    chatKind: 'staff',
    code: 'notification_route_ready',
    contextId: 'team:team-a',
    route: 'chat',
    targetId: 'staff-room-a',
  })

  assert.equal(resolveCoachNotificationOpen({
    app: 'coach',
    contextId: 'team:team-a',
    route: 'chat',
    teamId: 'team-b',
  }, { contexts }).code, 'notification_context_denied')
})

test('Coach Chat and Poll adapters use the new server-owned active-Team authority', () => {
  for (const marker of [
    'get_staff_chat_conversation_ids',
    'staff_chat_conversation_in_active_context',
    'send_staff_chat_message',
    'active_team_id_value: user.activeTeamId',
    'p_active_team_id: user.activeTeamId',
  ]) assert.match(phaseData, new RegExp(marker))

  assert.doesNotMatch(phaseData, /from\('staff_chat_messages'\)\.insert/)
  assert.doesNotMatch(phaseData, /Number\(user\.roleRank \|\| 0\) >= 70/)
})

test('Coach app clears cross-context Chat state and verifies an exact deep-link room after scoped reload', () => {
  assert.match(app, /setChatNotificationTarget\(null\)[\s\S]*setNotice\(''\)/)
  assert.match(app, /notificationResponseIdRef/)
  assert.match(app, /contextId: result\.contextId,[\s\S]*id: result\.targetId,[\s\S]*kind: result\.chatKind/)
  assert.match(phaseScreen, /rooms\.find\(\(item\) => item\.id === targetId/)
  assert.match(phaseScreen, /This Coach Chat is stale or no longer authorised/)
  assert.match(phaseScreen, /getCoachChatMessages\(user, nextRoom\)/)
  assert.match(buildGuard, /FP-MOBILE-COMMS-POLLS-PRIVACY-CORRECTIVE-36/)
})
