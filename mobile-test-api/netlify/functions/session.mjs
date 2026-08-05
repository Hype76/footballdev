import { jsonResponse, requireAuthenticatedFixture } from './_shared/environment.mjs'

export default async function handler(request) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  try {
    const result = await requireAuthenticatedFixture(request)
    if (result.response) return result.response

    return jsonResponse({
      authenticated: true,
      role: result.profile.role,
      clubId: result.profile.club_id,
      environment: result.environment.environment,
    })
  } catch {
    return jsonResponse({ error: 'environment_boundary_failed' }, 503)
  }
}

export const config = {
  path: '/api/mobile-test/session',
}
