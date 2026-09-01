import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('production OTA updates require explicit confirmation, a clean exact-main worktree, and store-live configuration', async () => {
  const source = await readSource('../apps/scripts/mobile-update-guard.mjs')

  assert.match(source, /MOBILE_OTA_UPDATE_CONFIRMED/)
  assert.match(source, /MOBILE_OTA_UPDATE_MESSAGE/)
  assert.match(source, /updateMessageArgument/)
  assert.match(source, /A-Za-z0-9 \._-/)
  assert.match(source, /git', \['status', '--porcelain'\]/)
  assert.match(source, /git', \['fetch', 'origin', '--prune'\]/)
  assert.match(source, /headCommit !== originMainCommit/)
  assert.match(source, /EXPO_PUBLIC_BUILD_PROFILE: productionProfile/)
  assert.match(source, /mobile-resolved-environment-check\.mjs/)
  assert.match(source, /'update'/)
  assert.match(source, /'--channel',[\s\S]*'production'/)
  assert.match(source, /'--environment',[\s\S]*'production'/)
  assert.match(source, /updatePlatform = 'all'/)
  assert.match(source, /new Set\(\['all', 'ios', 'android'\]\)/)
  assert.match(source, /supportedUpdatePlatforms\.has\(updatePlatform\)/)
  assert.match(source, /'--platform',[\s\S]*updatePlatform/)
  assert.doesNotMatch(source, /'build'/)
  assert.doesNotMatch(source, /'submit'/)
})

test('resolved environment checks reject a missing or mismatched build-profile marker', async () => {
  const source = await readSource('../apps/scripts/mobile-resolved-environment-check.mjs')
  const buildGuard = await readSource('../apps/scripts/mobile-build-guard.mjs')

  assert.match(source, /resolvedBuildProfile/)
  assert.match(source, /build_profile_mismatch/)
  assert.match(source, /buildProfile: resolvedBuildProfile/)
  assert.match(buildGuard, /EXPO_PUBLIC_BUILD_PROFILE: profile/)
})

test('root scripts expose only guarded Parent and Coach production OTA commands', async () => {
  const packageJson = JSON.parse(await readSource('../package.json'))
  const eslintConfig = await readSource('../eslint.config.js')

  assert.equal(packageJson.scripts['mobile:update:coach:production'], 'node apps/scripts/mobile-update-guard.mjs coach')
  assert.equal(packageJson.scripts['mobile:update:parent:production'], 'node apps/scripts/mobile-update-guard.mjs parent')
  assert.match(eslintConfig, /apps\/\*-mobile\/dist/)
})
