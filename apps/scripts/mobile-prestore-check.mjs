import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const apps = [
  {
    appConfig: 'apps/coach-mobile/app.config.js',
    notificationIcon: 'apps/coach-mobile/assets/notification-icon.png',
    easConfig: 'apps/coach-mobile/eas.json',
    metadata: 'apps/coach-mobile/STORE_METADATA.md',
    name: 'Coach',
    sourceRoots: ['apps/coach-mobile/App.js', 'apps/mobile-core/src'],
  },
  {
    appConfig: 'apps/parent-mobile/app.config.js',
    notificationIcon: 'apps/parent-mobile/assets/notification-icon.png',
    easConfig: 'apps/parent-mobile/eas.json',
    metadata: 'apps/parent-mobile/STORE_METADATA.md',
    name: 'Parents',
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

const failures = []
const sharedPrivacyPath = 'apps/MOBILE_PRIVACY_QUESTIONNAIRE.md'
const reviewerHandoffPath = 'apps/MOBILE_REVIEWER_HANDOFF.md'

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
}

for (const app of apps) {
  assertFile(app.appConfig, `${app.name} app config`)
  assertFile(app.notificationIcon, `${app.name} notification icon`)
  assertFile(app.easConfig, `${app.name} EAS config`)
  assertFile(app.metadata, `${app.name} store metadata`)

  if (existsSync(join(repoRoot, app.appConfig))) {
    const appConfig = read(app.appConfig)
    assertIncludes(appConfig, "const supabaseEnvironment = process.env.EXPO_PUBLIC_SUPABASE_ENV || 'test'", `${app.name} app config`)
    assertIncludes(appConfig, "const allowLiveSupabase = process.env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE || 'false'", `${app.name} app config`)
    assertIncludes(appConfig, 'ITSAppUsesNonExemptEncryption: false', `${app.name} iOS config`)
    assertIncludes(appConfig, "icon: './assets/notification-icon.png'", `${app.name} notifications config`)
  }

  if (existsSync(join(repoRoot, app.easConfig))) {
    const easConfig = read(app.easConfig)
    assertIncludes(easConfig, '"EXPO_PUBLIC_SUPABASE_ENV": "test"', `${app.name} EAS config`)
    assertIncludes(easConfig, '"EXPO_PUBLIC_ALLOW_LIVE_SUPABASE": "false"', `${app.name} EAS config`)
    assertNotIncludes(easConfig, '"EXPO_PUBLIC_SUPABASE_ENV": "live"', `${app.name} EAS config`)
    assertNotIncludes(easConfig, '"EXPO_PUBLIC_ALLOW_LIVE_SUPABASE": "true"', `${app.name} EAS config`)
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

if (existsSync(join(repoRoot, sharedPrivacyPath))) {
  const privacyDraft = read(sharedPrivacyPath)
  assertIncludes(privacyDraft, 'Apps do not include in-app purchases.', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'Apps do not collect precise location.', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'Apps use Expo push notification services', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'https://footballplayer.online/gdpr', 'Mobile privacy questionnaire')
  assertIncludes(privacyDraft, 'https://footballplayer.online/terms', 'Mobile privacy questionnaire')
}

if (existsSync(join(repoRoot, reviewerHandoffPath))) {
  const reviewerHandoff = read(reviewerHandoffPath)
  assertIncludes(reviewerHandoff, 'Do not commit real passwords', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Payments are handled outside the mobile app', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'This review build uses the test database.', 'Mobile reviewer handoff')
  assertIncludes(reviewerHandoff, 'Screenshot checklist', 'Mobile reviewer handoff')
}

if (failures.length > 0) {
  console.error('Mobile pre-store check failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Mobile pre-store check passed.')
