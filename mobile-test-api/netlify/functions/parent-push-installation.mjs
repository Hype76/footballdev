import { jsonResponse, requireAuthenticatedFixture } from './_shared/environment.mjs'
import {
  callAuthenticatedRpc,
  isExpoPushToken,
  isInstallationId,
  normalizeDetailLevel,
  requireParentFixture,
} from './_shared/parent-push.mjs'

function normalize(value) {
  return String(value ?? '').trim()
}

function parseBody(request) {
  return request.json().catch(() => ({}))
}

function installationIdFromRequest(request, body) {
  return normalize(body?.installationId || new URL(request.url).searchParams.get('installationId'))
}

export default async function handler(request) {
  if (!['DELETE', 'GET', 'PATCH', 'POST'].includes(request.method)) {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  try {
    const authenticated = await requireAuthenticatedFixture(request)
    if (authenticated.response) return authenticated.response
    const fixture = requireParentFixture(authenticated)
    const body = request.method === 'GET' ? {} : await parseBody(request)
    const installationId = installationIdFromRequest(request, body)

    if (!isInstallationId(installationId)) {
      return jsonResponse({ error: 'invalid_installation_id' }, 400)
    }

    if (request.method === 'GET') {
      const installation = await callAuthenticatedRpc(
        fixture,
        'get_mobile_test_parent_push_installation',
        { p_installation_id: installationId },
      )
      return jsonResponse({ installation, success: true })
    }

    if (request.method === 'DELETE') {
      await callAuthenticatedRpc(
        fixture,
        'unbind_mobile_test_parent_push_installation',
        { p_installation_id: installationId },
      )
      return jsonResponse({ success: true })
    }

    const detailLevel = normalizeDetailLevel(body.detailLevel)

    if (request.method === 'PATCH') {
      const installation = await callAuthenticatedRpc(
        fixture,
        'update_mobile_test_parent_push_preference',
        {
          p_detail_level: detailLevel,
          p_enabled: Boolean(body.enabled),
          p_installation_id: installationId,
        },
      )
      return jsonResponse({ installation, success: true })
    }

    const expoPushToken = normalize(body.expoPushToken)
    const parentLinkId = normalize(body.parentLinkId)
    const platform = normalize(body.platform).toLowerCase()

    if (!isExpoPushToken(expoPushToken) || !isInstallationId(parentLinkId) || !['android', 'ios'].includes(platform)) {
      return jsonResponse({ error: 'invalid_installation_registration' }, 400)
    }

    const installation = await callAuthenticatedRpc(
      fixture,
      'register_mobile_test_parent_push_installation',
      {
        p_app_version: normalize(body.appVersion).slice(0, 40),
        p_build_number: normalize(body.buildNumber).slice(0, 40),
        p_detail_level: detailLevel,
        p_expo_push_token: expoPushToken,
        p_installation_id: installationId,
        p_parent_link_id: parentLinkId,
        p_platform: platform,
      },
    )

    return jsonResponse({ installation, success: true })
  } catch (error) {
    return jsonResponse({ error: error.message || 'parent_push_installation_failed' }, error.status || 503)
  }
}

export const config = {
  path: '/api/mobile-test/parent-push-installation',
}
