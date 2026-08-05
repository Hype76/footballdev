export const APPROVED_MOBILE_TEST = Object.freeze({
  apiOrigin: 'https://footballplayer-mobile-test-api.netlify.app',
  supabaseOrigin: 'https://ndohkecigwlwayghsopw.supabase.co',
  supabaseRef: 'ndohkecigwlwayghsopw',
})

export const MOBILE_EAS_PROJECT_IDS = Object.freeze({
  coach: '347965b1-f32f-47b1-8c86-7aa910fe2cb5',
  parent: '7e0906f3-64f4-42d9-b45d-0ee68f599baa',
})

const LIVE_SUPABASE_REF = 'hvapkizujvsahvgspser'
const RETIRED_SUPABASE_REF = 'llpufwzvgxyczxcjwupu'
const TESTER_PROFILES = new Set(['development', 'internal', 'store-test'])
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function normalize(value) {
  return String(value ?? '').trim()
}

function unique(values) {
  return [...new Set(values)]
}

function decodeBase64Url(value) {
  const input = normalize(value).replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/g, '')
  let bits = 0
  let buffer = 0
  let output = ''

  for (const character of input) {
    const index = BASE64_ALPHABET.indexOf(character)
    if (index < 0) throw new Error('invalid_base64url')
    buffer = (buffer << 6) | index
    bits += 6

    if (bits >= 8) {
      bits -= 8
      output += String.fromCharCode((buffer >> bits) & 0xff)
    }
  }

  return output
}

export function getPublicClientKeyProjectRef(value) {
  try {
    const segments = normalize(value).split('.')
    if (segments.length !== 3) return ''
    const claims = JSON.parse(decodeBase64Url(segments[1]))
    return claims?.role === 'anon' ? normalize(claims.ref) : ''
  } catch {
    return ''
  }
}

function classifySupabaseUrl(value, failures) {
  if (!value) {
    failures.push('missing_required_variable')
    return
  }

  try {
    const url = new URL(value)
    const ref = url.hostname.split('.')[0]

    if (url.protocol !== 'https:') failures.push('unknown_supabase')
    if (ref === LIVE_SUPABASE_REF) failures.push('forbidden_live_supabase')
    else if (ref === RETIRED_SUPABASE_REF) failures.push('forbidden_retired_supabase')
    else if (url.origin !== APPROVED_MOBILE_TEST.supabaseOrigin) failures.push('unknown_supabase')
  } catch {
    failures.push('unknown_supabase')
  }
}

function classifyApiUrl(value, failures) {
  if (!value) {
    failures.push('missing_required_variable')
    return
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') failures.push('insecure_api')
    if (url.hostname === 'footballplayer.online' || url.hostname.endsWith('.footballplayer.online')) {
      failures.push('forbidden_live_api')
    } else if (url.origin !== APPROVED_MOBILE_TEST.apiOrigin) {
      failures.push('unknown_api')
    }
  } catch {
    failures.push('unknown_api')
  }
}

export function validateResolvedMobileEnvironment({
  allowLiveSupabase,
  apiBaseUrl,
  appRole,
  buildProfile,
  easProjectId,
  supabaseEnvironment,
  supabasePublishableKey,
  supabaseUrl,
}) {
  const app = normalize(appRole).toLowerCase()
  const profile = normalize(buildProfile).toLowerCase()
  const classification = normalize(supabaseEnvironment).toLowerCase()
  const liveAccess = normalize(allowLiveSupabase).toLowerCase()
  const failures = []

  if (profile === 'store-live') failures.push('production_build_not_authorised')
  else if (!TESTER_PROFILES.has(profile)) failures.push('invalid_build_profile')

  if (!classification) failures.push('missing_required_variable')
  else if (classification !== 'test') failures.push('invalid_environment_classification')

  if (!liveAccess) failures.push('missing_required_variable')
  else if (liveAccess !== 'false') failures.push('live_access_enabled')

  classifySupabaseUrl(normalize(supabaseUrl), failures)
  classifyApiUrl(normalize(apiBaseUrl), failures)

  const key = normalize(supabasePublishableKey)
  if (!key) failures.push('missing_required_variable')
  else if (getPublicClientKeyProjectRef(key) !== APPROVED_MOBILE_TEST.supabaseRef) failures.push('mismatched_supabase_key')

  const expectedProjectId = MOBILE_EAS_PROJECT_IDS[app]
  if (!expectedProjectId || normalize(easProjectId) !== expectedProjectId) failures.push('wrong_eas_project')

  const reasonCodes = unique(failures)
  return {
    app,
    category: reasonCodes.length === 0 ? 'approved_test_environment' : 'blocked_mobile_environment',
    pass: reasonCodes.length === 0,
    profile,
    reasonCodes: reasonCodes.length === 0
      ? ['approved_test_supabase', 'approved_test_api', 'approved_test_key_pair']
      : reasonCodes,
  }
}
