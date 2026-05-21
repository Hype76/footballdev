import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mobileApps } from './mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const apps = mobileApps

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
const easSetupChecklistPath = 'apps/MOBILE_EAS_SETUP_CHECKLIST.md'
const notificationRunbookPath = 'apps/MOBILE_NOTIFICATION_RUNBOOK.md'
const preStoreQaPath = 'apps/MOBILE_PRE_STORE_QA.md'
const reviewerHandoffPath = 'apps/MOBILE_REVIEWER_HANDOFF.md'
const screenshotPlanPath = 'apps/MOBILE_SCREENSHOT_PLAN.md'
const storeAccountSetupPath = 'apps/MOBILE_STORE_ACCOUNT_SETUP.md'
const versioningPath = 'apps/MOBILE_VERSIONING.md'
const releaseStatusPath = 'apps/MOBILE_RELEASE_STATUS.md'
const releasePhasesPath = 'apps/MOBILE_RELEASE_PHASES.md'
const externalEvidencePath = 'apps/MOBILE_EXTERNAL_RELEASE_EVIDENCE.md'
const rootPackagePath = 'package.json'
const sharedAppConfigPath = 'apps/mobile-core/appConfig.cjs'
const mobileAppsRegistryPath = 'apps/scripts/mobile-apps.mjs'
const mobileConfigCheckPath = 'apps/scripts/mobile-config-check.mjs'

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
    const appPackageForVersion = existsSync(join(repoRoot, app.packageJson)) ? JSON.parse(read(app.packageJson)) : null

    assertNotIncludes(appConfig, 'projectId:', `${app.name} app config`)
    assertNotIncludes(appConfig, 'EXPO_PUBLIC_EAS_PROJECT_ID=', `${app.name} app config`)
    assertIncludes(appConfig, `name: '${app.expectedName}'`, `${app.name} app identity`)
    assertIncludes(appConfig, `slug: '${app.slug}'`, `${app.name} app identity`)
    assertIncludes(appConfig, `scheme: '${app.scheme}'`, `${app.name} app identity`)
    assertIncludes(appConfig, `bundleIdentifier: '${app.bundleIdentifier}'`, `${app.name} iOS identity`)
    assertIncludes(appConfig, `packageName: '${app.packageName}'`, `${app.name} Android identity`)
    assertIncludes(appConfig, `appRole: '${app.appRole}'`, `${app.name} app role`)
    if (appPackageForVersion?.version) {
      assertIncludes(appConfig, `version: '${appPackageForVersion.version}'`, `${app.name} app version`)
    }
    assertIncludes(appConfig, 'createMobileExpoConfig', `${app.name} shared app config`)
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
    assertIncludes(easConfig, '"developmentClient": true', `${app.name} EAS development profile`)
    assertIncludes(easConfig, '"distribution": "internal"', `${app.name} EAS internal profile`)
    assertIncludes(easConfig, '"buildType": "apk"', `${app.name} EAS Android internal profile`)
    assertIncludes(easConfig, '"distribution": "store"', `${app.name} EAS store-test profile`)
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
    if (appPackage.scripts?.['build:android:internal'] !== 'npx eas-cli build --profile internal --platform android') {
      failures.push(`${app.name} package must include Android internal build script`)
    }
    if (appPackage.scripts?.['build:android:store-test'] !== 'npx eas-cli build --profile store-test --platform android') {
      failures.push(`${app.name} package must include Android store-test build script`)
    }
    if (appPackage.scripts?.['build:ios:store-test'] !== 'npx eas-cli build --profile store-test --platform ios') {
      failures.push(`${app.name} package must include iOS store-test build script`)
    }
    if (appPackage.scripts?.['export:web'] !== 'expo export --platform web --output-dir dist-web-check') {
      failures.push(`${app.name} package must include mobile web export script`)
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
    assertIncludes(metadata, 'Copyright 2026 Football Player. Powered by pulseslabs.online.', `${app.name} metadata`)
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
    assertIncludes(checklist, 'npm run build:android:internal', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'npm run build:ios:store-test', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'npm run build:android:store-test', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'npm run submit:ios:store-test', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'npm run submit:android:store-test', `${app.name} store submission checklist`)
    assertIncludes(checklist, 'Run only after store records, reviewer credentials, screenshots, reviewer notes, and device QA are complete.', `${app.name} store submission checklist`)
    assertNotIncludes(checklist, 'npx eas-cli build --profile internal --platform android', `${app.name} store submission checklist`)
    assertNotIncludes(checklist, 'npx eas-cli build --profile store-test --platform ios', `${app.name} store submission checklist`)
    assertNotIncludes(checklist, 'npx eas-cli build --profile store-test --platform android', `${app.name} store submission checklist`)
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
  assertIncludes(readme, 'npm run mobile:config', `${app.name} README`)
  assertIncludes(readme, 'EXPO_PUBLIC_SUPABASE_ENV=test', `${app.name} README`)
  assertIncludes(readme, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', `${app.name} README`)
    assertIncludes(readme, '## Submit', `${app.name} README`)
    assertIncludes(readme, 'Run only after the store records, reviewer credentials, screenshots, reviewer notes, physical device QA, and `STORE_SUBMISSION_CHECKLIST.md` are complete.', `${app.name} README`)
    assertIncludes(readme, 'npm run submit:ios:store-test', `${app.name} README`)
    assertIncludes(readme, 'npm run submit:android:store-test', `${app.name} README`)
  }

  app.sourceRoots.forEach((sourceRoot) => scanSource(sourceRoot, app.name))
}

assertFile(sharedPrivacyPath, 'Mobile privacy questionnaire')
assertFile(environmentRunbookPath, 'Mobile environment runbook')
assertFile(easSetupChecklistPath, 'Mobile EAS setup checklist')
assertFile(notificationRunbookPath, 'Mobile notification runbook')
assertFile(preStoreQaPath, 'Mobile pre-store QA')
assertFile(reviewerHandoffPath, 'Mobile reviewer handoff')
assertFile(screenshotPlanPath, 'Mobile screenshot plan')
assertFile(storeAccountSetupPath, 'Mobile store account setup')
assertFile(versioningPath, 'Mobile versioning guide')
assertFile(releaseStatusPath, 'Mobile release status')
assertFile(releasePhasesPath, 'Mobile release phases')
assertFile(externalEvidencePath, 'Mobile external release evidence template')
assertFile(rootPackagePath, 'Root package')
assertFile(sharedAppConfigPath, 'Mobile shared app config')
assertFile(mobileAppsRegistryPath, 'Mobile app registry')
assertFile(mobileConfigCheckPath, 'Mobile config check')
assertNoTrackedMobilePrivateFiles()

const mobileAppsRegistry = existsSync(join(repoRoot, mobileAppsRegistryPath)) ? read(mobileAppsRegistryPath) : ''
const mobileConfigCheck = existsSync(join(repoRoot, mobileConfigCheckPath)) ? read(mobileConfigCheckPath) : ''

assertIncludes(mobileAppsRegistry, 'export const mobileApps', 'Mobile app registry')
assertIncludes(mobileAppsRegistry, "path: 'apps/coach-mobile'", 'Mobile app registry')
assertIncludes(mobileAppsRegistry, "path: 'apps/parent-mobile'", 'Mobile app registry')
assertIncludes(mobileConfigCheck, 'assertStoreSafeApiBaseUrl', 'Mobile config check')
assertIncludes(mobileConfigCheck, 'must use https for release checks when set', 'Mobile config check')
assertIncludes(mobileConfigCheck, 'must not point at a local development host', 'Mobile config check')

const sharedAppConfig = existsSync(join(repoRoot, sharedAppConfigPath)) ? read(sharedAppConfigPath) : ''

assertIncludes(sharedAppConfig, "policy: 'appVersion'", 'Mobile shared app config')
assertIncludes(sharedAppConfig, "buildNumber: '1'", 'Mobile shared app config')
assertIncludes(sharedAppConfig, 'versionCode: 1', 'Mobile shared app config')
assertIncludes(sharedAppConfig, "supabaseEnvironment: process.env.EXPO_PUBLIC_SUPABASE_ENV || 'test'", 'Mobile shared app config')
assertIncludes(sharedAppConfig, "allowLiveSupabase: process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE || 'false'", 'Mobile shared app config')
assertIncludes(sharedAppConfig, 'ITSAppUsesNonExemptEncryption: false', 'Mobile shared app config')
assertIncludes(sharedAppConfig, "icon: './assets/notification-icon.png'", 'Mobile shared app config')
assertIncludes(sharedAppConfig, 'blockedPermissions', 'Mobile shared Android permissions')
assertIncludes(sharedAppConfig, 'android.permission.ACCESS_COARSE_LOCATION', 'Mobile shared Android blocked permissions')
assertIncludes(sharedAppConfig, 'android.permission.ACCESS_FINE_LOCATION', 'Mobile shared Android blocked permissions')
assertIncludes(sharedAppConfig, 'android.permission.BLUETOOTH', 'Mobile shared Android blocked permissions')
assertIncludes(sharedAppConfig, 'android.permission.CAMERA', 'Mobile shared Android blocked permissions')
assertIncludes(sharedAppConfig, 'android.permission.READ_CONTACTS', 'Mobile shared Android blocked permissions')
assertIncludes(sharedAppConfig, 'android.permission.READ_MEDIA_IMAGES', 'Mobile shared Android blocked permissions')
assertIncludes(sharedAppConfig, 'android.permission.READ_MEDIA_VIDEO', 'Mobile shared Android blocked permissions')
assertIncludes(sharedAppConfig, 'android.permission.RECORD_AUDIO', 'Mobile shared Android blocked permissions')
assertIncludes(sharedAppConfig, "'POST_NOTIFICATIONS'", 'Mobile shared Android allowed permissions')
assertIncludes(sharedAppConfig, "'USE_BIOMETRIC'", 'Mobile shared Android allowed permissions')
assertIncludes(sharedAppConfig, "'USE_FINGERPRINT'", 'Mobile shared Android allowed permissions')

const mobileConfig = read('apps/mobile-core/src/config.js')
const mobileActions = read('apps/mobile-core/src/actions.js')
const mobileAuth = read('apps/mobile-core/src/auth.js')
const mobileAssessment = read('apps/mobile-core/src/assessment.js')
const mobileData = read('apps/mobile-core/src/data.js')
const mobileDeviceControls = read('apps/mobile-core/src/deviceControls.js')
const mobileExportWebCheck = read('apps/scripts/mobile-export-web-check.mjs')
const mobileHttp = read('apps/mobile-core/src/http.js')
const mobileNotifications = read('apps/mobile-core/src/notifications.js')
const mobileParentLinks = read('apps/mobile-core/src/parentLinks.js')
const mobileProfile = read('apps/mobile-core/src/profile.js')
const mobileRoutes = read('apps/mobile-core/src/routes.js')
const mobileSupabase = read('apps/mobile-core/src/supabase.js')
const mobileUi = read('apps/mobile-core/src/ui.js')
const expoPushFunction = read('netlify/functions/_expo-push.js')
const sendCoachMobilePushFunction = read('netlify/functions/send-coach-mobile-push.js')
const sendMatchDayPushFunction = read('netlify/functions/send-match-day-push.js')
const sendParentMobilePushFunction = read('netlify/functions/send-parent-mobile-push.js')
assertIncludes(mobileConfig, 'isUsable: isConfigured && !isLiveBlocked', 'Mobile runtime config')
assertIncludes(mobileConfig, 'This app build is not ready for access yet.', 'Mobile runtime config')
assertIncludes(mobileConfig, 'This app build is missing its connection setup.', 'Mobile runtime config')
assertNotIncludes(mobileConfig, 'Live Supabase is blocked', 'Mobile runtime config')
assertNotIncludes(mobileConfig, 'environment variables are missing', 'Mobile runtime config')
assertIncludes(mobileActions, 'export function useMobileActionRunner', 'Mobile action runner')
assertIncludes(mobileActions, "setActiveActionId('')", 'Mobile action runner')
assertIncludes(mobileAuth, 'This app build is missing its connection setup.', 'Mobile auth')
assertNotIncludes(mobileAuth, 'environment variables are missing', 'Mobile auth')
assertIncludes(mobileAssessment, 'export function createAssessmentFieldValues', 'Mobile assessment field defaults')
assertIncludes(mobileAssessment, 'export function resetAssessmentFieldValues', 'Mobile assessment field reset')
assertIncludes(mobileParentLinks, 'export function getParentPortalLinks', 'Mobile parent link selection')
assertIncludes(mobileParentLinks, 'export function getSelectedParentLink', 'Mobile parent link selection')
assertIncludes(mobileParentLinks, 'export function withSelectedParentLink', 'Mobile parent link selection')
assertIncludes(mobileData, "import { getParentPortalLinks, getSelectedParentLink } from './parentLinks'", 'Mobile parent link selection')
assertIncludes(mobileProfile, "import { getSelectedParentLink } from './parentLinks'", 'Mobile parent profile link selection')
assertIncludes(mobileRoutes, 'export function getTabForNotificationRoute', 'Mobile notification route handling')
assertIncludes(mobileRoutes, "normalizedRoute === 'parent-portal' || normalizedRoute === 'matchday'", 'Mobile notification route handling')
assertIncludes(mobileDeviceControls, 'export function useMobileDeviceControls', 'Mobile device controls')
assertIncludes(mobileDeviceControls, 'initializeMobileNotifications', 'Mobile device controls')
assertIncludes(mobileDeviceControls, 'registerNativePushDevice', 'Mobile device controls')
assertIncludes(mobileDeviceControls, 'revokeNativePushDevice', 'Mobile device controls')
assertIncludes(mobileDeviceControls, 'setBiometricEnabled', 'Mobile device controls')
assertIncludes(mobileDeviceControls, 'getAccessToken', 'Mobile device controls')
assertIncludes(mobileDeviceControls, 'initializeMobileNotifications().catch', 'Mobile device controls')
assertIncludes(mobileDeviceControls, 'await refreshDeviceState()', 'Mobile device controls')
assertIncludes(mobileExportWebCheck, "assertExportFile(app, 'index.html')", 'Mobile web export check')
assertIncludes(mobileExportWebCheck, "assertExportFile(app, 'metadata.json')", 'Mobile web export check')
assertIncludes(mobileExportWebCheck, "assertExportDirectoryHasFiles(app, '_expo')", 'Mobile web export check')
assertIncludes(mobileExportWebCheck, "assertExportDirectoryHasFiles(app, 'assets')", 'Mobile web export check')
assertIncludes(mobileHttp, 'fetchJsonWithTimeout', 'Mobile HTTP helper')
assertIncludes(mobileHttp, 'The request timed out. Check your connection and try again.', 'Mobile HTTP helper')
assertNotIncludes(mobileHttp, 'test API URL', 'Mobile HTTP helper')
assertIncludes(mobileNotifications, "const MATCHDAY_CHANNEL_ID = 'matchday'", 'Mobile notifications')
assertIncludes(mobileNotifications, 'register-mobile-push-device', 'Mobile notifications')
assertIncludes(mobileNotifications, 'Notifications.setBadgeCountAsync(0)', 'Mobile notifications')
assertIncludes(mobileNotifications, 'Notifications are not ready for this build.', 'Mobile notifications')
assertIncludes(mobileNotifications, 'Notifications could not be prepared on this device.', 'Mobile notifications')
assertNotIncludes(mobileNotifications, 'mobile API base URL', 'Mobile notifications')
assertNotIncludes(mobileNotifications, 'Expo push token could not be created', 'Mobile notifications')
assertNotIncludes(mobileNotifications, 'Mobile notifications could not be', 'Mobile notifications')
assertIncludes(expoPushFunction, 'DeviceNotRegistered', 'Expo push helper')
assertIncludes(expoPushFunction, 'invalidTokens', 'Expo push helper')
assertIncludes(sendCoachMobilePushFunction, 'revokeMobileDeviceTokens', 'Coach mobile push function')
assertIncludes(sendCoachMobilePushFunction, "status: 'revoked'", 'Coach mobile push function')
assertIncludes(sendMatchDayPushFunction, 'revokeMobileDeviceTokens', 'Matchday mobile push function')
assertIncludes(sendMatchDayPushFunction, "status: 'revoked'", 'Matchday mobile push function')
assertIncludes(sendParentMobilePushFunction, 'revokeMobileDeviceTokens', 'Parent mobile push function')
assertIncludes(sendParentMobilePushFunction, "status: 'revoked'", 'Parent mobile push function')
assertIncludes(mobileProfile, 'This login is not linked to a coach account.', 'Mobile profile access')
assertIncludes(mobileProfile, 'This login is not linked to a parent account.', 'Mobile profile access')
assertNotIncludes(mobileProfile, 'staff mobile account', 'Mobile profile access')
assertNotIncludes(mobileProfile, 'parent portal link', 'Mobile profile access')
assertIncludes(mobileSupabase, 'config.isUsable ? config.supabaseUrl', 'Mobile Supabase client')
assertIncludes(mobileUi, 'Powered by pulseslabs.online', 'Mobile legal footer')
assertIncludes(mobileUi, 'Copyright 2026 Football Player.', 'Mobile legal footer')
assertIncludes(mobileUi, 'visibleOptions', 'Mobile poll option access')
assertIncludes(mobileUi, 'Show all ${poll.options.length} options', 'Mobile poll option access')
assertIncludes(mobileUi, 'export function OverviewPanel', 'Mobile shared overview')
assertIncludes(mobileUi, 'styles.statGrid', 'Mobile shared overview')
assertIncludes(mobileUi, 'export function TabRail', 'Mobile shared tab rail')
assertIncludes(mobileUi, 'tabBasis', 'Mobile shared tab rail')
assertIncludes(mobileUi, 'export function MobileSettingsPanel', 'Mobile shared settings')
assertIncludes(mobileUi, 'Refresh notifications', 'Mobile shared settings')
assertIncludes(mobileUi, 'Biometric unlock', 'Mobile shared settings')
assertIncludes(mobileUi, 'Updated {formatLastUpdated(lastUpdatedAt)}', 'Mobile shared settings')
assertIncludes(mobileUi, 'Connection ready', 'Mobile shared settings')
assertIncludes(mobileUi, 'Connection needs setup', 'Mobile shared settings')
assertIncludes(mobileUi, 'Enable notifications', 'Mobile shared settings')
assertIncludes(mobileUi, 'Disable notifications', 'Mobile shared settings')
assertIncludes(mobileUi, 'export function LoadingScreen', 'Mobile shared fallback screens')
assertIncludes(mobileUi, 'export function AccessScreen', 'Mobile shared fallback screens')
assertIncludes(mobileUi, 'export function LockedScreen', 'Mobile shared fallback screens')
assertIncludes(mobileUi, 'Sign out', 'Mobile shared fallback screens')
assertIncludes(mobileUi, 'Unlock failed.', 'Mobile shared fallback screens')
assertIncludes(mobileUi, 'export function MobileLoginScreen', 'Mobile shared login')
assertIncludes(mobileUi, 'keyboardType="email-address"', 'Mobile shared login')
assertIncludes(mobileUi, 'autoComplete="current-password"', 'Mobile shared login')
assertIncludes(mobileUi, 'disabled={!canSubmit}', 'Mobile shared login')
assertIncludes(mobileUi, 'Log in', 'Mobile shared login')
assertIncludes(mobileUi, 'export function MobileScreen', 'Mobile shared screen chrome')
assertIncludes(mobileUi, 'export function ScreenHeader', 'Mobile shared screen chrome')
assertIncludes(mobileUi, 'export function LoadingRow', 'Mobile shared screen chrome')
assertIncludes(mobileUi, 'export function EmptyState', 'Mobile shared empty state')
assertIncludes(mobileUi, 'export function ChoiceGroup', 'Mobile shared choice controls')
assertIncludes(mobileUi, 'styles.choiceButton', 'Mobile shared choice controls')
assertIncludes(mobileUi, 'export function SegmentedControl', 'Mobile shared segmented controls')
assertIncludes(mobileUi, 'styles.segmentButton', 'Mobile shared segmented controls')
assertIncludes(mobileUi, 'export function Panel', 'Mobile shared layout primitives')
assertIncludes(mobileUi, 'export function ListStack', 'Mobile shared layout primitives')
assertIncludes(mobileUi, 'export function HintText', 'Mobile shared layout primitives')

apps.forEach((app) => {
  const appSource = read(app.sourceRoots[0])
  assertIncludes(appSource, 'MobileScreen', `${app.name} shared screen chrome`)
  assertIncludes(appSource, 'ScreenHeader', `${app.name} shared screen chrome`)
  assertIncludes(appSource, 'LoadingRow', `${app.name} shared loading state`)
  assertIncludes(appSource, 'EmptyState', `${app.name} shared empty state`)
  assertIncludes(appSource, 'ChoiceGroup', `${app.name} shared choice controls`)
  assertIncludes(appSource, 'ListStack', `${app.name} shared layout primitives`)
  assertIncludes(appSource, 'Panel', `${app.name} shared layout primitives`)
  assertIncludes(appSource, 'RefreshControl', `${app.name} pull-to-refresh`)
  assertIncludes(appSource, 'refreshControl={(', `${app.name} pull-to-refresh`)
  assertIncludes(appSource, 'onRefresh={handleRefresh}', `${app.name} pull-to-refresh`)
  assertIncludes(appSource, 'tintColor={colors.accent}', `${app.name} pull-to-refresh`)
  assertIncludes(appSource, 'AppState.addEventListener', `${app.name} foreground refresh`)
  assertIncludes(appSource, "nextState === 'active'", `${app.name} foreground refresh`)
  assertIncludes(appSource, 'lastUpdatedAt', `${app.name} freshness indicator`)
  assertIncludes(appSource, 'showOverview', `${app.name} progressive overview`)
  assertIncludes(appSource, 'OverviewPanel', `${app.name} progressive overview`)
  assertIncludes(appSource, app.restrictedAccessCopy, `${app.name} login copy`)
  assertIncludes(appSource, 'MobileLoginScreen', `${app.name} shared login`)
  assertNotIncludes(appSource, 'Test environment only.', `${app.name} login copy`)
  assertNotIncludes(appSource, 'Log In', `${app.name} button copy`)
  assertNotIncludes(appSource, 'Sign Out', `${app.name} button copy`)
  assertNotIncludes(appSource, 'Enable Notifications', `${app.name} notification copy`)
  assertNotIncludes(appSource, 'Disable Notifications', `${app.name} notification copy`)
  assertNotIncludes(appSource, 'Biometric Unlock', `${app.name} biometric copy`)
  assertNotIncludes(appSource, 'native alerts', `${app.name} notification copy`)
  assertNotIncludes(appSource, 'mobile coach access', `${app.name} access copy`)
  assertNotIncludes(appSource, 'parent portal login', `${app.name} login copy`)
  assertNotIncludes(appSource, 'Supabase:', `${app.name} settings status`)
  assertNotIncludes(appSource, 'API:', `${app.name} settings status`)
})

const coachAppSource = read('apps/coach-mobile/App.js')
assertIncludes(coachAppSource, 'SegmentedControl', 'Coach matchday segmented controls')
assertIncludes(coachAppSource, 'canRecordGoal', 'Coach matchday guardrails')
assertIncludes(coachAppSource, 'Start the match before adding goals.', 'Coach matchday guardrails')
assertIncludes(coachAppSource, "disabled={!['live', 'second_half'].includes(match.status)}", 'Coach matchday guardrails')
assertIncludes(coachAppSource, 'visiblePlayers', 'Coach assessment player access')
assertIncludes(coachAppSource, 'Show all ${players.length} players', 'Coach assessment player access')
assertIncludes(coachAppSource, 'createAssessmentFieldValues(fields, currentValues)', 'Coach assessment field defaults')
assertIncludes(coachAppSource, 'resetAssessmentFieldValues(fields, currentValues)', 'Coach assessment field reset')

if (existsSync(join(repoRoot, rootPackagePath))) {
  const rootPackage = JSON.parse(read(rootPackagePath))
  if (rootPackage.scripts?.['mobile:config'] !== 'node apps/scripts/mobile-config-check.mjs') {
    failures.push('Root package must include mobile:config script')
  }
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
  const privacyQuestionnaire = read(sharedPrivacyPath)
  assertIncludes(privacyQuestionnaire, '# Football Player Mobile Privacy Questionnaire', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'This is a technical implementation summary, not legal advice.', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'Apps do not include in-app purchases.', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'Apps do not collect precise location.', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'Android builds explicitly block location, camera, microphone, contacts, media, and Bluetooth permissions.', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'Android builds request only notification and biometric unlock permissions.', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'Apps use Expo push notification services', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'https://footballplayer.online/gdpr', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'https://footballplayer.online/terms', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'Website and support URL: `https://footballplayer.online/`', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, '## Native Permission Map', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, '`POST_NOTIFICATIONS`', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, '`USE_BIOMETRIC`', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, '`USE_FINGERPRINT`', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, '`android.permission.ACCESS_FINE_LOCATION`', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, '`android.permission.CAMERA`', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, '`android.permission.RECORD_AUDIO`', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'Face ID is used only to unlock a saved session when biometric login is enabled.', 'Mobile privacy questionnaire')
  assertIncludes(privacyQuestionnaire, 'Mobile pre-store checks block common analytics and advertising SDK packages unless the privacy questionnaire is deliberately revised.', 'Mobile privacy questionnaire')
  assertNotIncludes(privacyQuestionnaire, 'Privacy Questionnaire Draft', 'Mobile privacy questionnaire')
  assertNotIncludes(privacyQuestionnaire, 'Use this draft', 'Mobile privacy questionnaire')
  assertNotIncludes(privacyQuestionnaire, 'Apple privacy labels draft', 'Mobile privacy questionnaire')
  assertNotIncludes(privacyQuestionnaire, 'Google Play Data Safety draft', 'Mobile privacy questionnaire')
  assertNotIncludes(privacyQuestionnaire, 'provisional support URL', 'Mobile privacy questionnaire')
}

if (existsSync(join(repoRoot, environmentRunbookPath))) {
  const environmentRunbook = read(environmentRunbookPath)
  assertIncludes(environmentRunbook, 'Do not commit real Supabase keys', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'Both mobile app `.gitignore` files must ignore native build artifacts and private credential files', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, '`npm run mobile:prestore` fails if a mobile `.env` file, native build artifact, or private store credential file is tracked by git.', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'Do not commit EAS project IDs into `app.config.js`.', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'EXPO_PUBLIC_SUPABASE_ENV=test', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'For TestFlight and Google internal builds, `EXPO_PUBLIC_API_BASE_URL` must point at the test API host, not localhost.', 'Mobile environment runbook')
  assertIncludes(environmentRunbook, 'Do not set live Supabase values for either mobile app until live release approval is explicitly given.', 'Mobile environment runbook')
}

if (existsSync(join(repoRoot, easSetupChecklistPath))) {
  const easSetupChecklist = read(easSetupChecklistPath)
  assertIncludes(easSetupChecklist, '# Football Player Mobile EAS Setup Checklist', 'Mobile EAS setup checklist')
  assertIncludes(easSetupChecklist, 'Football Player Coach', 'Mobile EAS setup checklist')
  assertIncludes(easSetupChecklist, 'Football Player Parents', 'Mobile EAS setup checklist')
  assertIncludes(easSetupChecklist, 'com.footballplayer.coach', 'Mobile EAS setup checklist')
  assertIncludes(easSetupChecklist, 'com.footballplayer.parents', 'Mobile EAS setup checklist')
  assertIncludes(easSetupChecklist, 'EXPO_PUBLIC_EAS_PROJECT_ID', 'Mobile EAS setup checklist')
  assertIncludes(easSetupChecklist, 'EXPO_PUBLIC_SUPABASE_ENV=test', 'Mobile EAS setup checklist')
  assertIncludes(easSetupChecklist, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', 'Mobile EAS setup checklist')
  assertIncludes(easSetupChecklist, 'EXPO_PUBLIC_API_BASE_URL` must be HTTPS for TestFlight and Google internal builds.', 'Mobile EAS setup checklist')
  assertIncludes(easSetupChecklist, 'Do not set live Supabase values for either mobile app until live release approval is explicitly given.', 'Mobile EAS setup checklist')
  assertNotIncludes(easSetupChecklist, 'EXPO_PUBLIC_SUPABASE_ENV=live', 'Mobile EAS setup checklist')
  assertNotIncludes(easSetupChecklist, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=true', 'Mobile EAS setup checklist')
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
  assertIncludes(notificationRunbook, 'DeviceNotRegistered', 'Mobile notification runbook')
  assertIncludes(notificationRunbook, 'Stale or uninstalled-device tokens are marked revoked in `mobile_push_devices` after Expo reports `DeviceNotRegistered`.', 'Mobile notification runbook')
}

if (existsSync(join(repoRoot, 'apps/MOBILE_DEVICE_TESTING.md'))) {
  const deviceTesting = read('apps/MOBILE_DEVICE_TESTING.md')
  assertIncludes(deviceTesting, '## Evidence log', 'Mobile device testing')
  assertIncludes(deviceTesting, 'Confirm EAS project setup matches `MOBILE_EAS_SETUP_CHECKLIST.md`.', 'Mobile device testing')
  assertIncludes(deviceTesting, 'Use `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md` as the template', 'Mobile device testing')
  assertIncludes(deviceTesting, 'Build IDs for Coach iOS, Coach Android, Parents iOS, and Parents Android.', 'Mobile device testing')
  assertIncludes(deviceTesting, '`mobile_push_devices` rows created or revoked during the run.', 'Mobile device testing')
  assertIncludes(deviceTesting, '`notification_events` rows for each push test, including failed outcomes.', 'Mobile device testing')
  assertIncludes(deviceTesting, 'Evidence log is complete for the tested builds.', 'Mobile device testing')
}

if (existsSync(join(repoRoot, preStoreQaPath))) {
  const preStoreQa = read(preStoreQaPath)
  assertIncludes(preStoreQa, 'Football Player Coach', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'com.footballplayer.coach', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Football Player Parents', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'com.footballplayer.parents', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Verify each store listing uses the current icons from the app assets.', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'EAS setup: `MOBILE_EAS_SETUP_CHECKLIST.md`', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Complete `MOBILE_EAS_SETUP_CHECKLIST.md` before creating EAS builds.', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Release phases: `MOBILE_RELEASE_PHASES.md`', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'External evidence template: `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Record external QA evidence using `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Verify privacy wording matches `MOBILE_PRIVACY_QUESTIONNAIRE.md`.', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Verify the public support route `https://footballplayer.online/` is monitored before submission.', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Confirm screenshot files meet the current Apple and Google size and format rules in `MOBILE_SCREENSHOT_PLAN.md`.', 'Mobile pre-store QA')
  assertNotIncludes(preStoreQa, 'Privacy questionnaire draft', 'Mobile pre-store QA')
  assertNotIncludes(preStoreQa, 'Reviewer handoff draft', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'npm run mobile:config', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'npm run build:android:internal', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'npm run build:ios:store-test', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'npm run build:android:store-test', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Shared mobile UI renders consistently across both apps for login, headers, tabs, overview, cards, lists, settings, choice controls, and segmented controls.', 'Mobile pre-store QA')
  assertIncludes(preStoreQa, 'Shared mobile device controls behave consistently across both apps for notifications and biometric unlock.', 'Mobile pre-store QA')
  assertNotIncludes(preStoreQa, 'npx eas-cli build --profile internal --platform android', 'Mobile pre-store QA')
  assertNotIncludes(preStoreQa, 'npx eas-cli build --profile store-test --platform ios', 'Mobile pre-store QA')
  assertNotIncludes(preStoreQa, 'npx eas-cli build --profile store-test --platform android', 'Mobile pre-store QA')
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
  assertIncludes(reviewerHandoff, '## Apple Review Notes', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, '## Google Play Review Notes', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Football Player Coach requires login because it is used by authorised football club staff connected to an existing Football Player workspace.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Football Player Parents requires login because it is used by parents and guardians linked to an existing Football Player workspace.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'App access: restricted staff login. Use the supplied test coach account.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'App access: restricted parent login. Use the supplied test parent account.', 'Mobile reviewer handoff')
  assertNotIncludes(reviewerHandoff, 'Apple review notes draft', 'Mobile reviewer handoff')
  assertNotIncludes(reviewerHandoff, 'Google Play review notes draft', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Screenshot checklist', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Confirm reviewer credentials are entered only in App Store Connect and Google Play Console.', 'Mobile reviewer handoff')
  assertNoReviewerCredentialValues(reviewerHandoff, 'Mobile reviewer handoff')
}

if (existsSync(join(repoRoot, screenshotPlanPath))) {
  const screenshotPlan = read(screenshotPlanPath)
  assertIncludes(screenshotPlan, 'Screenshots must come from real store builds, TestFlight builds, or Google internal builds.', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Use test database data only.', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Keep each uploaded screenshot under 10 MB.', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Keep each screenshot between 320 px and 3840 px on each side.', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Use PNG or JPEG files only.', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Coach App Shots', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Parents App Shots', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'coach-ios-07-settings.png', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'coach-android-07-settings.png', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'parents-ios-07-settings.png', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'parents-android-07-settings.png', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'Keep all rejected or alternate screenshots outside the final upload folder so the wrong app or platform image is not selected during submission.', 'Mobile screenshot plan')
  assertIncludes(screenshotPlan, 'No billing, checkout, subscription, Stripe, or bulk email screens are shown.', 'Mobile screenshot plan')
}

if (existsSync(join(repoRoot, versioningPath))) {
  const versioning = read(versioningPath)
  assertIncludes(versioning, 'cli.appVersionSource` is `remote`', 'Mobile versioning guide')
  assertIncludes(versioning, 'The `store-test` profile has `autoIncrement` enabled.', 'Mobile versioning guide')
  assertIncludes(versioning, '`npm run mobile:config` checks the resolved Expo config for app identity, native version values, test Supabase defaults, notification setup, biometric permissions, and blocked Android permissions.', 'Mobile versioning guide')
  assertIncludes(versioning, '`npm run mobile:prestore` checks that each app config version matches its package version.', 'Mobile versioning guide')
  assertIncludes(versioning, '`npm run mobile:prestore` checks that the initial native build numbers remain at `1` while EAS remote versioning handles store-test increments.', 'Mobile versioning guide')
  assertIncludes(versioning, '`npm run mobile:prestore` checks that EAS development, internal, and store-test profiles keep the expected distribution settings.', 'Mobile versioning guide')
  assertIncludes(versioning, '`npm run mobile:prestore` checks that shared native config stays in `apps/mobile-core/appConfig.cjs`.', 'Mobile versioning guide')
  assertIncludes(versioning, 'Keep both apps on `EXPO_PUBLIC_SUPABASE_ENV=test` until live release approval is explicit.', 'Mobile versioning guide')
  assertIncludes(versioning, 'Keep native permission, notification, biometric, runtime version, and test database defaults in `apps/mobile-core/appConfig.cjs`.', 'Mobile versioning guide')
  assertIncludes(versioning, 'Let EAS auto-increment store-test builds.', 'Mobile versioning guide')
}

if (existsSync(join(repoRoot, storeAccountSetupPath))) {
  const storeSetup = read(storeAccountSetupPath)
  assertIncludes(storeSetup, 'MOBILE_RELEASE_STATUS.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_EAS_SETUP_CHECKLIST.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_ENVIRONMENT_RUNBOOK.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_NOTIFICATION_RUNBOOK.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_SCREENSHOT_PLAN.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_EXTERNAL_RELEASE_EVIDENCE.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'MOBILE_VERSIONING.md', 'Mobile store account setup')
  assertIncludes(storeSetup, 'com.footballplayer.coach', 'Mobile store account setup')
  assertIncludes(storeSetup, 'com.footballplayer.parents', 'Mobile store account setup')
  assertIncludes(storeSetup, 'If `eas project:init` offers to write a project ID into `app.config.js`, keep the app config env-driven and put the value in EAS as `EXPO_PUBLIC_EAS_PROJECT_ID` instead.', 'Mobile store account setup')
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
  assertIncludes(releaseStatus, 'For phase ownership and remaining external work, use `MOBILE_RELEASE_PHASES.md`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Focused EAS setup checklist is present at `MOBILE_EAS_SETUP_CHECKLIST.md`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'External release evidence template is present at `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Mobile release phase tracker is present at `MOBILE_RELEASE_PHASES.md`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Resolved Expo app config is checked by `npm run mobile:config`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Both apps are locked to test Supabase by default.', 'Mobile release status')
  assertIncludes(releaseStatus, 'MOBILE_ENVIRONMENT_RUNBOOK.md', 'Mobile release status')
  assertIncludes(releaseStatus, 'MOBILE_NOTIFICATION_RUNBOOK.md', 'Mobile release status')
  assertIncludes(releaseStatus, 'Create Expo EAS projects for both apps using `MOBILE_EAS_SETUP_CHECKLIST.md`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'EAS remote app versioning and store-test auto-increment are configured for both apps.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Shared Expo native app config exists at `apps/mobile-core/appConfig.cjs`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Shared mobile UI now covers login, fallback screens, screen chrome, overview, tab rail, settings, layout panels, lists, choice controls, and segmented controls.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Shared mobile device controls now cover push notification registration, push notification opt out, device notification state, and biometric setting changes.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Shared Expo config now owns native permissions, notification plugin setup, biometric permission text, runtime version policy, and test database defaults for both apps.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Verify push notifications on real Android and iOS devices using `MOBILE_NOTIFICATION_RUNBOOK.md`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'Record external QA and submission evidence using `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.', 'Mobile release status')
  assertIncludes(releaseStatus, 'MOBILE_SCREENSHOT_PLAN.md', 'Mobile release status')
  assertIncludes(releaseStatus, 'Do not switch either mobile app to live Supabase until live release approval is explicitly given.', 'Mobile release status')
  assertNotIncludes(releaseStatus, 'Confirm final support URL', 'Mobile release status')
}

if (existsSync(join(repoRoot, releasePhasesPath))) {
  const releasePhases = read(releasePhasesPath)
  assertIncludes(releasePhases, '## Phase 1: Local Repo Readiness', 'Mobile release phases')
  assertIncludes(releasePhases, 'Status: complete in this branch.', 'Mobile release phases')
  assertIncludes(releasePhases, '## Phase 2: Expo EAS Setup', 'Mobile release phases')
  assertIncludes(releasePhases, 'Use `MOBILE_EAS_SETUP_CHECKLIST.md` for the app-by-app EAS setup steps.', 'Mobile release phases')
  assertIncludes(releasePhases, '## Phase 3: Apple And Google Store Records', 'Mobile release phases')
  assertIncludes(releasePhases, '## Phase 4: Native Builds', 'Mobile release phases')
  assertIncludes(releasePhases, '## Phase 5: Real Device QA', 'Mobile release phases')
  assertIncludes(releasePhases, 'Record release evidence using `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.', 'Mobile release phases')
  assertIncludes(releasePhases, '## Phase 6: Screenshots And Final Store Submission', 'Mobile release phases')
  assertIncludes(releasePhases, 'Do not switch either app to live Supabase until live release approval is explicitly given.', 'Mobile release phases')
}

if (existsSync(join(repoRoot, externalEvidencePath))) {
  const externalEvidence = read(externalEvidencePath)
  assertIncludes(externalEvidence, '# Football Player Mobile External Release Evidence', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, 'Use this template outside git', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, 'Do not commit a completed copy of this file', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, '## EAS Projects', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, '## Native Builds', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, '## Device QA', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, '## Notification Evidence', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, '## Screenshot Evidence', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, '## Store Submission Evidence', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, 'Live Supabase disabled', 'Mobile external release evidence template')
  assertIncludes(externalEvidence, 'EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false', 'Mobile external release evidence template')
  assertNotIncludes(externalEvidence, 'Password:', 'Mobile external release evidence template')
  assertNotIncludes(externalEvidence, 'Email:', 'Mobile external release evidence template')
}

if (failures.length > 0) {
  console.error('Mobile pre-store check failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Mobile pre-store check passed.')
