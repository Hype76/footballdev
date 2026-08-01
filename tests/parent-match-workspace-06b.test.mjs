import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/pages/ParentPortalPage.jsx', import.meta.url), 'utf8')
const panelStart = source.indexOf('function ParentMatchCardsPanel')
const panelEnd = source.indexOf('function ParentResultsPanel', panelStart)
const panelSource = source.slice(panelStart, panelEnd)
const cardStart = source.indexOf('function ParentMatchCard')
const cardEnd = source.indexOf('function ParentShootoutControls', cardStart)
const cardSource = source.slice(cardStart, cardEnd)

test('Parent matches uses one focused detail instead of stacking every full card', () => {
  assert.match(panelSource, /const selectedMatch = requestedMatch \?\? visibleActiveMatches\[0\]/)
  assert.match(panelSource, /<ParentMatchCard[\s\S]*match=\{selectedMatch\}/)
  assert.doesNotMatch(panelSource, /visibleActiveMatches\.map\([\s\S]{0,800}<ParentMatchCard/)
  assert.match(panelSource, /md:grid-cols-\[minmax\(15rem,20rem\)_minmax\(0,1fr\)\]/)
})

test('Parent matches keeps a mobile list and explicit focused-detail path', () => {
  assert.match(panelSource, /showMobileDetail \? 'hidden md:block' : 'block'/)
  assert.match(panelSource, /showMobileDetail \? 'block' : 'hidden md:block'/)
  assert.match(panelSource, />\s*Back to matches\s*</)
  assert.match(source, /nextSearchParams\.set\('matchDayId', match\.id\)/)
  assert.match(source, /nextSearchParams\.delete\('matchDayId'\)/)
})

test('Parent matches prioritises response needs and exposes bounded history', () => {
  assert.match(panelSource, /parentMatchRequiresResponse/)
  assert.match(panelSource, /Response needs attention/)
  assert.match(panelSource, /md:max-h-\[42rem\] md:overflow-y-auto/)
  assert.match(panelSource, /onOpenSection\('results'\)/)
  assert.match(panelSource, /Previous matches/)
})

test('Focused match keeps response, team, role, scoring and timeline capabilities', () => {
  assert.match(cardSource, /Your fixture response/)
  assert.match(cardSource, /Review response/)
  assert.match(cardSource, />Confirmed Team</)
  assert.match(cardSource, /Volunteer role status/)
  assert.match(cardSource, /Open Game Mode/)
  assert.match(cardSource, /Update score/)
  assert.match(cardSource, /Add goal/)
  assert.match(cardSource, /Match timeline/)
})

test('Child switching clears focused match state before loading another child', () => {
  const handlerStart = source.indexOf('const handleParentLinkSelect')
  const handlerEnd = source.indexOf('const handleOpenDevelopmentReport', handlerStart)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.match(handlerSource, /setScorerGameModeMatchId\(''\)/)
  assert.match(handlerSource, /nextSearchParams\.delete\('matchDayId'\)/)
})
