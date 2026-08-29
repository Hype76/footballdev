import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  filterCoachMatchDayPlayerChoices,
  getCoachMatchDayOpponentPlayers,
  getCoachMatchDaySelectedPlayers,
  formatCoachMatchDayParticipantName,
  pickCoachMatchDayLinkedPlayer,
  updateCoachMatchDayLinkedPlayer,
  validateCoachMatchDayEventForm,
} from '../apps/mobile-core/src/coachMatchDayCore.js'

const coachScreenUrl = new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url)

const players = [
  { id: 'p1', playerName: 'Steve King', section: 'Squad', shirtNumber: '8', status: 'active', teamId: 'team-1' },
  { id: 'p2', playerName: 'Alex Green', section: 'Squad', shirtNumber: '10', status: 'active', teamId: 'team-1' },
  { id: 'p3', playerName: 'Trial Player', section: 'Trial', shirtNumber: '11', status: 'active', teamId: 'team-1' },
  { id: 'p4', playerName: 'Other Team', section: 'Squad', shirtNumber: '12', status: 'active', teamId: 'team-2' },
]

const match = {
  teamId: 'team-1',
  squadDecisions: [
    { playerId: 'p1', status: 'selected' },
    { playerId: 'p2', status: 'waiting' },
    { playerId: 'p3', status: 'selected' },
    { playerId: 'p4', status: 'selected' },
  ],
}

test('Match Day action player choices include selected active same-team players, including non-roster participants', () => {
  assert.deepEqual(getCoachMatchDaySelectedPlayers(players, match), [
    { id: 'p1', playerName: 'Steve King', shirtNumber: '8' },
    { id: 'p3', playerName: 'Trial Player', shirtNumber: '11' },
  ])
})

test('Coach and Other participants are match-only labelled names', () => {
  assert.equal(formatCoachMatchDayParticipantName('coach', 'Simon Bailey'), 'Coach: Simon Bailey')
  assert.equal(formatCoachMatchDayParticipantName('other', 'Guest 12'), 'Other: Guest 12')
  assert.equal(formatCoachMatchDayParticipantName('player', 'Steve King'), 'Steve King')
  assert.throws(() => validateCoachMatchDayEventForm({ eventType: 'yellow_card', participantType: 'coach', teamSide: 'club' }), /Coach name/)
  assert.equal(validateCoachMatchDayEventForm({ eventType: 'red_card', participantType: 'coach', playerName: 'Simon Bailey', teamSide: 'club' }).playerName, 'Coach: Simon Bailey')
})

test('Known player names and unique shirts populate both linked fields while manual text remains valid', () => {
  const base = { playerName: '', playerShirtNumber: '' }
  const byName = updateCoachMatchDayLinkedPlayer(base, 'player', 'name', 'steve king', players)
  assert.equal(byName.playerName, 'Steve King')
  assert.equal(byName.playerShirtNumber, '8')

  const byShirt = updateCoachMatchDayLinkedPlayer(base, 'player', 'shirt', '10', players)
  assert.equal(byShirt.playerName, 'Alex Green')
  assert.equal(byShirt.playerShirtNumber, '10')

  const manual = updateCoachMatchDayLinkedPlayer(base, 'player', 'name', 'Opponent Player', players)
  assert.equal(manual.playerName, 'Opponent Player')
  assert.equal(manual.playerShirtNumber, '')

  const picked = pickCoachMatchDayLinkedPlayer(base, 'player', players[0])
  assert.equal(picked.playerName, 'Steve King')
  assert.equal(picked.playerShirtNumber, '8')
})

test('Dropdown filtering searches both player names and shirt numbers', () => {
  assert.deepEqual(filterCoachMatchDayPlayerChoices(players, 'green').map((player) => player.id), ['p2'])
  assert.deepEqual(filterCoachMatchDayPlayerChoices(players, '8').map((player) => player.id), ['p1'])
})

test('Opponent choices reuse previously saved opponent names and shirts without exposing our squad', () => {
  const choices = getCoachMatchDayOpponentPlayers({
    events: [
      { teamSide: 'club', scorerName: 'Steve King', scorerShirtNumber: '8' },
      { teamSide: 'opponent', scorerName: 'Away Scorer', scorerShirtNumber: '9', assistName: 'Away Assist', assistShirtNumber: '4' },
      { teamSide: 'opponent', playerName: 'Away Scorer', playerShirtNumber: '9' },
    ],
  })
  assert.deepEqual(choices.map((player) => [player.playerName, player.shirtNumber]), [
    ['Away Assist', '4'],
    ['Away Scorer', '9'],
  ])
})

test('Opponent substitution details are optional while Our Team still requires both selected players', () => {
  assert.doesNotThrow(() => validateCoachMatchDayEventForm({ eventType: 'substitution', teamSide: 'opponent' }))
  assert.throws(() => validateCoachMatchDayEventForm({ eventType: 'substitution', teamSide: 'club' }), /Player going off/)
})

test('Coach action sheets expose linked fields, optional opponent labels, inline errors, and confirmed closure', async () => {
  const source = await readFile(coachScreenUrl, 'utf8')
  const livePanel = source.slice(source.indexOf('function LivePanel'), source.indexOf('function TimelinePanel'))

  assert.match(source, /function LinkedPlayerField/)
  assert.match(source, /Show \$\{fieldLabel\} choices/)
  assert.match(livePanel, /prefix="scorer"/)
  assert.match(livePanel, /prefix="assist"/)
  assert.match(livePanel, /Assist shirt number \(Optional\)/)
  assert.match(livePanel, /prefix="player"/)
  assert.match(livePanel, /prefix="playerOn"/)
  assert.match(livePanel, /No selected active team players are available/)
  assert.match(livePanel, /label: 'Coach', value: 'coach'/)
  assert.match(livePanel, /label: 'Other', value: 'other'/)
  assert.match(livePanel, /actionError/)
  assert.match(livePanel, /if \(!saved\) throw new Error/)
  assert.match(livePanel, /setActionSheet\(null\)/)
})
