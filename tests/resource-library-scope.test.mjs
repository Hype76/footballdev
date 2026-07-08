import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const domainUrl = new URL('../src/lib/domain/resource-library.js', import.meta.url)
const pageUrl = new URL('../src/pages/ResourceLibraryPage.jsx', import.meta.url)

test('Resource Library client helpers require active team context', async () => {
  const source = await readFile(domainUrl, 'utf8')

  assert.match(source, /function getActiveResourceTeamId\(user\)/)
  assert.match(source, /Choose a team before opening the Team Resource Library/)
  assert.match(source, /query = query\.eq\('team_id', normalizedTeamId\)/)
  assert.match(source, /\$\{user\.clubId\}\/\$\{normalizedTeamId\}\/\$\{resourceId\}/)
  assert.match(source, /\.eq\('team_id', activeTeamId\)/)
  assert.match(source, /Team resources can only be assigned inside the active team/)
  assert.doesNotMatch(source, /team_id\.is\.null/)
  assert.doesNotMatch(source, /teamId \|\| null/)
})

test('Resource Library page uses the active team as the only V1 library context', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /const activeTeamId = String\(user\?\.activeTeamId/)
  assert.match(page, /Team scope/)
  assert.match(page, /activeTeamName/)
  assert.match(page, /getResourceLibraryItems\(\{ user, \.\.\.filters, teamId: activeTeamId \}\)/)
  assert.match(page, /\['team', 'squad'\]\.includes\(linkedType\) \? activeTeamId : ''/)
  assert.match(page, /filteredPlayers\.map\(\(player\) => \(\{/)
  assert.doesNotMatch(page, /Club-wide/)
  assert.doesNotMatch(page, /shared club/i)
})
