import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const coachHomeUrl = new URL('../src/pages/CoachHomePage.jsx', import.meta.url)

test('latest player note cards link to the player profile with accessible focus styling', async () => {
  const source = await readFile(coachHomeUrl, 'utf8')
  const start = source.indexOf('<h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Latest player notes</h2>')
  const end = source.indexOf('{!isLoading && recentEvaluations.length === 0', start)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const latestNotesSection = source.slice(start, end)

  assert.match(latestNotesSection, /<Link/)
  assert.match(latestNotesSection, /to=\{`\/player\/\$\{encodeURIComponent\(evaluation\.playerName\)\}`\}/)
  assert.match(latestNotesSection, /Open player profile/)
  assert.match(latestNotesSection, /focus:outline-none/)
  assert.match(latestNotesSection, /focus:ring-2/)
  assert.doesNotMatch(latestNotesSection, /<button/)
})
