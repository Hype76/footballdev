import { createDemoMatchDayAdapter } from './demo-matchday-adapter.js'
import { isDemoUser } from './demo.js'
import { MATCH_DAY_CANONICAL_EXPERIENCE_MANIFEST } from './matchday-capability-manifest.js'

export const MATCH_DAY_EXPERIENCE_INTENTIONAL_DIFFERENCES = Object.freeze([
  Object.freeze({ key: 'data_provider', reason: 'Demo uses session-isolated synthetic fixtures, Teams, Players, and timeline state.' }),
  Object.freeze({ key: 'mutation_boundary', reason: 'Demo rejects every identifier outside the demo-gameday namespace.' }),
  Object.freeze({ key: 'communication_policy', reason: 'Demo blocks email, push, SMS, Chat, invitations, and production queue work.' }),
  Object.freeze({ key: 'reset_control', reason: 'Demo adds one idempotent reset control for practice recovery.' }),
  Object.freeze({ key: 'demo_label', reason: 'Demo adds a compact context label without changing the operational layout.' }),
])

export function createMatchDayExperienceAdapter({ demoScope = '', user, live, storage } = {}) {
  if (isDemoUser(user)) {
    return Object.freeze({
      ...createDemoMatchDayAdapter({ scopeKey: demoScope || user?.id || user?.email, storage }),
      manifest: MATCH_DAY_CANONICAL_EXPERIENCE_MANIFEST,
    })
  }

  if (!live || typeof live.getMatchDays !== 'function') {
    throw new Error('Live Game Day adapter is unavailable.')
  }

  return Object.freeze({
    ...live,
    mode: 'live',
    allowsCommunication: true,
    manifest: MATCH_DAY_CANONICAL_EXPERIENCE_MANIFEST,
    resetPolicy: 'production_authority',
    async reset() {
      throw new Error('Reset is available only in Demo Game Day.')
    },
  })
}
