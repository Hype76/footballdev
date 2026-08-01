import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  normalizePlayerProfilePanel,
  normalizePlayerProfileSection,
  playerProfilePanels,
  playerProfileSections,
} from '../src/lib/player-profile-workspace.js'

const pageUrl = new URL('../src/pages/PlayerProfile.jsx', import.meta.url)
const navUrl = new URL('../src/components/players/PlayerProfileWorkspaceNav.jsx', import.meta.url)

test('player profile defaults safely and exposes every focused workspace route', () => {
  assert.equal(normalizePlayerProfileSection(), 'overview')
  assert.equal(normalizePlayerProfileSection('unknown'), 'overview')
  assert.equal(normalizePlayerProfileSection('records'), 'records')
  assert.deepEqual(playerProfileSections.map((section) => section.key), [
    'overview',
    'development',
    'details',
    'communication',
    'records',
  ])
  assert.equal(normalizePlayerProfilePanel('development'), 'progression')
  assert.equal(normalizePlayerProfilePanel('communication', 'chat'), 'chat')
  assert.equal(normalizePlayerProfilePanel('records', 'invalid'), 'history')
  assert.deepEqual(playerProfilePanels.records.map((panel) => panel.key), ['history', 'activity', 'merge'])
})

test('workspace navigation is accessible and URL addressable', async () => {
  const [pageSource, navSource] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(navUrl, 'utf8'),
  ])

  assert.match(navSource, /aria-label="Player profile sections"/)
  assert.match(navSource, /aria-current=\{isActive \? 'page'/)
  assert.match(navSource, /aria-pressed=\{isActive\}/)
  assert.match(pageSource, /searchParams\.get\('view'\)/)
  assert.match(pageSource, /searchParams\.get\('panel'\)/)
  assert.match(pageSource, /new URLSearchParams\(searchParams\)/)
  assert.match(pageSource, /nextParams\.set\('view', nextSection\)/)
  assert.match(pageSource, /nextParams\.set\('panel', nextPanel\)/)
})

test('focused rendering preserves all player profile capabilities without stacking them', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /activeProfileSection === 'overview' \? \([\s\S]{0,80}<PlayerOverview/)
  assert.match(source, /activeProfileSection === 'development' && activeProfilePanel === 'progression'/)
  assert.match(source, /activeProfileSection === 'development' && activeProfilePanel === 'elite'/)
  assert.match(source, /activeProfileSection === 'details' \? \([\s\S]{0,80}<PlayerDetailsSection/)
  assert.match(source, /activeProfileSection === 'communication' && activeProfilePanel === 'resources'/)
  assert.match(source, /activeProfileSection === 'communication' && activeProfilePanel === 'chat'/)
  assert.match(source, /activeProfileSection === 'records' && activeProfilePanel === 'merge' && canMergeEvaluations/)
  assert.match(source, /activeProfileSection === 'records' && activeProfilePanel === 'activity'/)
  assert.match(source, /activeProfileSection === 'records' && activeProfilePanel === 'history'/)
  assert.match(source, /<PlayerProfileModals/)
})
