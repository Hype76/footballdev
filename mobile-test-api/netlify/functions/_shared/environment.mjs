const LIVE_SUPABASE_REF = 'hvapkizujvsahvgspser'
const RETIRED_SUPABASE_REF = 'llpufwzvgxyczxcjwupu'
const MOBILE_TEST_SUPABASE_REF = 'ndohkecigwlwayghsopw'

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function requiredEnvironmentValue(name) {
  const value = Netlify.env.get(name)?.trim()
  if (!value) {
    throw new Error(`missing_${name.toLowerCase()}`)
  }
  return value
}

export function requireMobileTestEnvironment() {
  const environment = requiredEnvironmentValue('FP_MOBILE_ENV')
  const projectRef = requiredEnvironmentValue('SUPABASE_PROJECT_REF')
  const supabaseUrl = requiredEnvironmentValue('SUPABASE_URL')
  const publishableKey = requiredEnvironmentValue('SUPABASE_PUBLISHABLE_KEY')
  const productionAccess = requiredEnvironmentValue('FP_PRODUCTION_ACCESS')
  const communicationsEnabled = requiredEnvironmentValue('FP_COMMUNICATIONS_ENABLED')
  const schedulesEnabled = requiredEnvironmentValue('FP_SCHEDULES_ENABLED')

  const parsedUrl = new URL(supabaseUrl)
  const urlProjectRef = parsedUrl.hostname.split('.')[0]
  const forbiddenRefs = new Set([LIVE_SUPABASE_REF, RETIRED_SUPABASE_REF])

  if (
    environment !== 'test' ||
    productionAccess !== 'false' ||
    communicationsEnabled !== 'false' ||
    schedulesEnabled !== 'false' ||
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.hostname !== `${projectRef}.supabase.co` ||
    urlProjectRef !== projectRef ||
    projectRef !== MOBILE_TEST_SUPABASE_REF ||
    forbiddenRefs.has(projectRef)
  ) {
    throw new Error('mobile_test_environment_boundary_failed')
  }

  return {
    environment,
    projectRef,
    supabaseUrl: parsedUrl.origin,
    publishableKey,
    productionAccess: false,
    communicationsEnabled: false,
    schedulesEnabled: false,
  }
}

export async function requireAuthenticatedFixture(request) {
  const environment = requireMobileTestEnvironment()
  const authorization = request.headers.get('authorization')?.trim()

  if (!authorization?.startsWith('Bearer ')) {
    return { response: jsonResponse({ error: 'authentication_required' }, 401) }
  }

  const headers = {
    apikey: environment.publishableKey,
    authorization,
  }
  const authResponse = await fetch(`${environment.supabaseUrl}/auth/v1/user`, { headers })

  if (!authResponse.ok) {
    return { response: jsonResponse({ error: 'invalid_session' }, 401) }
  }

  const authUser = await authResponse.json()
  const profileResponse = await fetch(
    `${environment.supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(authUser.id)}&select=id,role,club_id,status`,
    { headers },
  )

  if (!profileResponse.ok) {
    return { response: jsonResponse({ error: 'profile_lookup_failed' }, 502) }
  }

  const [profile] = await profileResponse.json()
  if (!profile || profile.status !== 'active') {
    return { response: jsonResponse({ error: 'fixture_profile_unavailable' }, 403) }
  }

  return { environment, headers, profile }
}
