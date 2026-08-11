import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { MOBILE_STARTUP_STATES, runMobileStartup } from '../apps/mobile-core/src/startupStateCore.js'

test('role-aware startup diagnostics never label a Coach failure as Parent', async () => {
  const result = await runMobileStartup({
    appRole: 'coach',
    clearInvalidSession: async () => {},
    config: { isUsable: true },
    getBiometricEnabled: async () => false,
    getSession: () => new Promise(() => {}),
    loadProfile: async () => {},
    onSession: async () => {},
    prepare: async () => {},
    timeoutMs: 5,
  })
  assert.equal(result.state, MOBILE_STARTUP_STATES.RECOVERABLE_ERROR)
  assert.equal(result.diagnosticCode, 'COACH_STARTUP_TIMEOUT')
})

test('Parent startup uses encrypted cached profile immediately and refreshes live authority in the background', async () => {
  const auth = await readFile(new URL('../apps/mobile-core/src/auth.js', import.meta.url), 'utf8')
  assert.match(auth, /if \(cachedProfile\)[\s\S]*withStartupTimeout\([\s\S]*refreshProfile[\s\S]*return cachedProfile/)
  assert.match(auth, /isAuthoritativeProfileFailure/)
  assert.match(auth, /if \(offlineProfileStore\?\.clear\)/)
  assert.doesNotMatch(auth, /appRole === 'parent' && offlineProfileStore/)
})

test('Parent Match Day merges only server-authorised published formation plans and renders a read-only pitch and Bench', async () => {
  const [data, app] = await Promise.all([
    readFile(new URL('../apps/mobile-core/src/data.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  ])
  assert.match(data, /get_parent_portal_match_formation_plans/)
  assert.match(data, /formationPlan: plans\.get\(match\.id\) \|\| null/)
  assert.match(app, /Shared match plan/)
  assert.match(app, /Read-only plan shared by Team staff/)
  assert.match(app, /No Players are on the Bench/)
  assert.doesNotMatch(app, /formationPlan[\s\S]{0,500}staff notes/i)
})

test('Parent multiple-choice Poll changes reconcile desired state before any toggle RPC retry', async () => {
  const [offline, app] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/src/offline.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  ])
  assert.match(offline, /payload: \{ optionId: normalizedOptionId, selected: poll\.allowMultiple \? !currentlySelected : true \}/)
  assert.match(offline, /const polls = await getParentPolls\(scopedUser\)/)
  assert.match(offline, /if \(selected === \(command\.payload\.selected !== false\)\) return \{ reconciled: true \}/)
  assert.match(app, /command\.payload\.selected === false/)
  assert.match(app, /tap again to remove one|Adds or removes this saved response/i)
})
