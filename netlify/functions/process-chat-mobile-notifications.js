import { sendExpoPushMessages } from './lib/_expo-push.js'
import { authorizeNativeScheduledRequest } from './lib/_processor-auth.js'
import {
  allowsParentAppNotifications,
  getParentCommunicationChannels,
} from './lib/_parent-communication-preferences.js'

const BATCH_SIZE = 50
const RETRY_DELAY_MS = 60_000

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeDetailLevel(value) {
  return normalizeText(value).toLowerCase() === 'detailed' ? 'detailed' : 'minimal'
}

function safeCode(value, fallback = 'provider_error') {
  return normalizeText(value || fallback).toLowerCase().replace(/[^a-z0-9_:-]+/g, '_').slice(0, 100) || fallback
}

function parentChatLabel(roomType) {
  if (roomType === 'team') return 'Team Chat'
  if (roomType === 'match_squad') return 'Match Squad Chat'
  return 'Parent Chat'
}

function staffChatLabel(conversationType) {
  if (conversationType === 'team_staff') return 'Team Staff Chat'
  if (conversationType === 'player_staff') return 'Player Staff Chat'
  if (conversationType === 'club_staff') return 'Club Staff Chat'
  if (conversationType === 'group') return 'Staff Group Chat'
  return 'Direct Staff Chat'
}

export function buildParentChatMobileNotification(intent = {}) {
  const recipientApp = normalizeText(intent.recipient_app)
  const detailLevel = normalizeDetailLevel(intent.detail_level)
  const chatLabel = parentChatLabel(normalizeText(intent.room_type))
  const isParent = recipientApp === 'parent'

  return {
    body: detailLevel === 'detailed'
      ? `A new message is waiting in ${chatLabel}.`
      : `A new ${chatLabel} update is available.`,
    data: {
      app: isParent ? 'parent' : 'coach',
      chatType: normalizeText(intent.room_type),
      contextId: isParent ? '' : normalizeText(intent.context_id),
      parentLinkId: isParent ? normalizeText(intent.parent_link_id) : '',
      roomId: normalizeText(intent.room_id),
      route: 'chat',
      teamId: normalizeText(intent.team_id),
      type: 'parent_chat',
    },
    sound: 'default',
    title: chatLabel,
    to: normalizeText(intent.expo_push_token),
  }
}

export function buildStaffChatMobileNotification(intent = {}) {
  const detailLevel = normalizeDetailLevel(intent.detail_level)
  const chatLabel = staffChatLabel(normalizeText(intent.conversation_type))

  return {
    body: detailLevel === 'detailed'
      ? `A new message is waiting in ${chatLabel}.`
      : 'A new staff Chat update is available.',
    data: {
      app: 'coach',
      chatType: normalizeText(intent.conversation_type),
      conversationId: normalizeText(intent.conversation_id),
      contextId: normalizeText(intent.context_id),
      route: 'chat',
      teamId: normalizeText(intent.team_id),
      type: 'staff_chat',
    },
    sound: 'default',
    title: chatLabel,
    to: normalizeText(intent.expo_push_token),
  }
}

export function buildParentPollMobileNotification(intent = {}) {
  const detailLevel = normalizeDetailLevel(intent.detail_level)
  return {
    body: detailLevel === 'detailed'
      ? 'A new Parent Poll is ready to answer.'
      : 'A new Poll is available.',
    data: {
      app: 'parent',
      parentLinkId: normalizeText(intent.parent_link_id),
      pollId: normalizeText(intent.poll_id),
      route: 'polls',
      teamId: normalizeText(intent.team_id),
      type: 'parent_poll',
    },
    sound: 'default',
    title: 'Football Player Parents',
    to: normalizeText(intent.expo_push_token),
  }
}

async function updateIntent(client, table, intentId, values) {
  const { error } = await client.from(table).update({
    ...values,
    locked_at: null,
    updated_at: new Date().toISOString(),
  }).eq('id', intentId).eq('status', 'processing')
  if (error) throw error
}

async function logParentChatEvent(client, intent, payload, status) {
  const isParent = intent.recipient_app === 'parent'
  const table = isParent ? 'parent_mobile_notification_events' : 'coach_mobile_notification_events'
  const row = isParent
    ? {
        installation_id: intent.installation_id,
        auth_user_id: intent.auth_user_id,
        parent_link_id: intent.parent_link_id,
        club_id: intent.club_id,
        team_id: intent.team_id,
        intent_type: 'parent_chat',
        title: payload.title,
        body: payload.body,
        data: payload.data,
        status,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      }
    : {
        installation_id: intent.installation_id,
        auth_user_id: intent.auth_user_id,
        user_profile_id: intent.user_profile_id,
        club_id: intent.club_id,
        team_id: intent.team_id,
        intent_type: 'parent_chat',
        title: payload.title,
        body: payload.body,
        data: payload.data,
        status,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      }
  const { error } = await client.from(table).insert(row)
  if (error) console.error('chat_mobile_notification_event_log_failed', { table, code: safeCode(error.code) })
}

async function logStaffChatEvent(client, intent, payload, status) {
  const { error } = await client.from('coach_mobile_notification_events').insert({
    installation_id: intent.installation_id,
    auth_user_id: intent.auth_user_id,
    user_profile_id: intent.user_profile_id,
    club_id: intent.club_id,
    team_id: intent.team_id || null,
    intent_type: 'staff_chat',
    title: payload.title,
    body: payload.body,
    data: payload.data,
    status,
    sent_at: status === 'sent' ? new Date().toISOString() : null,
  })
  if (error) console.error('staff_chat_mobile_notification_event_log_failed', { code: safeCode(error.code) })
}

async function logParentPollEvent(client, intent, payload, status) {
  const { error } = await client.from('parent_mobile_notification_events').insert({
    installation_id: intent.installation_id,
    auth_user_id: intent.auth_user_id,
    parent_link_id: intent.parent_link_id,
    club_id: intent.club_id,
    team_id: intent.team_id || null,
    intent_type: 'parent_poll',
    title: payload.title,
    body: payload.body,
    data: payload.data,
    status,
    sent_at: status === 'sent' ? new Date().toISOString() : null,
  })
  if (error) console.error('parent_poll_mobile_notification_event_log_failed', { code: safeCode(error.code) })
}

async function revokeInvalidInstallation(client, intent, invalidTokens) {
  const token = normalizeText(intent.expo_push_token)
  if (!token || !(invalidTokens || []).includes(token)) return

  if (intent.recipient_app === 'parent') {
    const { error } = await client.from('parent_mobile_push_installations').update({
      auth_user_id: null,
      parent_link_id: null,
      club_id: null,
      team_id: null,
      expo_push_token: null,
      enabled: false,
      status: 'revoked',
      updated_at: new Date().toISOString(),
    }).eq('installation_id', intent.installation_id).eq('expo_push_token', token)
    if (error) throw error
    return
  }

  const { error } = await client.from('coach_mobile_push_installations').update({
    auth_user_id: null,
    user_profile_id: null,
    club_id: null,
    team_id: null,
    context_id: '',
    expo_push_token: null,
    enabled: false,
    status: 'revoked',
    updated_at: new Date().toISOString(),
  }).eq('installation_id', intent.installation_id).eq('expo_push_token', token)
  if (error) throw error
}

async function deliverIntent({ client, intent, kind, sendMessages }) {
  const table = kind === 'parent'
    ? 'parent_chat_mobile_notification_intents'
    : kind === 'parent_poll'
      ? 'parent_poll_mobile_notification_intents'
      : 'staff_chat_mobile_notification_intents'
  const payload = kind === 'parent'
    ? buildParentChatMobileNotification(intent)
    : kind === 'parent_poll'
      ? buildParentPollMobileNotification(intent)
      : buildStaffChatMobileNotification(intent)

  try {
    if (kind === 'parent' || kind === 'parent_poll') {
      const channels = await getParentCommunicationChannels(client, [intent.auth_user_id])
      const channel = channels.get(normalizeText(intent.auth_user_id)) || 'both'
      if (!allowsParentAppNotifications(channel)) {
        await updateIntent(client, table, intent.intent_id, {
          status: 'sent',
          processed_at: new Date().toISOString(),
          safe_error_code: 'communication_preference_email',
        })
        return 'skipped'
      }
    }

    const result = await sendMessages([payload])
    await revokeInvalidInstallation(client, intent, result.invalidTokens)
    const sent = Number(result.sent || 0) === 1 && Number(result.failed || 0) === 0
    const status = sent ? 'sent' : 'failed'

    await updateIntent(client, table, intent.intent_id, sent
      ? {
          status: 'sent',
          processed_at: new Date().toISOString(),
          safe_error_code: null,
        }
      : {
          status: 'failed',
          available_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
          safe_error_code: 'provider_failed',
        })

    if (kind === 'parent') {
      await logParentChatEvent(client, intent, payload, status)
    } else if (kind === 'parent_poll') {
      await logParentPollEvent(client, intent, payload, status)
    } else {
      await logStaffChatEvent(client, intent, payload, status)
    }

    return sent ? 'sent' : 'failed'
  } catch (error) {
    await updateIntent(client, table, intent.intent_id, {
      status: 'failed',
      available_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
      safe_error_code: safeCode(error?.code || error?.name),
    }).catch(() => {})
    return 'failed'
  }
}

async function claimIntents(client, rpcName) {
  const { data, error } = await client.rpc(rpcName, { batch_size_value: BATCH_SIZE })
  if (error) throw error
  return data || []
}

export async function processChatMobileNotifications({
  client,
  sendMessages = sendExpoPushMessages,
} = {}) {
  if (!client) throw new Error('chat_notification_client_required')

  const [parentIntents, staffIntents, pollIntents] = await Promise.all([
    claimIntents(client, 'claim_parent_chat_mobile_notification_intents'),
    claimIntents(client, 'claim_staff_chat_mobile_notification_intents'),
    claimIntents(client, 'claim_parent_poll_mobile_notification_intents'),
  ])
  const summary = {
    claimed: parentIntents.length + staffIntents.length + pollIntents.length,
    failed: 0,
    sent: 0,
    skipped: 0,
  }

  for (const intent of parentIntents) {
    const outcome = await deliverIntent({ client, intent, kind: 'parent', sendMessages })
    summary[outcome] += 1
  }
  for (const intent of staffIntents) {
    const outcome = await deliverIntent({ client, intent, kind: 'staff', sendMessages })
    summary[outcome] += 1
  }
  for (const intent of pollIntents) {
    const outcome = await deliverIntent({ client, intent, kind: 'parent_poll', sendMessages })
    summary[outcome] += 1
  }

  return summary
}

export const config = {
  schedule: '* * * * *',
}

export default async function scheduledHandler(request) {
  const authorization = await authorizeNativeScheduledRequest(request)
  if (!authorization.ok) return authorization.response

  try {
    const { createSupabaseAdminClient } = await import('./lib/_supabase.js')
    const client = createSupabaseAdminClient({
      headers: Object.fromEntries(request.headers.entries()),
    })
    const result = await processChatMobileNotifications({ client })
    console.info('chat_mobile_notification_processing_complete', result)
    return Response.json({ success: true, ...result }, { status: 200 })
  } catch (error) {
    console.error('chat_mobile_notification_processing_failed', {
      code: safeCode(error?.code || error?.name),
    })
    return Response.json({ success: false, message: 'Chat notifications could not be processed.' }, { status: 500 })
  }
}
