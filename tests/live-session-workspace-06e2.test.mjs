import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const routerSource = await readFile(new URL('../src/app/router.jsx', import.meta.url), 'utf8')
const sessionsPageSource = await readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')
const playersSectionSource = await readFile(new URL('../src/components/sessions/SessionPlayersSection.jsx', import.meta.url), 'utf8')

test('live session route uses the focused queue workspace', () => {
  assert.match(routerSource, /path: 'sessions\/start'[\s\S]*<SessionsPage liveOnly \/>/)
  assert.match(sessionsPageSource, /liveOnly \? \([\s\S]*<LiveSessionPlanningCard/)
  assert.match(sessionsPageSource, /liveOnly \? \([\s\S]*aria-label="Live session summary"/)
  assert.match(sessionsPageSource, /compactMode=\{liveOnly\}/)
})

test('live workspace keeps calendar and history capabilities available', () => {
  assert.match(sessionsPageSource, /onOpenCalendar=\{\(\) => navigate\('\/calendar'\)\}/)
  assert.match(sessionsPageSource, /onOpenHistory=\{\(\) => navigate\('\/sessions\/previous'\)\}/)
  assert.match(sessionsPageSource, /liveOnly \? \([\s\S]*\) : \([\s\S]*<FootballCalendar/)
})

test('focused player selection uses URL state and browser history', () => {
  assert.match(sessionsPageSource, /searchParams\.get\('queuePlayerId'\)/)
  assert.match(sessionsPageSource, /nextSearchParams\.set\('queuePlayerId', nextPlayerId\)/)
  assert.match(sessionsPageSource, /setSearchParams\(nextSearchParams\)/)
  assert.match(playersSectionSource, /value=\{focusedPlayer\?\.id \|\| ''\}/)
  assert.match(playersSectionSource, /onFocusedPlayerChange\(event\.target\.value\)/)
})

test('compact queue renders one player while the full queue remains available', () => {
  assert.match(playersSectionSource, /compactMode \? \([\s\S]*<SessionPlayerCard[\s\S]*player=\{focusedPlayer\}/)
  assert.match(playersSectionSource, /\) : \([\s\S]*paginatedPlayers\.items\.map/)
  assert.match(playersSectionSource, /<Pagination/)
  assert.match(playersSectionSource, /Record all/)
  assert.match(playersSectionSource, /Team voice note/)
  assert.match(playersSectionSource, /Clear session/)
})
