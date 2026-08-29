import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { normalizeCoachInvite } from '../apps/mobile-core/src/coachPhase31ECore.js'
import { buildParentCalendarIcs } from '../apps/parent-mobile/src/parentExperience.js'

const migrationUrl = new URL('../supabase/migrations/20260829160252_parent_carpool_and_active_team_selection_124.sql', import.meta.url)
const parentScreensUrl = new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url)
const parentDataUrl = new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url)
const coachScreensUrl = new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)

test('Parent calendar export creates a platform-shareable timed event', () => {
  const ics = buildParentCalendarIcs({
    id: 'match-1',
    kickoffTime: '09:15',
    matchDate: '2026-08-29',
    opponent: 'Haverhill Gold',
    shirtChoice: 'home',
    teamName: 'U14 JPL 26/27',
    venueAddress: 'The New Croft, Haverhill',
  })
  assert.match(ics, /BEGIN:VCALENDAR/)
  assert.match(ics, /DTSTART;TZID=Europe\/London:20260829T091500/)
  assert.match(ics, /SUMMARY:U14 JPL 26\/27 v Haverhill Gold/)
  assert.ok(ics.includes('LOCATION:The New Croft\\, Haverhill'))
  assert.match(ics, /END:VCALENDAR/)
})

test('Parent calendar export supports date-only events and invitation field names', () => {
  const ics = buildParentCalendarIcs({ eventDate: '2026-09-03', eventTitle: 'JPL Training 3G Pitch', sourceRecordId: 'request-1' })
  assert.match(ics, /DTSTART;VALUE=DATE:20260903/)
  assert.match(ics, /SUMMARY:JPL Training 3G Pitch/)
})

test('Carpool state remains independent from attendance and is Parent scoped', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.match(migration, /get_parent_portal_match_transport_states/)
  assert.match(migration, /link\.auth_user_id = \(select auth\.uid\(\)\)/)
  assert.match(migration, /request\.player_id = link\.player_id/)
  assert.match(migration, /submit_match_day_availability_response\([\s\S]*request_row\.token_hash,[\s\S]*'',/)
  assert.doesNotMatch(migration, /update public\.match_day_player_availability/)
  assert.match(migration, /from public, anon;[\s\S]*to authenticated, service_role/)
})

test('Fixture selection allows an active same-team player without weakening archive or scope checks', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  assert.doesNotMatch(migration, /player_row\.section <> 'Squad'/)
  assert.match(migration, /player_row\.club_id <> match_row\.club_id/)
  assert.match(migration, /player_row\.team_id is distinct from match_row\.team_id/)
  assert.match(migration, /player_row\.status, 'active'\) = 'archived'/)
})

test('Coach invite normalisation exposes red need-lift and club-colour offer states', async () => {
  const need = normalizeCoachInvite({ id: 'a', transport_needs_lift: true }, 'match')
  const offer = normalizeCoachInvite({ id: 'b', transport_can_offer_lift: true, transport_seats_offered: 3 }, 'match')
  assert.equal(need.transportNeedsLift, true)
  assert.equal(offer.transportCanOfferLift, true)
  assert.equal(offer.transportSeatsOffered, 3)
  const source = await readFile(coachScreensUrl, 'utf8')
  assert.match(source, /name="directions-car"/)
  assert.match(source, /needsLift \? styles\.carpoolNeed : styles\.carpoolOffer/)
})

test('Parent views show calendar and carpool actions without changing attendance', async () => {
  const [screens, data] = await Promise.all([readFile(parentScreensUrl, 'utf8'), readFile(parentDataUrl, 'utf8')])
  assert.match(screens, /function ParentCarpoolControl/)
  assert.match(screens, /'Need a lift'/)
  assert.match(screens, /'Offer a lift'/)
  assert.match(screens, /label="Add to calendar"/)
  assert.match(data, /get_parent_portal_match_transport_states/)
  assert.match(data, /set_parent_portal_match_transport/)
  assert.match(data, /mimeType: 'text\/calendar'/)
})

test('Web match entry separates Player, Coach, and Other match-only names', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  assert.match(source, /function formatMatchOnlyParticipantName/)
  assert.match(source, /<option value="coach">Coach<\/option>/)
  assert.match(source, /<option value="other">Other<\/option>/)
  assert.match(source, /formatMatchOnlyParticipantName\(formEvent\.participantType, formEvent\.playerName\)/)
})
