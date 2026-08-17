import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildParentPollMobileNotification,
  processChatMobileNotifications,
} from '../netlify/functions/process-chat-mobile-notifications.js'

test('Parent Chat avoids Android double keyboard resizing and keeps the focused room route', async () => {
  const [app, config, screens] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/appConfig.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/)
  assert.match(app, /enabled=\{Platform\.OS === 'ios'\}/)
  assert.doesNotMatch(app, /Platform\.OS === 'ios' \? 'padding' : 'height'/)
  assert.match(config, /softwareKeyboardLayoutMode: 'resize'/)
  assert.match(screens, /style=\{styles\.chatList\}/)
  assert.match(screens, /Back to Chat rooms/)
})

test('Coach Player writes use the canonical Basic Development Records capability', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPlayersData.js', import.meta.url), 'utf8')
  assert.match(source, /assertCoachCapability\(user, CAPABILITIES\.basicDevelopmentRecords\)/)
  assert.doesNotMatch(source, /CAPABILITIES\.players/)
})

test('Coach Sessions exposes recurring training invitations and keeps assessment Sessions separate', async () => {
  const [screen, data] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachCalendarData.js', import.meta.url), 'utf8'),
  ])
  for (const marker of ['Create training session', 'label="Repeat until"', 'Notify parents now', 'Ask parents to respond', 'Assessment Sessions']) {
    assert.match(screen, new RegExp(marker))
  }
  assert.match(screen, /saveCoachTrainingInvitation/)
  assert.match(data, /save_training_availability_setting_v3/)
  assert.match(data, /notify_calendar_event_parents/)
  assert.match(data, /processCalendarNotification/)
  assert.match(screen, /filterCoachCalendarEvents\(calendarRows, 'upcoming'\)/)
})

test('Coach Resources supports Player targets including published Formation Boards', async () => {
  const [screen, migration] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260817065446_mobile_feedback_corrective_61.sql', import.meta.url), 'utf8'),
  ])
  assert.match(screen, /Assign selected Resource/)
  assert.match(screen, /linkedType: 'player'/)
  assert.match(screen, /Visible to the Player's family/)
  assert.match(migration, /new\.linked_type <> 'player'/)
  assert.match(migration, /set search_path = ''/)
})

test('new Parent Poll notification is privacy-safe and deep-links to Parent Polls', () => {
  const payload = buildParentPollMobileNotification({
    detail_level: 'detailed',
    expo_push_token: 'ExpoPushToken[parent]',
    parent_link_id: 'parent-link-1',
    poll_id: 'poll-1',
    team_id: 'team-1',
  })
  assert.equal(payload.title, 'Football Player Parents')
  assert.deepEqual(payload.data, {
    app: 'parent',
    parentLinkId: 'parent-link-1',
    pollId: 'poll-1',
    route: 'polls',
    teamId: 'team-1',
    type: 'parent_poll',
  })
  assert.doesNotMatch(JSON.stringify(payload), /parentName|playerName|question|optionId|@/i)
})

test('notification processor claims and records Parent Poll delivery', async () => {
  const calls = []
  const pollIntent = {
    intent_id: 61,
    recipient_app: 'parent',
    installation_id: 'parent-install',
    auth_user_id: 'parent-user',
    parent_link_id: 'parent-link-1',
    club_id: 'club-1',
    team_id: 'team-1',
    poll_id: 'poll-1',
    detail_level: 'minimal',
    expo_push_token: 'ExpoPushToken[parent-token]',
  }
  const client = {
    async rpc(name) {
      return { data: name === 'claim_parent_poll_mobile_notification_intents' ? [pollIntent] : [], error: null }
    },
    from(table) {
      const chain = {
        eq() { return chain },
        in() { return Promise.resolve({ data: [], error: null }) },
        insert(value) { calls.push({ operation: 'insert', table, value }); return Promise.resolve({ error: null }) },
        select() { return chain },
        update(value) { calls.push({ operation: 'update', table, value }); return chain },
      }
      return chain
    },
  }
  const result = await processChatMobileNotifications({
    client,
    async sendMessages(messages) {
      assert.equal(messages[0].data.route, 'polls')
      assert.equal(messages[0].data.app, 'parent')
      return { failed: 0, invalidTokens: [], sent: 1 }
    },
  })
  assert.deepEqual(result, { claimed: 1, failed: 0, sent: 1, skipped: 0 })
  assert.equal(calls.some((call) => call.table === 'parent_poll_mobile_notification_intents' && call.value.status === 'sent'), true)
  assert.equal(calls.some((call) => call.table === 'parent_mobile_notification_events' && call.value.intent_type === 'parent_poll'), true)
})

test('corrective release guards and native versions cover both apps', async () => {
  const [buildGuard, submitGuard, coachConfig, coachPackage, parentConfig, parentPackage] = await Promise.all([
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/app.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/app.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/package.json', import.meta.url), 'utf8'),
  ])
  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-FEEDBACK-CORRECTIVE-61/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-FEEDBACK-CORRECTIVE-61/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-FEEDBACK-CORRECTIVE-61'/)
  assert.match(coachConfig, /version: '1\.0\.17'/)
  assert.equal(JSON.parse(coachPackage).version, '1.0.17')
  assert.match(parentConfig, /version: '1\.0\.14'/)
  const parsedParentPackage = JSON.parse(parentPackage)
  assert.equal(parsedParentPackage.version, '1.0.14')
  assert.match(parsedParentPackage.scripts['build:ios:internal-live'], /parent internal-live ios/)
})
