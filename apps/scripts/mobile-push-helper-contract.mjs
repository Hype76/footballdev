export const expoPushHelperPath = 'netlify/functions/lib/_expo-push.js'

export const expoPushCallerPaths = [
  'netlify/functions/send-coach-mobile-push.js',
  'netlify/functions/send-match-day-push.js',
  'netlify/functions/send-parent-mobile-push.js',
]

const canonicalExpoPushUrl = 'https://exp.host/--/api/v2/push/send'
const canonicalImport = "import { sendExpoPushMessages } from './lib/_expo-push.js'"

export function validateExpoPushHelperContract({ helperSource = '', callerSources = {} } = {}) {
  const failures = []
  const fail = (message) => failures.push(`Expo push helper ${message}`)

  if (!helperSource.trim()) {
    fail(`is missing: ${expoPushHelperPath}`)
    return failures
  }

  if (!/export\s+async\s+function\s+sendExpoPushMessages\s*\(/.test(helperSource)) {
    fail('must export async function sendExpoPushMessages')
  }

  if (!helperSource.includes(`const EXPO_PUSH_URL = '${canonicalExpoPushUrl}'`)) {
    fail(`must use only the canonical Expo transport ${canonicalExpoPushUrl}`)
  }

  const transportUrls = helperSource.match(/https?:\/\/[^'"\s)]+/g) || []
  if (transportUrls.some((url) => url !== canonicalExpoPushUrl)) {
    fail('must not contain an alternate or insecure transport URL')
  }

  if (/\b(?:process\.env|Netlify\.env)\b/.test(helperSource)) {
    fail('must not select a transport URL or credential through an environment fallback')
  }

  if (/\bAuthorization\b|access[_-]?token|service[_-]?role/i.test(helperSource)) {
    fail('must not embed or request push, Expo, or Supabase credentials')
  }

  if (/\bconsole\.(?:log|info|warn|error|debug)\s*\(/.test(helperSource)) {
    fail('must not log message payloads or full device tokens')
  }

  ;[
    "chunkMessages(messages, size = 100)",
    "startsWith('ExponentPushToken[')",
    'fetch(EXPO_PUSH_URL',
    'response.ok',
    'DeviceNotRegistered',
    'invalidTokens',
  ].forEach((requiredSource) => {
    if (!helperSource.includes(requiredSource)) {
      fail(`must include ${requiredSource}`)
    }
  })

  expoPushCallerPaths.forEach((callerPath) => {
    const callerSource = callerSources[callerPath] || ''

    if (!callerSource.trim()) {
      failures.push(`Expo push caller is missing: ${callerPath}`)
      return
    }

    if (!callerSource.includes(canonicalImport)) {
      failures.push(`Expo push caller must import the canonical shared helper: ${callerPath}`)
    }

    if (!callerSource.includes('sendExpoPushMessages(')) {
      failures.push(`Expo push caller must invoke sendExpoPushMessages: ${callerPath}`)
    }
  })

  return failures
}
