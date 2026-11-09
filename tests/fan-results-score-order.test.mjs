import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getMatchDayDisplayName,
  getMatchDayDisplayParts,
  getMatchDayDisplayScore,
} from '../src/lib/matchday-display.js'

test('Fans result puts the away fixture home side first without moving either score', () => {
  const match = {
    title: 'Cambourne Town FC v Kirkley & Pakefield',
    clubName: 'Cambourne Town FC',
    opponent: 'Kirkley & Pakefield',
    homeAway: 'away',
    homeScore: 1,
    awayScore: 5,
  }

  assert.equal(getMatchDayDisplayName(match), 'Kirkley & Pakefield v Cambourne Town FC')
  assert.equal(getMatchDayDisplayScore(match), '1 - 5')
  assert.deepEqual(
    [getMatchDayDisplayParts(match).firstTeam, getMatchDayDisplayParts(match).firstScore],
    ['Kirkley & Pakefield', 1],
  )
  assert.deepEqual(
    [getMatchDayDisplayParts(match).secondTeam, getMatchDayDisplayParts(match).secondScore],
    ['Cambourne Town FC', 5],
  )
})

test('home results and intentional fixture titles keep their existing display', () => {
  const home = {
    title: 'Cambourne Town FC v Norwich City Girls Academy U16',
    clubName: 'Cambourne Town FC',
    opponent: 'Norwich City Girls Academy U16',
    homeAway: 'home',
    homeScore: 8,
    awayScore: 1,
  }

  assert.equal(getMatchDayDisplayName(home), home.title)
  assert.equal(getMatchDayDisplayScore(home), '8 - 1')
  assert.equal(getMatchDayDisplayName({ ...home, homeAway: 'away', title: 'Cup semi-final' }), 'Cup semi-final')
})
