import assert from 'node:assert/strict'
import test from 'node:test'
import { getMatchDayDisplayName, getMatchDayDisplayParts } from '../src/lib/matchday-display.js'
import { getCoachMatchDayPresentation } from '../apps/mobile-core/src/coachMatchDayCore.js'
import { normalizeCoachCalendarEvent } from '../apps/mobile-core/src/coachCalendarCore.js'
import { enrichParentMatchInvitations, getParentMatchCalendarUrl } from '../apps/parent-mobile/src/parentExperience.js'

const fixture = Object.freeze({
  id: 'fixture', clubName: 'Cambourne Town FC', teamName: 'U14 JPL 26/27',
  opponent: 'Peterborough Junior Blues U14', homeAway: 'away',
  homeScore: 2, awayScore: 3, matchDate: '2099-09-19', kickoffTime: '10:45', status: 'scheduled',
})

for (const homeAway of ['home', 'away', 'neutral']) {
  test(`${homeAway} match titles use the club and keep score ownership`, () => {
    const match = { ...fixture, homeAway }
    const away = homeAway === 'away'
    const expected = away
      ? 'Peterborough Junior Blues U14 v Cambourne Town FC'
      : 'Cambourne Town FC v Peterborough Junior Blues U14'
    assert.equal(getMatchDayDisplayName(match), expected)
    const parts = getMatchDayDisplayParts(match)
    assert.equal(parts.firstScore, 2)
    assert.equal(parts.secondScore, 3)
    assert.equal(away ? parts.secondTeam : parts.firstTeam, fixture.clubName)
    assert.equal(getCoachMatchDayPresentation(match).displayName, expected)
    const calendar = normalizeCoachCalendarEvent(match, 'match_day')
    assert.equal(calendar.title, expected)
    assert.equal(calendar.teamName, fixture.teamName)
    assert.equal(new URL(getParentMatchCalendarUrl(match)).searchParams.get('text'), expected)
    assert.equal(match.teamName, 'U14 JPL 26/27')
  })
}

test('older cached matches fall back to their team until club identity is available', () => {
  assert.equal(getMatchDayDisplayName({ ...fixture, clubName: '' }), 'Peterborough Junior Blues U14 v U14 JPL 26/27')
  assert.equal(getMatchDayDisplayName({ opponent: 'Visitors' }), 'Our team v Visitors')
  assert.equal(getMatchDayDisplayName({ club_name: '  Another FC  ', team_name: 'U16', opponent: 'Visitors', home_away: 'home' }), 'Another FC v Visitors')
})

test('Parent invitations use each fixture club while retaining internal team references', () => {
  const invitations = [
    { eventId: 'fixture', invitationType: 'match_attendance', teamName: fixture.teamName },
    { eventId: 'another-fixture', invitationType: 'match_role', teamName: 'U16' },
  ]
  const result = enrichParentMatchInvitations(invitations, [fixture, {
    ...fixture, id: 'another-fixture', clubName: 'Other Club FC', teamName: 'U16', homeAway: 'home',
  }])
  assert.equal(result[0].eventTitle, 'Peterborough Junior Blues U14 v Cambourne Town FC')
  assert.equal(result[0].teamName, fixture.teamName)
  assert.equal(result[1].eventTitle, 'Other Club FC v Peterborough Junior Blues U14')
  assert.equal(result[1].teamName, 'U16')
})
