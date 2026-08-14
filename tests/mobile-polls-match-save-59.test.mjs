import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildCoachCalendarPayload,
  coachCalendarFormFromEvent,
} from '../apps/mobile-core/src/coachCalendarCore.js'

test('Coach Add Match builds a valid event from opponent, UK date and active Team context', () => {
  const form = {
    ...coachCalendarFormFromEvent(null, { activeTeamId: 'team-1' }),
    date: '20-08-2026',
    endTime: '19:00',
    eventType: 'match',
    opponent: 'St Ives',
    startTime: '18:00',
  }
  const payload = buildCoachCalendarPayload({
    context: {
      activeTeamId: 'team-1',
      activeTeamName: 'U17 Green',
      clubId: 'club-1',
      role: 'head_manager',
    },
    form,
  })

  assert.equal(payload.title, 'U17 Green v St Ives')
  assert.equal(payload.team_id, 'team-1')
  assert.equal(payload.event_type, 'match')
  assert.equal(payload.starts_at, '2026-08-20T17:00:00.000Z')
  assert.equal(payload.ends_at, '2026-08-20T18:00:00.000Z')
})

test('Parent poll audit accepts authenticated Parents without public.users profiles', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260814165801_mobile_poll_audit_and_match_save_59.sql', import.meta.url),
    'utf8',
  )

  assert.match(migration, /select profile\.id[\s\S]*into audit_actor_id[\s\S]*from public\.users profile/)
  assert.match(migration, /insert into public\.audit_logs[\s\S]*audit_actor_id[\s\S]*'parent_poll_vote_submitted'/)
  assert.match(migration, /'actorAuthUserId', actor_auth_id/)
  assert.doesNotMatch(migration, /poll_row\.club_id,\s*actor_auth_id,\s*'parent_poll_vote_submitted'/)
})

test('Coach Match save keeps taps active and shows validation beside the form', async () => {
  const [app, calendarScreen, operationalData] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachOperationalData.js', import.meta.url), 'utf8'),
  ])

  assert.match(app, /keyboardShouldPersistTaps="always"/)
  assert.match(calendarScreen, /Keyboard\.dismiss\(\)/)
  assert.match(calendarScreen, /accessibilityRole="alert"/)
  assert.match(calendarScreen, /setSaveConfirmation\(form\?\.eventType === 'match' \? 'Match saved\.' : 'Event saved\.'\)/)
  assert.match(operationalData, /p_source: 'application'/)
  assert.match(operationalData, /appSource: 'coach_mobile_test'/)
})

test('release guards and native versions cover both mobile apps', async () => {
  const [buildGuard, submitGuard, coachConfig, coachPackage, parentConfig, parentPackage] = await Promise.all([
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/app.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/app.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/package.json', import.meta.url), 'utf8'),
  ])

  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-POLLS-MATCH-SAVE-59/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-POLLS-MATCH-SAVE-59/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-POLLS-MATCH-SAVE-59'/)
  assert.match(coachConfig, /version: '1\.0\.13'/)
  assert.equal(JSON.parse(coachPackage).version, '1.0.13')
  assert.match(parentConfig, /version: '1\.0\.10'/)
  assert.equal(JSON.parse(parentPackage).version, '1.0.10')
})
