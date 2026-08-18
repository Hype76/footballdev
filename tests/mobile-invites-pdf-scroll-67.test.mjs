import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { resolveDevelopmentParentReport } from '../netlify/functions/lib/_development-parent-email-output.js'

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('Parent report reconstruction includes every Parent-visible saved field and excludes Coach-private fields', () => {
  const report = resolveDevelopmentParentReport({
    club: { id: 'club', name: 'Club' },
    team: { id: 'team', name: 'Team' },
    player: { id: 'player', player_name: 'Player' },
    evaluation: {
      id: 'evaluation',
      club_id: 'club',
      team_id: 'team',
      player_id: 'player',
      form_responses: {
        Technical: 8,
        'Parent summary': 'Strong progress.',
        'Coach private note': 'Do not share.',
      },
      feedback_form_snapshot: {
        fields: [
          { id: 'technical', label: 'Technical', type: 'score_1_10', parentVisible: true },
          { id: 'summary', label: 'Parent summary', type: 'textarea', parentVisible: true },
          { id: 'private', label: 'Coach private note', type: 'textarea', parentVisible: false },
        ],
      },
    },
    requestedResponses: undefined,
  })

  assert.deepEqual(report.responseItems.map((item) => item.label), [
    'Technical',
    'Parent summary',
  ])
  assert.doesNotMatch(JSON.stringify(report), /Do not share|Coach private note/)
})

test('mobile invite response reports selected, created, existing, and unresolved counts honestly', async () => {
  const [dataSource, screenSource, serverSource] = await Promise.all([
    readSource('../apps/mobile-core/src/coachPhase31EData.js'),
    readSource('../apps/coach-mobile/src/CoachPhase31EScreens.js'),
    readSource('../netlify/functions/send-match-day-availability-requests.js'),
  ])

  assert.match(dataSource, /selectedPlayerCount:\s*Number\(result\?\.selectedPlayerCount/)
  assert.match(dataSource, /createdPlayerCount:\s*Number\(result\?\.createdPlayerCount/)
  assert.match(screenSource, /createdCount\}\sof\s\$\{selectedCount\}/)
  assert.match(serverSource, /unresolvedPlayerIds/)
  assert.match(serverSource, /from\('player_team_memberships'\)/)
  assert.match(serverSource, /authorisedPlayerIds/)
  assert.doesNotMatch(serverSource, /normalizeText\(player\.team_id\) !== teamId/)
})

test('Parent Home removes read notifications from the feed and its offline cache', async () => {
  const [appSource, offlineSource] = await Promise.all([
    readSource('../apps/parent-mobile/App.js'),
    readSource('../apps/parent-mobile/src/offline.js'),
  ])

  assert.match(appSource, /notifications\.items\.filter\(\(notification\) => !notification\.isRead\)/)
  assert.match(appSource, /markParentOfflineNotificationRead/)
  assert.match(offlineSource, /export async function markParentOfflineNotificationRead/)
  assert.match(offlineSource, /isRead:\s*true/)
})

test('Parent refresh keeps the current layout after initial hydration and waits for active interactions', async () => {
  const appSource = await readSource('../apps/parent-mobile/App.js')

  assert.match(appSource, /hydratedScopeRef/)
  assert.match(appSource, /shouldHydrateCache/)
  assert.match(appSource, /InteractionManager\.runAfterInteractions/)
})

test('Development PDF caches stable files, keeps iOS files alive, and repairs old empty snapshots', async () => {
  const [mobileSource, serverSource, outputSource] = await Promise.all([
    readSource('../apps/parent-mobile/parentDevelopment.js'),
    readSource('../netlify/functions/parent-development-history.js'),
    readSource('../netlify/functions/lib/_development-parent-email-output.js'),
  ])

  assert.match(mobileSource, /reportId.*finalizedAt/s)
  assert.match(mobileSource, /FileSystem\.moveAsync/)
  assert.match(mobileSource, /if \(await isUsablePdf\(destination\)\)/)
  assert.doesNotMatch(mobileSource, /finally\s*\{[\s\S]*deleteAsync\(destination/)
  assert.match(serverSource, /repairEmptyReportSnapshot/)
  assert.match(serverSource, /parentDevelopmentPdfCache/)
  assert.match(serverSource, /requestedResponses:\s*undefined/)
  assert.doesNotMatch(outputSource, /profile,\s*requestedResponses\s*=\s*\[\]/)
})
