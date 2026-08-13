import { jsonResponse, requireAuthenticatedFixture } from './_shared/environment.mjs'
import {
  callCoachRpc,
  isCoachExpoPushToken,
  isCoachInstallationId,
  normalizeCoachDetailLevel,
  requireCoachFixture,
} from './_shared/coach-push.mjs'

const normalize = (value) => String(value ?? '').trim()

async function readBody(request) {
  return request.json().catch(() => ({}))
}

export default async function handler(request) {
  if (!['DELETE', 'GET', 'PATCH', 'POST'].includes(request.method)) return jsonResponse({ error: 'method_not_allowed' }, 405)
  try {
    const authenticated = await requireAuthenticatedFixture(request)
    if (authenticated.response) return authenticated.response
    const fixture = requireCoachFixture(authenticated)
    const body = request.method === 'GET' ? {} : await readBody(request)
    const installationId = normalize(body.installationId || new URL(request.url).searchParams.get('installationId'))
    if (!isCoachInstallationId(installationId)) return jsonResponse({ error: 'invalid_installation_id' }, 400)

    if (request.method === 'GET') {
      const installation = await callCoachRpc(fixture, 'get_mobile_test_coach_push_installation', { p_installation_id: installationId })
      return jsonResponse({ installation, success: true })
    }
    if (request.method === 'DELETE') {
      await callCoachRpc(fixture, 'unbind_mobile_test_coach_push_installation', { p_installation_id: installationId })
      return jsonResponse({ success: true })
    }

    const contextId = normalize(body.contextId)
    const detailLevel = normalizeCoachDetailLevel(body.detailLevel)
    if (!contextId) return jsonResponse({ error: 'staff_context_required' }, 400)
    if (request.method === 'PATCH') {
      const installation = await callCoachRpc(fixture, 'update_mobile_test_coach_push_preference', {
        p_context_id: contextId,
        p_detail_level: detailLevel,
        p_enabled: Boolean(body.enabled),
        p_installation_id: installationId,
      })
      return jsonResponse({ installation, success: true })
    }

    const expoPushToken = normalize(body.expoPushToken)
    const platform = normalize(body.platform).toLowerCase()
    if (!isCoachExpoPushToken(expoPushToken) || !['android', 'ios'].includes(platform)) {
      return jsonResponse({ error: 'invalid_installation_registration' }, 400)
    }
    const installation = await callCoachRpc(fixture, 'register_mobile_test_coach_push_installation', {
      p_app_version: normalize(body.appVersion).slice(0, 40),
      p_build_number: normalize(body.buildNumber).slice(0, 40),
      p_context_id: contextId,
      p_detail_level: detailLevel,
      p_expo_push_token: expoPushToken,
      p_installation_id: installationId,
      p_platform: platform,
    })
    return jsonResponse({ installation, success: true })
  } catch (error) {
    return jsonResponse({ error: error.message || 'coach_push_installation_failed' }, error.status || 503)
  }
}

export const config = { path: '/api/mobile-test/coach-push-installation' }
