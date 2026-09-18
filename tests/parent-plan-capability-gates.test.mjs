import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assertParentPlanFeatureForScope } from '../netlify/functions/lib/_parent-plan-gate.js'

const IDS = Object.freeze({
  club: '10000000-0000-4000-8000-000000000001',
  link: '20000000-0000-4000-8000-000000000001',
  player: '30000000-0000-4000-8000-000000000001',
  team: '40000000-0000-4000-8000-000000000001',
})

function scope(featureName, actionCategory = 'READ') {
  return {
    actionCategory,
    clubId: IDS.club,
    featureName,
    parentLinkId: IDS.link,
    playerId: IDS.player,
    teamId: IDS.team,
  }
}

test('verified Parent scope receives per-club plan context with its role and resource identifiers', async () => {
  const calls = []
  const profile = await assertParentPlanFeatureForScope(scope('resourceLibrary'), {
    loadPlanGate: async () => ({
      getClubPlanProfile: async (clubId) => {
        calls.push(['load', clubId])
        return { clubId, planKey: 'club', planStatus: 'active' }
      },
      assertPlanFeature: (candidate, featureName, options) => {
        calls.push(['assert', candidate, featureName, options])
      },
    }),
  })

  assert.deepEqual(calls[0], ['load', IDS.club])
  assert.equal(calls[1][1].role, 'parent_portal')
  assert.equal(calls[1][1].parentLinkId, IDS.link)
  assert.equal(calls[1][1].playerId, IDS.player)
  assert.equal(calls[1][1].teamId, IDS.team)
  assert.equal(calls[1][2], 'resourceLibrary')
  assert.deepEqual(calls[1][3], { actionCategory: 'READ' })
  assert.equal(profile.planKey, 'club')
})

test('denied Parent capability fails before service-role data access can proceed', async () => {
  await assert.rejects(
    assertParentPlanFeatureForScope(scope('basicDevelopmentRecords', 'EXPORT'), {
      loadPlanGate: async () => ({
        getClubPlanProfile: async () => ({ clubId: IDS.club, planKey: 'matchday' }),
        assertPlanFeature: () => {
          throw Object.assign(new Error('Basic development records are not included in your current plan.'), { statusCode: 403 })
        },
      }),
    }),
    (error) => error.status === 403 && /not included/.test(error.message),
  )
})

test('service-role Parent handlers gate the authoritative linked Club before protected reads', async () => {
  const [developmentSource, resourceSource] = await Promise.all([
    readFile(new URL('../netlify/functions/parent-development-history.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/parent-resource-access.js', import.meta.url), 'utf8'),
  ])

  assert.ok(developmentSource.indexOf('loadParentScope({') < developmentSource.lastIndexOf("featureName: 'basicDevelopmentRecords'"))
  assert.ok(developmentSource.lastIndexOf("featureName: 'basicDevelopmentRecords'") < developmentSource.indexOf('const history = await loadHistory'))
  assert.ok(resourceSource.lastIndexOf('loadActiveParentContext({') < resourceSource.lastIndexOf("featureName: 'resourceLibrary'"))
  assert.ok(resourceSource.lastIndexOf("featureName: 'resourceLibrary'") < resourceSource.indexOf("if (action === 'list_calendar_event_resources')"))
})
