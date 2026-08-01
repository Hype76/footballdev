import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const routerSource = await readFile(new URL('../src/app/router.jsx', import.meta.url), 'utf8')
const sessionsPageSource = await readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')
const historyWorkspaceSource = await readFile(new URL('../src/components/sessions/PreviousSessionsWorkspace.jsx', import.meta.url), 'utf8')

test('previous sessions route uses the focused history workspace', () => {
  assert.match(routerSource, /path: 'sessions\/previous'[\s\S]*<SessionsPage historyOnly \/>/)
  assert.match(sessionsPageSource, /if \(historyOnly\) \{[\s\S]*<PreviousSessionsWorkspace/)
  assert.doesNotMatch(historyWorkspaceSource, /FootballCalendar|SessionPlayersSection|CreateSessionSection|CoachOptionsSection/)
})

test('history selection keeps direct links and browser history', () => {
  assert.match(sessionsPageSource, /setSearchParams\(getOpenSessionSearchParams\(searchParams, nextSessionId\), \{ replace: !historyOnly \}\)/)
  assert.match(historyWorkspaceSource, /value=\{selectedSession\?\.id \|\| ''\}/)
  assert.match(historyWorkspaceSource, /onChange=\{\(event\) => onOpenSession\(event\.target\.value\)\}/)
  assert.match(historyWorkspaceSource, /<Link to=\{workspaceHref\}/)
})

test('history workspace keeps session capabilities available from the full workspace', () => {
  assert.match(historyWorkspaceSource, /to="\/sessions\/start\?action=create-session"/)
  assert.match(historyWorkspaceSource, /Open session workspace/)
  assert.match(historyWorkspaceSource, /attendance, coach notes, player records, completion, and session controls/)
  assert.match(sessionsPageSource, /workspaceHref=\{selectedSessionWorkspaceHref\}/)
})
