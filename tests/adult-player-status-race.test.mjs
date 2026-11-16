import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('saving refreshes adult account status after the invitation finishes', async () => {
  const source = await readFile(new URL('../src/pages/PlayerProfile.jsx', import.meta.url), 'utf8')
  const start = source.indexOf('  const handleSavePlayer = async (playerId) => {')
  const end = source.indexOf('  const handlePromotePlayer =', start)
  assert.ok(start >= 0 && end > start)
  let release
  const sending = new Promise(resolve => { release = resolve })
  let refreshes = 0
  const player = { id: 'p', playerName: 'Adult', contactType: 'self', dateOfBirth: '1990-01-01', parentContacts: [{ type: 'self', email: 'a@example.test' }] }
  const dependencies = {
    playerDrafts: { p: player }, playerSaveLock: { current: false }, setIsSavingPlayer: () => {}, setErrorMessage: () => {},
    isAdultPlayerBirthDate: () => true, updatePlayer: async () => player, user: {}, getEditableParentContacts: () => player.parentContacts,
    players: [player], setPlayers: () => {}, setPlayerDrafts: () => {}, createPlayerDraft: value => value, writeViewCache: () => {}, cacheKey: '', evaluations: [],
    getAdultPlayerSetupEmail: () => 'a@example.test', canUseUiFeature: () => false, CAPABILITIES: {}, sendParentPortalInvitesForPlayer: async () => [],
    sendAdultPlayerSetupInvite: () => sending, getPlayerParentInviteContacts: () => [], refreshParentPortalLinksForPlayer: async () => {},
    routePlayerName: 'Adult', setEditingPlayerId: () => {}, navigate: () => {}, buildPlayerProfilePath: () => '', showToast: () => {},
    setAdultStatusRefresh: change => { refreshes = change(refreshes) },
  }
  const save = new Function(...Object.keys(dependencies), `${source.slice(start, end)}; return handleSavePlayer`)(...Object.values(dependencies))
  const pending = save('p')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(refreshes, 0, 'a status read can complete before the send does')
  release({ state: 'sent' })
  await pending
  assert.equal(refreshes, 1, 'the completed send triggers a fresh status read')
})
