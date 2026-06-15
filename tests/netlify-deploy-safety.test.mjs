import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  evaluateSafety,
  legacyStagingProjectRef,
  liveProjectRef,
} from '../scripts/netlify-deploy-safety-check.mjs'

const liveDist = {
  exists: true,
  hasLegacyStagingRef: false,
  hasLiveRef: true,
}

const stagingDist = {
  exists: true,
  hasLegacyStagingRef: true,
  hasLiveRef: false,
}

test('local live validation allows live ref with no deploy command or context', () => {
  const result = evaluateSafety({
    currentBranch: 'football-os-staging',
    dist: liveDist,
    mode: 'local-live',
    targetBranch: 'football-os-staging',
  })

  assert.deepEqual(result.failures, [])
})

test('local live validation blocks deploy commands and legacy staging refs', () => {
  const result = evaluateSafety({
    command: 'netlify deploy --dir=dist',
    currentBranch: 'football-os-staging',
    dist: {
      exists: true,
      hasLegacyStagingRef: true,
      hasLiveRef: false,
    },
    mode: 'local-live',
    targetBranch: 'football-os-staging',
  })

  assert.match(result.failures.join('\n'), /must not review or run a deploy command/)
  assert.match(result.failures.join('\n'), /requires live Supabase ref/)
  assert.match(result.failures.join('\n'), /must not use legacy staging Supabase ref/)
})

test('real deploy safety requires an explicit expected Supabase ref', () => {
  const result = evaluateSafety({
    currentBranch: 'football-os-staging',
    deployContext: 'branch-deploy',
    dist: stagingDist,
    mode: 'deploy',
    siteId: 'site-1',
    targetBranch: 'football-os-staging',
  })

  assert.match(result.failures.join('\n'), /require --expected-supabase-ref/)
})

test('real deploy safety blocks unexpected refs in dist', () => {
  const result = evaluateSafety({
    currentBranch: 'football-os-staging',
    deployContext: 'branch-deploy',
    dist: liveDist,
    expectedSupabaseRef: legacyStagingProjectRef,
    mode: 'deploy',
    siteId: 'site-1',
    targetBranch: 'football-os-staging',
  })

  assert.match(result.failures.join('\n'), /not proven in dist/)
  assert.match(result.failures.join('\n'), /Unexpected live Supabase ref/)
})

test('real deploy safety blocks mixed or missing Supabase refs', () => {
  const mixedResult = evaluateSafety({
    currentBranch: 'football-os-staging',
    deployContext: 'branch-deploy',
    dist: {
      exists: true,
      hasLegacyStagingRef: true,
      hasLiveRef: true,
    },
    expectedSupabaseRef: liveProjectRef,
    mode: 'deploy',
    siteId: 'site-1',
    targetBranch: 'football-os-staging',
  })
  const missingResult = evaluateSafety({
    currentBranch: 'football-os-staging',
    deployContext: 'branch-deploy',
    dist: {
      exists: true,
      hasLegacyStagingRef: false,
      hasLiveRef: false,
    },
    expectedSupabaseRef: liveProjectRef,
    mode: 'deploy',
    siteId: 'site-1',
    targetBranch: 'football-os-staging',
  })

  assert.match(mixedResult.failures.join('\n'), /Both live and legacy staging Supabase refs/)
  assert.match(missingResult.failures.join('\n'), /No known Supabase ref/)
})
