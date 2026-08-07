import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  containsForbiddenParentNotificationContent,
  getParentNotificationStatusLabel,
  getParentPushSetupFailureCode,
  isParentInstallationId,
  normalizeParentNotificationDetail,
  normalizeParentNotificationState,
  resolveParentNotificationOpen,
} from '../apps/mobile-core/src/parentNotificationsCore.js'
import {
  buildParentPushMessage,
  isExpoPushToken,
  PARENT_PUSH_INTENTS,
  sendAllowedParentPush,
} from '../mobile-test-api/netlify/functions/_shared/parent-push.mjs'

const migration = await readFile(new URL('../mobile-test-api/migrations/20260807070500_parent_push_installations.sql', import.meta.url), 'utf8')
const client = await readFile(new URL('../apps/parent-mobile/src/notifications.js', import.meta.url), 'utf8')
const app = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
const installationApi = await readFile(new URL('../mobile-test-api/netlify/functions/parent-push-installation.mjs', import.meta.url), 'utf8')
const pushApi = await readFile(new URL('../mobile-test-api/netlify/functions/parent-push-test.mjs', import.meta.url), 'utf8')
const environment = await readFile(new URL('../mobile-test-api/netlify/functions/_shared/environment.mjs', import.meta.url), 'utf8')

test('installation identity is random-looking, app-scoped, environment-scoped, and non-personal', () => {
  assert.equal(isParentInstallationId('ad3d70b6-d2bc-40e4-91b0-959964e61780'), true)
  assert.equal(isParentInstallationId('android-id'), false)
  assert.match(client, /Crypto\.randomUUID\(\)/)
  assert.match(client, /football-player:parent:test:push-installation-id:v1/)
  assert.match(client, /SecureStore\.setItemAsync/)
  assert.doesNotMatch(client, /deviceName|androidId|serial|imei|udid|advertisingId/i)
})

test('push token is never persisted in AsyncStorage and rotation refresh is wired', () => {
  assert.doesNotMatch(client, /AsyncStorage\.(setItem|getItem)\([^\n]*(token|push)/i)
  assert.match(client, /Notifications\.addPushTokenListener/)
  assert.match(client, /getExpoPushTokenAsync/)
  assert.match(client, /getDevicePushTokenAsync/)
  assert.match(client, /devicePushToken/)
  assert.match(client, /PUSH_TOKEN_ATTEMPTS = 2/)
  assert.match(app, /addParentPushTokenListener/)
  assert.match(migration, /unique \(expo_push_token\)/i)
  assert.match(migration, /where expo_push_token = p_expo_push_token[\s\S]*installation_id <> p_installation_id/i)
})

test('push setup failures are categorised without exposing provider payloads', () => {
  assert.equal(
    getParentPushSetupFailureCode({ message: 'FIS_AUTH_ERROR' }, 'device'),
    'PARENT_PUSH_DEVICE_FIREBASE_CONFIGURATION',
  )
  assert.equal(
    getParentPushSetupFailureCode({ code: 'ERR_NOTIFICATIONS_NETWORK_ERROR' }, 'expo'),
    'PARENT_PUSH_EXPO_NETWORK',
  )
  assert.equal(
    getParentPushSetupFailureCode({ code: 'ERR_NOTIFICATIONS_SERVER_ERROR' }, 'expo'),
    'PARENT_PUSH_EXPO_SERVICE',
  )
  assert.equal(
    getParentPushSetupFailureCode({ message: 'storage failed' }, 'local'),
    'PARENT_PUSH_LOCAL_STORAGE_UNAVAILABLE',
  )
  assert.equal(
    getParentPushSetupFailureCode({ message: 'request failed' }, 'api'),
    'PARENT_PUSH_API_REQUEST_UNAVAILABLE',
  )
  assert.equal(
    getParentPushSetupFailureCode({ message: 'permission failed' }, 'permission'),
    'PARENT_PUSH_PERMISSION_PERMISSION_UNAVAILABLE',
  )
  assert.match(app, /Parent notification setup failed\.', normalizeText\(error\?\.code\)/)
  assert.doesNotMatch(app, /Parent notification setup failed\.', error(?:\?\.message)?/)
  assert.match(client, /createSafePushSetupError\(error, 'local'\)/)
  assert.match(client, /createSafePushSetupError\(error, 'api'\)/)
  assert.match(client, /createSafePushSetupError\(error, 'permission'\)/)
})

test('permission is requested only by the explicit enable path', () => {
  const initialize = client.slice(
    client.indexOf('export async function initializeParentNotifications'),
    client.indexOf('export function addParentPushTokenListener'),
  )
  const enable = client.slice(
    client.indexOf('export async function enableParentNotifications'),
    client.indexOf('export async function updateParentNotificationPreference'),
  )
  assert.doesNotMatch(initialize, /requestPermissionsAsync/)
  assert.match(enable, /requestPermissionsAsync/)
  assert.match(enable, /app remains fully usable/i)
})

test('Minimal is the default and Detailed requires an explicit selection', () => {
  assert.equal(normalizeParentNotificationDetail(undefined), 'minimal')
  assert.equal(normalizeParentNotificationDetail('detailed'), 'detailed')
  assert.equal(normalizeParentNotificationDetail('unexpected'), 'minimal')
  assert.deepEqual(normalizeParentNotificationState({ enabled: true, registered: true }), {
    canAskAgain: true,
    detailLevel: 'minimal',
    enabled: true,
    message: '',
    permissionGranted: false,
    permissionStatus: 'undetermined',
    registered: true,
  })
  assert.equal(getParentNotificationStatusLabel({ enabled: true, registered: true }), 'On, Minimal')
  assert.match(app, /onNotificationDetailChange\(choice\.key\)/)
})

test('server-owned notification copy contains no Player full name or private content', () => {
  const playerNames = ['Synthetic Player', 'Another Player']
  for (const intentType of Object.keys(PARENT_PUSH_INTENTS)) {
    for (const detail of ['minimal', 'detailed']) {
      const message = buildParentPushMessage(intentType, detail)
      assert.equal(message.title, 'Football Player Parents')
      assert.equal(containsForbiddenParentNotificationContent(`${message.title} ${message.body}`, playerNames), false)
      assert.equal(message.data.app, 'parent')
      assert.deepEqual(Object.keys(message.data).sort(), ['app', 'intentType', 'route'])
    }
  }
  assert.equal(containsForbiddenParentNotificationContent('Synthetic Player has a new assessment.', playerNames), true)
  assert.doesNotMatch(pushApi, /title\s*[:=]\s*body|body\s*[:=]\s*body/)
})

test('notification opens route only through current authoritative resources', () => {
  assert.deepEqual(resolveParentNotificationOpen({ app: 'parent', route: 'messages', targetId: 'current' }, {
    messages: ['current'],
  }), { tab: 'messages', targetId: 'current' })
  assert.deepEqual(resolveParentNotificationOpen({ app: 'parent', route: 'polls', targetId: 'deleted' }, {
    polls: ['current'],
  }), { tab: 'polls', targetId: '' })
  assert.equal(resolveParentNotificationOpen({ app: 'coach', route: 'messages' }), null)
  assert.equal(resolveParentNotificationOpen({ app: 'parent', route: 'staff' }), null)
  assert.match(app, /loadParentData\(\)\.then/)
})

test('test schema is least-privilege, RLS protected, indexed, and allowlisted to one Android and one iOS slot', () => {
  for (const table of [
    'mobile_test_parent_push_allowlist',
    'mobile_test_parent_push_installations',
    'mobile_test_parent_push_audit',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'))
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'))
  }
  assert.match(migration, /mobile_test_parent_push_installations_auth_status_idx/i)
  assert.match(migration, /mobile_test_parent_push_installations_parent_link_idx/i)
  assert.match(migration, /mobile_test_parent_push_audit_auth_created_idx/i)
  assert.match(migration, /mobile_test_parent_push_audit_installation_idx/i)
  assert.match(migration, /expected_exactly_one_synthetic_mobile_parent/i)
  assert.match(migration, /\(synthetic_parent_id, 'android'\)[\s\S]*\(synthetic_parent_id, 'ios'\)/i)
  assert.match(migration, /set search_path = ''/i)
  assert.match(migration, /auth\.uid\(\)/i)
  assert.match(migration, /ppl\.auth_user_id = caller_id[\s\S]*ppl\.status = 'active'/i)
})

test('logout unbinds server association and unregisters the native push token', () => {
  assert.match(client, /unbindParentNotifications/)
  assert.match(client, /method: 'DELETE'/)
  assert.match(client, /Notifications\.unregisterForNotificationsAsync\(\)/)
  assert.match(app, /onBeforeSignOut=\{unbindParentNotifications\}/)
  assert.match(migration, /expo_push_token = null[\s\S]*status = 'unbound'/i)
})

test('production and uncontrolled recipients are rejected by construction', () => {
  assert.match(environment, /projectRef !== MOBILE_TEST_SUPABASE_REF/)
  assert.match(environment, /forbiddenRefs\.has\(projectRef\)/)
  assert.match(installationApi, /requireAuthenticatedFixture/)
  assert.match(installationApi, /requireParentFixture/)
  assert.match(pushApi, /prepare_mobile_test_parent_push/)
  assert.match(migration, /test_installation_not_allowlisted/)
  assert.match(migration, /test_installation_slot_already_claimed/)
  assert.doesNotMatch(`${installationApi}\n${pushApi}\n${migration}`, /hvapkizujvsahvgspser|llpufwzvgxyczxcjwupu/)
})

test('Expo transport receives one allowlisted safe payload and no caller-authored copy', async () => {
  const calls = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ data: { id: 'ticket-1', status: 'ok' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const result = await sendAllowedParentPush({
      detailLevel: 'minimal',
      expoPushToken: 'ExponentPushToken[synthetic_token_123]',
      intentType: 'parent_poll',
    })
    assert.equal(result.sent, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://exp.host/--/api/v2/push/send')
    const payload = JSON.parse(calls[0].options.body)
    assert.equal(payload.body, 'A new poll is available.')
    assert.equal(payload.data.route, 'polls')
    assert.equal(payload.to, 'ExponentPushToken[synthetic_token_123]')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('invalid tokens and unsupported intents fail closed', async () => {
  assert.equal(isExpoPushToken('not-a-token'), false)
  assert.throws(() => buildParentPushMessage('marketing', 'detailed'), /unsupported/)
  await assert.rejects(() => sendAllowedParentPush({
    detailLevel: 'minimal',
    expoPushToken: 'invalid',
    intentType: 'parent_message',
  }), /token_unavailable/)
})

test('test API authenticates the Parent, forwards only installation data, and audits controlled delivery', async () => {
  const testRef = 'ndohkecigwlwayghsopw'
  const env = {
    FP_COMMUNICATIONS_ENABLED: 'false',
    FP_MOBILE_ENV: 'test',
    FP_PRODUCTION_ACCESS: 'false',
    FP_SCHEDULES_ENABLED: 'false',
    SUPABASE_PROJECT_REF: testRef,
    SUPABASE_PUBLISHABLE_KEY: 'test-only-placeholder',
    SUPABASE_URL: `https://${testRef}.supabase.co`,
  }
  globalThis.Netlify = { env: { get: (name) => env[name] } }
  const installationModule = await import(`../mobile-test-api/netlify/functions/parent-push-installation.mjs?test=${Math.random()}`)
  const pushModule = await import(`../mobile-test-api/netlify/functions/parent-push-test.mjs?test=${Math.random()}`)
  const previousFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).endsWith('/auth/v1/user')) {
      return Response.json({ id: '53e2300d-b72f-4b55-96bb-cca857e5e9aa' })
    }
    if (String(url).includes('/rest/v1/users?')) {
      return Response.json([{ club_id: 'club-1', id: '53e2300d-b72f-4b55-96bb-cca857e5e9aa', role: 'parent_portal', status: 'active' }])
    }
    if (String(url).endsWith('/rpc/register_mobile_test_parent_push_installation')) {
      return Response.json({ detailLevel: 'minimal', enabled: true, platform: 'android', registered: true })
    }
    if (String(url).endsWith('/rpc/prepare_mobile_test_parent_push')) {
      return Response.json([{ detail_level: 'minimal', expo_push_token: 'ExponentPushToken[allowed_test_token]', platform: 'android' }])
    }
    if (String(url).endsWith('/rpc/record_mobile_test_parent_push_result')) {
      return Response.json(true)
    }
    if (String(url) === 'https://exp.host/--/api/v2/push/send') {
      return Response.json({ data: { id: 'ticket-2', status: 'ok' } })
    }
    return Response.json({ message: 'unexpected_request' }, { status: 500 })
  }

  try {
    const installationResponse = await installationModule.default(new Request(
      'https://footballplayer-mobile-test-api.netlify.app/api/mobile-test/parent-push-installation',
      {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic-test-session', 'content-type': 'application/json' },
        body: JSON.stringify({
          appVersion: '1.0.1',
          buildNumber: '9',
          detailLevel: 'minimal',
          expoPushToken: 'ExponentPushToken[allowed_test_token]',
          installationId: 'ad3d70b6-d2bc-40e4-91b0-959964e61780',
          parentLinkId: 'b9686ca3-a65a-4ae3-9070-e95ca9e7cb47',
          platform: 'android',
        }),
      },
    ))
    assert.equal(installationResponse.status, 200)
    const registerCall = calls.find((call) => call.url.endsWith('/rpc/register_mobile_test_parent_push_installation'))
    const registerBody = JSON.parse(registerCall.options.body)
    assert.equal(registerBody.p_installation_id, 'ad3d70b6-d2bc-40e4-91b0-959964e61780')
    assert.equal(registerBody.p_platform, 'android')
    assert.equal('deviceName' in registerBody, false)
    assert.equal('email' in registerBody, false)

    const pushResponse = await pushModule.default(new Request(
      'https://footballplayer-mobile-test-api.netlify.app/api/mobile-test/parent-push-test',
      {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic-test-session', 'content-type': 'application/json' },
        body: JSON.stringify({
          installationId: 'ad3d70b6-d2bc-40e4-91b0-959964e61780',
          intentType: 'parent_poll',
        }),
      },
    ))
    assert.equal(pushResponse.status, 200)
    assert.deepEqual(await pushResponse.json(), {
      detailLevel: 'minimal',
      intentType: 'parent_poll',
      sent: true,
      success: true,
    })
    assert.equal(calls.filter((call) => call.url === 'https://exp.host/--/api/v2/push/send').length, 1)
    assert.equal(calls.filter((call) => call.url.endsWith('/rpc/record_mobile_test_parent_push_result')).length, 1)
  } finally {
    globalThis.fetch = previousFetch
  }
})
