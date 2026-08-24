import assert from 'node:assert/strict'
import test from 'node:test'

import { sendExpoPushMessages } from '../netlify/functions/lib/_expo-push.js'
import {
  buildParentChatMobileNotification,
  buildStaffChatMobileNotification,
  processChatMobileNotifications,
} from '../netlify/functions/process-chat-mobile-notifications.js'

function createFakeClient({ parentIntents = [], staffIntents = [] } = {}) {
  const calls = []

  function builder(table) {
    const state = { table, operation: '', value: null, filters: [] }
    const chain = {
      eq(column, value) {
        state.filters.push([column, value])
        return chain
      },
      in(column, value) {
        state.filters.push([column, value])
        calls.push({ ...state })
        return Promise.resolve({ data: [], error: null })
      },
      insert(value) {
        calls.push({ table, operation: 'insert', value })
        return Promise.resolve({ error: null })
      },
      upsert(value) {
        state.operation = 'upsert'
        state.value = value
        return chain
      },
      select(value) {
        if (!state.operation) state.operation = 'select'
        state.value = value
        return chain
      },
      then(resolve) {
        calls.push({ ...state })
        resolve({ error: null })
      },
      update(value) {
        state.operation = 'update'
        state.value = value
        return chain
      },
    }
    return chain
  }

  return {
    calls,
    from: builder,
    async rpc(name) {
      if (name === 'claim_parent_chat_mobile_notification_intents') return { data: parentIntents, error: null }
      if (name === 'claim_staff_chat_mobile_notification_intents') return { data: staffIntents, error: null }
      return { data: [], error: null }
    },
  }
}

test('Parent and Coach Chat payloads preserve products, deep links, and privacy levels', () => {
  const parentMinimal = buildParentChatMobileNotification({
    recipient_app: 'parent',
    detail_level: 'minimal',
    room_type: 'match_squad',
    room_id: 'room-1',
    parent_link_id: 'link-1',
    team_id: 'team-1',
    expo_push_token: 'ExpoPushToken[parent]',
  })
  const coachDetailed = buildParentChatMobileNotification({
    recipient_app: 'coach',
    detail_level: 'detailed',
    room_type: 'parent_staff',
    room_id: 'room-2',
    context_id: 'team:team-selected-elsewhere',
    team_id: 'team-2',
    expo_push_token: 'ExponentPushToken[coach]',
  })
  const staffDetailed = buildStaffChatMobileNotification({
    detail_level: 'detailed',
    conversation_type: 'team_staff',
    conversation_id: 'conversation-1',
    context_id: 'team:team-selected-elsewhere',
    team_id: 'team-1',
    expo_push_token: 'ExponentPushToken[staff]',
  })

  assert.deepEqual(parentMinimal.data, {
    app: 'parent',
    chatType: 'match_squad',
    clubName: '',
    contextId: '',
    parentLinkId: 'link-1',
    messageId: '',
    roomId: 'room-1',
    route: 'chat',
    teamId: 'team-1',
    teamName: '',
    type: 'parent_chat',
  })
  assert.equal(coachDetailed.data.app, 'coach')
  assert.equal(coachDetailed.data.contextId, 'team:team-2')
  assert.equal(coachDetailed.data.roomId, 'room-2')
  assert.equal(staffDetailed.data.conversationId, 'conversation-1')
  assert.equal(staffDetailed.data.contextId, 'team:team-1')
  assert.equal(staffDetailed.data.type, 'staff_chat')

  for (const payload of [parentMinimal, coachDetailed, staffDetailed]) {
    assert.doesNotMatch(payload.body, /synthetic body|parent name|child name|@/i)
    assert.doesNotMatch(JSON.stringify(payload.data), /body|preview/i)
  }
})

test('processor uses injected provider sender and records deterministic intent outcomes', async () => {
  const parentIntent = {
    intent_id: 1,
    recipient_app: 'parent',
    installation_id: 'parent-install',
    auth_user_id: 'parent-user',
    parent_link_id: 'parent-link',
    club_id: 'club-1',
    team_id: 'team-1',
    context_id: '',
    message_id: 'message-1',
    room_id: 'room-1',
    room_type: 'team',
    detail_level: 'minimal',
    expo_push_token: 'ExpoPushToken[parent-token]',
  }
  const staffIntent = {
    intent_id: 2,
    installation_id: 'coach-install',
    auth_user_id: 'coach-user',
    user_profile_id: 'coach-user',
    club_id: 'club-1',
    team_id: 'team-1',
    context_id: 'team:team-1',
    conversation_id: 'conversation-1',
    conversation_type: 'team_staff',
    detail_level: 'detailed',
    expo_push_token: 'ExponentPushToken[coach-token]',
  }
  const client = createFakeClient({ parentIntents: [parentIntent], staffIntents: [staffIntent] })
  const providerCalls = []

  const result = await processChatMobileNotifications({
    client,
    async sendMessages(messages) {
      providerCalls.push(messages)
      return { sent: 1, failed: 0, invalidTokens: [] }
    },
  })

  assert.deepEqual(result, { claimed: 2, failed: 0, sent: 2, skipped: 0 })
  assert.equal(providerCalls.length, 2)
  assert.equal(providerCalls.flat().length, 2)
  assert.equal(client.calls.filter((call) => ['insert', 'upsert'].includes(call.operation)).length, 2)
  assert.equal(client.calls.filter((call) => call.operation === 'update' && call.value.status === 'sent').length, 2)
})

test('Expo provider helper accepts both current Expo token prefixes without a real network call', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const messages = JSON.parse(options.body)
    requests.push(messages)
    return {
      ok: true,
      async json() {
        return { data: messages.map(() => ({ status: 'ok' })) }
      },
    }
  }

  try {
    const result = await sendExpoPushMessages([
      { to: 'ExponentPushToken[legacy-prefix]', title: 'One' },
      { to: 'ExpoPushToken[current-prefix]', title: 'Two' },
      { to: 'not-a-token', title: 'Ignored' },
    ])
    assert.deepEqual(result, { sent: 2, failed: 0, invalidTokens: [] })
    assert.equal(requests.flat().length, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
