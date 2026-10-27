import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { getBackgroundInvitationAction, getBackgroundInvitationCommand, performBackgroundInvitationAction } from '../apps/parent-mobile/src/backgroundInvitationActionCore.js'

const linkId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const response = (action = 'parent_accept', kind = 'match_attendance') => ({ actionIdentifier: action,
  notification: { request: { identifier: 'notification-1', content: { data: {
    app: 'parent', route: 'invites', invitationId: `${kind}:${requestId}`, parentLinkId: linkId,
  } } } },
})
const invitation = kind => ({ invitation_id: `${kind}:${requestId}`, invitation_type: kind, parent_link_id: linkId,
  source_record_id: requestId, invitation_state: 'active', can_respond: true, role_type: 'scorer' })

test('Accept and Decline map to exact existing match, training and volunteer commands', () => {
  for (const kind of ['match_attendance', 'training_attendance', 'match_role']) {
    for (const action of ['parent_accept', 'parent_decline']) {
      const command = getBackgroundInvitationCommand(getBackgroundInvitationAction(response(action, kind)), [invitation(kind)])
      assert.equal(command.name, kind === 'training_attendance' ? 'respond_parent_portal_training_invitation' : 'respond_parent_portal_match_day_invitation')
      assert.equal(command.args.parent_link_id_value, linkId)
      assert.equal(command.args.response_value, kind === 'match_role' ? action === 'parent_accept' ? 'yes' : 'no' : action === 'parent_accept' ? 'available' : 'unavailable')
    }
  }
})

test('notification delivery and ordinary taps never cause invitation writes', () => {
  assert.equal(getBackgroundInvitationAction({}), null)
  assert.equal(getBackgroundInvitationAction(response('expo.modules.notifications.actions.DEFAULT')), null)
})

test('foreign apps, missing child, malformed requests and a different invitation cannot be answered', () => {
  for (const override of [{ app: 'coach' }, { parentLinkId: '' }, { invitationId: 'match_attendance:bad' }, { route: 'chat' }]) {
    const value = response()
    Object.assign(value.notification.request.content.data, override)
    assert.throws(() => getBackgroundInvitationAction(value), /invalid/)
  }
  const action = getBackgroundInvitationAction(response())
  for (const override of [{ parent_link_id: userId }, { source_record_id: userId }, { invitation_id: `match_attendance:${userId}` },
    { invitation_state: 'cancelled' }, { can_respond: false }, { response_deadline: '2020-01-01T00:00:00Z' }]) {
    assert.throws(() => getBackgroundInvitationCommand(action, [{ ...invitation('match_attendance'), ...override }]), /unavailable|expired/)
  }
})

function dependencies({ owned = true, current = true, error = null, history = [] } = {}) {
  const calls = []
  const session = { access_token: 'test-token', user: { id: userId } }
  const query = { select: () => query, eq: (...args) => { calls.push(['filter', ...args]); return query },
    maybeSingle: async () => ({ data: owned ? { id: linkId } : null }) }
  return { calls, getAuthenticatedClient: async () => ({ session, client: {
    from: () => query,
    rpc: async (name, args) => { calls.push([name, args]); return name === 'get_parent_portal_invitation_summary'
      ? { data: [invitation('match_attendance')] } : { data: error ? null : { changed: true }, error } },
  } }), claimAttempt: async () => true, isCurrentSession: async () => current, readHistory: async () => history,
  writeHistory: async (key, ids) => calls.push(['history', key, ids]) }
}

test('background response checks account and child then writes once and records a durable receipt', async () => {
  const deps = dependencies()
  assert.equal((await performBackgroundInvitationAction(response(), deps)).saved, true)
  assert.ok(deps.calls.some(call => call[0] === 'filter' && call[1] === 'auth_user_id' && call[2] === userId))
  assert.equal(deps.calls.filter(call => call[0] === 'respond_parent_portal_match_day_invitation').length, 1)
  assert.deepEqual(deps.calls.at(-1), ['history', `fp.parent.notification-responses.v1.${userId}`, ['notification-1']])
})

test('a failed press is consumed before writing and cannot replay after connectivity or account changes', async () => {
  const attempted = new Set()
  const claimAttempt = async id => { if (attempted.has(id)) return false; attempted.add(id); return true }
  const failed = { ...dependencies({ error: new Error('offline') }), claimAttempt }
  await assert.rejects(performBackgroundInvitationAction(response(), failed), /offline/)
  const later = { ...dependencies(), claimAttempt }
  assert.equal((await performBackgroundInvitationAction(response(), later)).duplicate, true)
  assert.equal(later.calls.length, 0)
})

test('repeat delivery, revoked child access, changed account and failed writes cannot report success', async () => {
  const duplicate = dependencies({ history: ['notification-1'] })
  assert.equal((await performBackgroundInvitationAction(response(), duplicate)).duplicate, true)
  assert.equal(duplicate.calls.length, 0)
  for (const options of [{ owned: false }, { current: false }, { error: new Error('offline') }]) {
    const deps = dependencies(options)
    await assert.rejects(performBackgroundInvitationAction(response(), deps))
    assert.ok(!deps.calls.some(call => call[0] === 'history'))
    if (options.current === false || options.owned === false) assert.ok(!deps.calls.some(call => call[0].startsWith('respond_')))
  }
})

test('a confirmed response stays saved when receipt storage or Coach push wake-up fails', async () => {
  const deps = dependencies()
  let wakeAttempted = false
  deps.writeHistory = async () => { throw new Error('storage unavailable') }
  deps.afterSaved = async ({ action, session, result }) => {
    wakeAttempted = true
    assert.equal(action.parentLinkId, linkId)
    assert.equal(session.user.id, userId)
    assert.equal(result.changed, true)
    throw new Error('push wake-up unavailable')
  }
  assert.equal((await performBackgroundInvitationAction(response(), deps)).saved, true)
  assert.equal(wakeAttempted, true)
})

test('real background handler clears failed native responses and consumes them across a runtime restart', async () => {
  const source = await readFile(new URL('../apps/parent-mobile/src/backgroundInvitationActions.js', import.meta.url), 'utf8')
  const code = transformSync(source, { loader: 'js', format: 'cjs' }).code
  const storage = new Map(), feedback = [], dismissed = []
  let latest = response(), sessionReads = 0, clears = 0
  const modules = {
    '@react-native-async-storage/async-storage': { getItem: async key => storage.get(key), setItem: async (key, value) => storage.set(key, value) },
    '@supabase/supabase-js': { createClient: () => { throw new Error('No client may be created after failed authentication') } },
    'expo-modules-core': {}, 'react-native': { Platform: { OS: 'android' } },
    'expo-task-manager': { defineTask: () => {} },
    'expo-notifications': { DEFAULT_ACTION_IDENTIFIER: 'default', addNotificationResponseReceivedListener: () => {},
      scheduleNotificationAsync: async value => feedback.push(value), dismissNotificationAsync: async id => dismissed.push(id),
      getLastNotificationResponseAsync: async () => latest, clearLastNotificationResponseAsync: async () => { latest = null; clears += 1 } },
    '../../mobile-core/src/config': {}, '../../mobile-core/src/mobileFetchCore': {}, '../../mobile-core/src/http': {},
    '../../mobile-core/src/supabase': { supabase: { auth: { getSession: async () => { sessionReads += 1; return { error: new Error('offline') } } } } },
    './backgroundInvitationActionCore.js': { getBackgroundInvitationAction, performBackgroundInvitationAction },
  }
  const load = () => {
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, require: name => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected module: ${name}`)
      return modules[name]
    } })
    return module.exports
  }
  assert.equal((await load().handleBackgroundInvitationResponse(response())).saved, false)
  assert.equal(latest, null)
  assert.equal(clears, 1)
  assert.equal(feedback.length, 1)
  assert.equal(feedback[0].content.data.parentLinkId, linkId)
  assert.equal(feedback[0].content.data.invitationId, `match_attendance:${requestId}`)
  assert.equal((await load().handleBackgroundInvitationResponse(response())).duplicate, true)
  assert.equal(sessionReads, 1)
  assert.equal(feedback.length, 1)
  assert.equal(dismissed.length, 2)
  const app = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
  const cachedActionGuard = app.slice(app.indexOf("if (['parent_accept', 'parent_decline'].includes(lastNotificationResponse?.actionIdentifier))"))
    .split('const responseId')[0]
  assert.match(cachedActionGuard, /return undefined/)
  assert.doesNotMatch(cachedActionGuard, /handleBackgroundInvitationResponse|respondToParentInvitation/)
})
