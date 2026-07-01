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

const retiredStagingDist = {
  exists: true,
  hasLegacyStagingRef: true,
  hasLiveRef: false,
}

test('local live validation allows live ref with no deploy command or context', () => {
  const result = evaluateSafety({
    currentBranch: 'codex/fp-v1-staging-retire-safety-06',
    dist: liveDist,
    mode: 'local-live',
    targetBranch: 'codex/fp-v1-staging-retire-safety-06',
  })

  assert.deepEqual(result.failures, [])
})

test('local live validation blocks deploy commands and legacy staging refs', () => {
  const result = evaluateSafety({
    command: 'netlify deploy --dir=dist',
    currentBranch: 'codex/fp-v1-staging-retire-safety-06',
    dist: {
      exists: true,
      hasLegacyStagingRef: true,
      hasLiveRef: false,
    },
    mode: 'local-live',
    targetBranch: 'codex/fp-v1-staging-retire-safety-06',
  })

  assert.match(result.failures.join('\n'), /must not review or run a deploy command/)
  assert.match(result.failures.join('\n'), /requires live Supabase ref/)
  assert.match(result.failures.join('\n'), /must not use legacy staging Supabase ref/)
})

test('real deploy safety requires an explicit expected Supabase ref', () => {
  const result = evaluateSafety({
    currentBranch: 'football-os-staging',
    deployContext: 'branch-deploy',
    dist: retiredStagingDist,
    mode: 'deploy',
    siteId: 'site-1',
    targetBranch: 'football-os-staging',
  })

  assert.match(result.failures.join('\n'), /require --expected-supabase-ref/)
  assert.match(result.failures.join('\n'), /staging deploy safety checks are retired/)
})

test('real deploy safety blocks retired staging refs in dist', () => {
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
  assert.match(result.failures.join('\n'), /Retired staging Supabase ref/)
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

test('deploy safety blocks missing Pilot preservation markers', () => {
  const result = evaluateSafety({
    currentBranch: 'main',
    deployContext: 'production',
    dist: liveDist,
    expectedSupabaseRef: liveProjectRef,
    mode: 'production-prep',
    pilot: {
      checked: true,
      failures: ['Pilot admin assignment preserved: expected preservation marker was not found.'],
    },
    siteId: 'site-1',
    targetBranch: 'main',
    command: 'netlify deploy --prod --dir=dist --site site-1',
  })

  assert.match(result.failures.join('\n'), /Pilot preservation check failed/)
})

test('real deploy safety blocks the retired parent staging branch host', () => {
  const result = evaluateSafety({
    command: 'netlify deploy --build --context branch:parent-staging --site site-1',
    currentBranch: 'parent-staging',
    deployContext: 'branch:parent-staging',
    dist: retiredStagingDist,
    expectedSupabaseRef: legacyStagingProjectRef,
    intendedUrl: 'https://parent-staging.staging.footballplayer.online',
    mode: 'deploy',
    siteId: 'site-1',
    targetBranch: 'parent-staging',
  })

  assert.match(result.failures.join('\n'), /staging deploy safety checks are retired/)
  assert.match(result.failures.join('\n'), /Retired staging Supabase ref/)
})
