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
  getPlayerProfileResolutionDiagnostics,
  getProfilePlayers,
  getScopedProfilePlayers,
  isSavedPlayerProfileSource,
  isPlayerInRequestedProfileScope,
  normalizePlayerProfileSource,
  requiresSavedPlayerTeamScope,
} from '../src/hooks/players/playerProfileUtils.js'

const playerProfileUrl = new URL('../src/pages/PlayerProfile.jsx', import.meta.url)
const playersPageUrl = new URL('../src/pages/PlayersPage.jsx', import.meta.url)
const playersListSectionUrl = new URL('../src/components/players/PlayersListSection.jsx', import.meta.url)
const recentlyAddedPlayersSectionUrl = new URL('../src/components/players/RecentlyAddedPlayersSection.jsx', import.meta.url)
const playerDetailsSectionUrl = new URL('../src/components/players/PlayerDetailsSection.jsx', import.meta.url)
const playerProfileActionsUrl = new URL('../src/components/players/PlayerProfileActions.jsx', import.meta.url)
const coreDomainUrl = new URL('../src/lib/domain/core.js', import.meta.url)

test('squad and trial rows open player profiles with canonical saved player ids', () => {
  assert.equal(getPlayerProfileSourceForSection('Squad'), 'squad')
  assert.equal(getPlayerProfileSourceForSection('Trial'), 'trial')
  assert.equal(getPlayerProfileSourceForSection('Development'), '')

  assert.equal(
    buildPlayerProfilePath({
      clubId: 'club-123',
      playerId: 'player-123',
      playerName: 'U12 Tigers',
      section: 'Squad',
      teamId: 'team-123',
    }),
    '/player/U12%20Tigers?source=squad&playerId=player-123&teamId=team-123&clubId=club-123',
  )
  assert.equal(
    buildPlayerProfilePath({
      playerId: 'trial-456',
      playerName: 'Trial Player',
      section: 'Trial',
      teamId: 'trial-team',
    }),
    '/player/Trial%20Player?source=trial&playerId=trial-456&teamId=trial-team',
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

test('scoped profile resolution blocks wrong team data and duplicate membership ambiguity', () => {
  const user = { clubId: 'club-real', activeTeamId: '' }
  const demoPlayer = {
    id: 'player-shared',
    clubId: 'club-real',
    teamId: 'team-demo',
    playerName: 'Jenson Bailey',
    section: 'Squad',
    team: 'Demo Team',
    parentName: 'Demo Parent',
  }
  const realPlayer = {
    id: 'player-shared',
    clubId: 'club-real',
    teamId: 'team-u14',
    playerName: 'Jenson Bailey',
    section: 'Squad',
    team: 'U14 JPL 26/27',
    parentName: 'Real Parent',
  }

  assert.deepEqual(
    getScopedProfilePlayers([demoPlayer, realPlayer], {
      profileSource: 'squad',
      routePlayerId: 'player-shared',
      routeTeamId: 'team-u14',
      user,
    }),
    [realPlayer],
  )
  assert.deepEqual(
    getScopedProfilePlayers([demoPlayer], {
      profileSource: 'squad',
      routePlayerId: 'player-shared',
      routeTeamId: 'team-u14',
      user,
    }),
    [],
  )
  assert.equal(
    isPlayerInRequestedProfileScope(demoPlayer, {
      profileSource: 'squad',
      routePlayerId: 'player-shared',
      routeTeamId: 'team-u14',
      user,
    }),
    false,
  )
  assert.equal(
    requiresSavedPlayerTeamScope({
      players: [demoPlayer],
      profileSource: 'squad',
      routePlayerId: 'player-shared',
      routeTeamId: '',
      user,
    }),
    true,
  )
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

  const missingIdState = getPlayerDetailsEmptyState({
    profileSource: 'squad',
    routePlayerId: '',
  })
  assert.equal(missingIdState.title, 'Saved player link is incomplete.')
  assert.match(missingIdState.body, /will not guess by name/)

  const missingTeamState = getPlayerDetailsEmptyState({
    profileSource: 'squad',
    routePlayerId: 'player-1',
    isTeamScopeMissing: true,
  })
  assert.equal(missingTeamState.title, 'Saved player team scope is incomplete.')

  const mismatchState = getPlayerDetailsEmptyState({
    profileSource: 'squad',
    routePlayerId: 'player-1',
    isScopeMismatch: true,
  })
  assert.equal(mismatchState.title, 'Selected team player could not be matched.')
  assert.match(mismatchState.body, /could not be matched to the selected team/)

  const historyState = getPlayerDetailsEmptyState({
    profileSource: 'history',
    routePlayerId: '',
  })
  assert.equal(historyState.title, 'Saved player details are not attached yet.')
  assert.match(historyState.body, /opened from development history/)
})

test('profile diagnostics prove id lookup, missing id, loading, and history branches', () => {
  const squadPlayer = { id: 'squad-1', playerName: 'Alex', section: 'Squad' }

  assert.deepEqual(
    getPlayerProfileResolutionDiagnostics({
      players: [squadPlayer],
      profilePlayers: [squadPlayer],
      profileSource: 'squad',
      routePlayerId: 'squad-1',
      routePlayerName: 'Alex',
      shouldLoadSavedPlayerById: true,
    }),
    {
      lookupMode: 'saved-player-id',
      lookupResultCount: 1,
      missingStateBranch: 'resolved-saved-player',
      playerId: 'squad-1',
      routePlayerName: 'Alex',
      source: 'squad',
      teamId: '',
    },
  )

  assert.equal(
    getPlayerProfileResolutionDiagnostics({
      isLoading: true,
      players: [],
      profilePlayers: [],
      profileSource: 'squad',
      routePlayerId: 'squad-1',
      routePlayerName: 'Alex',
      shouldLoadSavedPlayerById: true,
    }).missingStateBranch,
    'saved-player-id-loading',
  )
  assert.equal(
    getPlayerProfileResolutionDiagnostics({
      players: [],
      profilePlayers: [],
      profileSource: 'squad',
      routePlayerId: '',
      routePlayerName: 'Alex',
      shouldLoadSavedPlayerById: false,
    }).missingStateBranch,
    'saved-player-id-missing',
  )
  assert.equal(
    getPlayerProfileResolutionDiagnostics({
      players: [],
      profilePlayers: [],
      profileSource: '',
      routePlayerId: '',
      routePlayerName: 'Alex',
      shouldLoadSavedPlayerById: false,
    }).missingStateBranch,
    'development-history-missing-details',
  )
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
  const [
    playersPageSource,
    playersListSectionSource,
    recentlyAddedPlayersSectionSource,
    playerProfileSource,
    playerDetailsSource,
    playerActionsSource,
    coreDomainSource,
  ] =
    await Promise.all([
      readFile(playersPageUrl, 'utf8'),
      readFile(playersListSectionUrl, 'utf8'),
      readFile(recentlyAddedPlayersSectionUrl, 'utf8'),
      readFile(playerProfileUrl, 'utf8'),
      readFile(playerDetailsSectionUrl, 'utf8'),
      readFile(playerProfileActionsUrl, 'utf8'),
      readFile(coreDomainUrl, 'utf8'),
    ])

  assert.doesNotMatch(playersPageSource, /useNavigate/)
  assert.match(playersListSectionSource, /const playerProfilePath = buildPlayerProfilePath\(player\)/)
  assert.match(playersListSectionSource, /data-player-card=\{player\.playerId \|\| getPlayerKey\(player\.playerName\)\}/)
  assert.match(playersListSectionSource, /data-player-card-content/)
  assert.match(playersListSectionSource, /block w-full px-6 py-4/)
  assert.match(playersListSectionSource, /sm:px-7/)
  assert.match(playersListSectionSource, /data-player-card-name/)
  assert.match(playersListSectionSource, /data-player-profile-href=\{playerProfilePath\}/)
  assert.match(playersListSectionSource, /to=\{playerProfilePath\}/)
  assert.match(recentlyAddedPlayersSectionSource, /to=\{buildPlayerProfilePath\(player\)\}/)
  assert.match(playerProfileSource, /useSearchParams/)
  assert.match(playerProfileSource, /const routeTeamId = String\(searchParams\.get\('teamId'\)/)
  assert.match(playerProfileSource, /playerId: shouldLoadSavedPlayerById \? routePlayerId : undefined/)
  assert.match(playerProfileSource, /teamId: shouldLoadSavedPlayerById \? scopedRouteTeamId : undefined/)
  assert.match(playerProfileSource, /playerName: isSavedPlayerProfileRoute \? undefined : routePlayerName/)
  assert.match(playerProfileSource, /getScopedProfilePlayers/)
  assert.match(playerProfileSource, /getPlayerProfileResolutionDiagnostics/)
  assert.match(playerProfileSource, /isLoadingPlayerDetails=/)
  assert.match(playerProfileSource, /navigate\(buildPlayerProfilePath\(savedPlayer\)\)/)
  assert.match(playerProfileSource, /canUseProfilePlayerActions/)
  assert.match(playerProfileSource, /Open a resolved saved player record before deleting\./)
  assert.match(playerDetailsSource, /Checking saved player details\./)
  assert.match(playerDetailsSource, /playerDetailsEmptyState\.title/)
  assert.match(playerActionsSource, /canDeletePlayer\(user\) && canUseSavedPlayerActions/)
  assert.match(coreDomainSource, /export async function getPlayers\(\{ user, section, playerId, playerName, teamId/)
  assert.match(coreDomainSource, /if \(normalizedTeamId\)/)
  assert.match(coreDomainSource, /query = query\.eq\('team_id', normalizedTeamId\)/)
  assert.match(coreDomainSource, /query = query\.eq\('id', normalizedPlayerId\)/)
})
