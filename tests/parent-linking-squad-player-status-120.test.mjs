import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const parentLinkingPageUrl = new URL('../src/pages/ParentLinkingPage.jsx', import.meta.url)

test('Parent Invites includes every active Trial and Squad player', async () => {
  const [domain, page] = await Promise.all([
    readFile(parentPortalDomainUrl, 'utf8'),
    readFile(parentLinkingPageUrl, 'utf8'),
  ])
  const start = domain.indexOf('export async function getParentLinkingPlayers')
  const end = domain.indexOf('export async function getParentLinksForPlayer', start)
  const loader = domain.slice(start, end)
  assert.match(loader, /return getPlayers\(\{ user \}\)/)
  assert.doesNotMatch(loader, /status:\s*'active'/)
  assert.match(page, /filter\(isEligiblePlayer\)/)
  assert.match(page, /\['trial', 'squad'\]\.includes\(section\)/)
})
