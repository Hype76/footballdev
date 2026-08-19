import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('mobile connection warnings wait for a confirmed 30 second outage', async () => {
  const connection = await import(new URL('apps/mobile-core/src/useConfirmedConnectionIssue.js', root).href)
  const [coachApp, coachMatchDay, coachOperational, coachDomains, parentApp, parentScreens] = await Promise.all([
    readFile(new URL('apps/coach-mobile/App.js', root), 'utf8'),
    readFile(new URL('apps/coach-mobile/src/CoachMatchDayScreen.js', root), 'utf8'),
    readFile(new URL('apps/coach-mobile/src/CoachOperationalScreens.js', root), 'utf8'),
    readFile(new URL('apps/coach-mobile/src/CoachPhase31EScreens.js', root), 'utf8'),
    readFile(new URL('apps/parent-mobile/App.js', root), 'utf8'),
    readFile(new URL('apps/parent-mobile/src/ParentPortalScreens.js', root), 'utf8'),
  ])

  assert.equal(connection.CONNECTION_ISSUE_GRACE_PERIOD_MS, 30000)
  assert.equal(connection.isTransientConnectionMessage('No connection. Check your network and try again.'), true)
  assert.equal(connection.isTransientConnectionMessage('Network request failed'), true)
  assert.equal(connection.isTransientConnectionMessage('You are not authorised.'), false)
  assert.match(coachMatchDay, /useConfirmedConnectionMessage\(error\)/)
  assert.match(coachOperational, /useConfirmedConnectionIssue\(stale\)/)
  assert.match(coachDomains, /useConfirmedConnectionMessage\(error\)/)
  assert.match(parentApp, /useConfirmedConnectionIssue\(isOffline\)/)
  assert.match(parentScreens, /useConfirmedConnectionMessage\(messages\.error\)/)
  assert.match(coachApp, /contentInsetAdjustmentBehavior="never"/)
  assert.match(coachApp, /onMomentumScrollEnd=\{clampContentScroll\}/)
  assert.match(coachApp, /onScrollEndDrag=\{clampContentScroll\}/)
})

test('Coach invites include upcoming Training availability and canonical request identity', async () => {
  const [dataSource, screenSource] = await Promise.all([
    readFile(new URL('apps/mobile-core/src/coachPhase31EData.js', root), 'utf8'),
    readFile(new URL('apps/coach-mobile/src/CoachPhase31EScreens.js', root), 'utf8'),
  ])

  assert.match(dataSource, /calendar_event_id: request\?\.calendar_event_id/)
  assert.match(screenSource, /Choose an upcoming Match or Training session to see its availability/)
  assert.match(screenSource, /Training \| \{group\.occurrenceDate/)
  assert.match(screenSource, /Existing request identity is reused/)
  assert.match(screenSource, /Players who already responded are excluded and cannot be resent/)
})

test('all user-facing goal controls use UK Penalty wording', async () => {
  const sources = await Promise.all([
    'apps/coach-mobile/src/CoachMatchDayScreen.js',
    'src/pages/MatchDayPage.jsx',
    'src/pages/ParentPortalPage.jsx',
    'src/lib/matchday-final-report.js',
    'src/lib/matchday-report-export.js',
  ].map((path) => readFile(new URL(path, root), 'utf8')))

  for (const source of sources) assert.doesNotMatch(source, /Penalty goal/)
  assert.match(sources[0], /accessibilityLabel="Penalty"/)
  assert.match(sources[1], />Penalty</)
})

test('release 72 freezes both native versions and guarded production references', async () => {
  const [buildGuard, submitGuard, coachConfig, coachPackage, parentConfig, parentPackage] = await Promise.all([
    readFile(new URL('apps/scripts/mobile-build-guard.mjs', root), 'utf8'),
    readFile(new URL('apps/scripts/mobile-submit-guard.mjs', root), 'utf8'),
    readFile(new URL('apps/coach-mobile/app.config.js', root), 'utf8'),
    readFile(new URL('apps/coach-mobile/package.json', root), 'utf8'),
    readFile(new URL('apps/parent-mobile/app.config.js', root), 'utf8'),
    readFile(new URL('apps/parent-mobile/package.json', root), 'utf8'),
  ])

  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-INVITES-NOTIFICATIONS-AUDIT-72/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-INVITES-NOTIFICATIONS-AUDIT-72/)
  assert.match(submitGuard, /promotionReference === 'FP-INVITES-NOTIFICATIONS-AUDIT-72'/)
  assert.match(coachConfig, /version: '1\.0\.22'/)
  assert.equal(JSON.parse(coachPackage).version, '1.0.22')
  assert.match(parentConfig, /version: '1\.0\.19'/)
  assert.equal(JSON.parse(parentPackage).version, '1.0.19')
})
