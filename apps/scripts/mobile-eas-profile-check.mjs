import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mobileApps } from './mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const expectedProfiles = {
  development: { environment: 'development' },
  internal: { environment: 'preview' },
  'store-test': { environment: 'preview' },
}
const productionAscAppIds = {
  coach: '6772059305',
  parent: '6772061464',
}
const failures = []

for (const app of mobileApps) {
  const eas = JSON.parse(await readFile(resolve(repoRoot, app.easConfig), 'utf8'))
  const buildProfiles = eas.build || {}

  for (const [profile, expected] of Object.entries(expectedProfiles)) {
    const current = buildProfiles[profile]
    if (!current) {
      failures.push(`${app.name}:${profile}:missing_profile`)
      continue
    }
    if (current.environment !== expected.environment) failures.push(`${app.name}:${profile}:wrong_environment_scope`)
    if (current.env?.EXPO_PUBLIC_BUILD_PROFILE !== profile) failures.push(`${app.name}:${profile}:missing_build_profile_binding`)
    if (current.env?.EXPO_PUBLIC_SUPABASE_ENV !== 'test') failures.push(`${app.name}:${profile}:invalid_environment_classification`)
    if (current.env?.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE !== 'false') failures.push(`${app.name}:${profile}:live_access_enabled`)
  }

  for (const profile of ['internal-live', 'store-live']) {
    const current = buildProfiles[profile]
    if (!current) failures.push(`${app.name}:${profile}:missing_profile`)
    else {
      if (current.environment !== 'production') failures.push(`${app.name}:${profile}:wrong_environment_scope`)
      if (current.env?.EXPO_PUBLIC_BUILD_PROFILE !== profile) failures.push(`${app.name}:${profile}:missing_build_profile_binding`)
      if (current.env?.EXPO_PUBLIC_SUPABASE_ENV !== 'production') failures.push(`${app.name}:${profile}:invalid_environment_classification`)
      if (current.env?.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE !== 'true') failures.push(`${app.name}:${profile}:live_access_disabled`)
    }
  }
  if (eas.submit?.['store-live']?.ios?.ascAppId !== productionAscAppIds[app.appRole]) {
    failures.push(`${app.name}:store-live:invalid_ios_submission_identity`)
  }
}

if (failures.length > 0) {
  console.error('Mobile EAS profile boundary failed.')
  for (const failure of failures) console.error(failure)
  process.exit(1)
}

console.log('Mobile EAS profile boundary passed for test and explicitly authorised production profiles.')
