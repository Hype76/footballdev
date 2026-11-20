import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { PlayerDetailsSection } from './src/components/players/PlayerDetailsSection.jsx'
import { PlayersListSection } from './src/components/players/PlayersListSection.jsx'
const states = { linked: 'linked', invited: 'awaiting_acceptance', unlinked: 'not_invited', unavailable: 'unavailable' }
const players = Object.keys(states).map(id => ({ id, playerId: id, playerName: id, section: 'Squad', team: 'Fixture team', status: 'active', contactType: 'both', parentContacts: [{ type: 'self', name: id + ' Player', email: id + '@example.test' }, { type: 'parent', name: id + ' Parent', email: id + '-parent@example.test' }], positions: [], latestScore: null, averageScore: null, totalEvaluations: 0 }))
const links = Object.fromEntries(players.map(p => [p.id, [{ id: p.id + '-parent-link', email: p.id + '-parent@example.test', status: 'active', linkType: 'parent' }]]))
createRoot(document.getElementById('root')).render(<MemoryRouter><div id="details"><PlayerDetailsSection profilePlayers={players} playerDrafts={{}} adultLinkStatuses={states} parentPortalLinksByPlayerId={links} selectedDirectInviteDates={{}} getDirectEmailTemplateOptions={() => []} getSelectedDirectEmailTemplateOption={() => null}/></div><div id="list"><PlayersListSection adultLinkStatuses={states} filteredPlayers={players} paginatedPlayers={{items: players}} pageSize={12} playerPage={1} urlSection="All" viewFilter="all" searchTerm="" /></div></MemoryRouter>)
`
const built = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.webp': 'dataurl' } })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('http://127.0.0.1/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const contacts = page.getByRole('region', { name: 'Player contacts' })
  await contacts.first().waitFor()
  for (const [index, id] of ['linked', 'invited', 'unlinked', 'unavailable'].entries()) {
    const group = contacts.nth(index)
    const self = group.locator('div').filter({ has: page.getByText('Contact: ' + id + ' Player', { exact: true }) }).last()
    const parent = group.locator('div').filter({ has: page.getByText('Contact: ' + id + ' Parent', { exact: true }) }).last()
    assert.equal(await self.getByText('Player account linked', { exact: true }).count(), id === 'linked' ? 1 : 0, id + ' contact')
    assert.equal(await parent.getByText('Player account linked', { exact: true }).count(), 0, id + ' parent')
    assert.equal(await parent.getByText('Parent portal linked', { exact: true }).count(), 1, id + ' parent access')
    const row = page.locator('#list [data-player-card="' + id + '"]')
    assert.equal(await row.getByText('Player account linked', { exact: true }).count(), id === 'linked' ? 1 : 0, id + ' list')
  }
  console.log('PASS linked, invited, unlinked and unavailable statuses on Contacts and Players list; all Parent links preserved')
} finally { await browser.close() }
