import { jsonResponse, requireAuthenticatedFixture } from './_shared/environment.mjs'

export default async function handler(request) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  try {
    const result = await requireAuthenticatedFixture(request)
    if (result.response) return result.response
    const coachRoles = new Set([
      'assistant_coach',
      'coach',
      'head_manager',
      'manager',
      'admin',
      'super_admin',
    ])
    if (!coachRoles.has(result.profile.role)) {
      return jsonResponse({ error: 'coach_authority_required' }, 403)
    }

    const fixtureResponse = await fetch(
      `${result.environment.supabaseUrl}/rest/v1/match_days?select=id,team_id,opponent,status&order=match_date.asc&limit=1`,
      { headers: result.headers },
    )
    if (!fixtureResponse.ok) {
      return jsonResponse({ error: 'fixture_lookup_failed' }, 502)
    }

    const [fixture] = await fixtureResponse.json()
    return jsonResponse({ fixture: fixture ?? null })
  } catch {
    return jsonResponse({ error: 'environment_boundary_failed' }, 503)
  }
}

export const config = {
  path: '/api/mobile-test/coach-fixture',
}
