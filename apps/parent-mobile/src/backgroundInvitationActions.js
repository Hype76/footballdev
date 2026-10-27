import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { requireOptionalNativeModule } from 'expo-modules-core'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { Platform } from 'react-native'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { createBoundedMobileFetch } from '../../mobile-core/src/mobileFetchCore'
import { fetchJsonWithTimeout, joinApiPath } from '../../mobile-core/src/http'
import { readSavedMobileSession, supabase } from '../../mobile-core/src/supabase'
import { performBackgroundInvitationAction } from './backgroundInvitationActionCore.js'

const TASK_NAME = 'fp.parent.invitation-actions.v1'
const nativeActions = Platform.OS === 'ios' ? requireOptionalNativeModule('ParentNotificationActions') : null
let actionQueue = Promise.resolve()

async function getAuthenticatedClient() {
  const { data, error } = await supabase.auth.getSession()
  const session = data?.session
  if (error || !session?.access_token) throw new Error('invitation_action_sign_in_required')
  const config = getMobileRuntimeConfig('parent')
  if (!config.isUsable) throw new Error('invitation_action_configuration_invalid')
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
      fetch: createBoundedMobileFetch((...args) => fetch(...args)),
    },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const verified = await client.auth.getUser(session.access_token)
  if (verified.error || verified.data?.user?.id !== session.user.id) throw new Error('invitation_action_sign_in_required')
  return { client, session }
}

export function handleBackgroundInvitationResponse(response) {
  if (!['parent_accept', 'parent_decline'].includes(response?.actionIdentifier)) return Promise.resolve({ ignored: true })
  const operation = actionQueue.then(async () => {
    try {
      const result = await performBackgroundInvitationAction(response, {
        getAuthenticatedClient,
        isCurrentSession: async session => {
          const current = await readSavedMobileSession()
          return current?.user?.id === session.user.id && current?.access_token === session.access_token
        },
        readHistory: async key => {
          const value = JSON.parse(await AsyncStorage.getItem(key) || '[]')
          return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
        },
        writeHistory: (key, value) => AsyncStorage.setItem(key, JSON.stringify(value)),
        afterSaved: async ({ action, session, result }) => {
          if (action.kind !== 'training_attendance' || result.changed === false || !result.respondedAt) return
          const config = getMobileRuntimeConfig('parent')
          await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '/.netlify/functions/send-coach-mobile-push'), {
            method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentLinkId: action.parentLinkId, requestPlayerId: action.sourceId,
              respondedAt: result.respondedAt, type: 'training_availability_response' }),
          })
        },
      })
      if (result.saved || result.duplicate) {
        const latest = await Notifications.getLastNotificationResponseAsync().catch(() => null)
        if (latest?.notification?.request?.identifier === response.notification.request.identifier
          && latest.actionIdentifier === response.actionIdentifier) {
          await Notifications.clearLastNotificationResponseAsync().catch(() => {})
        }
      }
      if (result.saved) {
        await Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {})
        await Notifications.scheduleNotificationAsync({ content: {
          title: result.accepted ? 'Invitation accepted' : 'Invitation declined',
          body: 'Your response was saved.', data: { app: 'parent', route: 'invites', parentLinkId: result.action.parentLinkId },
        }, trigger: null }).catch(() => {})
      }
      return result
    } catch {
      await Notifications.scheduleNotificationAsync({ content: {
        title: 'Check your response', body: 'Your response could not be confirmed. Open Football Player Parents to check the invitation and try again.',
        data: { app: 'parent', route: 'invites' },
      }, trigger: null }).catch(() => {})
      return { saved: false }
    }
  })
  actionQueue = operation.catch(() => {})
  return operation
}

TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (!error && data?.actionIdentifier) await handleBackgroundInvitationResponse(data)
})

export async function registerBackgroundInvitationActions() {
  if (Platform.OS === 'web') return
  if (Platform.OS === 'ios') {
    if (!nativeActions) throw new Error('Background invitation actions require the new store version.')
    await nativeActions.registerTaskAsync(TASK_NAME)
  } else {
    await Notifications.registerTaskAsync(TASK_NAME)
  }
}

// Both a foreground listener and the headless task may observe the same response.
// The queue and durable history prevent a second write.
if (Platform.OS !== 'web') Notifications.addNotificationResponseReceivedListener(response => {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) void handleBackgroundInvitationResponse(response)
})
