import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { filterCoachPlayers, normalizeCoachPlayer } from '../apps/mobile-core/src/coachPlayersCore.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('active Coach rosters include current promoted Players and exclude archived Players', () => {
  const players = [
    normalizeCoachPlayer({ id: 'active', player_name: 'Active Player', status: 'active' }),
    normalizeCoachPlayer({ id: 'promoted', player_name: 'Promoted Player', status: 'promoted' }),
    normalizeCoachPlayer({ id: 'archived', player_name: 'Archived Player', status: 'archived' }),
  ]

  assert.deepEqual(
    filterCoachPlayers(players, { status: 'active' }).map((player) => player.id),
    ['active', 'promoted'],
  )
  assert.deepEqual(
    filterCoachPlayers(players, { status: 'archived' }).map((player) => player.id),
    ['archived'],
  )
})

test('Parent Calendar response buttons expose and render the saved selection', async () => {
  const screen = await read('../apps/parent-mobile/src/ParentPortalScreens.js')

  assert.match(screen, /accessibilityState=\{\{ disabled, selected \}\}/)
  assert.match(screen, /selected=\{invitation\.responseState === option\.value\}/)
  assert.match(screen, /styles\.actionSelected/)
  assert.match(screen, /styles\.actionTextSelected/)
})

test('Coach Resources can assign one Resource to every unassigned active Player in one request', async () => {
  const screen = await read('../apps/coach-mobile/src/CoachPhase31EScreens.js')

  assert.match(screen, /const assignAllPlayers = async \(\) =>/)
  assert.match(screen, /setCoachResourceSharing\(user, selected, unassignedPlayers\.map/)
  assert.match(screen, /label=\{assigning \? 'Assigning Players\.\.\.' : 'Assign to all Players'\}/)
})

test('Coach scrolling clamps an invalid offset after Poll content becomes shorter', async () => {
  const app = await read('../apps/coach-mobile/App.js')

  assert.match(app, /const maximumOffset = Math\.max\(0, contentHeightRef\.current - viewportHeightRef\.current\)/)
  assert.match(app, /contentScrollRef\.current\?\.scrollTo\(\{ animated: false, y: maximumOffset \}\)/)
  assert.match(app, /onContentSizeChange=/)
  assert.match(app, /bounces=\{false\}/)
  assert.match(app, /overScrollMode="never"/)
})

test('Parent notification responses remain consumed across app restarts', async () => {
  const app = await read('../apps/parent-mobile/App.js')

  assert.match(app, /PARENT_NOTIFICATION_RESPONSE_HISTORY_PREFIX/)
  assert.match(app, /AsyncStorage\.getItem\(notificationResponseHistoryKey\)/)
  assert.match(app, /AsyncStorage\.setItem\(notificationResponseHistoryKey, JSON\.stringify\(recentIds\)\)/)
  assert.match(app, /notificationResponseHistoryRef\.current\.has\(responseId\)/)
  assert.match(app, /Notifications\.clearLastNotificationResponseAsync\(\)/)
})

test('corrective release identity advances both native apps and authorises only guarded production candidates', async () => {
  const [buildGuard, submitGuard, coachConfig, coachPackage, parentConfig, parentPackage] = await Promise.all([
    read('../apps/scripts/mobile-build-guard.mjs'),
    read('../apps/scripts/mobile-submit-guard.mjs'),
    read('../apps/coach-mobile/app.config.js'),
    read('../apps/coach-mobile/package.json'),
    read('../apps/parent-mobile/app.config.js'),
    read('../apps/parent-mobile/package.json'),
  ])

  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-CORRECTIVE-70/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-CORRECTIVE-70/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-CORRECTIVE-70'/)
  assert.match(coachConfig, /version: '1\.0\.20'/)
  assert.equal(JSON.parse(coachPackage).version, '1.0.20')
  assert.match(parentConfig, /version: '1\.0\.17'/)
  assert.equal(JSON.parse(parentPackage).version, '1.0.17')
  assert.match(submitGuard, /submitArgs\.push\('--groups', 'Internal Testers'\)/)
})
