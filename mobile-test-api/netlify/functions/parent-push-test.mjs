import { jsonResponse, requireAuthenticatedFixture } from './_shared/environment.mjs'
import {
  callAuthenticatedRpc,
  isInstallationId,
  normalizeDetailLevel,
  PARENT_PUSH_INTENTS,
  requireParentFixture,
  sendAllowedParentPush,
} from './_shared/parent-push.mjs'

function normalize(value) {
  return String(value ?? '').trim()
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  try {
    const authenticated = await requireAuthenticatedFixture(request)
    if (authenticated.response) return authenticated.response
    const fixture = requireParentFixture(authenticated)
    const body = await request.json().catch(() => ({}))
    const installationId = normalize(body.installationId)
    const intentType = normalize(body.intentType)

    if (!isInstallationId(installationId) || !PARENT_PUSH_INTENTS[intentType]) {
      return jsonResponse({ error: 'invalid_test_notification_request' }, 400)
    }

    const targets = await callAuthenticatedRpc(
      fixture,
      'prepare_mobile_test_parent_push',
      {
        p_installation_id: installationId,
        p_intent_type: intentType,
      },
    )
    const target = Array.isArray(targets) ? targets[0] : null

    if (!target?.expo_push_token) {
      await callAuthenticatedRpc(
        fixture,
        'record_mobile_test_parent_push_result',
        {
          p_installation_id: installationId,
          p_intent_type: intentType,
          p_result_category: 'rejected',
        },
      ).catch(() => {})
      return jsonResponse({ error: 'allowlisted_installation_unavailable' }, 403)
    }

    const delivery = await sendAllowedParentPush({
      detailLevel: target.detail_level,
      expoPushToken: target.expo_push_token,
      intentType,
    })

    await callAuthenticatedRpc(
      fixture,
      'record_mobile_test_parent_push_result',
      {
        p_installation_id: installationId,
        p_intent_type: intentType,
        p_result_category: delivery.resultCategory,
      },
    )

    return jsonResponse({
      detailLevel: normalizeDetailLevel(target.detail_level),
      intentType,
      sent: delivery.sent,
      success: delivery.sent,
    }, delivery.sent ? 200 : 502)
  } catch (error) {
    return jsonResponse({ error: error.message || 'parent_test_push_failed' }, error.status || 503)
  }
}

export const config = {
  path: '/api/mobile-test/parent-push-test',
}
