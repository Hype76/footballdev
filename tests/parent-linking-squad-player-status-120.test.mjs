import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const parentLinkingPageUrl = new URL('../src/pages/ParentLinkingPage.jsx', import.meta.url)

test('Parent Invites includes every non-archived Squad player regardless of active or promoted status', async () => {
  const [domain, page] = await Promise.all([
    readFile(parentPortalDomainUrl, 'utf8'),
    readFile(parentLinkingPageUrl, 'utf8'),
  ])
  const start = domain.indexOf('export async function getParentLinkingPlayers')
  const end = domain.indexOf('export async function getParentLinksForPlayer', start)
  const loader = domain.slice(start, end)
  assert.match(loader, /getPlayers\(\{ user, section: 'Squad' \}\)/)
  assert.doesNotMatch(loader, /status:\s*'active'/)
  assert.match(page, /filter\(isSquadPlayer\)/)
})
