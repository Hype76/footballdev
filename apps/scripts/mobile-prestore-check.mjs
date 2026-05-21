import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const apps = [
  {
    appConfig: 'apps/coach-mobile/app.config.js',
    envExample: 'apps/coach-mobile/.env.example',
    notificationIcon: 'apps/coach-mobile/assets/notification-icon.png',
    easConfig: 'apps/coach-mobile/eas.json',
    metadata: 'apps/coach-mobile/STORE_METADATA.md',
    metroConfig: 'apps/coach-mobile/metro.config.js',
    name: 'Coach',
    packageJson: 'apps/coach-mobile/package.json',
    sourceRoots: ['apps/coach-mobile/App.js', 'apps/mobile-core/src'],
  },
  {
    appConfig: 'apps/parent-mobile/app.config.js',
    envExample: 'apps/parent-mobile/.env.example',
    notificationIcon: 'apps/parent-mobile/assets/notification-icon.png',
    easConfig: 'apps/parent-mobile/eas.json',
    metadata: 'apps/parent-mobile/STORE_METADATA.md',
    metroConfig: 'apps/parent-mobile/metro.config.js',
    name: 'Parents',
    packageJson: 'apps/parent-mobile/package.json',
    sourceRoots: ['apps/parent-mobile/App.js', 'apps/mobile-core/src'],
  },
]

const forbiddenSourcePatterns = [
  /\bstripe\b/i,
  /\bcheckout\b/i,
  /\bbilling\b/i,
  /\bsubscription management\b/i,
  /\bsubscribe\b/i,
]

const forbiddenBrandPatterns = [
  /Player Feedback/i,
  /playerfeedback/i,
]

const failures = []
const sharedPrivacyPath = 'apps/MOBILE_PRIVACY_QUESTIONNAIRE.md'
const reviewerHandoffPath = 'apps/MOBILE_REVIEWER_HANDOFF.md'
const storeAccountSetupPath = 'apps/MOBILE_STORE_ACCOUNT_SETUP.md'
const rootPackagePath = 'package.json'

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8')
}

function assertFile(relativePath, label) {
  if (!existsSync(join(repoRoot, relativePath))) {
    failures.push(`${label} is missing: ${relativePath}`)
  }
}

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    failures.push(`${label} must include ${expected}`)
  }
}

function assertNotIncludes(content, unexpected, label) {
  if (content.includes(unexpected)) {
    failures.push(`${label} must not include ${unexpected}`)
  }
}

function scanSource(relativePath, appName) {
  const fullPath = join(repoRoot, relativePath)

  if (!existsSync(fullPath)) {
    return
  }

  const stat = statSync(fullPath)

  if (stat.isDirectory()) {
    readdirSync(fullPath)
      .filter((entry) => /\.(js|jsx|ts|tsx)$/.test(entry))
      .forEach((entry) => scanSource(join(relativePath, entry), appName))
    return
  }

  const content = readFileSync(fullPath, 'utf8')

  forbiddenSourcePatterns.forEach((pattern) => {
    if (pattern.test(content)) {
      failures.push(`${appName} mobile source contains forbidden store-policy term ${pattern}: ${relativePath}`)
    }
  })

  forbiddenBrandPatterns.forEach((pattern) => {
    if (pattern.test(content)) {
      failures.push(`${appName} mobile source contains old brand term ${pattern}: ${relativePath}`)
    }
  })
}

for (const app of apps) {
  assertFile(app.appConfig, `${app.name} app config`)
  assertFile(app.envExample, `${app.name} env example`)
  assertFile(app.notificationIcon, `${app.name} notification icon`)
  assertFile(app.easConfig, `${app.name} EAS config`)
  assertFile(app.metadata, `${app.name} store metadata`)
  assertFile(app.metroConfig, `${app.name} Metro config`)
  assertFile(app.packageJson, `${app.name} package`)

  if (existsSync(join(repoRoot, app.appConfig))) {
    const appConfig = read(app.appConfig)
    assertIncludes(appConfig, "const supabaseEnvironment = process.env.EXPO_PUBLIC_SUPABASE_ENV || 'test'", `${app.name} app config`)
    assertIncludes(appConfig, "const allowLiveSupabase = process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE || 'false'", `${app.name} app config`)
    assertIncludes(appConfig, 'ITSAppUsesNonExemptEncryption: false', `${app.name} iOS config`)
    assertIncludes(appConfig, "icon: './assets/notification-icon.png'", `${app.name} notifications config`)
    assertIncludes(appConfig, 'blockedPermissions', `${app.name} Android permissions config`)
    assertIncludes(appConfig, 'android.permission.ACCESS_FINE_LOCATION', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.CAMERA', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.RECORD_AUDIO', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.READ_CONTACTS', `${app.name} Android blocked permissions`)
  }

  if (existsSync(join(repoRoot, app.envExample))) {
    const envExample = read(app.envExample)
    assertIncludes(envExample, 'EXPO_PUBLIC_SUPABASE_ENV=test', `${app.name} env example`)
    assertIncludes(envExample, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', `${app.name} env example`)
    assertIncludes(envExample, 'EXPO_PUBLIC_SUPABASE_URL=', `${app.name} env example`)
    assertIncludes(envExample, 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=', `${app.name} env example`)
    assertIncludes(envExample, 'EXPO_PUBLIC_EAS_PROJECT_ID=', `${app.name} env example`)
    assertNotIncludes(envExample, 'EXPO_PUBLIC_SUPABASE_ENV=live', `${app.name} env example`)
    assertNotIncludes(envExample, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=true', `${app.name} env example`)
  }

  if (existsSync(join(repoRoot, app.easConfig))) {
    const easConfig = read(app.easConfig)
    assertIncludes(easConfig, '"EXPO_PUBLIC_SUPABASE_ENV": "test"', `${app.name} EAS config`)
    assertIncludes(easConfig, '"EXPO_PUBLIC_ALLOW_LIVE_SUPABASE": "false"', `${app.name} EAS config`)
    assertNotIncludes(easConfig, '"EXPO_PUBLIC_SUPABASE_ENV": "live"', `${app.name} EAS config`)
    assertNotIncludes(easConfig, '"EXPO_PUBLIC_ALLOW_LIVE_SUPABASE": "true"', `${app.name} EAS config`)
  }

  if (existsSync(join(repoRoot, app.packageJson))) {
    const appPackage = JSON.parse(read(app.packageJson))
    if (appPackage.scripts?.doctor !== 'npx expo-doctor') {
      failures.push(`${app.name} package must run Expo Doctor through npx`)
    }
    if (appPackage.dependencies?.['@expo/metro-config'] || appPackage.devDependencies?.['@expo/metro-config']) {
      failures.push(`${app.name} package must not install @expo/metro-config directly`)
    }
  }

  if (existsSync(join(repoRoot, app.metroConfig))) {
    const metroConfig = read(app.metroConfig)
    assertIncludes(metroConfig, "require('expo/metro-config')", `${app.name} Metro config`)
    assertNotIncludes(metroConfig, "require('@expo/metro-config')", `${app.name} Metro config`)
  }

  if (existsSync(join(repoRoot, app.metadata))) {
    const metadata = read(app.metadata)
    assertIncludes(metadata, 'Payments are handled outside the mobile app', `${app.name} metadata`)
    assertIncludes(metadata, 'This review build uses the test database', `${app.name} metadata`)
    assertIncludes(metadata, 'https://footballplayer.online/gdpr', `${app.name} metadata`)
    assertIncludes(metadata, 'https://footballplayer.online/terms', `${app.name} metadata`)
  }

  app.sourceRoots.forEach((sourceRoot) => scanSource(sourceRoot, app.name))
}

assertFile(sharedPrivacyPath, 'Mobile privacy questionnaire')
assertFile(reviewerHandoffPath, 'Mobile reviewer handoff')
assertFile(storeAccountSetupPath, 'Mobile store account setup')
assertFile(rootPackagePath, 'Root package')

const mobileConfig = read('apps/mobile-core/src/config.js')
const mobileHttp = read('apps/mobile-core/src/http.js')
const mobileSupabase = read('apps/mobile-core/src/supabase.js')
const mobileUi = read('apps/mobile-core/src/ui.js')
assertIncludes(mobileConfig, 'isUsable: isConfigured && !isLiveBlocked', 'Mobile runtime config')
assertIncludes(mobileHttp, 'fetchJsonWithTimeout', 'Mobile HTTP helper')
assertIncludes(mobileHttp, 'The mobile API request timed out.', 'Mobile HTTP helper')
assertIncludes(mobileSupabase, 'config.isUsable ? config.supabaseUrl', 'Mobile Supabase client')
assertIncludes(mobileUi, 'Powered by pulseslabs.online', 'Mobile legal footer')
assertIncludes(mobileUi, 'Copyright 2026 Football Player.', 'Mobile legal footer')

if (existsSync(join(repoRoot, rootPackagePath))) {
  const rootPackage = JSON.parse(read(rootPackagePath))
  if (rootPackage.scripts?.['mobile:doctor'] !== 'node apps/scripts/mobile-doctor-check.mjs') {
    failures.push('Root package must include mobile:doctor script')
  }
  if (rootPackage.scripts?.['mobile:export:web'] !== 'node apps/scripts/mobile-export-web-check.mjs') {
    failures.push('Root package must include mobile:export:web script')
  }
  if (rootPackage.scripts?.['mobile:release-check'] !== 'node apps/scripts/mobile-release-check.mjs') {
    failures.push('Root package must include mobile:release-check script')
  }
}

if (existsSync(join(repoRoot, sharedPrivacyPath))) {
  const privacyDraft = read(sharedPrivacyPath)
  assertIncludes(privacyDraft, 'Apps do not include in-app purchases.', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'Apps do not collect precise location.', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'Android builds explicitly block location, camera, microphone, contacts, media, and Bluetooth permissions.', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'Apps use Expo push notification services', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'https://footballplayer.online/gdpr', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'https://footballplayer.online/terms', 'Mobile privacy questionnaire')
}

if (existsSync(join(repoRoot, reviewerHandoffPath))) {
  const reviewerHandoff = read(reviewerHandoffPath)
  assertIncludes(reviewerHandoff, 'Do not commit real passwords', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'MOBILE_STORE_ACCOUNT_SETUP.md', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Payments are handled outside the mobile app', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'This review build uses the test database.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Screenshot checklist', 'Mobile reviewer handoff')
}

if (existsSync(join(repoRoot, storeAccountSetupPath))) {
  const storeSetup = read(storeAccountSetupPath)
  assertIncludes(storeSetup, 'com.footballplayer.coach', 'Mobile store account setup')
  assertIncludes(storeSetup, 'com.footballplayer.parents', 'Mobile store account setup')
  assertIncludes(storeSetup, 'EXPO_PUBLIC_SUPABASE_ENV=test', 'Mobile store account setup')
  assertIncludes(storeSetup, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', 'Mobile store account setup')
  assertIncludes(storeSetup, 'Do not put real Supabase keys, EAS project IDs, or production API URLs in `.env.example`.', 'Mobile store account setup')
  assertIncludes(storeSetup, 'Do not commit private keys', 'Mobile store account setup')
}

if (failures.length > 0) {
  console.error('Mobile pre-store check failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Mobile pre-store check passed.')
