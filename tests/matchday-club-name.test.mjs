import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@babel/parser'
import { getMatchDayDisplayName, getMatchDayDisplayParts } from '../src/lib/matchday-display.js'
import { getCoachMatchDayPresentation } from '../apps/mobile-core/src/coachMatchDayCore.js'
import { normalizeCoachCalendarEvent } from '../apps/mobile-core/src/coachCalendarCore.js'
import { enrichParentMatchInvitations, getParentMatchCalendarUrl } from '../apps/parent-mobile/src/parentExperience.js'
import { normalizeMatchDayShirtChoice } from '../src/lib/matchday-model.js'
import { normalizePersonName } from '../src/lib/person-name.js'
import { normalizePitchType } from '../src/lib/pitch-type.js'

const parentPortalDataSource = await readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8')
const parentAppSource = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
const mobileCoreDataSource = await readFile(new URL('../apps/mobile-core/src/data.js', import.meta.url), 'utf8')
const declarationSource = (source, name) => {
  const declarations = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
    .map((node) => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
  const declaration = declarations.find((node) => node?.type === 'FunctionDeclaration' && node.id.name === name)
  return source.slice(declaration.start, declaration.end)
}
const normalizeText = (value) => String(value ?? '').trim()
const normalizeMatchDay = new Function('normalizeMatchDayShirtChoice', 'normalizePitchType', `
  ${declarationSource(mobileCoreDataSource, 'normalizeText')}
  ${declarationSource(mobileCoreDataSource, 'getRelatedRow')}
  ${declarationSource(mobileCoreDataSource, 'normalizeMatchDayEvent')}
  ${declarationSource(mobileCoreDataSource, 'normalizeMatchDay')}
  return normalizeMatchDay
`)(normalizeMatchDayShirtChoice, normalizePitchType)

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

test('Parent match fetch applies the selected link club when the RPC omits fixture club data', async () => {
  const calls = []
  const supabase = { rpc: async (name) => {
    calls.push(name)
    return { data: name === 'get_parent_portal_match_days' ? [{ id: 'fixture', club_name: '', team_name: fixture.teamName, opponent: fixture.opponent, home_away: fixture.homeAway, events: [] }] : [], error: null }
  } }
  const getParentPortalMatchDays = new Function('supabase', 'normalizeMatchDay', 'normalizePersonName', `
    const requireSelectedLink = user => user.link
    const normalizeText = ${normalizeText.toString()}
    ${declarationSource(parentPortalDataSource, 'normalizeParentFormationPlayers')}
    ${declarationSource(parentPortalDataSource, 'normalizeParentMatchFormationPlan')}
    ${declarationSource(parentPortalDataSource, 'normalizeParentMatchEvent')}
    ${declarationSource(parentPortalDataSource, 'normalizeParentMatchDay')}
    ${declarationSource(parentPortalDataSource, 'getParentPortalMatchDays')}
    return getParentPortalMatchDays
  `)(supabase, normalizeMatchDay, normalizePersonName)

  const [match] = await getParentPortalMatchDays({ link: { id: 'cambourne-link', clubId: 'cambourne', clubName: fixture.clubName, linkType: 'parent' } })
  assert.equal(match.clubName, fixture.clubName)
  assert.equal(match.teamName, fixture.teamName)
  assert.equal(getMatchDayDisplayName(match), 'Peterborough Junior Blues U14 v Cambourne Town FC')
  assert.ok(calls.includes('get_parent_portal_match_days'))
})

test('older cached Parent fixtures use the selected link club without crossing club boundaries', () => {
  const prepareParentResourceItems = new Function('prepareResourceItems', `
    ${declarationSource(parentAppSource, 'prepareParentResourceItems')}
    return prepareParentResourceItems
  `)((name, items) => items)
  const selectedLink = { clubId: 'cambourne', clubName: fixture.clubName }
  const cachedSource = { id: 'cached', clubId: 'cambourne', teamName: fixture.teamName, opponent: fixture.opponent, homeAway: fixture.homeAway, confirmedTeam: ['Jenson Bailey'], events: [{ id: 'event' }], isFanView: true, isScorer: true, resources: [{ id: 'resource' }], squadTransport: [{ playerId: 'player' }] }
  const [cachedMatch] = prepareParentResourceItems('matches', [cachedSource], selectedLink)
  assert.equal(getMatchDayDisplayName(cachedMatch), 'Peterborough Junior Blues U14 v Cambourne Town FC')
  assert.deepEqual(cachedMatch.resources, cachedSource.resources)
  assert.deepEqual(cachedMatch.confirmedTeam, cachedSource.confirmedTeam)
  assert.deepEqual(cachedMatch.events, cachedSource.events)
  assert.deepEqual(cachedMatch.squadTransport, cachedSource.squadTransport)
  assert.equal(cachedMatch.isFanView, true)
  assert.equal(cachedMatch.isScorer, true)

  const [otherClubMatch] = prepareParentResourceItems('matches', [{ id: 'other', clubId: 'other-club', teamName: fixture.teamName, opponent: fixture.opponent, homeAway: fixture.homeAway }], selectedLink)
  assert.equal(getMatchDayDisplayName(otherClubMatch), 'Peterborough Junior Blues U14 v U14 JPL 26/27')

  const [knownClubMatch] = prepareParentResourceItems('matches', [{ id: 'known', clubId: 'other-club', clubName: 'Existing Club FC', teamName: fixture.teamName, opponent: fixture.opponent, homeAway: fixture.homeAway }], selectedLink)
  assert.equal(getMatchDayDisplayName(knownClubMatch), 'Peterborough Junior Blues U14 v Existing Club FC')
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
