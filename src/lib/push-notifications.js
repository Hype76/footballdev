import { supabase } from './supabase-client.js'
import { isLiveMatchdayCommunicationAllowed } from './matchday-communication-safety.js'
import { isIosDevice, isStandaloneMode } from './pwa-install.js'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = `${base64String}${padding}`
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }

  return outputArray
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}

async function fetchPushPublicKey() {
  const response = await fetch('/.netlify/functions/parent-push-subscription')
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Notification settings could not be loaded.')
  }

  return String(result.publicKey ?? '').trim()
}

export function getPushSupportState() {
  if (typeof window === 'undefined') {
    return {
      isSupported: false,
      reason: 'Notifications are not available in this browser.',
    }
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return {
      isSupported: false,
      reason: 'This browser does not support push notifications.',
    }
  }

  if (isIosDevice() && !isStandaloneMode()) {
    return {
      isSupported: false,
      reason: 'On iPhone, add the family portal to your Home Screen first, then open it from the app icon.',
      needsIosInstall: true,
    }
  }

  return {
    isSupported: true,
    permission: Notification.permission,
  }
}

export async function getCurrentPushSubscription() {
  const support = getPushSupportState()

  if (!support.isSupported) {
    return null
  }

  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function subscribeToParentPush({ parentLinkId }) {
  const support = getPushSupportState()

  if (!support.isSupported) {
    throw new Error(support.reason)
  }

  const publicKey = await fetchPushPublicKey()

  if (!publicKey) {
    throw new Error('Push notifications are not configured yet.')
  }

  const permission = await Notification.requestPermission()

  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }

  const registration = await navigator.serviceWorker.ready
  const existingSubscription = await registration.pushManager.getSubscription()
  const subscription = existingSubscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  const token = await getAccessToken()

  if (!token) {
    throw new Error('Login is required before enabling notifications.')
  }

  const response = await fetch('/.netlify/functions/parent-push-subscription', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentLinkId,
      subscription: subscription.toJSON(),
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Notifications could not be enabled.')
  }

  return subscription
}

export async function unsubscribeFromParentPush({ parentLinkId }) {
  const subscription = await getCurrentPushSubscription()

  if (!subscription) {
    return false
  }

  const token = await getAccessToken()

  if (!token) {
    throw new Error('Login is required before disabling notifications.')
  }

  const response = await fetch('/.netlify/functions/parent-push-subscription', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentLinkId,
      endpoint: subscription.endpoint,
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Notifications could not be disabled.')
  }

  await subscription.unsubscribe()
  return true
}

export async function sendMatchDayPushNotification({ matchDayId, type, eventId = '', parentLinkId = '', targetParentLinkIds = [] }) {
  if (!isLiveMatchdayCommunicationAllowed({
    env: import.meta.env,
    location: globalThis.window?.location,
  })) {
    return null
  }

  const token = await getAccessToken()

  if (!token || !matchDayId) {
    return null
  }

  try {
    const response = await fetch('/.netlify/functions/send-match-day-push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        matchDayId,
        type,
        eventId,
        parentLinkId,
        targetParentLinkIds,
      }),
    })

    return response.json().catch(() => null)
  } catch (error) {
    console.error(error)
    return null
  }
}

export async function sendParentMobilePushNotification({ id, type }) {
  const token = await getAccessToken()

  if (!token || !id || !type) {
    return null
  }

  try {
    const response = await fetch('/.netlify/functions/send-parent-mobile-push', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id,
        type,
      }),
    })

    return response.json().catch(() => null)
  } catch (error) {
    console.error(error)
    return null
  }
}
