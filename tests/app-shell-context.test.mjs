import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const topbarUrl = new URL('../src/components/layout/Topbar.jsx', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)

test('logged-in topbar no longer owns workspace context controls', async () => {
  const source = await readFile(topbarUrl, 'utf8')
  const markupStart = source.indexOf('return (')
  assert.notEqual(markupStart, -1)
  const markup = source.slice(markupStart)

  assert.match(markup, /aria-label="Open navigation"/)
  assert.match(markup, /\{displayTitle\}/)
  assert.doesNotMatch(markup, />\s*View\s*</)
  assert.doesNotMatch(markup, />\s*Focus\s*</)
  assert.doesNotMatch(markup, />\s*Access view\s*</)
  assert.doesNotMatch(markup, />\s*Team tools\s*</)
  assert.doesNotMatch(markup, />\s*Settings\s*</)
  assert.doesNotMatch(markup, />\s*Sign out\s*</)
  assert.doesNotMatch(markup, /<select/)
})

test('sidebar owns workspace context, settings and sign out', async () => {
  const source = await readFile(sidebarUrl, 'utf8')

  assert.match(source, /const workspaceContext =/)
  assert.match(source, /const workLaneLabel =/)
  assert.match(source, /<option value="__team_access__">Team access<\/option>/)
  assert.match(source, /<option value="">Club admin view<\/option>/)
  assert.match(source, /<option key=\{team\.id\} value=\{team\.id\}>/)
  assert.match(source, /data-tour-id="sidebar-user-settings"/)
  assert.match(source, /to="\/user-settings"/)
  assert.match(source, /await signOut\(\)/)
  assert.match(source, /await selectTeam\(teamId\)/)
  assert.match(source, /navigate\('\/coach'\)/)
  assert.match(source, /navigate\('\/parent-portal'\)/)
})

test('mobile shell keeps navigation drawer as the access point for sidebar controls', async () => {
  const topbarSource = await readFile(topbarUrl, 'utf8')
  const sidebarSource = await readFile(sidebarUrl, 'utf8')

  assert.match(topbarSource, /aria-label="Open navigation"/)
  assert.match(sidebarSource, /aria-label="Close navigation"/)
  assert.match(sidebarSource, /w-\[min\(20\.5rem,calc\(100vw-1rem\)\)\]/)
  assert.match(sidebarSource, /overflow-y-auto/)
  assert.match(sidebarSource, /mt-auto space-y-3 pt-4/)
})
