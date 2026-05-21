import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const apps = [
  {
    appConfig: 'apps/coach-mobile/app.config.js',
    appRole: 'coach',
    bundleIdentifier: 'com.footballplayer.coach',
    envExample: 'apps/coach-mobile/.env.example',
    gitignore: 'apps/coach-mobile/.gitignore',
    notificationIcon: 'apps/coach-mobile/assets/notification-icon.png',
    easConfig: 'apps/coach-mobile/eas.json',
    expectedName: 'Football Player Coach',
    metadata: 'apps/coach-mobile/STORE_METADATA.md',
    metroConfig: 'apps/coach-mobile/metro.config.js',
    name: 'Coach',
    packageJson: 'apps/coach-mobile/package.json',
    packageName: 'com.footballplayer.coach',
    readme: 'apps/coach-mobile/README.md',
    scheme: 'footballplayercoach',
    slug: 'football-player-coach',
    sourceRoots: ['apps/coach-mobile/App.js', 'apps/mobile-core/src'],
    submissionChecklist: 'apps/coach-mobile/STORE_SUBMISSION_CHECKLIST.md',
    restrictedAccessCopy: 'Restricted club access.',
  },
  {
    appConfig: 'apps/parent-mobile/app.config.js',
    appRole: 'parent',
    bundleIdentifier: 'com.footballplayer.parents',
    envExample: 'apps/parent-mobile/.env.example',
    gitignore: 'apps/parent-mobile/.gitignore',
    notificationIcon: 'apps/parent-mobile/assets/notification-icon.png',
    easConfig: 'apps/parent-mobile/eas.json',
    expectedName: 'Football Player Parents',
    metadata: 'apps/parent-mobile/STORE_METADATA.md',
    metroConfig: 'apps/parent-mobile/metro.config.js',
    name: 'Parents',
    packageJson: 'apps/parent-mobile/package.json',
    packageName: 'com.footballplayer.parents',
    readme: 'apps/parent-mobile/README.md',
    scheme: 'footballplayerparents',
    slug: 'football-player-parents',
    sourceRoots: ['apps/parent-mobile/App.js', 'apps/mobile-core/src'],
    submissionChecklist: 'apps/parent-mobile/STORE_SUBMISSION_CHECKLIST.md',
    restrictedAccessCopy: 'Restricted parent access.',
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

const forbiddenMobileDiagnosticPatterns = [
  /Supabase:\s*\{/,
  /API:\s*\{/,
]

const forbiddenMobileDependencyPatterns = [
  /analytics/i,
  /amplitude/i,
  /appsflyer/i,
  /facebook/i,
  /firebase/i,
  /mixpanel/i,
  /segment/i,
  /sentry/i,
]

const failures = []
const sharedPrivacyPath = 'apps/MOBILE_PRIVACY_QUESTIONNAIRE.md'
const environmentRunbookPath = 'apps/MOBILE_ENVIRONMENT_RUNBOOK.md'
const notificationRunbookPath = 'apps/MOBILE_NOTIFICATION_RUNBOOK.md'
const preStoreQaPath = 'apps/MOBILE_PRE_STORE_QA.md'
const reviewerHandoffPath = 'apps/MOBILE_REVIEWER_HANDOFF.md'
const screenshotPlanPath = 'apps/MOBILE_SCREENSHOT_PLAN.md'
const storeAccountSetupPath = 'apps/MOBILE_STORE_ACCOUNT_SETUP.md'
const versioningPath = 'apps/MOBILE_VERSIONING.md'
const releaseStatusPath = 'apps/MOBILE_RELEASE_STATUS.md'
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

function assertNotIncludesInsensitive(content, unexpected, label) {
  if (content.toLowerCase().includes(unexpected.toLowerCase())) {
    failures.push(`${label} must not include ${unexpected}`)
  }
}

function assertNoReviewerCredentialValues(content, label) {
  content.split(/\r?\n/).forEach((line, index) => {
    const normalizedLine = line.trim().replace(/^-+\s*/, '')

    if (/^Email:/i.test(normalizedLine) && normalizedLine !== 'Email: add in store console only') {
      failures.push(`${label} line ${index + 1} must not contain a reviewer email value`)
    }

    if (/^Password:/i.test(normalizedLine) && normalizedLine !== 'Password: add in store console only') {
      failures.push(`${label} line ${index + 1} must not contain a reviewer password value`)
    }
  })
}

function assertNoTrackedMobilePrivateFiles() {
  const trackedFiles = execSync('git ls-files apps', {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)

  const forbiddenTrackedFilePatterns = [
    /(^|\/)\.env$/,
    /\.(apk|aab|ipa|p8|mobileprovision|keystore|jks)$/i,
    /(^|\/)GoogleService-Info\.plist$/i,
    /(^|\/)google-services\.json$/i,
    /(^|\/)credentials\.json$/i,
  ]

  trackedFiles.forEach((trackedFile) => {
    forbiddenTrackedFilePatterns.forEach((pattern) => {
      if (pattern.test(trackedFile)) {
        failures.push(`Tracked mobile private file must be removed from git: ${trackedFile}`)
      }
    })
  })
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

  forbiddenMobileDiagnosticPatterns.forEach((pattern) => {
    if (pattern.test(content)) {
      failures.push(`${appName} mobile source contains store-facing environment diagnostics ${pattern}: ${relativePath}`)
    }
  })
}

function scanPackageDependencies(packageJson, appName) {
  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  }

  Object.keys(dependencies).forEach((dependencyName) => {
    forbiddenMobileDependencyPatterns.forEach((pattern) => {
      if (pattern.test(dependencyName)) {
        failures.push(`${appName} package contains privacy-sensitive dependency ${dependencyName}. Revise the mobile privacy questionnaire before allowing it.`)
      }
    })
  })
}

for (const app of apps) {
  assertFile(app.appConfig, `${app.name} app config`)
  assertFile(app.envExample, `${app.name} env example`)
  assertFile(app.gitignore, `${app.name} gitignore`)
  assertFile(app.notificationIcon, `${app.name} notification icon`)
  assertFile(app.easConfig, `${app.name} EAS config`)
  assertFile(app.metadata, `${app.name} store metadata`)
  assertFile(app.metroConfig, `${app.name} Metro config`)
  assertFile(app.packageJson, `${app.name} package`)
  assertFile(app.readme, `${app.name} README`)
  assertFile(app.submissionChecklist, `${app.name} store submission checklist`)

  if (existsSync(join(repoRoot, app.appConfig))) {
    const appConfig = read(app.appConfig)
    assertIncludes(appConfig, `name: '${app.expectedName}'`, `${app.name} app identity`)
    assertIncludes(appConfig, `slug: '${app.slug}'`, `${app.name} app identity`)
    assertIncludes(appConfig, `scheme: '${app.scheme}'`, `${app.name} app identity`)
    assertIncludes(appConfig, `bundleIdentifier: '${app.bundleIdentifier}'`, `${app.name} iOS identity`)
    assertIncludes(appConfig, `package: '${app.packageName}'`, `${app.name} Android identity`)
    assertIncludes(appConfig, `appRole: '${app.appRole}'`, `${app.name} app role`)
    assertIncludes(appConfig, "const supabaseEnvironment = process.env.EXPO_PUBLIC_SUPABASE_ENV || 'test'", `${app.name} app config`)
    assertIncludes(appConfig, "const allowLiveSupabase = process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE || 'false'", `${app.name} app config`)
    assertIncludes(appConfig, 'ITSAppUsesNonExemptEncryption: false', `${app.name} iOS config`)
    assertIncludes(appConfig, "icon: './assets/notification-icon.png'", `${app.name} notifications config`)
    assertIncludes(appConfig, 'blockedPermissions', `${app.name} Android permissions config`)
    assertIncludes(appConfig, 'android.permission.ACCESS_COARSE_LOCATION', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.ACCESS_FINE_LOCATION', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.BLUETOOTH', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.CAMERA', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.READ_CONTACTS', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.READ_MEDIA_IMAGES', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.READ_MEDIA_VIDEO', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, 'android.permission.RECORD_AUDIO', `${app.name} Android blocked permissions`)
    assertIncludes(appConfig, "'POST_NOTIFICATIONS'", `${app.name} Android allowed permissions`)
    assertIncludes(appConfig, "'USE_BIOMETRIC'", `${app.name} Android allowed permissions`)
    assertIncludes(appConfig, "'USE_FINGERPRINT'", `${app.name} Android allowed permissions`)
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

  if (existsSync(join(repoRoot, app.gitignore))) {
    const appGitignore = read(app.gitignore)
    ;[
      '.expo/',
      'dist-web-check/',
      '.env',
      '*.apk',
      '*.aab',
      '*.ipa',
      '*.p8',
      '*.mobileprovision',
      '*.keystore',
      '*.jks',
      'GoogleService-Info.plist',
      'google-services.json',
      'credentials.json',
    ].forEach((pattern) => {
      assertIncludes(appGitignore, pattern, `${app.name} gitignore`)
    })
  }

  if (existsSync(join(repoRoot, app.easConfig))) {
    const easConfig = read(app.easConfig)
    assertIncludes(easConfig, '"EXPO_PUBLIC_SUPABASE_ENV": "test"', `${app.name} EAS config`)
    assertIncludes(easConfig, '"EXPO_PUBLIC_ALLOW_LIVE_SUPABASE": "false"', `${app.name} EAS config`)
    assertIncludes(easConfig, '"appVersionSource": "remote"', `${app.name} EAS config`)
    assertIncludes(easConfig, '"autoIncrement": true', `${app.name} EAS config`)
    assertNotIncludes(easConfig, '"EXPO_PUBLIC_SUPABASE_ENV": "live"', `${app.name} EAS config`)
    assertNotIncludes(easConfig, '"EXPO_PUBLIC_ALLOW_LIVE_SUPABASE": "true"', `${app.name} EAS config`)
  }

  if (existsSync(join(repoRoot, app.packageJson))) {
    const appPackage = JSON.parse(read(app.packageJson))
    scanPackageDependencies(appPackage, app.name)

    if (appPackage.scripts?.doctor !== 'npx expo-doctor') {
      failures.push(`${app.name} package must run Expo Doctor through npx`)
    }
    if (appPackage.scripts?.['submit:android:store-test'] !== 'npx eas-cli submit --profile store-test --platform android') {
      failures.push(`${app.name} package must include Android store-test submit script`)
    }
    if (appPackage.scripts?.['submit:ios:store-test'] !== 'npx eas-cli submit --profile store-test --platform ios') {
      failures.push(`${app.name} package must include iOS store-test submit script`)
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
    assertIncludes(metadata, `## App name\n\n${app.expectedName}`, `${app.name} metadata`)
    assertIncludes(metadata, '## Category\n\nSports', `${app.name} metadata`)
    assertIncludes(metadata, 'Payments are handled outside the mobile app', `${app.name} metadata`)
    assertIncludes(metadata, 'This review build uses the test database', `${app.name} metadata`)
    assertIncludes(metadata, 'https://footballplayer.online/gdpr', `${app.name} metadata`)
    assertIncludes(metadata, 'https://footballplayer.online/terms', `${app.name} metadata`)
    assertIncludes(metadata, 'Support: `https://footballplayer.online/`', `${app.name} metadata`)
    assertNotIncludes(metadata, 'Confirm final support URL', `${app.name} metadata`)
  }

  if (existsSync(join(repoRoot, app.submissionChecklist))) {
    const checklist = read(app.submissionChecklist)
    assertIncludes(checklist, '../MOBILE_ENVIRONMENT_RUNBOOK.md', `${app.name} store submission checklist`)
    assertIncludes(checklist, '../MOBILE_NOTIFICATION_RUNBOOK.md', `${app.name} store submission checklist`)
    assertIncludes(checklist, '../MOBILE_SCREENSHOT_PLAN.md', `${app.name} store submission checklist`)
    assertIncludes(checklist, '../MOBILE_VERSIONING.md', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'Verify `STORE_METADATA.md` matches the current app name, restricted-login access model, support URL, privacy URL, and terms URL.', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'Verify `../MOBILE_PRIVACY_QUESTIONNAIRE.md` matches the current app permissions, notification behaviour, no-purchase model, and test-data review build.', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'Confirm app icons and splash assets match the current Football Player brand for review builds.', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'EXPO_PUBLIC_SUPABASE_ENV=test', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'Keep reviewer email and password out of git. Add them only inside App Store Connect and Google Play Console.', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'Do not paste reviewer credentials into repo files.', `${app.name} store submission checklist`)
    assertNotIncludesInsensitive(checklist, 'confirm final public copy', `${app.name} store submission checklist`)
    assertNotIncludesInsensitive(checklist, 'confirm final privacy answers', `${app.name} store submission checklist`)
    assertNotIncludesInsensitive(checklist, 'final enough', `${app.name} store submission checklist`)
  }

  if (existsSync(join(repoRoot, app.readme))) {
    const readme = read(app.readme)
    assertIncludes(readme, '../MOBILE_ENVIRONMENT_RUNBOOK.md', `${app.name} README`)
    assertIncludes(readme, '../MOBILE_NOTIFICATION_RUNBOOK.md', `${app.name} README`)
    assertIncludes(readme, '../MOBILE_SCREENSHOT_PLAN.md', `${app.name} README`)
    assertIncludes(readme, '../MOBILE_VERSIONING.md', `${app.name} README`)
    assertIncludes(readme, '../MOBILE_REVIEWER_HANDOFF.md', `${app.name} README`)
    assertIncludes(readme, 'EXPO_PUBLIC_SUPABASE_ENV=test', `${app.name} README`)
    assertIncludes(readme, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', `${app.name} README`)
  }

  app.sourceRoots.forEach((sourceRoot) => scanSource(sourceRoot, app.name))
}

assertFile(sharedPrivacyPath, 'Mobile privacy questionnaire')
assertFile(environmentRunbookPath, 'Mobile environment runbook')
assertFile(notificationRunbookPath, 'Mobile notification runbook')
assertFile(preStoreQaPath, 'Mobile pre-store QA')
assertFile(reviewerHandoffPath, 'Mobile reviewer handoff')
assertFile(screenshotPlanPath, 'Mobile screenshot plan')
assertFile(storeAccountSetupPath, 'Mobile store account setup')
assertFile(versioningPath, 'Mobile versioning guide')
assertFile(releaseStatusPath, 'Mobile release status')
assertFile(rootPackagePath, 'Root package')
assertNoTrackedMobilePrivateFiles()

const mobileConfig = read('apps/mobile-core/src/config.js')
const mobileHttp = read('apps/mobile-core/src/http.js')
const mobileNotifications = read('apps/mobile-core/src/notifications.js')
const mobileProfile = read('apps/mobile-core/src/profile.js')
const mobileSupabase = read('apps/mobile-core/src/supabase.js')
const mobileUi = read('apps/mobile-core/src/ui.js')
assertIncludes(mobileConfig, 'isUsable: isConfigured && !isLiveBlocked', 'Mobile runtime config')
assertIncludes(mobileHttp, 'fetchJsonWithTimeout', 'Mobile HTTP helper')
assertIncludes(mobileHttp, 'The request timed out. Check your connection and try again.', 'Mobile HTTP helper')
assertNotIncludes(mobileHttp, 'test API URL', 'Mobile HTTP helper')
assertIncludes(mobileNotifications, "const MATCHDAY_CHANNEL_ID = 'matchday'", 'Mobile notifications')
assertIncludes(mobileNotifications, 'register-mobile-push-device', 'Mobile notifications')
assertIncludes(mobileNotifications, 'Notifications.setBadgeCountAsync(0)', 'Mobile notifications')
assertIncludes(mobileNotifications, 'Notifications are not ready for this build.', 'Mobile notifications')
assertNotIncludes(mobileNotifications, 'mobile API base URL', 'Mobile notifications')
assertIncludes(mobileProfile, 'This login is not linked to a coach account.', 'Mobile profile access')
assertIncludes(mobileProfile, 'This login is not linked to a parent account.', 'Mobile profile access')
assertNotIncludes(mobileProfile, 'staff mobile account', 'Mobile profile access')
assertNotIncludes(mobileProfile, 'parent portal link', 'Mobile profile access')
assertIncludes(mobileSupabase, 'config.isUsable ? config.supabaseUrl', 'Mobile Supabase client')
assertIncludes(mobileUi, 'Powered by pulseslabs.online', 'Mobile legal footer')
assertIncludes(mobileUi, 'Copyright 2026 Football Player.', 'Mobile legal footer')

apps.forEach((app) => {
  const appSource = read(app.sourceRoots[0])
  assertIncludes(appSource, 'Connection ready', `${app.name} settings status`)
  assertIncludes(appSource, 'Connection needs setup', `${app.name} settings status`)
  assertIncludes(appSource, app.restrictedAccessCopy, `${app.name} login copy`)
  assertNotIncludes(appSource, 'Test environment only.', `${app.name} login copy`)
  assertNotIncludes(appSource, 'mobile coach access', `${app.name} access copy`)
  assertNotIncludes(appSource, 'parent portal login', `${app.name} login copy`)
  assertNotIncludes(appSource, 'Supabase:', `${app.name} settings status`)
  assertNotIncludes(appSource, 'API:', `${app.name} settings status`)
})

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
  assertIncludes(privacyDraft, 'Android builds request only notification and biometric unlock permissions.', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'Apps use Expo push notification services', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'https://footballplayer.online/gdpr', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'https://footballplayer.online/terms', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'Website and support URL: `https://footballplayer.online/`', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'Mobile pre-store checks block common analytics and advertising SDK packages unless the privacy questionnaire is deliberately revised.', 'Mobile privacy questionnaire')
  assertNotIncludes(privacyDraft, 'provisional support URL', 'Mobile privacy questionnaire')
}

if (existsSync(join(repoRoot, environmentRunbookPath))) {
  const environmentRunbook = read(environmentRunbookPath)
  assertIncludes(environmentRunbook, 'Do not commit real Supabase keys', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'Both mobile app `.gitignore` files must ignore native build artifacts and private credential files', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, '`npm run mobile:prestore` fails if a mobile `.env` file, native build artifact, or private store credential file is tracked by git.', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'EXPO_PUBLIC_SUPABASE_ENV=test', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'For TestFlight and Google internal builds, `EXPO_PUBLIC_API_BASE_URL` must point at the test API host, not localhost.', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'Do not set live Supabase values for either mobile app until live release approval is explicitly given.', 'Mobile environment runbook')
}

if (existsSync(join(repoRoot, notificationRunbookPath))) {
  const notificationRunbook = read(notificationRunbookPath)
  assertIncludes(notificationRunbook, 'Native push must be tested on real iOS and Android devices.', 'Mobile notification runbook')
  assertIncludes(notificationRunbook, 'Android uses the `matchday` notification channel.', 'Mobile notification runbook')
  assertIncludes(notificationRunbook, 'register-mobile-push-device', 'Mobile notification runbook')
  assertIncludes(notificationRunbook, 'send-match-day-push', 'Mobile notification runbook')
  assertIncludes(notificationRunbook, 'send-coach-mobile-push', 'Mobile notification runbook')
  assertIncludes(notificationRunbook, 'send-parent-mobile-push', 'Mobile notification runbook')
  assertIncludes(notificationRunbook, 'mobile_push_devices', 'Mobile notification runbook')
  assertIncludes(notificationRunbook, 'notification_events', 'Mobile notification runbook')
}

if (existsSync(join(repoRoot, preStoreQaPath))) {
  const preStoreQa = read(preStoreQaPath)
  assertIncludes(preStoreQa, 'Football Player Coach', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'com.footballplayer.coach', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Football Player Parents', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'com.footballplayer.parents', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Verify each store listing uses the current icons from the app assets.', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Verify privacy wording matches `MOBILE_PRIVACY_QUESTIONNAIRE.md`.', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Verify the public support route `https://footballplayer.online/` is monitored before submission.', 'Mobile pre-store QA')
  assertNotIncludes(preStoreQa, 'Confirm final app names', 'Mobile pre-store QA')
  assertNotIncludes(preStoreQa, 'support URLs', 'Mobile pre-store QA')
}

if (existsSync(join(repoRoot, reviewerHandoffPath))) {
  const reviewerHandoff = read(reviewerHandoffPath)
  assertIncludes(reviewerHandoff, 'Do not commit real passwords', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Do not paste reviewer email addresses, passwords, one-time codes, or private account notes into this file.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'MOBILE_STORE_ACCOUNT_SETUP.md', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'MOBILE_SCREENSHOT_PLAN.md', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Payments are handled outside the mobile app', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'This review build uses the test database.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'App access instructions', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'This app is restricted to authorised club staff.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'This app is restricted to linked parents and guardians.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'The app has no in-app signup, purchase, subscription, or billing flow.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Screenshot checklist', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Confirm reviewer credentials are entered only in App Store Connect and Google Play Console.', 'Mobile reviewer handoff')
  assertNoReviewerCredentialValues(reviewerHandoff, 'Mobile reviewer handoff')
}

if (existsSync(join(repoRoot, screenshotPlanPath))) {
  const screenshotPlan = read(screenshotPlanPath)
  assertIncludes(screenshotPlan, 'Screenshots must come from real store builds, TestFlight builds, or Google internal builds.', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Use test database data only.', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Coach App Shots', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Parents App Shots', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'No billing, checkout, subscription, Stripe, or bulk email screens are shown.', 'Mobile screenshot plan')
}

if (existsSync(join(repoRoot, versioningPath))) {
  const versioning = read(versioningPath)
  assertIncludes(versioning, 'cli.appVersionSource` is `remote`', 'Mobile versioning guide')
  assertIncludes(versioning, 'The `store-test` profile has `autoIncrement` enabled.', 'Mobile versioning guide')
  assertIncludes(versioning, 'Keep both apps on `EXPO_PUBLIC_SUPABASE_ENV=test` until live release approval is explicit.', 'Mobile versioning guide')
  assertIncludes(versioning, 'Let EAS auto-increment store-test builds.', 'Mobile versioning guide')
}

if (existsSync(join(repoRoot, storeAccountSetupPath))) {
  const storeSetup = read(storeAccountSetupPath)
  assertIncludes(storeSetup, 'MOBILE_RELEASE_STATUS.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_ENVIRONMENT_RUNBOOK.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_NOTIFICATION_RUNBOOK.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_SCREENSHOT_PLAN.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_VERSIONING.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'com.footballplayer.coach', 'Mobile store account setup')
  assertIncludes(storeSetup, 'com.footballplayer.parents', 'Mobile store account setup')
  assertIncludes(storeSetup, 'EXPO_PUBLIC_SUPABASE_ENV=test', 'Mobile store account setup')
  assertIncludes(storeSetup, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', 'Mobile store account setup')
  assertIncludes(storeSetup, 'Do not put real Supabase keys, EAS project IDs, or production API URLs in `.env.example`.', 'Mobile store account setup')
  assertIncludes(storeSetup, 'npm run submit:ios:store-test', 'Mobile store account setup')
  assertIncludes(storeSetup, 'npm run submit:android:store-test', 'Mobile store account setup')
  assertIncludes(storeSetup, 'Do not commit private keys', 'Mobile store account setup')
}

if (existsSync(join(repoRoot, releaseStatusPath))) {
  const releaseStatus = read(releaseStatusPath)
  assertIncludes(releaseStatus, 'npm run mobile:release-check', 'Mobile release status')
  assertIncludes(releaseStatus, 'Both apps are locked to test Supabase by default.', 'Mobile release status')
  assertIncludes(releaseStatus, 'MOBILE_ENVIRONMENT_RUNBOOK.md', 'Mobile release status')
  assertIncludes(releaseStatus, 'MOBILE_NOTIFICATION_RUNBOOK.md', 'Mobile release status')
  assertIncludes(releaseStatus, 'Create Expo EAS projects for both apps.', 'Mobile release status')
  assertIncludes(releaseStatus, 'EAS remote app versioning and store-test auto-increment are configured for both apps.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Verify push notifications on real Android and iOS devices using `MOBILE_NOTIFICATION_RUNBOOK.md`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'MOBILE_SCREENSHOT_PLAN.md', 'Mobile release status')
  assertIncludes(releaseStatus, 'Do not switch either mobile app to live Supabase until live release approval is explicitly given.', 'Mobile release status')
  assertNotIncludes(releaseStatus, 'Confirm final support URL', 'Mobile release status')
}

if (failures.length > 0) {
  console.error('Mobile pre-store check failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Mobile pre-store check passed.')
