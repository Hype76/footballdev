import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  buildPlayerProfilePath,
  getPlayerProfileSourceForSection,
} from '../src/hooks/players/playersPageUtils.js'
import {
  canUseProfilePlayerActions,
  getPlayerDetailsEmptyState,
  getProfilePlayers,
  isSavedPlayerProfileSource,
  normalizePlayerProfileSource,
} from '../src/hooks/players/playerProfileUtils.js'

const playerProfileUrl = new URL('../src/pages/PlayerProfile.jsx', import.meta.url)
const playersPageUrl = new URL('../src/pages/PlayersPage.jsx', import.meta.url)
const playerDetailsSectionUrl = new URL('../src/components/players/PlayerDetailsSection.jsx', import.meta.url)
const playerProfileActionsUrl = new URL('../src/components/players/PlayerProfileActions.jsx', import.meta.url)
const coreDomainUrl = new URL('../src/lib/domain/core.js', import.meta.url)

test('squad and trial rows open player profiles with canonical saved player ids', () => {
  assert.equal(getPlayerProfileSourceForSection('Squad'), 'squad')
  assert.equal(getPlayerProfileSourceForSection('Trial'), 'trial')
  assert.equal(getPlayerProfileSourceForSection('Development'), '')

  assert.equal(
    buildPlayerProfilePath({
      playerId: 'player-123',
      playerName: 'U12 Tigers',
      section: 'Squad',
    }),
    '/player/U12%20Tigers?source=squad&playerId=player-123',
  )
  assert.equal(
    buildPlayerProfilePath({
      playerId: 'trial-456',
      playerName: 'Trial Player',
      section: 'Trial',
    }),
    '/player/Trial%20Player?source=trial&playerId=trial-456',
  )
  assert.equal(
    buildPlayerProfilePath({
      playerName: 'History Only',
      section: 'Development',
    }),
    '/player/History%20Only',
  )
})

test('profile player resolution prioritises the saved player id over name fallback', () => {
  const squadPlayer = { id: 'squad-1', playerName: 'Alex', section: 'Squad' }
  const trialPlayer = { id: 'trial-1', playerName: 'Alex', section: 'Trial' }

  assert.deepEqual(getProfilePlayers([trialPlayer, squadPlayer], { playerId: 'trial-1' }), [trialPlayer])
  assert.deepEqual(getProfilePlayers([trialPlayer, squadPlayer], { playerId: 'missing-player' }), [])
  assert.deepEqual(getProfilePlayers([trialPlayer, squadPlayer]), [squadPlayer])
})

test('source-aware empty states keep stale saved player links out of history mode', () => {
  assert.equal(normalizePlayerProfileSource('Squad'), 'squad')
  assert.equal(isSavedPlayerProfileSource('trial'), true)
  assert.equal(isSavedPlayerProfileSource('history'), false)

  const missingSavedPlayerState = getPlayerDetailsEmptyState({
    profileSource: 'squad',
    routePlayerId: 'missing-player',
  })
  assert.equal(missingSavedPlayerState.title, 'Saved player record could not be found.')
  assert.match(missingSavedPlayerState.body, /saved player record that is no longer available/)

  const historyState = getPlayerDetailsEmptyState({
    profileSource: 'history',
    routePlayerId: '',
  })
  assert.equal(historyState.title, 'Saved player details are not attached yet.')
  assert.match(historyState.body, /opened from development history/)
})

test('saved-player destructive actions require one resolved non-ambiguous player', () => {
  const squadPlayer = { id: 'squad-1', playerName: 'Alex', section: 'Squad' }
  const trialPlayer = { id: 'trial-1', playerName: 'Alex', section: 'Trial' }

  assert.equal(
    canUseProfilePlayerActions({
      players: [squadPlayer],
      profilePlayers: [squadPlayer],
      routePlayerId: '',
    }),
    true,
  )
  assert.equal(
    canUseProfilePlayerActions({
      players: [squadPlayer, trialPlayer],
      profilePlayers: [squadPlayer],
      routePlayerId: '',
    }),
    false,
  )
  assert.equal(
    canUseProfilePlayerActions({
      players: [squadPlayer, trialPlayer],
      profilePlayers: [trialPlayer],
      routePlayerId: 'trial-1',
    }),
    true,
  )
  assert.equal(
    canUseProfilePlayerActions({
      players: [],
      profilePlayers: [],
      routePlayerId: 'missing-player',
    }),
    false,
  )
})

test('runtime profile path uses id-scoped loading, safe empty state, and guarded delete action', async () => {
  const [playersPageSource, playerProfileSource, playerDetailsSource, playerActionsSource, coreDomainSource] =
    await Promise.all([
      readFile(playersPageUrl, 'utf8'),
      readFile(playerProfileUrl, 'utf8'),
      readFile(playerDetailsSectionUrl, 'utf8'),
      readFile(playerProfileActionsUrl, 'utf8'),
      readFile(coreDomainUrl, 'utf8'),
    ])

  assert.match(playersPageSource, /buildPlayerProfilePath\(player\)/)
  assert.match(playerProfileSource, /useSearchParams/)
  assert.match(playerProfileSource, /playerId: shouldLoadSavedPlayerById \? routePlayerId : undefined/)
  assert.match(playerProfileSource, /getPlayerDetailsEmptyState\(\{ profileSource, routePlayerId \}\)/)
  assert.match(playerProfileSource, /canUseProfilePlayerActions/)
  assert.match(playerProfileSource, /Open a resolved saved player record before deleting\./)
  assert.match(playerDetailsSource, /playerDetailsEmptyState\.title/)
  assert.match(playerActionsSource, /canDeletePlayer\(user\) && canUseSavedPlayerActions/)
  assert.match(coreDomainSource, /export async function getPlayers\(\{ user, section, playerId, playerName/)
  assert.match(coreDomainSource, /query = query\.eq\('id', normalizedPlayerId\)/)
})
