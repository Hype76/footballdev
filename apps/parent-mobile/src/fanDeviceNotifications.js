const LEGACY_KEY = 'fan-notification-device'
const pending = new Map()

// Stable across updates, isolated by API environment and authenticated account.
export function fanNotificationPreferenceKey({ userId, apiBaseUrl }) {
  if (!userId || !apiBaseUrl) throw new Error('Sign in to check phone notifications.')
  const encode = value => Array.from(String(value)).map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  return `fan-notification-preference.v1.${encode(apiBaseUrl.replace(/\/$/, ''))}.${encode(userId)}`
}

function checkCurrent(services) {
  if (services.isCurrent && !services.isCurrent()) throw new Error('The notification account changed. Please try again.')
}

async function checked(services, action) {
  checkCurrent(services)
  const result = await action()
  checkCurrent(services)
  return result
}

function serial(services, operation) {
  const key = fanNotificationPreferenceKey(services)
  const task = (pending.get(key) || Promise.resolve()).catch(() => {}).then(() => {
    checkCurrent(services)
    return operation(key)
  })
  pending.set(key, task)
  void task.finally(() => { if (pending.get(key) === task) pending.delete(key) }).catch(() => {})
  return task
}

async function readPreference(services, key) {
  const raw = await checked(services, () => services.secureStore.getItemAsync(key))
  if (!raw) return null
  const value = JSON.parse(raw)
  if (typeof value.enabled !== 'boolean' || !Array.isArray(value.tokens) || !value.tokens.every(token => typeof token === 'string') || (value.legacyToken !== undefined && typeof value.legacyToken !== 'string')) {
    throw new Error('Phone notification preferences could not be checked.')
  }
  return value
}

function save(services, key, preference) {
  return checked(services, () => services.secureStore.setItemAsync(key, JSON.stringify(preference)))
}

function allowed(permission) {
  return permission.status === 'granted' || [2, 3, 4].includes(permission.ios?.status)
}

async function removeTokens(services, key, preference, tokens) {
  for (const token of tokens) await checked(services, () => services.request({ action: 'unregister_device', token }))
  const next = { ...preference, tokens: preference.tokens.filter(token => !tokens.includes(token)) }
  await save(services, key, next)
  return next
}

async function restore(services, key, preference, permission, devicePushToken) {
  const tokenOptions = { projectId: services.projectId, ...(devicePushToken ? { devicePushToken } : {}) }
  const token = (await checked(services, () => services.notifications.getExpoPushTokenAsync(tokenOptions))).data
  if (!token) throw new Error('Phone notification registration could not be checked.')
  // Record attempted registrations before network writes so pause/logout can clean up lost responses.
  preference = { ...preference, enabled: true, tokens: [...new Set([...preference.tokens, token])] }
  await save(services, key, preference)
  const current = await checked(services, () => services.request({ action: 'device_status', token }))
  if (current.registered !== true) {
    await checked(services, () => services.request({ action: 'register_device', token }))
    const confirmation = await checked(services, () => services.request({ action: 'device_status', token }))
    if (confirmation.registered !== true) throw new Error('Phone notification registration could not be confirmed. Please try again.')
  }
  preference = await removeTokens(services, key, preference, preference.tokens.filter(previous => previous !== token))
  // Retain the verified pointer for a rollback to the older client. It cannot grant
  // another account consent because legacy migration still requires server ownership.
  await checked(services, () => services.secureStore.setItemAsync(LEGACY_KEY, token))
  await save(services, key, { ...preference, legacyToken: token })
  return { status: 'enabled', canAskAgain: true, quiet: permission.ios?.status === 3 }
}

export function readFanDeviceNotifications(services, devicePushToken) {
  return serial(services, async key => {
    let preference = await readPreference(services, key)
    if (preference?.enabled && preference.legacyToken) {
      const legacyToken = await checked(services, () => services.secureStore.getItemAsync(LEGACY_KEY))
      if (!legacyToken) {
        // The older app clears this pointer when paused or signed out. Never
        // restore a saved opt-in over that later choice after rolling forward.
        preference = { ...preference, enabled: false }
        await save(services, key, preference)
      }
    }
    if (preference?.enabled === false) {
      await removeTokens(services, key, preference, preference.tokens)
      return { status: 'paused', canAskAgain: true }
    }
    const permission = await checked(services, () => services.notifications.getPermissionsAsync())
    if (!allowed(permission)) return { status: 'off', canAskAgain: permission.canAskAgain !== false }
    if (!preference) {
      const token = await checked(services, () => services.secureStore.getItemAsync(LEGACY_KEY))
      if (!token) return { status: 'not_registered', canAskAgain: true }
      const legacy = await checked(services, () => services.request({ action: 'device_status', token }))
      // A global legacy token is not evidence that this account opted in.
      if (legacy.registered !== true) return { status: 'not_registered', canAskAgain: true }
      preference = { enabled: true, tokens: [token] }
      await save(services, key, preference)
    }
    return restore(services, key, preference, permission, devicePushToken)
  })
}

export function enableFanDeviceNotifications(services) {
  return serial(services, async key => {
    let permission = await checked(services, () => services.notifications.getPermissionsAsync())
    if (!allowed(permission)) permission = await checked(services, () => services.notifications.requestPermissionsAsync())
    if (!allowed(permission)) throw new Error('Notifications are not enabled in your phone settings.')
    const previous = await readPreference(services, key)
    const preference = { enabled: true, tokens: previous?.tokens || [] }
    if (!previous) {
      const legacyToken = await checked(services, () => services.secureStore.getItemAsync(LEGACY_KEY))
      if (legacyToken) {
        const legacy = await checked(services, () => services.request({ action: 'device_status', token: legacyToken }))
        if (legacy.registered === true) preference.tokens.push(legacyToken)
      }
    }
    await save(services, key, preference)
    return restore(services, key, preference, permission)
  })
}

export function disableFanDeviceNotifications(services) {
  return serial(services, async key => {
    const previous = await readPreference(services, key)
    const legacy = await checked(services, () => services.secureStore.getItemAsync(LEGACY_KEY))
    const preference = { enabled: false, tokens: [...new Set([...(previous?.tokens || []), ...(legacy ? [legacy] : [])])] }
    // Persist the explicit opt-out even if unregister temporarily fails.
    await save(services, key, preference)
    // Older clients do not understand the scoped opt-out record.
    await checked(services, () => services.secureStore.deleteItemAsync(LEGACY_KEY))
    await removeTokens(services, key, preference, preference.tokens)
    return { status: 'paused', canAskAgain: true }
  })
}
