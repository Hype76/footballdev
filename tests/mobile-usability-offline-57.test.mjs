import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildCoachCalendarPayload,
  formatCoachCalendarFormDate,
  normalizeCoachCalendarFormDate,
} from '../apps/mobile-core/src/coachCalendarCore.js'
import { getParentCalendarMarkerTone } from '../apps/mobile-core/src/parentCalendarCore.js'
import { getParentSyncAttentionItems, getParentSyncSummary } from '../apps/mobile-core/src/parentOfflineCore.js'
import { getCoachFriendlyError } from '../apps/coach-mobile/src/coachFriendlyErrors.js'

test('Parent month markers distinguish cancelled, response, match, training, and other events', () => {
  assert.equal(getParentCalendarMarkerTone({ eventType: 'training', status: 'cancelled' }), 'cancelled')
  assert.equal(getParentCalendarMarkerTone({ eventType: 'match_day', requiresResponse: true, status: 'scheduled' }), 'response')
  assert.equal(getParentCalendarMarkerTone({ eventType: 'match_day', status: 'scheduled' }), 'match')
  assert.equal(getParentCalendarMarkerTone({ eventType: 'assessment_session', status: 'scheduled' }), 'training')
  assert.equal(getParentCalendarMarkerTone({ eventType: 'social', status: 'scheduled' }), 'event')
})

test('Coach Calendar accepts and displays UK dates while preserving canonical ISO payloads', () => {
  assert.equal(normalizeCoachCalendarFormDate('14-08-2026'), '2026-08-14')
  assert.equal(normalizeCoachCalendarFormDate('2026-08-14'), '2026-08-14')
  assert.equal(normalizeCoachCalendarFormDate('31-02-2026'), '')
  assert.equal(formatCoachCalendarFormDate('2026-08-14'), '14-08-2026')

  const payload = buildCoachCalendarPayload({
    context: { clubId: 'club-1', paymentAccess: { canMutate: true }, role: 'manager', roleRank: 40, teamId: 'team-1' },
    form: {
      date: '14-08-2026',
      endTime: '20:00',
      eventType: 'match',
      parentAudience: 'none',
      parentVisible: false,
      recurrenceFrequency: 'none',
      startTime: '18:00',
      title: 'Friday match',
    },
  })
  assert.match(payload.starts_at, /^2026-08-14T17:00:00\.000Z$/)
})

test('Parent attention actions are child scoped and retain exact destinations', () => {
  const document = {
    journal: [
      { childScope: 'link-a', commandId: 'one', createdAt: '2026-08-14T10:00:00Z', entityId: 'poll-1', lastErrorCategory: 'conflict', localSequence: 1, status: 'conflict', type: 'poll_vote' },
      { childScope: 'link-b', commandId: 'two', createdAt: '2026-08-14T10:01:00Z', entityId: 'message-1', lastErrorCategory: 'authority_removed', localSequence: 2, status: 'permanently_rejected', type: 'message_read' },
    ],
  }
  assert.deepEqual(getParentSyncSummary(document, 'link-a'), { needsAttention: 1, state: 'attention', waiting: 0 })
  assert.deepEqual(getParentSyncAttentionItems(document, 'link-a'), [{ commandId: 'one', createdAt: '2026-08-14T10:00:00Z', entityId: 'poll-1', reason: 'conflict', type: 'poll_vote' }])
})

test('Coach errors hide implementation details and explain recoverable conditions plainly', () => {
  assert.equal(getCoachFriendlyError(new Error('Network request failed'), 'Could not load.'), 'We could not connect just now. Saved information is still available where possible.')
  assert.equal(getCoachFriendlyError(new Error('PGRST205'), 'Could not load.'), 'Could not load.')
  assert.equal(getCoachFriendlyError(new Error('That Europe/London time does not exist because the clocks change.'), 'Could not save.'), 'That time falls during the clock change. Please choose another time.')
})

test('mobile sources provide direct date navigation, actionable attention, offline-first reads, and quiet Coach loading', async () => {
  const [parentApp, parentScreens, coachApp, coachScreens, phaseScreens, communication, migration, buildGuard, submitGuard] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/lib/_parent-communication-preferences.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260812103411_matchday_parent_notification_repair.sql', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
  ])

  assert.match(parentScreens, /getParentCalendarMarkerTone/)
  assert.match(parentScreens, /onDateSelected\?\.\(date\)/)
  assert.match(parentApp, /scrollToEnd\(\{ animated: true \}\)/)
  assert.match(parentApp, /Opens the item that needs attention/)
  assert.match(parentApp, />Next</)
  assert.match(parentApp, /item\.type === 'poll_vote'/)
  assert.match(parentApp, /item\.type === 'message_read'/)

  assert.doesNotMatch(coachApp, /Latest Coach overview loaded/)
  assert.match(coachApp, /setTimeout\(\(\) => onDismissRef\.current\(\), 4500\)/)
  assert.match(coachScreens, /Date DD-MM-YYYY/)
  assert.doesNotMatch(coachScreens, /canonical Calendar state/)
  assert.match(coachScreens, /const cached = await readCoachOfflineResources/)
  assert.match(phaseScreens, /const cached = await readCoachOfflineResources/)
  assert.doesNotMatch(phaseScreens, /Safety boundary/)

  assert.match(communication, /return \['app', 'email', 'both'\]\.includes\(channel\) \? channel : 'both'/)
  assert.match(migration, /communication_channel text not null default 'both'/)
  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-USABILITY-OFFLINE-57/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-USABILITY-OFFLINE-57/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-USABILITY-OFFLINE-57'/)
  assert.match(submitGuard, /if \(platform === 'ios'\) submitArgs\.push\('--groups', 'Internal Testers'\)/)
})
