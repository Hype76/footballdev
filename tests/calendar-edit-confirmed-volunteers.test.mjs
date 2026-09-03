import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('existing Match Day edit exposes role requests and the existing invitation send choice', async () => {
  const source = await read('src/pages/SessionsPage.jsx')
  assert.match(source, /isMatchFixture && event\?\.sourceType === 'match-day'/)
  for (const name of ['requestScorer', 'requestLinesman', 'requestReferee']) {
    assert.match(source, new RegExp(`\\['${name}', 'Request`))
    assert.match(source, new RegExp(`${name}: calendarForm\\.${name}`))
  }
  assert.match(source, /Send updated invitations to parents/)
  assert.match(source, /Sends secure availability and configured volunteer response links/)
  assert.match(source, /Manage volunteer assignments/)
  assert.match(source, /\/match-day\?fixture=\$\{encodeURIComponent\(matchDayId\)\}&section=roles/)
})

test('coach-confirmed selection stays request, fixture, club, player and Parent-link scoped', async () => {
  const [server, domain, page] = await Promise.all([
    read('netlify/functions/select-match-day-volunteer.js'),
    read('src/lib/domain/match-day.js'),
    read('src/pages/MatchDayPage.jsx'),
  ])
  assert.match(domain, /confirmedByCoach: volunteer\.confirmedByCoach === true/)
  assert.match(domain, /parentLinkId: volunteer\.parentLinkId \|\| ''/)
  assert.match(server, /confirmedByCoach && !requestedParentLinkId/)
  assert.match(server, /if \(confirmedByCoach\) request = \{ \.\.\.request, parent_link_id: requestedParentLinkId \}/)
  assert.match(server, /assertCoachConfirmedVolunteerSelection/)
  assert.match(server, /role === 'scorer' && !confirmedByCoach/)
  assert.match(server, /await resolveParentLink\(adminSupabase, \{ match, request \}\)/)
  assert.match(server, /metadata: \{\s*confirmedByCoach,/)
  assert.match(page, /normalizeVolunteerText\(row\.response\) === 'no_response'/)
  assert.match(page, /Boolean\(row\.parentLinkId\)/)
  assert.match(page, /Assign confirmed parent/)
  assert.match(page, /The Parent has not volunteered through the app/)
  assert.match(page, /canSelect \|\| isSelected/)
  assert.doesNotMatch(server, /volunteer_(scorer|linesman|referee)_response:\s*'yes'/)
})
