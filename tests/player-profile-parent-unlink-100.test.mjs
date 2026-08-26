import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const playerProfileUrl = new URL('../src/pages/PlayerProfile.jsx', import.meta.url)
const playerDetailsUrl = new URL('../src/components/players/PlayerDetailsSection.jsx', import.meta.url)
const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)

test('Player details restores a visible removal action for each active Parent link', async () => {
  const source = await readFile(playerDetailsUrl, 'utf8')

  assert.match(source, /String\(link\?\.status[\s\S]*=== 'active'/)
  assert.match(source, /normalizeParentPortalInviteEmail\(link\?\.email\) === email/)
  assert.match(source, /onClick=\{\(\) => onRemoveParentPortalAccess\(activeParentLink\)\}/)
  assert.match(source, /Remove Parent access/)
})

test('Player profile waits for confirmation, removes the saved link immediately, and treats refresh as non-fatal', async () => {
  const source = await readFile(playerProfileUrl, 'utf8')

  assert.match(source, /title="Remove Parent access"/)
  assert.match(source, /does not delete the Parent account or affect access to any other children/)
  assert.match(source, /await revokeParentPortalLink\(\{[\s\S]*linkId: revokeTarget\.id,[\s\S]*playerId: revokeTarget\.playerId/)
  assert.match(source, /setParentPortalLinksByPlayerId\([\s\S]*\.filter\(\(link\) => String\(link\?\.id\) !== String\(revokeTarget\.id\)\)/)
  assert.match(source, /await refreshParentPortalLinksForPlayer\(revokeTarget\.playerId\)[\s\S]*catch \(refreshError\)/)
  assert.match(source, /errorMessage=\{parentPortalRevokeError\}/)
  assert.match(source, /onConfirm=\{confirmRemoveParentPortalAccess\}/)
  assert.doesNotMatch(source, /onConfirm=\{\(\) => void confirmRemoveParentPortalAccess\(\)\}/)
  assert.match(source, /setParentPortalRevokeTarget\(null\)/)
})

test('revocation removes only the selected relationship and never deletes an Auth account', async () => {
  const source = await readFile(parentPortalDomainUrl, 'utf8')
  const start = source.indexOf('export async function revokeParentPortalLink')
  const end = source.indexOf('export async function getFamilyLinksForParentLink', start)
  const revokeSource = source.slice(start, end)

  assert.match(revokeSource, /\.from\('parent_player_links'\)[\s\S]*\.update\(\{[\s\S]*status: 'revoked'/)
  assert.match(revokeSource, /auth_user_id: null/)
  assert.match(revokeSource, /\.eq\('id', normalizedLinkId\)/)
  assert.match(revokeSource, /\.neq\('status', 'revoked'\)/)
  assert.match(revokeSource, /query = query\.eq\('player_id', normalizedPlayerId\)/)
  assert.match(revokeSource, /\.maybeSingle\(\)/)
  assert.match(revokeSource, /if \(!data\?\.id\)/)
  assert.doesNotMatch(revokeSource, /auth\.admin|deleteUser|\.delete\(\)/)
})
